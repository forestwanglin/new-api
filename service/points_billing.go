package service

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

func newPointsBillingSession(c *gin.Context, info *relaycommon.RelayInfo, quota int) (*BillingSession, *types.NewAPIError) {
	if info == nil || quota < 0 {
		return nil, types.NewError(model.ErrPointCallInvalid, types.ErrorCodeInvalidRequest)
	}
	if info.RequestId == "" {
		info.RequestId = common.NewRequestId()
	}
	session := &BillingSession{relayInfo: info, pointsMode: true, pointsContext: c, funding: &WalletFunding{userId: info.UserId}}
	// A truly free route has no holdings. A zero estimate on a possibly paid
	// route still snapshots conversion and eligible account identity.
	surcharge := model_setting.GetGrokSettings()
	hasFee := surcharge != nil && surcharge.ViolationDeductionEnabled && surcharge.ViolationDeductionAmount > 0
	if info.PriceData.FreeModel && !hasFee {
		session.freePoints = true
		return session, nil
	}
	rate, unit := operation_setting.USDExchangeRate, common.QuotaPerUnit
	if math.IsNaN(rate) || math.IsInf(rate, 0) || rate <= 0 || math.IsNaN(unit) || math.IsInf(unit, 0) || unit <= 0 {
		return nil, types.NewError(model.ErrPointCallInvalid, types.ErrorCodeModelPriceError)
	}
	tokenID := info.TokenId
	if info.IsPlayground {
		tokenID = 0
	}
	id := info.RequestId
	channelID := selectedPointsChannel(c, info)
	if err := model.CreatePointCallForRoute(id, info.UserId, tokenID, info.OriginModelName, strconv.FormatFloat(rate, 'f', -1, 64), strconv.FormatFloat(unit, 'f', -1, 64), channelID, info.UsingGroup); err != nil {
		return nil, pointsBillingAPIError(err)
	}
	session.pointsID = id
	info.PointsBillingID = id
	if err := model.ReservePointCall(id, fmt.Sprintf("%s:reserve:%d", id, quota), quota, info.TokenUnlimited); err != nil {
		return nil, pointsBillingAPIError(err)
	}
	session.preConsumedQuota = quota
	session.tokenConsumed = quota
	info.BillingSource = BillingSourceWallet
	info.SubscriptionId = 0
	info.SubscriptionPreConsumed = 0
	info.FinalPreConsumedQuota = quota
	// ReservePointCall records dispatch intent in the same transaction as the
	// initial hold, so no later marker failure can strand an unsubmitted hold.
	if c != nil {
		c.Set("points_billing_session", session)
	}
	return session, nil
}
func pointsBillingAPIError(err error) *types.NewAPIError {
	if errors.Is(err, model.ErrInsufficientPoints) || errors.Is(err, model.ErrTokenPointLimit) {
		return types.NewErrorWithStatusCode(err, types.ErrorCodeInsufficientUserQuota, http.StatusForbidden, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
	}
	return types.NewError(err, types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
}

// The context holds this attempt's channel before ChannelMeta is rebuilt by
// the transport. Prefer it to the previous attempt's cached metadata.
func selectedPointsChannel(c *gin.Context, info *relaycommon.RelayInfo) int {
	if c != nil {
		if channelID := c.GetInt("channel_id"); channelID > 0 {
			return channelID
		}
	}
	if info != nil && info.ChannelMeta != nil {
		return info.ChannelId
	}
	return 0
}

// PreparePointsBillingForSelectedChannel is called even for legacy/non-tiered
// prices before each relay attempt; unchanged estimates must still check routes.
func PreparePointsBillingForSelectedChannel(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	if info == nil {
		return nil
	}
	s, ok := info.Billing.(*BillingSession)
	if !ok || !s.pointsMode || s.freePoints {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if c != nil {
		s.pointsContext = c
	}
	if err := s.pointsReserve(s.preConsumedQuota); err != nil {
		return pointsBillingAPIError(err)
	}
	return nil
}

func (s *BillingSession) pointsReserve(target int) error {
	if target < 0 {
		return model.ErrPointCallInvalid
	}
	if PointsBillingOutcomeUncertain(s.relayInfo.LastError) {
		s.pointsUncertain = true
	}
	if s.pointsUncertain || s.settled || s.refunded {
		return model.ErrPointCallConflict
	}
	if s.freePoints {
		if target == 0 {
			return nil
		}
		return model.ErrInsufficientPoints
	}
	target = max(target, s.preConsumedQuota)
	channelID := selectedPointsChannel(s.pointsContext, s.relayInfo)
	allowRebind := !s.pointsObserved && s.relayInfo.LastError != nil && !PointsBillingOutcomeUncertain(s.relayInfo.LastError)
	event := fmt.Sprintf("%s:r:%d:%d:%d", s.pointsID, s.relayInfo.RetryIndex, channelID, target)
	if err := model.ReservePointCallForRoute(s.pointsID, event, target, s.relayInfo.TokenUnlimited, channelID, s.relayInfo.UsingGroup, allowRebind); err != nil {
		return err
	}
	s.preConsumedQuota = target
	s.tokenConsumed = target
	s.relayInfo.FinalPreConsumedQuota = target
	return nil
}

func (s *BillingSession) pointsSettle(target int, final bool) error {
	if s.freePoints {
		if target != 0 {
			return model.ErrInsufficientPoints
		}
		s.recordPointsMetadata(&model.PointBillingMetadata{Version: 1, CallID: s.relayInfo.RequestId, EventID: s.relayInfo.RequestId + ":free", Status: "committed", TotalPoints: "0", Items: []model.PointBillingItem{}})
		s.settled = final
		return nil
	}
	if target > 0 {
		s.pointsObserved = true
	}
	event := fmt.Sprintf("%s:base:%d:%d:%t", s.pointsID, s.pointsEventSequence, target, final)
	result, err := model.SetPointCallTarget(s.pointsID, event, target, final, false, nil)
	if err != nil {
		s.recordPointsMetadata(&model.PointBillingMetadata{Version: 1, CallID: s.pointsID, EventID: event, Status: "pending", TotalPoints: "0", Items: []model.PointBillingItem{}})
		return err
	}
	model.SyncPointCallCaches(result.Call.UserID, result.Call.TokenID)
	s.pointsEventSequence++
	s.recordPointsMetadata(&result.Metadata)
	s.settled = final
	s.fundingSettled = true
	return nil
}
func (s *BillingSession) recordPointsMetadata(meta *model.PointBillingMetadata) {
	s.relayInfo.PointsBillingMetadata = meta
	if s.pointsContext != nil {
		s.pointsContext.Set("points_billing", meta)
	}
}

// Realtime usage frames are already observed usage, not predicted work. They
// advance a durable cumulative target and may incur debt, never drop a charge
// because the completed frame exceeded its hold. Initial admission still holds
// the transport estimate before establishing the upstream connection.
func pointsRealtimeConsume(info *relaycommon.RelayInfo, quota int) error {
	s, ok := info.Billing.(*BillingSession)
	if !ok || !s.pointsMode {
		return model.ErrPointCallInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if quota < 0 || s.pointsRealtimeQuota > math.MaxInt-quota {
		return model.ErrPointCallInvalid
	}
	s.pointsRealtimeQuota += quota
	return s.pointsSettle(s.pointsRealtimeQuota, false)
}

// PointsBillingOutcomeUncertain identifies errors without authoritative upstream
// rejection. They must neither retry work nor release the call's reservation.
func PointsBillingOutcomeUncertain(apiErr *types.NewAPIError) bool {
	if apiErr == nil {
		return false
	}
	switch apiErr.GetErrorCode() {
	case types.ErrorCodeDoRequestFailed, types.ErrorCodeReadResponseBodyFailed,
		types.ErrorCodeBadResponse, types.ErrorCodeBadResponseBody,
		types.ErrorCodeEmptyResponse, types.ErrorCodeAwsInvokeError,
		types.ErrorCodeChannelResponseTimeExceeded:
		return true
	}
	return false
}

func PreserveUncertainPointsBilling(info *relaycommon.RelayInfo) {
	if info == nil {
		return
	}
	s, ok := info.Billing.(*BillingSession)
	if !ok || !s.pointsMode || s.freePoints {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.settled || s.refunded {
		return
	}
	s.pointsUncertain = true
	if s.pointsContext != nil {
		s.pointsContext.Set("points_upstream_uncertain", true)
	}
	s.recordPointsMetadata(&model.PointBillingMetadata{Version: 1, CallID: s.pointsID, EventID: s.pointsID + ":uncertain", Status: "pending", TotalPoints: "0", Items: []model.PointBillingItem{}})
}
