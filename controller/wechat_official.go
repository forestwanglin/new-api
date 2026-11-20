package controller

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const officialOwnerCookie = "wechat_official_owner"
const officialScannerCookie = "wechat_official_scanner"
const officialConfirmationCookie = "wechat_official_confirmation"
const officialCookiePath = "/api/oauth/wechat_official"

func officialCookie(c *gin.Context, name, value string, age int) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(name, value, age, officialCookiePath, "", true, true)
}
func officialCSRF(token string) string {
	return common.GenerateHMACWithKey([]byte("wechat-official-confirm:"+common.SessionSecret), token)
}
func officialIdentity(c *gin.Context) service.AuthIdentity {
	identity, _ := middleware.GetStepUpIdentity(c)
	return identity
}
func officialError(c *gin.Context, err error) {
	// Database/provider errors may contain sensitive operational information.
	switch err {
	case model.ErrWeChatOfficialUnavailable, service.ErrWeChatOfficialFailed, service.ErrWeChatOfficialFlow:
		common.ApiError(c, err)
	default:
		common.ApiErrorT(c, "WeChat authorization expired or changed. Please start again.")
	}
}

func WeChatOfficialBrowser(c *gin.Context) {
	setAuthNoStore(c)
	nonce, err := c.Cookie(phoneBrowserCookie)
	if err != nil || len(nonce) != 43 {
		random := make([]byte, 32)
		if _, err := rand.Read(random); err != nil {
			officialError(c, err)
			return
		}
		nonce = base64.RawURLEncoding.EncodeToString(random)
	}
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(phoneBrowserCookie, nonce, 600, "/api", "", common.SessionCookieSecure, true)
	common.ApiSuccess(c, gin.H{"browser_token": nonce})
}

func NewWeChatOfficialFlow(c *gin.Context) {
	browser, ok := phoneBrowserIdentity(c)
	if !ok {
		return
	}
	var req struct {
		Intent       string          `json:"intent"`
		Aff          string          `json:"aff"`
		Scope        string          `json:"scope"`
		Context      json.RawMessage `json:"context"`
		SameDevice   bool            `json:"same_device"`
		ReturnTarget string          `json:"return_target"`
	}
	if common.DecodeJson(c.Request.Body, &req) != nil {
		common.ApiErrorT(c, "Invalid request")
		return
	}
	identity := officialIdentity(c)
	if req.Intent != "login" && identity.UserID == 0 {
		writeSecurityOperationError(c, service.ErrAuthTokenInvalid)
		return
	}
	// A single browser has one active same-device ceremony. Refresh invalidates
	// the previous one before it can receive a late scanner callback.
	if previous, err := c.Cookie(officialOwnerCookie); err == nil {
		_ = service.CancelWeChatOfficial(previous, browser, identity)
	}
	flow, err := service.NewWeChatOfficialFlow(browser, identity, service.WeChatOfficialFlowRequest{Intent: req.Intent, Aff: req.Aff, Scope: req.Scope, Context: req.Context, SameDevice: req.SameDevice, ReturnTarget: req.ReturnTarget})
	if err != nil {
		officialError(c, err)
		return
	}
	officialCookie(c, officialOwnerCookie, flow.FlowToken, 300)
	common.ApiSuccess(c, flow)
}

func officialOwnerRequest(c *gin.Context) (string, string, service.AuthIdentity, bool) {
	browser, ok := phoneBrowserIdentity(c)
	if !ok {
		return "", "", service.AuthIdentity{}, false
	}
	var req struct {
		FlowToken string `json:"flow_token"`
	}
	if common.DecodeJson(c.Request.Body, &req) != nil || len(req.FlowToken) != 43 {
		common.ApiErrorT(c, "Invalid request")
		return "", "", service.AuthIdentity{}, false
	}
	return req.FlowToken, browser, officialIdentity(c), true
}
func WeChatOfficialFlowStatus(c *gin.Context) {
	token, browser, identity, ok := officialOwnerRequest(c)
	if !ok {
		return
	}
	status, err := service.WeChatOfficialStatus(token, browser, identity)
	if err != nil {
		officialError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"status": status})
}
func CancelWeChatOfficialFlow(c *gin.Context) {
	token, browser, identity, ok := officialOwnerRequest(c)
	if !ok {
		return
	}
	if err := service.CancelWeChatOfficial(token, browser, identity); err != nil {
		officialError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
func ResumeWeChatOfficialFlow(c *gin.Context) {
	browser, ok := phoneBrowserIdentity(c)
	if !ok {
		return
	}
	token, err := c.Cookie(officialOwnerCookie)
	if err != nil {
		officialError(c, service.ErrWeChatOfficialFlow)
		return
	}
	p, err := service.ResumeWeChatOfficial(token, browser, officialIdentity(c))
	if err != nil {
		officialError(c, err)
		return
	}
	f, err := model.GetAuthFlow(token, model.AuthFlowMatch{Purpose: "wechat_official_owner", Provider: "wechat_official"})
	if err != nil {
		officialError(c, err)
		return
	}
	data := gin.H{"flow_token": token, "intent": p.Intent, "scope": p.Scope, "aff": p.Aff, "return_target": p.ReturnTarget, "expires_at": f.ExpiresAt.Unix(), "qr_url": "", "status": p.Status}
	if p.Context != "" {
		var context any
		if common.UnmarshalJsonStr(p.Context, &context) != nil {
			officialError(c, service.ErrWeChatOfficialFlow)
			return
		}
		data["context"] = context
	}
	common.ApiSuccess(c, data)
}
func CompleteWeChatOfficialFlow(c *gin.Context) {
	token, browser, identity, ok := officialOwnerRequest(c)
	if !ok {
		return
	}
	p, assertion, proof, err := service.CompleteWeChatOfficial(token, browser, identity)
	if err != nil {
		officialError(c, err)
		return
	}
	switch p.Intent {
	case "login":
		officialCookie(c, officialOwnerCookie, "", -1)
		completeWeChatLogin(c, wechatIdentity{OpenID: p.Subject.OpenID, Profile: wechatProfile{Nickname: p.Subject.Nickname, AvatarURL: p.Subject.AvatarURL}}, browser, p.Aff, p.Fingerprint)
	case "bind":
		f, err := model.GetAuthFlow(assertion, model.AuthFlowMatch{Purpose: "wechat_official_assert", Provider: "wechat_official"})
		if err != nil {
			officialError(c, err)
			return
		}
		common.ApiSuccess(c, gin.H{"assertion_token": assertion, "expires_at": f.ExpiresAt.Unix()})
	case "verify":
		common.ApiSuccess(c, proof)
	}
}
func StartWeChatOfficial(c *gin.Context) {
	state, authorization, err := service.StartWeChatOfficial(c.Query("ref"))
	if err != nil {
		officialError(c, err)
		return
	}
	officialCookie(c, officialScannerCookie, state, 300)
	c.Header("Referrer-Policy", "no-referrer")
	c.Redirect(http.StatusFound, authorization)
}
func CallbackWeChatOfficial(c *gin.Context) {
	cookie, err := c.Cookie(officialScannerCookie)
	state := c.Query("state")
	if err != nil || len(state) != 64 || subtle.ConstantTimeCompare([]byte(cookie), []byte(state)) != 1 {
		officialError(c, service.ErrWeChatOfficialFlow)
		return
	}
	officialCookie(c, officialScannerCookie, "", -1)
	confirmation, err := service.CallbackWeChatOfficial(c.Request.Context(), state, c.Query("code"))
	if err != nil {
		c.Redirect(http.StatusFound, "/wechat-official/confirm?failed=1")
		return
	}
	officialCookie(c, officialConfirmationCookie, confirmation, 300)
	c.Header("Referrer-Policy", "no-referrer")
	c.Redirect(http.StatusFound, "/wechat-official/confirm")
}
func GetWeChatOfficialConfirmation(c *gin.Context) {
	token, err := c.Cookie(officialConfirmationCookie)
	if err != nil {
		officialError(c, service.ErrWeChatOfficialFlow)
		return
	}
	confirmation, err := service.GetWeChatOfficialConfirmation(token)
	if err != nil {
		officialError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"intent": confirmation.Intent, "official_account_name": confirmation.OfficialAccountName, "official_account_logo": confirmation.OfficialAccountLogo, "site_name": confirmation.SiteName, "expires_at": confirmation.ExpiresAt, "same_device": confirmation.SameDevice, "csrf_token": officialCSRF(token)})
}
func ConfirmWeChatOfficial(c *gin.Context) {
	token, err := c.Cookie(officialConfirmationCookie)
	if err != nil {
		officialError(c, service.ErrWeChatOfficialFlow)
		return
	}
	var req struct {
		CSRFToken string `json:"csrf_token"`
		Confirmed bool   `json:"confirmed"`
	}
	if common.DecodeJson(c.Request.Body, &req) != nil || subtle.ConstantTimeCompare([]byte(req.CSRFToken), []byte(officialCSRF(token))) != 1 {
		officialError(c, service.ErrWeChatOfficialFlow)
		return
	}
	confirmation, err := service.GetWeChatOfficialConfirmation(token)
	if err != nil {
		officialError(c, err)
		return
	}
	if err := service.ConfirmWeChatOfficial(token, req.Confirmed); err != nil {
		officialError(c, err)
		return
	}
	officialCookie(c, officialConfirmationCookie, "", -1)
	common.ApiSuccess(c, gin.H{"same_device": confirmation.SameDevice})
}

type officialBindingRequest struct {
	AssertionToken string `json:"assertion_token"`
	SMSToken       string `json:"sms_token"`
	SMSCode        string `json:"sms_code"`
}

func officialBindingContext(c *gin.Context) (officialBindingRequest, service.AuthIdentity, string, service.VerificationOperation, bool) {
	var req officialBindingRequest
	browser, ok := phoneBrowserIdentity(c)
	if !ok {
		return req, service.AuthIdentity{}, "", service.VerificationOperation{}, false
	}
	identity, ok := middleware.GetStepUpIdentity(c)
	if !ok {
		writeSecurityOperationError(c, service.ErrAuthTokenInvalid)
		return req, identity, browser, service.VerificationOperation{}, false
	}
	if common.DecodeJson(c.Request.Body, &req) != nil {
		common.ApiErrorT(c, "Invalid request")
		return req, identity, browser, service.VerificationOperation{}, false
	}
	if _, err := service.GetWeChatOfficialAssertion(req.AssertionToken, browser, identity); err != nil {
		officialError(c, err)
		return req, identity, browser, service.VerificationOperation{}, false
	}
	context, _ := common.Marshal(service.AccountBindingContext{Provider: "wechat_official", Code: strings.TrimSpace(req.AssertionToken)})
	return req, identity, browser, service.VerificationOperation{Scope: service.VerificationScopeAccountBind, Context: context}, true
}
func SendWeChatOfficialBindingSMS(c *gin.Context) {
	req, identity, _, operation, ok := officialBindingContext(c)
	if !ok {
		return
	}
	_ = req
	token, err := service.SendWeChatBindingSMS(identity, operation, c.ClientIP())
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"sms_token": token, "retry_after": 90})
}
func VerifyWeChatOfficialBindingSMS(c *gin.Context) {
	req, identity, _, operation, ok := officialBindingContext(c)
	if !ok {
		return
	}
	proof, err := service.VerifyWeChatBindingSMS(identity, operation, req.SMSToken, req.SMSCode)
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	common.ApiSuccess(c, proof)
}
func BindWeChatOfficial(c *gin.Context) {
	req, identity, browser, operation, ok := officialBindingContext(c)
	if !ok {
		return
	}
	succeeded, notificationFailed := false, false
	defer func() {
		recordUserSecurityAudit(c, identity.UserID, "user.binding_bind", map[string]any{"provider": "wechat_official", "success": succeeded, "notification_failed": notificationFailed})
	}()
	_ = operation
	subject, err := service.BindWeChatOfficialAssertion(req.AssertionToken, browser, strings.TrimSpace(c.GetHeader("X-Security-Proof")), identity)
	if err != nil {
		officialError(c, err)
		return
	}
	succeeded = true
	if err := model.SyncWeChatProfile(identity.UserID, subject.OpenID, "", subject.AvatarURL, true); err != nil {
		common.SysLog("WeChat optional profile synchronization failed")
	}
	user, err := model.GetUserById(identity.UserID, false)
	if err != nil {
		officialError(c, err)
		return
	}
	notificationFailed = service.NotifyAccountSecurityChange(service.AccountMailLanguage(c, user.Id), user.Email, i18n.MsgSecurityEventWeChatLinked) != nil
	common.ApiSuccess(c, gin.H{"notification_warning": notificationFailed})
}
