package controller

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/pquerna/otp/totp"
	"github.com/stretchr/testify/require"
)

func phoneAuthControllerRequest(method, path, body, browser string, handler gin.HandlerFunc) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest(method, path, strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if browser != "" {
		c.Request.AddCookie(&http.Cookie{Name: phoneBrowserCookie, Value: browser})
		c.Request.Header.Set("X-Phone-Auth", browser)
	}
	handler(c)
	return response
}

type controllerSMSRoundTripper func(*http.Request) (*http.Response, error)

func (send controllerSMSRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) {
	return send(r)
}

func TestPhoneControllerRejectsMissingOrMismatchedBrowserProof(t *testing.T) {
	setupSecurityEnrollmentTest(t)
	previous := common.WeChatAuthEnabled
	common.WeChatAuthEnabled = true
	t.Cleanup(func() { common.WeChatAuthEnabled = previous })
	for _, handler := range []gin.HandlerFunc{WeChatAuth, VerifyPhoneCaptcha, SendPhoneSMS, PhoneLogin} {
		for _, mismatched := range []bool{false, true} {
			response := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(response)
			c.Request = httptest.NewRequest(http.MethodPost, "/api/phone/login", strings.NewReader(`{}`))
			if mismatched {
				c.Request.AddCookie(&http.Cookie{Name: phoneBrowserCookie, Value: strings.Repeat("a", 43)})
				c.Request.Header.Set("X-Phone-Auth", strings.Repeat("b", 43))
			}
			handler(c)
			require.Contains(t, response.Body.String(), "Authentication flow expired")
			require.NotContains(t, response.Body.String(), `"access_token"`)
			require.Empty(t, response.Header().Values("Set-Cookie"))
		}
	}
}

func TestPhoneControllerWeChatBindingRetainsLoginVerification(t *testing.T) {
	for _, withMFA := range []bool{false, true} {
		t.Run(fmt.Sprintf("mfa=%t", withMFA), func(t *testing.T) {
			user, _ := setupSecurityEnrollmentTest(t)
			require.NoError(t, model.DB.AutoMigrate(&model.ExternalIdentityClaim{}))
			require.NoError(t, model.DB.Model(user).Update("wechat_id", "phone-binding-openid").Error)
			if withMFA {
				require.NoError(t, model.DB.Create(&model.TwoFA{UserId: user.Id, Secret: "JBSWY3DPEHPK3PXP", IsEnabled: true}).Error)
			}
			previousEnabled, previousAddress := common.WeChatAuthEnabled, common.WeChatServerAddress
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				require.Equal(t, "wechat-code", r.URL.Query().Get("code"))
				_, _ = w.Write([]byte(`{"success":true,"data":"phone-binding-openid"}`))
			}))
			common.WeChatAuthEnabled, common.WeChatServerAddress = true, upstream.URL
			t.Cleanup(func() {
				upstream.Close()
				common.WeChatAuthEnabled, common.WeChatServerAddress = previousEnabled, previousAddress
			})
			settings := system_setting.GetPhoneSettings()
			previousSettings := *settings
			*settings = system_setting.PhoneSettings{Enabled: true, Region: "cn-hangzhou", SignName: "test", TemplateCode: "SMS_TEST"}
			t.Cleanup(func() { *settings = previousSettings })
			t.Setenv("ALIYUN_SMS_ACCESS_KEY_ID", "testid")
			t.Setenv("ALIYUN_SMS_ACCESS_KEY_SECRET", "testsecret")
			originalClient := http.DefaultClient
			smsCode := ""
			http.DefaultClient = &http.Client{Transport: controllerSMSRoundTripper(func(r *http.Request) (*http.Response, error) {
				require.Equal(t, "https://dysmsapi.aliyuncs.com/", r.URL.String())
				require.NoError(t, r.ParseForm())
				require.Equal(t, "13800138000", r.Form.Get("PhoneNumbers"))
				var template map[string]string
				require.NoError(t, common.UnmarshalJsonStr(r.Form.Get("TemplateParam"), &template))
				smsCode = template["code"]
				return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"Code":"OK"}`)), Header: http.Header{}}, nil
			})}
			t.Cleanup(func() { http.DefaultClient = originalClient })

			captchaResponse := phoneAuthControllerRequest("GET", "/api/phone/captcha", "", "", PhoneCaptcha)
			var captcha struct {
				Success bool `json:"success"`
				Data    struct {
					Browser string `json:"browser_token"`
					Token   string `json:"challenge_token"`
					Image   string `json:"image"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(captchaResponse.Body.Bytes(), &captcha))
			require.True(t, captcha.Success, captchaResponse.Body.String())
			require.NotEmpty(t, captcha.Data.Image)
			require.Equal(t, captcha.Data.Browser, captchaResponse.Result().Cookies()[0].Value)
			browser := captcha.Data.Browser
			browserIdentity := common.GenerateHMACWithKey([]byte("phone-browser:"+common.SessionSecret), browser)
			response := phoneAuthControllerRequest("POST", "/api/oauth/wechat", `{"code":"wechat-code"}`, browser, WeChatAuth)
			var pending struct {
				Success bool `json:"success"`
				Data    struct {
					Required bool   `json:"require_phone_binding"`
					Token    string `json:"bind_token"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &pending))
			require.True(t, pending.Success, response.Body.String())
			require.True(t, pending.Data.Required)
			require.NotEmpty(t, pending.Data.Token)
			require.NotContains(t, response.Body.String(), `"access_token"`)
			require.Empty(t, response.Header().Values("Set-Cookie"))
			count, err := model.CountActiveUserSessions(user.Id, time.Now().Unix())
			require.NoError(t, err)
			require.EqualValues(t, 1, count, "primary WeChat proof must not create another session")

			// Fix the random CAPTCHA answer in its stored fixture, then exercise the
			// actual public verification/send/login controllers and provider transport.
			imageFlow, err := model.GetAuthFlow(captcha.Data.Token, model.AuthFlowMatch{Purpose: "phone_image", SessionId: browserIdentity})
			require.NoError(t, err)
			payload, err := common.Marshal(map[string]string{"digest": common.GenerateHMACWithKey([]byte("phone-code:"+common.SessionSecret), "12345")})
			require.NoError(t, err)
			require.NoError(t, model.DB.Model(imageFlow).Update("payload", string(payload)).Error)
			body, err := common.Marshal(map[string]string{"challenge_token": captcha.Data.Token, "answer": "12345", "phone": "13800138000", "bind_token": pending.Data.Token})
			require.NoError(t, err)
			verified := phoneAuthControllerRequest("POST", "/api/phone/captcha/verify", string(body), browser, VerifyPhoneCaptcha)
			var permit struct {
				Success bool `json:"success"`
				Data    struct {
					Token string `json:"send_token"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(verified.Body.Bytes(), &permit))
			require.True(t, permit.Success, verified.Body.String())
			sent := phoneAuthControllerRequest("POST", "/api/phone/sms/send", fmt.Sprintf(`{"send_token":%q}`, permit.Data.Token), browser, SendPhoneSMS)
			var sms struct {
				Success bool `json:"success"`
				Data    struct {
					Token string `json:"sms_token"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(sent.Body.Bytes(), &sms))
			require.True(t, sms.Success, sent.Body.String())
			require.Len(t, smsCode, 6)
			loginBody := fmt.Sprintf(`{"sms_token":%q,"code":%q}`, sms.Data.Token, smsCode)
			completed := phoneAuthControllerRequest("POST", "/api/phone/login", loginBody, browser, PhoneLogin)
			var result struct {
				Success bool `json:"success"`
				Data    struct {
					RequireVerification bool   `json:"require_verification"`
					FlowToken           string `json:"flow_token"`
					AccessToken         string `json:"access_token"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(completed.Body.Bytes(), &result))
			require.True(t, result.Success, completed.Body.String())
			owner, err := model.GetPhoneUserID("13800138000")
			require.NoError(t, err)
			require.Equal(t, user.Id, owner)
			if withMFA {
				require.True(t, result.Data.RequireVerification)
				require.Empty(t, result.Data.AccessToken)
				require.Empty(t, completed.Header().Values("Set-Cookie"))
				count, err = model.CountActiveUserSessions(user.Id, time.Now().Unix())
				require.NoError(t, err)
				require.EqualValues(t, 1, count, "SMS must retain the configured MFA requirement")
				code, err := totp.GenerateCode("JBSWY3DPEHPK3PXP", time.Now())
				require.NoError(t, err)
				completed = securityEnrollmentRequest("POST", "/api/user/login/verify", fmt.Sprintf(`{"flow_token":%q,"code":%q}`, result.Data.FlowToken, code), "", service.AuthIdentity{}, VerifyLogin)
				require.NoError(t, common.Unmarshal(completed.Body.Bytes(), &result))
				require.True(t, result.Success, completed.Body.String())
			}
			require.NotEmpty(t, result.Data.AccessToken)
			require.NotEmpty(t, completed.Header().Values("Set-Cookie"))
			count, err = model.CountActiveUserSessions(user.Id, time.Now().Unix())
			require.NoError(t, err)
			require.EqualValues(t, 2, count)
			replay := phoneAuthControllerRequest("POST", "/api/phone/login", loginBody, browser, PhoneLogin)
			require.NotContains(t, replay.Body.String(), `"success":true`)
			require.Empty(t, replay.Header().Values("Set-Cookie"))
		})
	}
}
