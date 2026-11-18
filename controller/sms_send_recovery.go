package controller

import (
	"errors"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func writeSMSDeliveryRecovery(c *gin.Context, err error) bool {
	var recovery *service.SMSDeliveryError
	if !errors.As(err, &recovery) {
		return false
	}
	data := gin.H{"code": "SMS_DELIVERY_FAILED", "retry_after": recovery.RetryAfter}
	if recovery.RetryToken != "" {
		data["retry_token"] = recovery.RetryToken
		data["retry_expires_at"] = recovery.RetryExpiresAt
	}
	c.Set("security_error_code", "PHONE_SMS_DELIVERY_FAILED")
	common.ApiErrorStatus(c, http.StatusOK, service.ErrBindingSMSDelivery, gin.H{"code": "PHONE_SMS_DELIVERY_FAILED", "data": data})
	return true
}
