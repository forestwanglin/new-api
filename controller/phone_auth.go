package controller

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const phoneBrowserCookie = "phone_auth_browser"

func phoneBrowserIdentity(c *gin.Context) (string, bool) {
	cookie, err := c.Cookie(phoneBrowserCookie)
	header := c.GetHeader("X-Phone-Auth")
	if err != nil || len(cookie) != 43 || subtle.ConstantTimeCompare([]byte(cookie), []byte(header)) != 1 {
		common.ApiErrorT(c, "Authentication flow expired. Please try again.")
		return "", false
	}
	return common.GenerateHMACWithKey([]byte("phone-browser:"+common.SessionSecret), cookie), true
}

func PhoneCaptcha(c *gin.Context) {
	setAuthNoStore(c)
	nonce, err := c.Cookie(phoneBrowserCookie)
	if err != nil || len(nonce) != 43 {
		random := make([]byte, 32)
		if _, err := rand.Read(random); err != nil {
			common.ApiError(c, err)
			return
		}
		nonce = base64.RawURLEncoding.EncodeToString(random)
	}
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(phoneBrowserCookie, nonce, 600, "/api", "", common.SessionCookieSecure, true)
	browser := common.GenerateHMACWithKey([]byte("phone-browser:"+common.SessionSecret), nonce)
	token, image, err := service.NewPhoneImage(browser)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"challenge_token": token, "image": image, "browser_token": nonce})
}

type phoneAuthRequest struct {
	ChallengeToken string `json:"challenge_token"`
	Answer         string `json:"answer"`
	Phone          string `json:"phone"`
	BindToken      string `json:"bind_token"`
	SendToken      string `json:"send_token"`
	SMSToken       string `json:"sms_token"`
	Code           string `json:"code"`
}

func VerifyPhoneCaptcha(c *gin.Context) {
	browser, ok := phoneBrowserIdentity(c)
	if !ok {
		return
	}
	var req phoneAuthRequest
	if common.DecodeJson(c.Request.Body, &req) != nil {
		common.ApiErrorT(c, "Invalid request")
		return
	}
	token, err := service.VerifyPhoneImage(req.ChallengeToken, req.Answer, req.Phone, req.BindToken, browser)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"send_token": token})
}

func SendPhoneSMS(c *gin.Context) {
	browser, ok := phoneBrowserIdentity(c)
	if !ok {
		return
	}
	if !service.PhoneSMSConfigured() {
		common.ApiErrorT(c, "Phone login is not configured. Please contact your administrator.")
		return
	}
	var req phoneAuthRequest
	if common.DecodeJson(c.Request.Body, &req) != nil {
		common.ApiErrorT(c, "Invalid request")
		return
	}
	token, err := service.SendPhoneSMS(req.SendToken, browser, c.ClientIP())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"sms_token": token, "retry_after": 90})
}

func PhoneLogin(c *gin.Context) {
	browser, ok := phoneBrowserIdentity(c)
	if !ok {
		return
	}
	if !service.PhoneSMSConfigured() {
		common.ApiErrorT(c, "Phone login is not configured. Please contact your administrator.")
		return
	}
	var req phoneAuthRequest
	if common.DecodeJson(c.Request.Body, &req) != nil {
		common.ApiErrorT(c, "Invalid request")
		return
	}
	user, err := service.CompletePhoneLogin(req.SMSToken, req.Code, browser)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.Set("login_method", "phone_sms")
	setupLogin(user, nil, c)
}
