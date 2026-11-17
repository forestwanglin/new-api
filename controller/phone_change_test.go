package controller

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type phoneChangeSMSRoundTripper func(*http.Request) (*http.Response, error)

func (transport phoneChangeSMSRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func phoneChangeControllerToken(t *testing.T, identity service.AuthIdentity, path, body string, handler gin.HandlerFunc) string {
	t.Helper()
	response := securityEnrollmentRequest("POST", path, body, "", identity, handler)
	var result struct {
		Success bool `json:"success"`
		Data    struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	require.True(t, result.Success, response.Body.String())
	require.NotEmpty(t, result.Data.Token)
	return result.Data.Token
}

func TestPhoneChangeControllerRotatesCurrentSessionAndRevokesOthers(t *testing.T) {
	user, identity := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.Create(&model.ExternalIdentityClaim{Provider: "phone", Subject: "13800138000", UserId: user.Id}).Error)
	require.NoError(t, model.DB.Create(&model.TwoFA{UserId: user.Id, Secret: "unused", IsEnabled: true}).Error)
	other, err := service.CreateLoginSession(user.Id, "password", "192.0.2.2", "other-device")
	require.NoError(t, err)
	status := securityEnrollmentRequest("GET", "/api/user/phone/change/status", "", "", identity, GetPhoneChangeStatus)
	require.Contains(t, status.Body.String(), `"phone_masked":"138****8000"`)
	require.NotContains(t, status.Body.String(), "13800138000")
	oldSettings := *system_setting.GetPhoneSettings()
	*system_setting.GetPhoneSettings() = system_setting.PhoneSettings{Enabled: true, Region: "cn-hangzhou", SignName: "test", TemplateCode: "SMS_TEST"}
	t.Cleanup(func() { *system_setting.GetPhoneSettings() = oldSettings })
	t.Setenv("ALIYUN_SMS_ACCESS_KEY_ID", "test")
	t.Setenv("ALIYUN_SMS_ACCESS_KEY_SECRET", "test")
	oldClient := http.DefaultClient
	t.Cleanup(func() { http.DefaultClient = oldClient })
	code := ""
	http.DefaultClient = &http.Client{Transport: phoneChangeSMSRoundTripper(func(r *http.Request) (*http.Response, error) {
		require.NoError(t, r.ParseForm())
		var template map[string]string
		require.NoError(t, common.UnmarshalJsonStr(r.Form.Get("TemplateParam"), &template))
		code = template["code"]
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"Code":"OK"}`))}, nil
	})}
	oldSMS := phoneChangeControllerToken(t, identity, "/api/user/phone/change/send", `{"step":"old"}`, SendPhoneChangeCode)
	oldVerified := phoneChangeControllerToken(t, identity, "/api/user/phone/change/verify", fmt.Sprintf(`{"step":"old","token":%q,"code":%q}`, oldSMS, code), VerifyPhoneChangeCode)
	newSMS := phoneChangeControllerToken(t, identity, "/api/user/phone/change/send", fmt.Sprintf(`{"step":"new","phone":"13900139000","verification_token":%q}`, oldVerified), SendPhoneChangeCode)
	ready := phoneChangeControllerToken(t, identity, "/api/user/phone/change/verify", fmt.Sprintf(`{"step":"new","phone":"13900139000","token":%q,"code":%q}`, newSMS, code), VerifyPhoneChangeCode)
	response := securityEnrollmentRequest("POST", "/api/user/phone/change/complete", fmt.Sprintf(`{"token":%q}`, ready), "", identity, CompletePhoneChange)
	var result struct {
		Success bool `json:"success"`
		Data    struct {
			AccessToken string `json:"access_token"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	require.True(t, result.Success, response.Body.String())
	rotated, err := service.ParseAccessToken(result.Data.AccessToken)
	require.NoError(t, err)
	require.Equal(t, identity.SessionID, rotated.SessionID)
	require.Equal(t, identity.UserAuthVersion+1, rotated.UserAuthVersion)
	require.NoError(t, model.ValidateAuthSessionWithTx(model.DB, rotated))
	otherSession, err := model.GetUserSessionBySID(other.Session.SID)
	require.NoError(t, err)
	require.Equal(t, model.UserSessionStatusRevoked, otherSession.Status)
	replay := securityEnrollmentRequest("POST", "/api/user/phone/change/complete", fmt.Sprintf(`{"token":%q}`, ready), "", rotated, CompletePhoneChange)
	require.Contains(t, replay.Body.String(), `"success":false`)
}

func TestPhoneBindingControllerRejectsMissingProofBeforeSMSDelivery(t *testing.T) {
	user, identity := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.Create(&model.ExternalIdentityClaim{Provider: "phone", Subject: "13800138000", UserId: user.Id}).Error)
	require.NoError(t, model.DB.Create(&model.TwoFA{UserId: user.Id, Secret: "unused", IsEnabled: true}).Error)
	response := securityEnrollmentRequest("POST", "/api/user/phone/change/start", `{}`, "", identity, StartPhoneBinding)
	require.Contains(t, response.Body.String(), `"success":false`)
	require.Contains(t, response.Body.String(), "SECURITY_PROOF")
}

func TestPhoneBindingControllerWeChatCodeMustBelongToCurrentAccount(t *testing.T) {
	user, identity := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.Model(user).Update("wechat_id", "phone-owner-openid").Error)
	oldEnabled, oldAddress, oldToken := common.WeChatAuthEnabled, common.WeChatServerAddress, common.WeChatServerToken
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		openid := "another-account"
		if r.URL.Query().Get("code") == "123456" {
			openid = "phone-owner-openid"
		}
		_, _ = fmt.Fprintf(w, `{"success":true,"data":%q}`, openid)
	}))
	common.WeChatAuthEnabled, common.WeChatServerAddress, common.WeChatServerToken = true, server.URL, "test-token"
	t.Cleanup(func() {
		server.Close()
		common.WeChatAuthEnabled, common.WeChatServerAddress, common.WeChatServerToken = oldEnabled, oldAddress, oldToken
	})
	for _, code := range []string{"654321", "123456"} {
		response := securityEnrollmentRequest("POST", "/api/verify", fmt.Sprintf(`{"scope":"phone.binding","method":"wechat","code":%q}`, code), "", identity, UniversalVerify)
		body := decodeSecurityEnrollmentResponse(t, response)
		if code == "654321" {
			require.False(t, body.Success)
			continue
		}
		require.True(t, body.Success, response.Body.String())
		var proof service.SecurityProof
		require.NoError(t, common.Unmarshal(body.Data, &proof))
		response = securityEnrollmentRequest("POST", "/api/user/phone/change/start", `{}`, proof.ProofToken, identity, StartPhoneBinding)
		require.True(t, decodeSecurityEnrollmentResponse(t, response).Success, response.Body.String())
		response = securityEnrollmentRequest("POST", "/api/user/phone/change/start", `{}`, proof.ProofToken, identity, StartPhoneBinding)
		require.False(t, decodeSecurityEnrollmentResponse(t, response).Success)
	}
}
