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
	"gorm.io/gorm"
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
			inviter := model.User{Username: "binding-inviter", AffCode: "iQO5"}
			require.NoError(t, model.DB.Create(&inviter).Error)
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
			response := phoneAuthControllerRequest("POST", "/api/oauth/wechat", `{"code":"wechat-code","aff":"iQO5"}`, browser, WeChatAuth)
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
			body, err := common.Marshal(map[string]string{"challenge_token": captcha.Data.Token, "answer": "12345", "phone": "13800138000", "bind_token": pending.Data.Token, "aff": "iQO5"})
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
			require.NoError(t, model.DB.First(user, user.Id).Error)
			require.Zero(t, user.InviterId, "binding a phone must not attribute an existing account")
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

// Keep referral coverage on the real public auth handlers and database. Only
// WeChat's code exchange and Alibaba SMS delivery are external test doubles.
func setupAffiliateAuthTest(t *testing.T) *model.User {
	t.Helper()
	inviter, _ := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.ExternalIdentityClaim{}, &model.Log{}))
	require.NoError(t, model.DB.Model(inviter).Update("aff_code", "iQO5").Error)
	previousRegister := common.RegisterEnabled
	common.RegisterEnabled = true
	t.Cleanup(func() { common.RegisterEnabled = previousRegister })
	return inviter
}

func TestPhoneAffiliateAttribution(t *testing.T) {
	for _, tc := range []struct {
		name, aff                                  string
		existing, previouslyInvited, lookupFailure bool
		wantInviter                                bool
	}{
		{name: "new user receives inviter", aff: "iQO5", wantInviter: true},
		{name: "new user trims invitation", aff: "  iQO5  ", wantInviter: true},
		{name: "new user without invitation"},
		{name: "new user with unknown invitation", aff: "missing"},
		{name: "oversized invitation ignored", aff: strings.Repeat("a", 33)},
		{name: "existing user keeps empty inviter", aff: "iQO5", existing: true},
		{name: "existing user keeps previous inviter", aff: "iQO5", existing: true, previouslyInvited: true},
		{name: "database failure aborts registration", aff: "iQO5", lookupFailure: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			inviter := setupAffiliateAuthTest(t)
			var existing model.User
			previousInviter := 0
			if tc.existing {
				if tc.previouslyInvited {
					prior := model.User{Username: "previous-inviter", AffCode: "prior"}
					require.NoError(t, model.DB.Create(&prior).Error)
					previousInviter = prior.Id
				}
				existing = model.User{Username: "existing-phone-user", AffCode: "phone", InviterId: previousInviter, Status: common.UserStatusEnabled}
				require.NoError(t, model.DB.Create(&existing).Error)
				require.NoError(t, model.DB.Create(&model.ExternalIdentityClaim{Provider: "phone", Subject: "13800138000", UserId: existing.Id}).Error)
			}
			if tc.lookupFailure {
				require.NoError(t, model.DB.Callback().Query().After("gorm:query").Register("test:affiliate_failure", func(tx *gorm.DB) {
					if tx.Statement.Table == "users" && len(tx.Statement.Selects) == 1 && tx.Statement.Selects[0] == "id" && strings.Contains(tx.Statement.SQL.String(), "aff_code") {
						tx.AddError(fmt.Errorf("affiliate database unavailable"))
					}
				}))
				t.Cleanup(func() { _ = model.DB.Callback().Query().Remove("test:affiliate_failure") })
			}
			completed := completeAffiliatePhoneLogin(t, tc.aff)
			var result struct {
				Success bool `json:"success"`
			}
			require.NoError(t, common.Unmarshal(completed.Body.Bytes(), &result))
			if tc.lookupFailure {
				require.False(t, result.Success)
				owner, err := model.GetPhoneUserID("13800138000")
				require.NoError(t, err)
				require.Zero(t, owner)
				return
			}
			require.True(t, result.Success)
			owner, err := model.GetPhoneUserID("13800138000")
			require.NoError(t, err)
			var user model.User
			require.NoError(t, model.DB.First(&user, owner).Error)
			want := previousInviter
			if tc.wantInviter {
				want = inviter.Id
			}
			require.Equal(t, want, user.InviterId)
			if tc.existing {
				require.Equal(t, existing.Id, user.Id)
			}
		})
	}
}

func completeAffiliatePhoneLogin(t *testing.T, affiliateCode string) *httptest.ResponseRecorder {
	t.Helper()
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
		var template map[string]string
		require.NoError(t, common.UnmarshalJsonStr(r.Form.Get("TemplateParam"), &template))
		smsCode = template["code"]
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"Code":"OK"}`)), Header: http.Header{}}, nil
	})}
	t.Cleanup(func() { http.DefaultClient = originalClient })
	browser := strings.Repeat("a", 43)
	browserIdentity := common.GenerateHMACWithKey([]byte("phone-browser:"+common.SessionSecret), browser)
	payload, err := common.Marshal(map[string]string{"digest": common.GenerateHMACWithKey([]byte("phone-code:"+common.SessionSecret), "12345")})
	require.NoError(t, err)
	image, _, err := model.CreateAuthFlow(model.AuthFlowCreate{Purpose: "phone_image", SessionId: browserIdentity, Payload: string(payload), ExpiresAt: time.Now().Add(time.Minute)})
	require.NoError(t, err)
	body, err := common.Marshal(map[string]string{"challenge_token": image, "answer": "12345", "phone": "13800138000", "aff": affiliateCode})
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
	return phoneAuthControllerRequest("POST", "/api/phone/login", fmt.Sprintf(`{"sms_token":%q,"code":%q}`, sms.Data.Token, smsCode), browser, PhoneLogin)
}

func TestWeChatAffiliateAttribution(t *testing.T) {
	for _, tc := range []struct {
		name, aff                                  string
		existing, previouslyInvited, lookupFailure bool
		wantInviter                                bool
	}{
		{name: "new user attributed before phone binding", aff: "iQO5", wantInviter: true},
		{name: "new user trims invitation", aff: "  iQO5  ", wantInviter: true},
		{name: "new user without invitation"},
		{name: "new user with unknown invitation", aff: "missing"},
		{name: "oversized invitation ignored", aff: strings.Repeat("a", 33)},
		{name: "existing user keeps empty inviter", aff: "iQO5", existing: true},
		{name: "existing user keeps previous inviter", aff: "iQO5", existing: true, previouslyInvited: true},
		{name: "database failure aborts registration", aff: "iQO5", lookupFailure: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			inviter := setupAffiliateAuthTest(t)
			previousInviter := 0
			if tc.existing {
				if tc.previouslyInvited {
					prior := model.User{Username: "previous-inviter", AffCode: "prior"}
					require.NoError(t, model.DB.Create(&prior).Error)
					previousInviter = prior.Id
				}
				existing := model.User{Username: "existing-wechat-user", AffCode: "wechat", WeChatId: "affiliate-openid", InviterId: previousInviter, Status: common.UserStatusEnabled}
				require.NoError(t, model.DB.Create(&existing).Error)
			}
			oldEnabled, oldAddress := common.WeChatAuthEnabled, common.WeChatServerAddress
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(`{"success":true,"data":"affiliate-openid"}`))
			}))
			common.WeChatAuthEnabled, common.WeChatServerAddress = true, upstream.URL
			t.Cleanup(func() {
				upstream.Close()
				common.WeChatAuthEnabled, common.WeChatServerAddress = oldEnabled, oldAddress
			})
			if tc.lookupFailure {
				require.NoError(t, model.DB.Callback().Query().After("gorm:query").Register("test:affiliate_failure", func(tx *gorm.DB) {
					if tx.Statement.Table == "users" && len(tx.Statement.Selects) == 1 && tx.Statement.Selects[0] == "id" && strings.Contains(tx.Statement.SQL.String(), "aff_code") {
						tx.AddError(fmt.Errorf("affiliate database unavailable"))
					}
				}))
				t.Cleanup(func() { _ = model.DB.Callback().Query().Remove("test:affiliate_failure") })
			}
			body, err := common.Marshal(map[string]string{"code": "wechat-code", "aff": tc.aff})
			require.NoError(t, err)
			response := phoneAuthControllerRequest("POST", "/api/oauth/wechat", string(body), strings.Repeat("a", 43), WeChatAuth)
			var result struct {
				Success bool `json:"success"`
				Data    struct {
					Required    bool   `json:"require_phone_binding"`
					AccessToken string `json:"access_token"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			if tc.lookupFailure {
				require.False(t, result.Success)
				var count int64
				require.NoError(t, model.DB.Model(&model.User{}).Where("wechat_id = ?", "affiliate-openid").Count(&count).Error)
				require.Zero(t, count)
				return
			}
			require.True(t, result.Success)
			require.True(t, result.Data.Required)
			require.Empty(t, result.Data.AccessToken)
			var user model.User
			require.NoError(t, model.DB.Where("wechat_id = ?", "affiliate-openid").First(&user).Error)
			want := previousInviter
			if tc.wantInviter {
				want = inviter.Id
			}
			require.Equal(t, want, user.InviterId)
		})
	}
}
