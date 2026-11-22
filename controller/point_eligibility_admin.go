package controller

import (
	"io"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetPointCatalog(c *gin.Context) {
	entries, err := model.GetPointCatalog()
	if err != nil {
		writePointAdminError(c, err)
		return
	}
	common.ApiSuccess(c, entries)
}

func GetPointEligibilityPolicy(c *gin.Context) {
	typeID, ok := pointAdminID(c, "type_id")
	if !ok {
		return
	}
	config, err := model.GetPointEligibilityPolicy(typeID)
	if err != nil {
		writePointAdminError(c, err)
		return
	}
	common.ApiSuccess(c, config)
}

func RenamePointType(c *gin.Context) {
	typeID, ok := pointAdminID(c, "type_id")
	if !ok {
		return
	}
	fields, ok := pointConfigurationFields(c, []string{"name", "config_version"}, "consume_priority")
	if !ok {
		return
	}
	var name string
	var version int64
	if common.Unmarshal(fields["name"], &name) != nil || common.Unmarshal(fields["config_version"], &version) != nil || version <= 0 {
		common.ApiErrorT(c, "Invalid point configuration fields")
		return
	}
	var priority *int
	if raw, exists := fields["consume_priority"]; exists {
		var value int
		if common.Unmarshal(raw, &value) != nil {
			common.ApiErrorT(c, "Consumption priority must be a 32-bit integer")
			return
		}
		priority = &value
	}
	typ, err := model.UpdatePointType(typeID, version, name, priority)
	if err != nil {
		writePointAdminError(c, err)
		return
	}
	common.ApiSuccess(c, typ)
}

func UpdatePointEligibilityPolicy(c *gin.Context) {
	typeID, ok := pointAdminID(c, "type_id")
	if !ok {
		return
	}
	fields, ok := pointConfigurationInput(c, "policy", "config_version")
	if !ok {
		return
	}
	var version int64
	if common.Unmarshal(fields["config_version"], &version) != nil || version <= 0 {
		common.ApiErrorT(c, "Invalid point configuration fields")
		return
	}
	policy, err := model.ParsePointEligibilityPolicy(fields["policy"])
	if err != nil {
		writePointAdminError(c, err)
		return
	}
	config, err := model.UpdatePointEligibilityPolicy(typeID, version, policy)
	if err != nil {
		writePointAdminError(c, err)
		return
	}
	common.ApiSuccess(c, config)
}

func pointConfigurationInput(c *gin.Context, keys ...string) (map[string]common.RawMessage, bool) {
	return pointConfigurationFields(c, keys)
}

func pointConfigurationFields(c *gin.Context, required []string, optional ...string) (map[string]common.RawMessage, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 64*1024))
	var fields map[string]common.RawMessage
	if err != nil || !utf8.Valid(body) || common.Unmarshal(body, &fields) != nil || len(fields) < len(required) || len(fields) > len(required)+len(optional) {
		common.ApiErrorT(c, "Invalid point configuration fields")
		return nil, false
	}
	allowed := make(map[string]bool, len(required)+len(optional))
	for _, key := range required {
		if _, exists := fields[key]; !exists {
			common.ApiErrorT(c, "Invalid point configuration fields")
			return nil, false
		}
		allowed[key] = true
	}
	for _, key := range optional {
		allowed[key] = true
	}
	for key, value := range fields {
		if !allowed[key] || strings.TrimSpace(string(value)) == "null" {
			common.ApiErrorT(c, "Invalid point configuration fields")
			return nil, false
		}
	}
	return fields, true
}
