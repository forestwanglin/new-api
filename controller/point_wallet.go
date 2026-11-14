package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetSelfPointWallet(c *gin.Context) {
	if c.Request.URL.RawQuery != "" {
		common.ApiErrorT(c, "Invalid point wallet filters")
		return
	}
	wallet, err := model.GetPointWallet(int64(c.GetInt("id")))
	if err != nil {
		common.ApiErrorT(c, "Failed to load point wallet")
		return
	}
	common.ApiSuccess(c, wallet)
}
