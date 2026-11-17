package controller

import (
	"errors"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"net/http"
)

type phoneChangeRequest struct {
	Step              string `json:"step"`
	Phone             string `json:"phone"`
	Token             string `json:"token"`
	VerificationToken string `json:"verification_token"`
	Code              string `json:"code"`
}

func GetPhoneChangeStatus(c *gin.Context) {
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		writeSecurityOperationError(c, service.ErrAuthTokenInvalid)
		return
	}
	result, err := service.GetPhoneChangeStatus(identity)
	if err != nil {
		writePhoneChangeError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func StartPhoneBinding(c *gin.Context) {
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		writeSecurityOperationError(c, service.ErrAuthTokenInvalid)
		return
	}
	authorization := middleware.RequireSecurityProof(c, service.VerificationOperation{Scope: service.VerificationScopePhoneBinding})
	if authorization == nil {
		return
	}
	result, err := service.StartPhoneBinding(identity, authorization)
	if err != nil {
		writePhoneChangeError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func SendPhoneChangeCode(c *gin.Context) {
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		writeSecurityOperationError(c, service.ErrAuthTokenInvalid)
		return
	}
	var request phoneChangeRequest
	if common.DecodeJson(c.Request.Body, &request) != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	token, err := service.SendPhoneChangeCode(identity, request.Step, request.Phone, request.VerificationToken, c.ClientIP())
	if err != nil {
		writePhoneChangeError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"token": token, "retry_after": 90})
}

func VerifyPhoneChangeCode(c *gin.Context) {
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		writeSecurityOperationError(c, service.ErrAuthTokenInvalid)
		return
	}
	var request phoneChangeRequest
	if common.DecodeJson(c.Request.Body, &request) != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	token, err := service.VerifyPhoneChangeCode(identity, request.Step, request.Token, request.Phone, request.Code)
	if err != nil {
		writePhoneChangeError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"token": token})
}

func CompletePhoneChange(c *gin.Context) {
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		writeSecurityOperationError(c, service.ErrAuthTokenInvalid)
		return
	}
	var request phoneChangeRequest
	if common.DecodeJson(c.Request.Body, &request) != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := service.CompletePhoneChange(identity, request.Token); err != nil {
		writePhoneChangeError(c, err)
		return
	}
	recordUserSecurityAudit(c, identity.UserID, "user.phone_change", map[string]any{"success": true})
	if err := model.PublishUserAuthCache(identity.UserID); err != nil {
		writePhoneChangeError(c, err)
		return
	}
	bundle, err := service.AdvanceCurrentSessionToUserVersion(identity, "phone_changed")
	if err != nil {
		writePhoneChangeError(c, err)
		return
	}
	common.ApiSuccess(c, authRotationData(bundle))
}

func writePhoneChangeError(c *gin.Context, err error) {
	if errors.Is(err, service.ErrPhoneOwned) {
		common.ApiErrorStatus(c, http.StatusConflict, service.ErrPhoneOwned, gin.H{"code": "PHONE_ALREADY_OWNED"})
		return
	}
	writeSecurityOperationError(c, err)
}
