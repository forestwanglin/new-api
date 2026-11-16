package controller

import (
	"errors"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

var invitationShareCode = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func invitationError(c *gin.Context, err error) {
	code, message := "INVITATION_FAILED", "Failed to process invitation"
	for _, item := range []struct {
		err           error
		code, message string
	}{
		{model.ErrInvitationInvalid, "INVALID_INVITATION", "Invalid invitation parameters"},
		{model.ErrInvitationStartPassed, "CAMPAIGN_START_PASSED", "Campaign start time has passed. Edit the campaign dates before publishing."},
		{model.ErrInvitationNotFound, "INVITATION_NOT_FOUND", "Invitation not found"},
		{model.ErrInvitationConflict, "INVITATION_CONFLICT", "Invitation version conflict"},
		{model.ErrInvitationAlreadyBound, "ALREADY_BOUND", "An inviter has already been bound"},
		{model.ErrInvitationSelf, "SELF_INVITATION", "You cannot invite yourself"},
		{model.ErrInvitationCycle, "INVITATION_CYCLE", "Invitation relationship would create a cycle"},
		{model.ErrInvitationOverlap, "CAMPAIGN_OVERLAP", "Invitation campaign periods overlap"},
		{model.ErrInvitationPointType, "INVALID_POINT_TYPE", "Invalid invitation reward point type"},
		{model.ErrInvitationRefundConflict, "REFUND_CONFLICT", "Invitation refund conflicts with the current order"},
		{model.ErrInvitationReviewRequired, "REVIEW_REQUIRED", "Invitation reward requires manual review"},
	} {
		if errors.Is(err, item.err) {
			code, message = item.code, item.message
			break
		}
	}
	common.ApiErrorStatus(c, http.StatusOK, common.NewMessage(message), gin.H{"code": code})
}

func invitationPagination(c *gin.Context) (int, int, bool) {
	values, err := url.ParseQuery(c.Request.URL.RawQuery)
	if err != nil {
		return 0, 0, false
	}
	page, size := int64(1), int64(20)
	for key, v := range values {
		if len(v) != 1 || (key != "p" && key != "page_size") {
			return 0, 0, false
		}
		n, ok := customSubscriptionInt(v[0], true)
		if !ok {
			return 0, 0, false
		}
		if key == "p" {
			page = n
		} else {
			size = n
		}
	}
	if size > 100 || page-1 > int64(math.MaxInt32)/size {
		return 0, 0, false
	}
	return int(page), int(size), true
}
func invitationNoQuery(c *gin.Context) bool { return c.Request.URL.RawQuery == "" }

func readInvitationBody(c *gin.Context, dst any, required, optional string) bool {
	if !invitationNoQuery(c) || c.ContentType() != "application/json" {
		return false
	}
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 32768))
	var fields map[string]common.RawMessage
	if err != nil || !utf8.Valid(body) || common.Unmarshal(body, &fields) != nil || fields == nil {
		return false
	}
	allowed := map[string]bool{}
	for _, key := range strings.Fields(required + " " + optional) {
		allowed[key] = true
	}
	for key, value := range fields {
		if !allowed[key] || string(value) == "null" {
			return false
		}
	}
	for _, key := range strings.Fields(required) {
		if _, ok := fields[key]; !ok {
			return false
		}
	}
	return common.Unmarshal(body, dst) == nil
}

func invitationCode(value, base string) (string, error) {
	value = strings.TrimSpace(value)
	if len(value) > 2048 || strings.ContainsAny(value, "\r\n\t\x00") {
		return "", model.ErrInvitationInvalid
	}
	if invitationShareCode.MatchString(value) {
		return value, nil
	}
	u, err := url.Parse(value)
	if err != nil {
		return "", model.ErrInvitationInvalid
	}
	root, err := url.Parse(base)
	if err != nil || u.User != nil || u.Fragment != "" || (u.Scheme != "https" && u.Scheme != "http") || !strings.EqualFold(u.Scheme, root.Scheme) || !strings.EqualFold(u.Host, root.Host) || u.Host == "" {
		return "", model.ErrInvitationInvalid
	}
	query, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return "", model.ErrInvitationInvalid
	}
	code := ""
	for key, values := range query {
		if (key != "aff" && key != "ref") || len(values) != 1 || code != "" || !invitationShareCode.MatchString(values[0]) {
			return "", model.ErrInvitationInvalid
		}
		code = values[0]
	}
	if code == "" {
		return "", model.ErrInvitationInvalid
	}
	return code, nil
}

func ListInvitationCampaigns(c *gin.Context) {
	p, size, ok := invitationPagination(c)
	if !ok {
		invitationError(c, model.ErrInvitationInvalid)
		return
	}
	result, err := model.ListInvitationCampaigns(strings.Contains(c.FullPath(), "/admin/"), p, size)
	if err != nil {
		invitationError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
func CurrentInvitationCampaign(c *gin.Context) {
	if !invitationNoQuery(c) {
		invitationError(c, model.ErrInvitationInvalid)
		return
	}
	result, err := model.CurrentInvitationCampaign()
	if err != nil {
		invitationError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
func GetInvitationCampaign(c *gin.Context) {
	id, ok := customSubscriptionInt(c.Param("id"), true)
	if !ok || !invitationNoQuery(c) {
		invitationError(c, model.ErrInvitationInvalid)
		return
	}
	result, err := model.GetInvitationCampaign(id)
	if err != nil {
		invitationError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func readInvitationCampaign(c *gin.Context, update bool) (model.InvitationCampaignInput, int64, bool) {
	var req struct {
		Code        string              `json:"code"`
		Period      int                 `json:"period"`
		Name        string              `json:"name"`
		Description string              `json:"description"`
		StartsAt    string              `json:"starts_at"`
		EndsAt      string              `json:"ends_at"`
		PointType   string              `json:"reward_point_type_id"`
		FreezeDays  *int                `json:"freeze_days"`
		Tiers       []common.RawMessage `json:"tiers"`
		Rules       string              `json:"rules_text"`
		Visible     bool                `json:"visible"`
		Version     string              `json:"version"`
	}
	required := "code period name description starts_at ends_at reward_point_type_id tiers rules_text visible"
	if update {
		required += " version"
	}
	fail := func() (model.InvitationCampaignInput, int64, bool) {
		invitationError(c, model.ErrInvitationInvalid)
		return model.InvitationCampaignInput{}, 0, false
	}
	if !readInvitationBody(c, &req, required, "freeze_days") {
		return fail()
	}
	start, a := customSubscriptionInt(req.StartsAt, true)
	end, b := customSubscriptionInt(req.EndsAt, true)
	pt, d := customSubscriptionInt(req.PointType, true)
	if !a || !b || !d || end <= start || end > 8640000000000000 || !customSubscriptionCode.MatchString(req.Code) || len(req.Code) > 64 || req.Period < 1 || req.Period > math.MaxInt32 || !customSubscriptionText(req.Name, 128, true) || !customSubscriptionText(req.Description, 500, false) || !customSubscriptionText(req.Rules, 16000, false) || len(req.Tiers) == 0 || len(req.Tiers) > 20 {
		return fail()
	}
	days := 7
	if req.FreezeDays != nil {
		days = *req.FreezeDays
	}
	if days < 1 || days > 365 {
		return fail()
	}
	in := model.InvitationCampaignInput{Code: req.Code, Period: req.Period, Name: req.Name, Description: req.Description, StartsAt: start, EndsAt: end, RewardPointTypeId: pt, FreezeDays: days, RulesText: req.Rules, Visible: req.Visible}
	prev := -1
	for _, rawTier := range req.Tiers {
		var fields map[string]common.RawMessage
		var tier struct {
			Threshold *int `json:"min_effective_friends"`
			Rate      *int `json:"rate_bps"`
		}
		if common.Unmarshal(rawTier, &fields) != nil || len(fields) != 2 || fields["min_effective_friends"] == nil || fields["rate_bps"] == nil || common.Unmarshal(rawTier, &tier) != nil {
			return fail()
		}
		if tier.Threshold == nil || tier.Rate == nil || *tier.Threshold < 0 || *tier.Threshold > math.MaxInt32 || *tier.Threshold <= prev || *tier.Rate < 0 || *tier.Rate > 10000 {
			return fail()
		}
		in.Tiers = append(in.Tiers, model.InvitationTierInput{MinEffectiveFriends: *tier.Threshold, RateBps: *tier.Rate})
		prev = *tier.Threshold
	}
	if in.Tiers[0].MinEffectiveFriends != 0 {
		return fail()
	}
	version := int64(0)
	if update {
		var ok bool
		version, ok = customSubscriptionInt(req.Version, true)
		if !ok {
			return fail()
		}
	}
	return in, version, true
}
func CreateInvitationCampaign(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	in, _, ok := readInvitationCampaign(c, false)
	if !ok {
		return
	}
	result, err := model.CreateInvitationCampaign(in, int64(c.GetInt("id")))
	if err != nil {
		invitationError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
func UpdateInvitationCampaign(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	id, ok := customSubscriptionInt(c.Param("id"), true)
	if !ok {
		invitationError(c, model.ErrInvitationInvalid)
		return
	}
	in, v, ok := readInvitationCampaign(c, true)
	if !ok {
		return
	}
	result, err := model.UpdateInvitationCampaign(id, v, int64(c.GetInt("id")), in)
	if err != nil {
		invitationError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
func ChangeInvitationCampaignStatus(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	var req struct {
		Version string `json:"version"`
	}
	id, ok := customSubscriptionInt(c.Param("id"), true)
	if !ok || !readInvitationBody(c, &req, "version", "") {
		invitationError(c, model.ErrInvitationInvalid)
		return
	}
	v, ok := customSubscriptionInt(req.Version, true)
	if !ok {
		invitationError(c, model.ErrInvitationInvalid)
		return
	}
	var result *model.InvitationCampaignView
	var err error
	if strings.HasSuffix(c.FullPath(), "/publish") {
		result, err = model.PublishInvitationCampaign(id, v, int64(c.GetInt("id")))
	} else {
		result, err = model.EndInvitationCampaign(id, v, int64(c.GetInt("id")))
	}
	if err != nil {
		invitationError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
func GetInvitationBinding(c *gin.Context) {
	if !invitationNoQuery(c) {
		invitationError(c, model.ErrInvitationInvalid)
		return
	}
	result, err := model.GetInvitationBinding(int64(c.GetInt("id")))
	if err != nil {
		invitationError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
func BindInvitation(c *gin.Context) {
	var req struct {
		Invitation string `json:"invitation"`
		RequestID  string `json:"request_id"`
	}
	if !readInvitationBody(c, &req, "invitation request_id", "") || !customSubscriptionRequestID.MatchString(req.RequestID) {
		invitationError(c, model.ErrInvitationInvalid)
		return
	}
	code, err := invitationCode(req.Invitation, system_setting.ServerAddress)
	if err != nil {
		invitationError(c, err)
		return
	}
	result, err := model.BindInvitation(int64(c.GetInt("id")), code, req.RequestID)
	if err != nil {
		invitationError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
func ListInvitationFriends(c *gin.Context) {
	p, size, ok := invitationPagination(c)
	if !ok {
		invitationError(c, model.ErrInvitationInvalid)
		return
	}
	result, err := model.ListInvitationFriends(int64(c.GetInt("id")), p, size)
	if err != nil {
		invitationError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
func GetInvitationLink(c *gin.Context) {
	if !invitationNoQuery(c) {
		invitationError(c, model.ErrInvitationInvalid)
		return
	}
	user, err := model.GetUserById(c.GetInt("id"), true)
	if err != nil {
		invitationError(c, err)
		return
	}
	// Existing accounts normally already have a share code. Updating only this
	// column avoids writing stale user balances or inviter fields.
	if user.AffCode == "" {
		code := common.GetRandomString(16)
		if err := model.DB.Model(&model.User{}).Where("id = ? AND (aff_code = ? OR aff_code IS NULL)", user.Id, "").Update("aff_code", code).Error; err != nil {
			invitationError(c, err)
			return
		}
		user, err = model.GetUserById(user.Id, true)
		if err != nil {
			invitationError(c, err)
			return
		}
	}
	root, err := url.Parse(system_setting.ServerAddress)
	if err != nil || root.Host == "" || root.User != nil || (root.Scheme != "https" && root.Scheme != "http") {
		invitationError(c, model.ErrInvitationInvalid)
		return
	}
	root.Path = "/invite"
	root.RawPath = ""
	root.Fragment = ""
	root.RawQuery = url.Values{"aff": {user.AffCode}}.Encode()
	common.ApiSuccess(c, gin.H{"code": user.AffCode, "url": root.String()})
}
func GetInvitationSummary(c *gin.Context) {
	if !invitationNoQuery(c) {
		invitationError(c, model.ErrInvitationInvalid)
		return
	}
	result, err := model.GetInvitationSummary(int64(c.GetInt("id")))
	if err != nil {
		invitationError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
func ListInvitationRewards(c *gin.Context) {
	p, size, ok := invitationPagination(c)
	if !ok {
		invitationError(c, model.ErrInvitationInvalid)
		return
	}
	result, err := model.ListInvitationRewards(int64(c.GetInt("id")), strings.Contains(c.FullPath(), "/admin/"), p, size)
	if err != nil {
		invitationError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
func MutateInvitationRefund(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	id, ok := customSubscriptionInt(c.Param("id"), true)
	if !ok {
		invitationError(c, model.ErrInvitationInvalid)
		return
	}
	var req struct {
		Amount           string `json:"amount_minor"`
		RequestID        string `json:"request_id"`
		Provider         string `json:"provider"`
		ProviderRefundID string `json:"provider_refund_id"`
	}
	path := c.FullPath()
	required := "amount_minor request_id"
	if strings.HasSuffix(path, "/complete") {
		required = "amount_minor provider provider_refund_id"
	} else if strings.HasSuffix(path, "/cancel") {
		required = ""
	}
	if !readInvitationBody(c, &req, required, "") {
		invitationError(c, model.ErrInvitationInvalid)
		return
	}
	var result *model.InvitationRefundOperation
	var err error
	operator := int64(c.GetInt("id"))
	if strings.HasSuffix(path, "/cancel") || strings.HasSuffix(path, "/complete") {
		refundID, valid := customSubscriptionInt(c.Param("refund_id"), true)
		if !valid {
			invitationError(c, model.ErrInvitationInvalid)
			return
		}
		if strings.HasSuffix(path, "/cancel") {
			result, err = model.CancelInvitationRefund(id, refundID, operator)
		} else {
			amount, valid := customSubscriptionInt(req.Amount, true)
			if !valid || !customSubscriptionText(req.Provider, 32, true) || !customSubscriptionText(req.ProviderRefundID, 128, true) {
				invitationError(c, model.ErrInvitationInvalid)
				return
			}
			result, err = model.CompleteInvitationRefund(id, refundID, operator, amount, req.Provider, req.ProviderRefundID)
		}
	} else {
		amount, valid := customSubscriptionInt(req.Amount, true)
		if !valid || !customSubscriptionRequestID.MatchString(req.RequestID) {
			invitationError(c, model.ErrInvitationInvalid)
			return
		}
		result, err = model.PrepareInvitationRefund(id, operator, amount, req.RequestID)
	}
	if err != nil {
		invitationError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
func ReverseInvitationReward(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	var req struct {
		Points    string `json:"points"`
		RequestID string `json:"request_id"`
		Reason    string `json:"reason"`
	}
	id, ok := customSubscriptionInt(c.Param("id"), true)
	if !ok || !readInvitationBody(c, &req, "points request_id reason", "") || !customSubscriptionRequestID.MatchString(req.RequestID) || !customSubscriptionText(req.Reason, 512, true) {
		invitationError(c, model.ErrInvitationInvalid)
		return
	}
	points, parseErr := strconv.ParseInt(req.Points, 10, 64)
	if parseErr != nil || points <= 0 || strconv.FormatInt(points, 10) != req.Points {
		invitationError(c, model.ErrInvitationInvalid)
		return
	}
	result, err := model.ReverseInvitationReward(id, int64(c.GetInt("id")), points, req.RequestID, req.Reason)
	if err != nil {
		invitationError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
