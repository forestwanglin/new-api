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
	case errors.Is(err, model.ErrPointTypeNotFound):
		common.ApiErrorT(c, "Point type not found")
	case errors.Is(err, model.ErrPointModelRuleNotFound):
		common.ApiErrorT(c, "Point model rule not found")
	case errors.Is(err, model.ErrPointModelRuleDuplicate):
		common.ApiErrorT(c, "Point model rule already exists")
	default:
		common.ApiErrorT(c, "Failed to manage point model rules")
	}
}
