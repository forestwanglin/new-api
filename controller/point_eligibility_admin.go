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
	fields, ok := pointConfigurationInput(c, "name", "config_version")
	if !ok {
		return
	}
	var name string
	var version int64
	if common.Unmarshal(fields["name"], &name) != nil || common.Unmarshal(fields["config_version"], &version) != nil || version <= 0 {
		common.ApiErrorT(c, "Invalid point configuration fields")
		return
	}
	typ, err := model.RenamePointType(typeID, version, name)
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
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 64*1024))
	var fields map[string]common.RawMessage
	if err != nil || !utf8.Valid(body) || common.Unmarshal(body, &fields) != nil || len(fields) != len(keys) {
		common.ApiErrorT(c, "Invalid point configuration fields")
		return nil, false
	}
	for _, key := range keys {
		value, exists := fields[key]
		if !exists || strings.TrimSpace(string(value)) == "null" {
			common.ApiErrorT(c, "Invalid point configuration fields")
			return nil, false
		}
	}
	return fields, true
}
