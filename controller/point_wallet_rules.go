package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetPointWalletRules(c *gin.Context) {
	if c.Request.URL.RawQuery != "" {
		common.ApiErrorT(c, "Invalid subscription rule query")
		return
	}
	rules, err := model.ReadPointWalletRules()
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
