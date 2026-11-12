package controller

import (
	"errors"
	"io"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

var customSubscriptionCode = regexp.MustCompile(`^[a-z0-9_-]+$`)
var customSubscriptionInteger = regexp.MustCompile(`^(0|[1-9][0-9]*)$`)

func customSubscriptionText(s string, max int, required bool) bool {
	return utf8.ValidString(s) && utf8.RuneCountInString(s) <= max && (!required || strings.TrimSpace(s) != "") && !strings.ContainsFunc(s, unicode.IsControl)
}
func customSubscriptionInt(s string, positive bool) (int64, bool) {
	n, err := strconv.ParseInt(s, 10, 64)
	return n, err == nil && customSubscriptionInteger.MatchString(s) && (!positive || n > 0)
}

func customSubscriptionInput(c *gin.Context, update bool) (model.CustomSubscriptionPlanInput, int64, bool) {
	var result model.CustomSubscriptionPlanInput
	fail := func() (model.CustomSubscriptionPlanInput, int64, bool) {
		common.ApiErrorT(c, "Invalid custom subscription plan fields")
		return result, 0, false
	}
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 32*1024))
	var fields map[string]common.RawMessage
	if err != nil || !utf8.Valid(body) || common.Unmarshal(body, &fields) != nil || fields == nil {
		return fail()
	}
	allowed := map[string]bool{}
	for _, key := range strings.Fields("code title subtitle tier_code tier_rank billing_cycle duration_months currency price_amount_minor paid_points paid_point_type_id bonus_points bonus_point_type_id auto_renew_enabled auto_renew_bonus_bps auto_bonus_point_type_id benefits enabled sort_order") {
		allowed[key] = true
	}
	if update {
		allowed["version"] = true
	}
	for key := range fields {
		if !allowed[key] {
			return fail()
		}
	}
	// All configuration fields are explicit, including false and zero; optional
	// type references may be omitted and normalize to SQL NULL when unused.
	for key := range allowed {
		if key == "bonus_point_type_id" || key == "auto_bonus_point_type_id" {
			continue
		}
		if value, ok := fields[key]; !ok || string(value) == "null" {
			return fail()
		}
	}
	var in struct {
		Code           string   `json:"code"`
		Title          string   `json:"title"`
		Subtitle       string   `json:"subtitle"`
		TierCode       string   `json:"tier_code"`
		TierRank       int      `json:"tier_rank"`
		BillingCycle   string   `json:"billing_cycle"`
		DurationMonths int      `json:"duration_months"`
		Currency       string   `json:"currency"`
		Price          string   `json:"price_amount_minor"`
		Paid           string   `json:"paid_points"`
		PaidType       string   `json:"paid_point_type_id"`
		Bonus          string   `json:"bonus_points"`
		BonusType      *string  `json:"bonus_point_type_id"`
		Auto           bool     `json:"auto_renew_enabled"`
		Bps            int      `json:"auto_renew_bonus_bps"`
		AutoType       *string  `json:"auto_bonus_point_type_id"`
		Benefits       []string `json:"benefits"`
		Enabled        bool     `json:"enabled"`
		Sort           int      `json:"sort_order"`
		Version        string   `json:"version"`
	}
	if common.Unmarshal(body, &in) != nil {
		return fail()
	}
	if !customSubscriptionCode.MatchString(in.Code) || len(in.Code) > 64 || !customSubscriptionCode.MatchString(in.TierCode) || len(in.TierCode) > 32 || !customSubscriptionText(in.Title, 128, true) || !customSubscriptionText(in.Subtitle, 255, false) || in.TierRank < 1 || in.TierRank > math.MaxInt32 || in.Sort < 0 || in.Sort > math.MaxInt32 || in.Currency != "CNY" || !(in.BillingCycle == "month" && in.DurationMonths == 1 || in.BillingCycle == "year" && in.DurationMonths == 12) || in.Bps < 0 || in.Bps > 10000 || (!in.Auto && in.Bps != 0) || len(in.Benefits) > 20 {
		return fail()
	}
	for _, benefit := range in.Benefits {
		if !customSubscriptionText(benefit, 255, true) {
			return fail()
		}
	}
	price, ok := customSubscriptionInt(in.Price, true)
	if !ok {
		return fail()
	}
	paid, ok := customSubscriptionInt(in.Paid, true)
	if !ok {
		return fail()
	}
	paidType, ok := customSubscriptionInt(in.PaidType, true)
	if !ok {
		return fail()
	}
	bonus, ok := customSubscriptionInt(in.Bonus, false)
	if !ok || paid > math.MaxInt64-bonus {
		return fail()
	}
	base := paid + bonus
	// Split before multiplying so even MaxInt64 * 10000 never overflows.
	extra := (base/10000)*int64(in.Bps) + (base%10000)*int64(in.Bps)/10000
	if base > math.MaxInt64-extra {
		return fail()
	}
	optionalType := func(value *string, needed bool) (*int64, bool) {
		if !needed {
			return nil, true
		}
		if value == nil {
			return nil, false
		}
		id, ok := customSubscriptionInt(*value, true)
		return &id, ok
	}
	bonusType, ok := optionalType(in.BonusType, bonus > 0)
	if !ok {
		return fail()
	}
	autoType, ok := optionalType(in.AutoType, in.Bps > 0)
	if !ok {
		return fail()
	}
	version := int64(0)
	if update {
		version, ok = customSubscriptionInt(in.Version, true)
		if !ok {
			return fail()
		}
	}
	benefits, err := common.Marshal(in.Benefits)
	if err != nil {
		return fail()
	}
	result = model.CustomSubscriptionPlanInput{Code: in.Code, Title: in.Title, Subtitle: in.Subtitle, TierCode: in.TierCode, TierRank: in.TierRank, BillingCycle: in.BillingCycle, DurationMonths: in.DurationMonths, Currency: in.Currency, PriceAmountMinor: price, PaidPoints: paid, PaidPointTypeId: paidType, BonusPoints: bonus, BonusPointTypeId: bonusType, AutoRenewEnabled: in.Auto, AutoRenewBonusBps: in.Bps, AutoBonusPointTypeId: autoType, BenefitsJson: string(benefits), Enabled: in.Enabled, SortOrder: in.Sort}
	return result, version, true
}

func customSubscriptionError(c *gin.Context, err error) {
	for _, safe := range []error{model.ErrCustomSubscriptionNotFound, model.ErrCustomSubscriptionDuplicate, model.ErrCustomSubscriptionConflict, model.ErrCustomSubscriptionHasOrders, model.ErrPointTypeNotFound} {
		if errors.Is(err, safe) {
			common.ApiErrorT(c, safe.Error())
			return
		}
	}
	common.ApiErrorT(c, "Failed to manage custom subscription plans")
}
func customSubscriptionTypes() ([]map[string]string, map[int64]map[string]string, error) {
	types, err := model.GetPointTypes()
	directory := make([]map[string]string, 0, len(types))
	byID := map[int64]map[string]string{}
	for _, t := range types {
		entry := map[string]string{"id": strconv.FormatInt(t.Id, 10), "code": t.Code, "name": t.Name}
		directory = append(directory, entry)
		byID[t.Id] = entry
	}
	return directory, byID, err
}
func customSubscriptionDTO(p model.CustomSubscriptionPlan, types map[int64]map[string]string) (map[string]any, error) {
	var benefits []string
	if err := common.UnmarshalJsonStr(p.BenefitsJson, &benefits); err != nil {
		return nil, err
	}
	if benefits == nil {
		benefits = []string{}
	}
	optional := func(id *int64) any {
		if id == nil {
			return nil
		}
		return strconv.FormatInt(*id, 10)
	}
	optionalType := func(id *int64) any {
		if id == nil || types[*id] == nil {
			return nil
		}
		return types[*id]
	}
	return map[string]any{"id": strconv.FormatInt(p.Id, 10), "code": p.Code, "title": p.Title, "subtitle": p.Subtitle, "tier_code": p.TierCode, "tier_rank": p.TierRank, "billing_cycle": p.BillingCycle, "duration_months": p.DurationMonths, "currency": p.Currency, "price_amount_minor": strconv.FormatInt(p.PriceAmountMinor, 10), "paid_points": strconv.FormatInt(p.PaidPoints, 10), "paid_point_type_id": strconv.FormatInt(p.PaidPointTypeId, 10), "bonus_points": strconv.FormatInt(p.BonusPoints, 10), "bonus_point_type_id": optional(p.BonusPointTypeId), "auto_renew_enabled": p.AutoRenewEnabled, "auto_renew_bonus_bps": p.AutoRenewBonusBps, "auto_bonus_point_type_id": optional(p.AutoBonusPointTypeId), "benefits": benefits, "enabled": p.Enabled, "sort_order": p.SortOrder, "version": strconv.FormatInt(p.Version, 10), "created_at": p.CreatedAt, "updated_at": p.UpdatedAt, "paid_point_type": types[p.PaidPointTypeId], "bonus_point_type": optionalType(p.BonusPointTypeId), "auto_bonus_point_type": optionalType(p.AutoBonusPointTypeId)}, nil
}
func writeCustomSubscription(c *gin.Context, p *model.CustomSubscriptionPlan) {
	_, types, err := customSubscriptionTypes()
	if err != nil {
		customSubscriptionError(c, err)
		return
	}
	dto, err := customSubscriptionDTO(*p, types)
	if err != nil {
		customSubscriptionError(c, err)
		return
	}
	common.ApiSuccess(c, dto)
}
func ListCustomSubscriptionPlans(c *gin.Context) {
	filter := model.CustomSubscriptionPlanFilter{Page: 1, PageSize: 20}
	valid := true
	for key, values := range c.Request.URL.Query() {
		if len(values) != 1 || values[0] == "" {
			valid = false
			break
		}
		value := values[0]
		switch key {
		case "p", "page_size":
			n, ok := customSubscriptionInt(value, true)
			if !ok || n > int64(math.MaxInt) {
				valid = false
				break
			}
			if key == "p" {
				filter.Page = int(n)
			} else {
				filter.PageSize = int(n)
			}
		case "keyword":
			if !customSubscriptionText(value, 128, false) {
				valid = false
			}
			filter.Keyword = value
		case "enabled":
			if value != "true" && value != "false" {
				valid = false
			}
			b := value == "true"
			filter.Enabled = &b
		case "billing_cycle":
			if value != "month" && value != "year" {
				valid = false
			}
			filter.BillingCycle = value
		default:
			valid = false
		}
	}
	if !valid || filter.PageSize > 100 || (filter.Page-1) > math.MaxInt/filter.PageSize {
		common.ApiErrorT(c, "Invalid custom subscription plan filters")
		return
	}
	plans, total, err := model.ListCustomSubscriptionPlans(filter)
	if err != nil {
		customSubscriptionError(c, err)
		return
	}
	directory, types, err := customSubscriptionTypes()
	if err != nil {
		customSubscriptionError(c, err)
		return
	}
	items := make([]map[string]any, 0, len(plans))
	for _, p := range plans {
		dto, err := customSubscriptionDTO(p, types)
		if err != nil {
			customSubscriptionError(c, err)
			return
		}
		items = append(items, dto)
	}
	common.ApiSuccess(c, gin.H{"page": filter.Page, "page_size": filter.PageSize, "total": total, "items": items, "point_types": directory})
}
func GetCustomSubscriptionPlan(c *gin.Context) {
	id, ok := pointAdminID(c, "id")
	if !ok {
		return
	}
	p, err := model.GetCustomSubscriptionPlan(id)
	if err != nil {
		customSubscriptionError(c, err)
		return
	}
	writeCustomSubscription(c, p)
}
func CreateCustomSubscriptionPlan(c *gin.Context) {
	input, _, ok := customSubscriptionInput(c, false)
	if !ok {
		return
	}
	p, err := model.CreateCustomSubscriptionPlan(input)
	if err != nil {
		customSubscriptionError(c, err)
		return
	}
	writeCustomSubscription(c, p)
}
func UpdateCustomSubscriptionPlan(c *gin.Context) {
	id, ok := pointAdminID(c, "id")
	if !ok {
		return
	}
	input, version, ok := customSubscriptionInput(c, true)
	if !ok {
		return
	}
	p, err := model.UpdateCustomSubscriptionPlan(id, version, input)
	if err != nil {
		customSubscriptionError(c, err)
		return
	}
	writeCustomSubscription(c, p)
}
func DeleteCustomSubscriptionPlan(c *gin.Context) {
	id, ok := pointAdminID(c, "id")
	if !ok {
		return
	}
	if err := model.DeleteCustomSubscriptionPlan(id); err != nil {
		customSubscriptionError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
