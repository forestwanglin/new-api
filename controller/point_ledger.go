package controller

import (
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetSelfPointLedger(c *gin.Context)  { getPointLedger(c, false) }
func GetAdminPointLedger(c *gin.Context) { getPointLedger(c, true) }

func getPointLedger(c *gin.Context, admin bool) {
	filter := model.PointLedgerFilter{Page: 1, PageSize: 20}
	values := c.Request.URL.Query()
	for name, entries := range values {
		if len(entries) != 1 || entries[0] == "" {
			common.ApiErrorT(c, "Invalid point ledger filters")
			return
		}
		value := entries[0]
		if name == "action" {
			if !utf8.ValidString(value) || utf8.RuneCountInString(value) > 32 || strings.TrimSpace(value) != value || strings.ContainsFunc(value, unicode.IsControl) {
				common.ApiErrorT(c, "Invalid point ledger filters")
				return
			}
			filter.Action = value
			continue
		}
		if name != "p" && name != "page_size" && name != "point_type_id" && name != "start_timestamp" && name != "end_timestamp" && !(admin && name == "user_id") {
			common.ApiErrorT(c, "Invalid point ledger filters")
			return
		}
		if strings.IndexFunc(value, func(r rune) bool { return r < '0' || r > '9' }) >= 0 {
			common.ApiErrorT(c, "Invalid point ledger filters")
			return
		}
		n, err := strconv.ParseInt(value, 10, 64)
		timestamp := name == "start_timestamp" || name == "end_timestamp"
		if err != nil || (!timestamp && n <= 0) || (timestamp && n > 8640000000000000) {
			common.ApiErrorT(c, "Invalid point ledger filters")
			return
		}
		switch name {
		case "p":
			if n > int64(int(^uint(0)>>1)) {
				common.ApiErrorT(c, "Invalid point ledger filters")
				return
			}
			filter.Page = int(n)
		case "page_size":
			if n > 100 {
				common.ApiErrorT(c, "Invalid point ledger filters")
				return
			}
			filter.PageSize = int(n)
		case "point_type_id":
			filter.PointTypeID = n
		case "user_id":
			filter.UserID = n
		case "start_timestamp":
			filter.StartTimestamp = &n
		case "end_timestamp":
			filter.EndTimestamp = &n
		}
	}
	if filter.Page-1 > int(^uint(0)>>1)/filter.PageSize || (filter.StartTimestamp != nil && filter.EndTimestamp != nil && *filter.StartTimestamp >= *filter.EndTimestamp) {
		common.ApiErrorT(c, "Invalid point ledger filters")
		return
	}
	if !admin {
		filter.UserID = int64(c.GetInt("id"))
	}
	result, err := model.GetPointLedger(filter, admin)
	if err != nil {
		common.ApiErrorT(c, "Failed to load point ledger")
		return
	}
	common.ApiSuccess(c, result)
}
