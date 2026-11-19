package model

import (
	"fmt"
	"gorm.io/gorm"
	"math/big"
	"strconv"
	"time"
)

type InvitationRewardPointType struct {
	Id   string `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
}
type InvitationRewardView struct {
	Id                 string                    `json:"id"`
	OrderId            string                    `json:"order_id"`
	OrderLabel         string                    `json:"order_label"`
	InviteeLabel       string                    `json:"invitee_label"`
	CampaignId         string                    `json:"campaign_id"`
	CampaignName       string                    `json:"campaign_name"`
	CampaignVersion    string                    `json:"campaign_version"`
	PointType          InvitationRewardPointType `json:"point_type"`
	PaidAmountMinor    string                    `json:"paid_amount_minor"`
	NetPaidAmountMinor string                    `json:"net_paid_amount_minor"`
	RateBps            int                       `json:"rate_bps"`
	EffectiveCount     string                    `json:"effective_count"`
	PaidAt             string                    `json:"paid_at"`
	ReleaseAt          string                    `json:"release_at"`
	OriginalPoints     string                    `json:"original_points"`
	ProcessingPoints   string                    `json:"processing_points"`
	FrozenPoints       string                    `json:"frozen_points"`
	ReleasedPoints     string                    `json:"released_points"`
	CancelledPoints    string                    `json:"cancelled_points"`
	ReversedPoints     string                    `json:"reversed_points"`
	ReviewDuePoints    string                    `json:"review_due_points"`
	Status             string                    `json:"status"`
}
type InvitationRewardPage struct {
	Page     int                    `json:"page"`
	PageSize int                    `json:"page_size"`
	Total    string                 `json:"total"`
	Items    []InvitationRewardView `json:"items"`
}
type InvitationBalanceSummary struct {
	PointTypeId      string `json:"point_type_id"`
	Code             string `json:"code"`
	Name             string `json:"name"`
	ReleasedTotal    string `json:"released_total"`
	PendingTotal     string `json:"pending_total"`
	ProcessingPoints string `json:"processing_points"`
	FrozenPoints     string `json:"frozen_points"`
	CancelledTotal   string `json:"cancelled_total"`
	ReversedTotal    string `json:"reversed_total"`
}
type InvitationSummary struct {
	BoundFriends     string                     `json:"bound_friends"`
	EffectiveFriends string                     `json:"effective_friends"`
	PendingFriends   string                     `json:"pending_friends"`
	CurrentRateBps   *int                       `json:"current_rate_bps"`
	NextThreshold    *int                       `json:"next_threshold"`
	Balances         []InvitationBalanceSummary `json:"balances"`
}

func invitationRewardView(r InvitationReward) InvitationRewardView {
	s := func(n int64) string { return strconv.FormatInt(n, 10) }
	return InvitationRewardView{Id: s(r.Id), OrderId: s(r.OrderId), OrderLabel: fmt.Sprintf("Subscription #%d", r.OrderId), InviteeLabel: fmt.Sprintf("Friend #%d", r.InviteeId), CampaignId: s(r.CampaignId), CampaignName: r.CampaignName, CampaignVersion: s(r.CampaignVersion), PointType: InvitationRewardPointType{Id: s(r.PointTypeId), Code: r.PointTypeCode, Name: r.PointTypeName}, PaidAmountMinor: s(r.PaidAmountMinor), NetPaidAmountMinor: s(r.NetPaidAmountMinor), RateBps: r.RateBps, EffectiveCount: s(r.EffectiveCount), PaidAt: s(r.PaidAt), ReleaseAt: s(r.ReleaseAt), OriginalPoints: s(r.OriginalPoints), ProcessingPoints: s(r.ProcessingPoints), FrozenPoints: s(r.FrozenPoints), ReleasedPoints: s(r.ReleasedPoints), CancelledPoints: s(r.CancelledPoints), ReversedPoints: s(r.ReversedPoints), ReviewDuePoints: s(r.ReviewDuePoints), Status: r.Status}
}
func ListInvitationRewards(userID int64, admin bool, page, pageSize int, campaignIDs ...int64) (*InvitationRewardPage, error) {
	if (!admin && userID <= 0) || page < 1 || pageSize < 1 || pageSize > 100 {
		return nil, ErrInvitationInvalid
	}
	result := InvitationRewardPage{Page: page, PageSize: pageSize, Items: []InvitationRewardView{}}
	query := DB.Model(&InvitationReward{})
	if len(campaignIDs) > 1 || (len(campaignIDs) == 1 && (campaignIDs[0] <= 0 || !admin)) {
		return nil, ErrInvitationInvalid
	}
	if len(campaignIDs) == 1 {
		query = query.Where("campaign_id = ?", campaignIDs[0])
	}
	if !admin {
		query = query.Where("inviter_id = ?", userID)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	result.Total = strconv.FormatInt(total, 10)
	var rows []InvitationReward
	if err := query.Order("id DESC").Limit(pageSize).Offset((page - 1) * pageSize).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, r := range rows {
		result.Items = append(result.Items, invitationRewardView(r))
	}
	return &result, nil
}
func GetInvitationSummary(userID int64) (*InvitationSummary, error) {
	if userID <= 0 {
		return nil, ErrInvitationInvalid
	}
	result := InvitationSummary{Balances: []InvitationBalanceSummary{}}
	err := invitationTransaction(func() int64 { return time.Now().UnixMilli() }, func(tx *gorm.DB, now int64) error {
		if err := reconcileInvitationQualifications(tx, now); err != nil {
			return err
		}
		var bound, pending int64
		if err := tx.Model(&InvitationBinding{}).Where("inviter_id = ?", userID).Count(&bound).Error; err != nil {
			return err
		}
		effective, err := invitationEffectiveCount(tx, userID)
		if err != nil {
			return err
		}
		if err := tx.Model(&InvitationQualification{}).Where("inviter_id = ? AND qualified_at IS NULL", userID).Count(&pending).Error; err != nil {
			return err
		}
		result.BoundFriends = strconv.FormatInt(bound, 10)
		result.EffectiveFriends = strconv.FormatInt(effective, 10)
		result.PendingFriends = strconv.FormatInt(pending, 10)
		campaign, err := activeInvitationVersion(tx, now)
		if err != nil && err != gorm.ErrRecordNotFound {
			return err
		}
		if campaign != nil && err == nil {
			rate, err := invitationRate(tx, campaign.Id, effective)
			if err != nil {
				return err
			}
			result.CurrentRateBps = &rate
			var next InvitationCampaignTier
			found := tx.Where("version_id = ? AND min_effective_friends > ?", campaign.Id, effective).Order("min_effective_friends ASC").Limit(1).Find(&next)
			if found.Error != nil {
				return found.Error
			}
			if found.RowsAffected > 0 {
				result.NextThreshold = &next.MinEffectiveFriends
			}
		}
		var rows []InvitationReward
		if err := tx.Where("inviter_id = ?", userID).Order("point_type_id ASC, id ASC").Find(&rows).Error; err != nil {
			return err
		}
		type totals struct {
			pointType                                                  InvitationRewardPointType
			released, pending, processing, frozen, cancelled, reversed int64
		}
		sums := map[int64]*totals{}
		ids := []int64{}
		for _, r := range rows {
			sum := sums[r.PointTypeId]
			if sum == nil {
				sum = &totals{pointType: InvitationRewardPointType{Id: strconv.FormatInt(r.PointTypeId, 10), Code: r.PointTypeCode, Name: r.PointTypeName}}
				sums[r.PointTypeId] = sum
				ids = append(ids, r.PointTypeId)
			}
			// Overflow must fail the projection instead of returning a wrapped balance.
			values := []struct {
				dst   *int64
				value int64
			}{{&sum.released, r.ReleasedPoints}, {&sum.pending, r.ProcessingPoints}, {&sum.pending, r.FrozenPoints}, {&sum.processing, r.ProcessingPoints}, {&sum.frozen, r.FrozenPoints}, {&sum.cancelled, r.CancelledPoints}, {&sum.reversed, r.ReversedPoints}}
			for _, v := range values {
				n := new(big.Int).Add(big.NewInt(*v.dst), big.NewInt(v.value))
				if !n.IsInt64() {
					return ErrInvitationInvalid
				}
				*v.dst = n.Int64()
			}
		}
		for _, id := range ids {
			v := sums[id]
			result.Balances = append(result.Balances, InvitationBalanceSummary{PointTypeId: v.pointType.Id, Code: v.pointType.Code, Name: v.pointType.Name, ReleasedTotal: strconv.FormatInt(v.released, 10), PendingTotal: strconv.FormatInt(v.pending, 10), ProcessingPoints: strconv.FormatInt(v.processing, 10), FrozenPoints: strconv.FormatInt(v.frozen, 10), CancelledTotal: strconv.FormatInt(v.cancelled, 10), ReversedTotal: strconv.FormatInt(v.reversed, 10)})
		}
		return nil
	})
	return &result, err
}

// InvitationRefundView exposes refund evidence only through the administrator list.
type InvitationRefundView struct {
	Id               string  `json:"id"`
	OrderId          string  `json:"order_id"`
	CampaignName     string  `json:"campaign_name"`
	AmountMinor      string  `json:"amount_minor"`
	Status           string  `json:"status"`
	Provider         string  `json:"provider"`
	ProviderRefundId *string `json:"provider_refund_id"`
	PreparedAt       string  `json:"prepared_at"`
	CompletedAt      *string `json:"completed_at"`
	CancelledAt      *string `json:"cancelled_at"`
}
type InvitationRefundPage struct {
	Page     int                    `json:"page"`
	PageSize int                    `json:"page_size"`
	Total    string                 `json:"total"`
	Items    []InvitationRefundView `json:"items"`
}

func ListInvitationRefunds(page, pageSize int) (*InvitationRefundPage, error) {
	if page < 1 || pageSize < 1 || pageSize > 100 {
		return nil, ErrInvitationInvalid
	}
	result := InvitationRefundPage{Page: page, PageSize: pageSize, Items: []InvitationRefundView{}}
	var total int64
	if err := DB.Model(&InvitationRefundOperation{}).Count(&total).Error; err != nil {
		return nil, err
	}
	result.Total = strconv.FormatInt(total, 10)
	var rows []InvitationRefundOperation
	if err := DB.Order("id DESC").Limit(pageSize).Offset((page - 1) * pageSize).Find(&rows).Error; err != nil {
		return nil, err
	}
	orderIDs := make([]int64, 0, len(rows))
	for _, r := range rows {
		orderIDs = append(orderIDs, r.OrderId)
	}
	var rewards []InvitationReward
	if len(orderIDs) > 0 {
		if err := DB.Select("order_id", "campaign_name").Where("order_id IN ?", orderIDs).Find(&rewards).Error; err != nil {
			return nil, err
		}
	}
	names := make(map[int64]string, len(rewards))
	for _, r := range rewards {
		names[r.OrderId] = r.CampaignName
	}
	for _, r := range rows {
		view := InvitationRefundView{Id: strconv.FormatInt(r.Id, 10), OrderId: strconv.FormatInt(r.OrderId, 10), CampaignName: names[r.OrderId], AmountMinor: strconv.FormatInt(r.AmountMinor, 10), Status: r.Status, Provider: r.Provider, ProviderRefundId: r.ProviderRefundId, PreparedAt: strconv.FormatInt(r.PreparedAt, 10)}
		if r.CompletedAt != nil {
			value := strconv.FormatInt(*r.CompletedAt, 10)
			view.CompletedAt = &value
		}
		if r.CancelledAt != nil {
			value := strconv.FormatInt(*r.CancelledAt, 10)
			view.CancelledAt = &value
		}
		result.Items = append(result.Items, view)
	}
	return &result, nil
}
