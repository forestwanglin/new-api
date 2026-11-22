package controller

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetPointTypes(c *gin.Context) {
	types, err := model.GetPointTypes()
	if err != nil {
		writePointAdminError(c, err)
		return
	}
	common.ApiSuccess(c, types)
}

func CreatePointType(c *gin.Context) {
	fields, ok := pointConfigurationInput(c, "code", "name", "consume_priority")
	if !ok {
		return
	}
	var code, name string
	var priority int
	if common.Unmarshal(fields["code"], &code) != nil || common.Unmarshal(fields["name"], &name) != nil {
		common.ApiErrorT(c, "Invalid point configuration fields")
		return
	}
	if common.Unmarshal(fields["consume_priority"], &priority) != nil {
		common.ApiErrorT(c, "Consumption priority must be a 32-bit integer")
		return
	}
	typ, err := model.CreatePointType(code, name, priority)
	if err != nil {
		writePointAdminError(c, err)
		return
	}
	common.ApiSuccess(c, typ)
}

func DeletePointType(c *gin.Context) {
	id, ok := pointAdminID(c, "type_id")
	if !ok {
		return
	}
	fields, ok := pointConfigurationInput(c, "config_version")
	if !ok {
		return
	}
	var version int64
	if common.Unmarshal(fields["config_version"], &version) != nil || version <= 0 {
		common.ApiErrorT(c, "Invalid point configuration fields")
		return
	}
	if err := model.DeletePointType(id, version); err != nil {
		writePointAdminError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func GetPointModelRules(c *gin.Context) {
	typeID, ok := pointAdminID(c, "type_id")
	if !ok {
		return
	}
	rules, err := model.GetPointModelRules(typeID)
	if err != nil {
		writePointAdminError(c, err)
		return
	}
	common.ApiSuccess(c, rules)
}

func CreatePointModelRule(c *gin.Context) {
	typeID, ok := pointAdminID(c, "type_id")
	if !ok {
		return
	}
	rule, ok := pointAdminRuleInput(c)
	if !ok {
		return
	}
	if err := model.CreatePointModelRule(typeID, rule); err != nil {
		writePointAdminError(c, err)
		return
	}
	common.ApiSuccess(c, rule)
}

func UpdatePointModelRule(c *gin.Context) {
	typeID, ok := pointAdminID(c, "type_id")
	if !ok {
		return
	}
	ruleID, ok := pointAdminID(c, "rule_id")
	if !ok {
		return
	}
	input, ok := pointAdminRuleInput(c)
	if !ok {
		return
	}
	rule, err := model.UpdatePointModelRule(typeID, ruleID, input)
	if err != nil {
		writePointAdminError(c, err)
		return
	}
	common.ApiSuccess(c, rule)
}

func DeletePointModelRule(c *gin.Context) {
	typeID, ok := pointAdminID(c, "type_id")
	if !ok {
		return
	}
	ruleID, ok := pointAdminID(c, "rule_id")
	if !ok {
		return
	}
	if err := model.DeletePointModelRule(typeID, ruleID); err != nil {
		writePointAdminError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func pointAdminID(c *gin.Context, name string) (int64, bool) {
	id, err := strconv.ParseInt(c.Param(name), 10, 64)
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid ID")
		return 0, false
	}
	return id, true
}

func pointAdminRuleInput(c *gin.Context) (*model.PointModelRule, bool) {
	// Unmarshal the entire bounded document, rather than DecodeJson, to reject
	// trailing documents. Exact keys prevent case-insensitive DTO field aliases.
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 16*1024))
	var fields map[string]common.RawMessage
	if err != nil || common.Unmarshal(body, &fields) != nil || len(fields) != 3 {
		common.ApiErrorT(c, "Invalid point model rule fields")
		return nil, false
	}
	for key := range fields {
		if key != "match_type" && key != "match_value" && key != "enabled" {
			common.ApiErrorT(c, "Invalid point model rule fields")
			return nil, false
		}
	}
	var input struct {
		MatchType  *string `json:"match_type"`
		MatchValue *string `json:"match_value"`
		Enabled    *bool   `json:"enabled"`
	}
	if common.Unmarshal(body, &input) != nil || input.MatchType == nil || input.MatchValue == nil || input.Enabled == nil {
		common.ApiErrorT(c, "Invalid point model rule fields")
		return nil, false
	}
	if *input.MatchType != model.PointMatchExact && *input.MatchType != model.PointMatchPattern {
		common.ApiErrorT(c, "Point model match type must be EXACT or PATTERN")
		return nil, false
	}
	value := *input.MatchValue
	if value == "" || utf8.RuneCountInString(value) > 255 || strings.TrimSpace(value) != value || strings.ContainsFunc(value, unicode.IsControl) {
		common.ApiErrorT(c, "Point model match value must contain 1 to 255 characters without surrounding whitespace or control characters")
		return nil, false
	}
	return &model.PointModelRule{MatchType: *input.MatchType, MatchValue: model.PointModelMatchValue(value), Enabled: *input.Enabled}, true
}

func writePointAdminError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, model.ErrInvalidPointTypeCode):
		common.ApiErrorT(c, "Point type code must start with an uppercase letter and contain only uppercase letters, digits or underscores (1 to 32 characters)")
	case errors.Is(err, model.ErrInvalidPointPriority):
		common.ApiErrorT(c, "Consumption priority must be a 32-bit integer")
	case errors.Is(err, model.ErrPointTypeDuplicate):
		common.ApiErrorT(c, "Point type code already exists")
	case errors.Is(err, model.ErrPointTypeProtected):
		common.ApiErrorT(c, "GENERAL is a system point type and cannot be deleted")
	case errors.Is(err, model.ErrPointTypeHasAccounts):
		common.ApiErrorT(c, "Point type is used by user accounts")
	case errors.Is(err, model.ErrPointTypeHasPlans):
		common.ApiErrorT(c, "Point type is used by subscription plans")
	case errors.Is(err, model.ErrPointTypeHasOrders):
		common.ApiErrorT(c, "Point type is used by subscription orders")
	case errors.Is(err, model.ErrPointTypeHasCampaigns):
		common.ApiErrorT(c, "Point type is used by invitation campaigns")
	case errors.Is(err, model.ErrPointTypeHasRewards):
		common.ApiErrorT(c, "Point type is used by invitation rewards")
	case errors.Is(err, model.ErrPointTypeHasCalls):
		common.ApiErrorT(c, "Point type is used by model billing history")
	case errors.Is(err, model.ErrPointConfigConflict):
		common.ApiErrorStatus(c, http.StatusConflict, common.NewMessage("Point configuration changed. Reload and try again."))
	case errors.Is(err, model.ErrPointPolicyManaged):
		common.ApiErrorStatus(c, http.StatusConflict, common.NewMessage("Grouped point rules are active. Use the grouped rule editor."))
	case errors.Is(err, model.ErrInvalidPointEligibilityPolicy):
		common.ApiErrorT(c, "Invalid point eligibility policy")
	case errors.Is(err, model.ErrPointPolicyChannelNotFound):
		common.ApiErrorT(c, "Point eligibility channel not found")
	case errors.Is(err, model.ErrInvalidPointTypeName):
		common.ApiErrorT(c, "Point type name must contain 1 to 64 characters without surrounding whitespace or control characters")
	case errors.Is(err, model.ErrPointTypeNotFound):
		common.ApiErrorT(c, "Point type not found")
	case errors.Is(err, model.ErrPointModelRuleNotFound):
		common.ApiErrorT(c, "Point model rule not found")
	case errors.Is(err, model.ErrPointModelRuleDuplicate):
		common.ApiErrorT(c, "Point model rule already exists")
	default:
		common.SysError("Failed to manage point configuration: " + err.Error())
		common.ApiErrorT(c, "Failed to manage point configuration")
	}
}
