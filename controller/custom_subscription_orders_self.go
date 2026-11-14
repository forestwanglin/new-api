package controller

import (
	"net/url"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetCustomSubscriptionOrdersSelf(c *gin.Context) {
	page, pageSize := 1, 20
	query, err := url.ParseQuery(c.Request.URL.RawQuery)
	if err != nil {
		common.ApiErrorT(c, "Invalid custom subscription order filters")
		return
	}
	for name, values := range query {
		if (name != "p" && name != "page_size") || len(values) != 1 || values[0] == "" || strings.IndexFunc(values[0], func(r rune) bool { return r < '0' || r > '9' }) >= 0 {
			common.ApiErrorT(c, "Invalid custom subscription order filters")
			return
		}
		value, err := strconv.ParseInt(values[0], 10, 64)
		if err != nil || value < 1 || value > int64(int(^uint(0)>>1)) || (name == "page_size" && value > 100) {
			common.ApiErrorT(c, "Invalid custom subscription order filters")
			return
		}
		if name == "p" {
			page = int(value)
		} else {
			pageSize = int(value)
		}
	}
	if page-1 > int(^uint(0)>>1)/pageSize {
		common.ApiErrorT(c, "Invalid custom subscription order filters")
		return
	}
	orders, err := model.ListCustomSubscriptionOrdersForUser(int64(c.GetInt("id")), page, pageSize)
	if err != nil {
		common.ApiErrorT(c, "Failed to load custom subscription orders")
		return
	}
	common.ApiSuccess(c, orders)
}
