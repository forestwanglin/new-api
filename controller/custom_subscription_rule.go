package controller

import (
	"errors"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func subscriptionRuleError(c *gin.Context, err error) {
	for _, safe := range []error{model.ErrSubscriptionRuleNotFound, model.ErrSubscriptionRuleDuplicate, model.ErrSubscriptionRuleConflict, model.ErrSubscriptionRuleFields, model.ErrSubscriptionRuleKeyChanged, model.ErrSubscriptionRulePlan} {
		if errors.Is(err, safe) {
			common.ApiErrorT(c, safe.Error())
			return
		}
	}
	common.ApiErrorT(c, "Failed to manage subscription rules")
}
func subscriptionRuleInput(c *gin.Context, update bool) (model.CustomSubscriptionRule, int64, bool) {
	var rule model.CustomSubscriptionRule
	fail := func() (model.CustomSubscriptionRule, int64, bool) {
		subscriptionRuleError(c, model.ErrSubscriptionRuleFields)
		return rule, 0, false
	}
	raw, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 64*1024))
	var fields map[string]common.RawMessage
	if err != nil || !utf8.Valid(raw) || common.Unmarshal(raw, &fields) != nil || fields == nil {
		return fail()
	}
	allowed := strings.Fields("plan_id rule_key title content enabled sort_order")
	if update {
		allowed = append(allowed, "version")
	}
	if len(fields) != len(allowed) {
		return fail()
	}
	for _, key := range allowed {
		v, ok := fields[key]
		if !ok || key != "plan_id" && string(v) == "null" {
			return fail()
		}
	}
	var in struct {
		PlanID    *string           `json:"plan_id"`
		RuleKey   string            `json:"rule_key"`
		Title     string            `json:"title"`
		Content   common.RawMessage `json:"content"`
		Enabled   bool              `json:"enabled"`
		SortOrder int               `json:"sort_order"`
		Version   string            `json:"version"`
	}
	if common.Unmarshal(raw, &in) != nil || !customSubscriptionCode.MatchString(in.RuleKey) || len(in.RuleKey) > 64 || !customSubscriptionText(in.Title, 128, true) || in.SortOrder < 0 || in.SortOrder > math.MaxInt32 {
		return fail()
	}
	content, err := model.ParseSubscriptionRuleContent(in.Content)
	if err != nil {
		return fail()
	}
	encoded, err := common.Marshal(content)
	if err != nil {
		return fail()
	}
	rule = model.CustomSubscriptionRule{RuleKey: in.RuleKey, Title: in.Title, ContentJson: string(encoded), Enabled: in.Enabled, SortOrder: in.SortOrder}
	if in.PlanID != nil {
		id, ok := customSubscriptionInt(*in.PlanID, true)
		if !ok {
			return fail()
		}
		rule.PlanId = &id
	}
	var version int64
	if update {
		var ok bool
		version, ok = customSubscriptionInt(in.Version, true)
		if !ok {
			return fail()
		}
	}
	return rule, version, true
}
func subscriptionRuleDTO(rule model.CustomSubscriptionRule, admin bool) (map[string]any, error) {
	content, err := model.ParseSubscriptionRuleContent([]byte(rule.ContentJson))
	if err != nil {
		return nil, err
	}
	dto := map[string]any{"id": strconv.FormatInt(rule.Id, 10), "rule_key": rule.RuleKey, "title": rule.Title, "content": content}
	if !admin {
		return dto, nil
	}
	dto["plan_id"], dto["plan"] = nil, nil
	if rule.PlanId != nil {
		plan, err := model.GetCustomSubscriptionPlan(*rule.PlanId)
		if err != nil {
			return nil, err
		}
		dto["plan_id"] = strconv.FormatInt(plan.Id, 10)
		dto["plan"] = map[string]string{"id": strconv.FormatInt(plan.Id, 10), "title": plan.Title, "code": plan.Code}
	}
	dto["enabled"], dto["sort_order"], dto["version"] = rule.Enabled, rule.SortOrder, strconv.FormatInt(rule.Version, 10)
	dto["created_at"], dto["updated_at"] = rule.CreatedAt, rule.UpdatedAt
	return dto, nil
}
func writeSubscriptionRule(c *gin.Context, rule *model.CustomSubscriptionRule) {
	dto, err := subscriptionRuleDTO(*rule, true)
	if err != nil {
		subscriptionRuleError(c, err)
		return
	}
	common.ApiSuccess(c, dto)
}
func ListCustomSubscriptionRules(c *gin.Context) {
	filter := model.CustomSubscriptionRuleFilter{Page: 1, PageSize: 20}
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
			filter.Keyword = value
			if !customSubscriptionText(value, 128, false) {
				valid = false
			}
		case "enabled":
			if value != "true" && value != "false" {
				valid = false
			}
			enabled := value == "true"
			filter.Enabled = &enabled
		case "scope":
			if value != "global" && value != "plan" {
				valid = false
			}
			filter.Scope = value
		case "plan_id":
			id, ok := customSubscriptionInt(value, true)
			if !ok {
				valid = false
			}
			filter.PlanId = &id
		default:
			valid = false
		}
	}
	if !valid || filter.PageSize > 100 || (filter.Page-1) > math.MaxInt/filter.PageSize || filter.Scope == "global" && filter.PlanId != nil {
		common.ApiErrorT(c, "Invalid subscription rule query")
		return
	}
	rules, total, err := model.ListCustomSubscriptionRules(filter)
	if err != nil {
		subscriptionRuleError(c, err)
		return
	}
	items := make([]map[string]any, 0, len(rules))
	for _, rule := range rules {
		dto, err := subscriptionRuleDTO(rule, true)
		if err != nil {
			subscriptionRuleError(c, err)
			return
		}
		items = append(items, dto)
	}
	common.ApiSuccess(c, gin.H{"page": filter.Page, "page_size": filter.PageSize, "total": total, "items": items})
}
func GetCustomSubscriptionRule(c *gin.Context) {
	id, ok := pointAdminID(c, "id")
	if !ok {
		return
	}
	rule, err := model.GetCustomSubscriptionRule(id)
	if err != nil {
		subscriptionRuleError(c, err)
		return
	}
	writeSubscriptionRule(c, rule)
}
func CreateCustomSubscriptionRule(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	rule, _, ok := subscriptionRuleInput(c, false)
	if !ok {
		return
	}
	saved, err := model.SaveCustomSubscriptionRule(0, 0, rule)
	if err != nil {
		subscriptionRuleError(c, err)
		return
	}
	writeSubscriptionRule(c, saved)
}
func UpdateCustomSubscriptionRule(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	id, ok := pointAdminID(c, "id")
	if !ok {
		return
	}
	rule, version, ok := subscriptionRuleInput(c, true)
	if !ok {
		return
	}
	saved, err := model.SaveCustomSubscriptionRule(id, version, rule)
	if err != nil {
		subscriptionRuleError(c, err)
		return
	}
	writeSubscriptionRule(c, saved)
}
func DeleteCustomSubscriptionRule(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	id, ok := pointAdminID(c, "id")
	if !ok {
		return
	}
	if err := model.DeleteCustomSubscriptionRule(id); err != nil {
		subscriptionRuleError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
func ReadCustomSubscriptionRules(c *gin.Context) {
	var planID *int64
	for key, values := range c.Request.URL.Query() {
		if key != "plan_id" || len(values) != 1 {
			common.ApiErrorT(c, "Invalid subscription rule query")
			return
		}
		id, ok := customSubscriptionInt(values[0], true)
		if !ok {
			common.ApiErrorT(c, "Invalid subscription rule query")
			return
		}
		planID = &id
	}
	rules, err := model.ReadCustomSubscriptionRules(planID)
	if err != nil {
		subscriptionRuleError(c, err)
		return
	}
	items := make([]map[string]any, 0, len(rules))
	for _, rule := range rules {
		dto, err := subscriptionRuleDTO(rule, false)
		if err != nil {
			subscriptionRuleError(c, err)
			return
		}
		items = append(items, dto)
	}
	common.ApiSuccess(c, gin.H{"items": items})
}
