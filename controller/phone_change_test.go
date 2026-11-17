package controller

import (
	"fmt"
	"io"
	"net/http"
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

func TestPhoneChangeControllerRejectsMFABypassBeforeSMSDelivery(t *testing.T) {
	user, identity := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.Create(&model.ExternalIdentityClaim{Provider: "phone", Subject: "13800138000", UserId: user.Id}).Error)
	require.NoError(t, model.DB.Create(&model.TwoFA{UserId: user.Id, Secret: "unused", IsEnabled: true}).Error)
	response := securityEnrollmentRequest("POST", "/api/user/phone/change/send", `{"step":"old"}`, "", identity, SendPhoneChangeCode)
	require.Contains(t, response.Body.String(), `"success":false`)
	require.Contains(t, response.Body.String(), "SECURITY_PROOF")
}
