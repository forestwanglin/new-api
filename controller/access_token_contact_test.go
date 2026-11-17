package controller

import (
	"fmt"
	"github.com/pquerna/otp/totp"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const contactCreateContext = `{"scopes":["profile:read"],"expires_at":0}`

func TestAccessTokenContactPriorityAndScopeIsolation(t *testing.T) {
	for _, contact := range []string{"none", "phone", "wechat", "both"} {
		t.Run(contact, func(t *testing.T) {
			user, identity := setupSecurityEnrollmentTest(t)
			if contact == "phone" || contact == "both" {
				require.NoError(t, model.DB.Create(&model.ExternalIdentityClaim{Provider: "phone", Subject: "13800138000", UserId: user.Id}).Error)
			}
			if contact == "wechat" || contact == "both" {
				require.NoError(t, model.DB.Model(user).Update("wechat_id", "own-wechat").Error)
			}
			require.NoError(t, model.DB.Create(&model.TwoFA{UserId: user.Id, Secret: "JBSWY3DPEHPK3PXP", IsEnabled: true}).Error)
			requirements, err := service.GetVerificationRequirements(identity, "access_token.generate")
			require.NoError(t, err)
			expected := "2fa"
			if contact == "phone" {
				expected = "sms"
			}
			if contact == "wechat" || contact == "both" {
				expected = "wechat"
			}
			require.Len(t, requirements.Methods, 1)
			assert.Equal(t, expected, requirements.Methods[0].Method)
			for _, scope := range []string{"access_token.update", "access_token.revoke", "account.binding.bind"} {
				unchanged, err := service.GetVerificationRequirements(identity, scope)
				require.NoError(t, err)
				require.Len(t, unchanged.Methods, 1)
				assert.Equal(t, "2fa", unchanged.Methods[0].Method)
			}
		})
	}
}

func TestAccessTokenWeChatCodeMustMatchBoundOwnerAndProofIsOneTime(t *testing.T) {
	user, identity := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.Model(user).Update("wechat_id", "own-wechat").Error)
	oldEnabled, oldAddress, oldToken := common.WeChatAuthEnabled, common.WeChatServerAddress, common.WeChatServerToken
	common.WeChatAuthEnabled, common.WeChatServerToken = true, "test-token"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "test-token", r.Header.Get("Authorization"))
		id := "other-wechat"
		if r.URL.Query().Get("code") == "123456" {
			id = "own-wechat"
		}
		_, _ = fmt.Fprintf(w, `{"success":true,"data":%q}`, id)
	}))
	common.WeChatServerAddress = server.URL
	t.Cleanup(func() {
		server.Close()
		common.WeChatAuthEnabled, common.WeChatServerAddress, common.WeChatServerToken = oldEnabled, oldAddress, oldToken
	})
	for _, code := range []string{"654321", "123456"} {
		response := securityEnrollmentRequest("POST", "/api/verify", `{"method":"wechat","scope":"access_token.generate","context":`+contactCreateContext+`,"code":"`+code+`"}`, "", identity, UniversalVerify)
		var body securityEnrollmentResponse
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &body))
		if code == "654321" {
			assert.False(t, body.Success)
			assert.NotContains(t, response.Body.String(), "proof_token")
			continue
		}
		require.True(t, body.Success, response.Body.String())
		var proof service.SecurityProof
		require.NoError(t, common.Unmarshal(body.Data, &proof))
		op := service.VerificationOperation{Scope: "access_token.generate", Context: []byte(contactCreateContext)}
		response = securityEnrollmentRequest("POST", "/api/user/access_tokens", `{"name":"wechat","scopes":["profile:read"],"expires_at":0}`, proof.ProofToken, identity, CreateAccessToken)
		require.True(t, decodeSecurityEnrollmentResponse(t, response).Success, response.Body.String())
		_, err := service.ConsumeOperationProof(proof.ProofToken, identity, op)
		require.Error(t, err)
	}
}

func TestAccessTokenSMSRejectsContextReplayAndChangedPriority(t *testing.T) {
	user, identity := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.Create(&model.ExternalIdentityClaim{Provider: "phone", Subject: "13800138000", UserId: user.Id}).Error)
	code := configureContactSMS(t)
	op := service.VerificationOperation{Scope: "access_token.generate", Context: []byte(contactCreateContext)}
	token, err := service.SendAccessTokenSMS(identity, op, "192.0.2.1")
	require.NoError(t, err)
	_, err = service.VerifySecurityInput(identity, service.VerificationInput{Scope: op.Scope, Context: []byte(`{"scopes":["usage:read"],"expires_at":0}`), Method: "sms", SMSToken: token, Code: *code})
	require.Error(t, err)
	input := service.VerificationInput{Scope: op.Scope, Context: op.Context, Method: "sms", SMSToken: token, Code: *code}
	proof, err := service.VerifySecurityInput(identity, input)
	require.NoError(t, err)
	_, err = service.VerifySecurityInput(identity, input)
	require.Error(t, err)
	require.NoError(t, model.DB.Model(user).Update("wechat_id", "new-wechat").Error)
	_, err = service.ConsumeOperationProof(proof.ProofToken, identity, op)
	require.Error(t, err)
}

type contactSMSHTTP func(*http.Request) (*http.Response, error)

func (f contactSMSHTTP) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestAccessTokenOldFactorProofRejectedAfterContactBinding(t *testing.T) {
	for _, contact := range []string{"wechat", "phone"} {
		t.Run(contact, func(t *testing.T) {
			user, identity := setupSecurityEnrollmentTest(t)
			op := service.VerificationOperation{Scope: "access_token.generate", Context: []byte(contactCreateContext)}
			proof, err := service.VerifySecurityInput(identity, service.VerificationInput{Scope: op.Scope, Context: op.Context, Method: "password", Password: "enrollment-password"})
			require.NoError(t, err)
			if contact == "wechat" {
				require.NoError(t, model.DB.Model(user).Update("wechat_id", "own-wechat").Error)
			} else {
				require.NoError(t, model.DB.Create(&model.ExternalIdentityClaim{Provider: "phone", Subject: "13800138000", UserId: user.Id}).Error)
			}
			_, err = service.ConsumeOperationProof(proof.ProofToken, identity, op)
			require.Error(t, err)
		})
	}
}

func configureContactSMS(t *testing.T) *string {
	t.Helper()
	oldSettings := *system_setting.GetPhoneSettings()
	*system_setting.GetPhoneSettings() = system_setting.PhoneSettings{Enabled: true, Region: "cn-hangzhou", SignName: "test", TemplateCode: "SMS_TEST"}
	t.Setenv("ALIYUN_SMS_ACCESS_KEY_ID", "test")
	t.Setenv("ALIYUN_SMS_ACCESS_KEY_SECRET", "test")
	oldClient := http.DefaultClient
	code := new(string)
	http.DefaultClient = &http.Client{Transport: contactSMSHTTP(func(r *http.Request) (*http.Response, error) {
		require.NoError(t, r.ParseForm())
		assert.Equal(t, "13800138000", r.Form.Get("PhoneNumbers"))
		var params struct {
			Code string `json:"code"`
		}
		require.NoError(t, common.UnmarshalJsonStr(r.Form.Get("TemplateParam"), &params))
		*code = params.Code
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"Code":"OK"}`)), Header: http.Header{}}, nil
	})}
	t.Cleanup(func() { http.DefaultClient = oldClient; *system_setting.GetPhoneSettings() = oldSettings })
	return code
}

func TestAccessTokenSMSRejectsInvalidCeremonies(t *testing.T) {
	for _, scenario := range []string{"create", "wrong", "expired", "exhausted", "session", "account", "revoked", "resend", "delivery", "rate_limit", "phone_changed", "proof_phone_changed"} {
		t.Run(scenario, func(t *testing.T) {
			user, identity := setupSecurityEnrollmentTest(t)
			require.NoError(t, model.DB.Create(&model.ExternalIdentityClaim{Provider: "phone", Subject: "13800138000", UserId: user.Id}).Error)
			code := configureContactSMS(t)
			op := service.VerificationOperation{Scope: "access_token.generate", Context: []byte(contactCreateContext)}
			if scenario == "delivery" {
				calls := 0
				http.DefaultClient = &http.Client{Transport: contactSMSHTTP(func(*http.Request) (*http.Response, error) { calls++; return nil, fmt.Errorf("provider timeout") })}
				_, err := service.SendAccessTokenSMS(identity, op, "192.0.2.1")
				require.ErrorIs(t, err, service.ErrBindingSMSDelivery)
				assert.Equal(t, 1, calls)
				var count int64
				require.NoError(t, model.DB.Model(&model.AuthFlow{}).Where("purpose = ?", "access_token_sms").Count(&count).Error)
				assert.Zero(t, count)
				return
			}
			response := securityEnrollmentRequest("POST", "/api/verify/sms/send", `{"scope":"access_token.generate","context":`+contactCreateContext+`}`, "", identity, SendVerificationSMS)
			body := decodeSecurityEnrollmentResponse(t, response)
			require.True(t, body.Success, body.Message)
			var sent struct {
				Token      string `json:"sms_token"`
				RetryAfter int    `json:"retry_after"`
			}
			require.NoError(t, common.Unmarshal(body.Data, &sent))
			require.NotEmpty(t, sent.Token)
			assert.Equal(t, 90, sent.RetryAfter)
			input := service.VerificationInput{Scope: op.Scope, Context: op.Context, Method: "sms", SMSToken: sent.Token, Code: *code}
			switch scenario {
			case "create":
				proof, err := service.VerifySecurityInput(identity, input)
				require.NoError(t, err)
				_, err = service.ConsumeOperationProof(proof.ProofToken, identity, service.VerificationOperation{Scope: "account.binding.bind", Context: []byte(`{"provider":"wechat"}`)})
				require.Error(t, err)
				response := securityEnrollmentRequest("POST", "/api/user/access_tokens", `{"name":"sms","scopes":["profile:read"],"expires_at":0}`, proof.ProofToken, identity, CreateAccessToken)
				require.True(t, decodeSecurityEnrollmentResponse(t, response).Success, response.Body.String())
				replay := securityEnrollmentRequest("POST", "/api/user/access_tokens", `{"name":"sms","scopes":["profile:read"],"expires_at":0}`, proof.ProofToken, identity, CreateAccessToken)
				require.False(t, decodeSecurityEnrollmentResponse(t, replay).Success)
				return
			case "wrong":
				input.Code = "invalid"
			case "expired":
				require.NoError(t, model.DB.Model(&model.AuthFlow{}).Where("purpose = ?", "access_token_sms").Update("expires_at", time.Now().Add(-time.Minute)).Error)
			case "exhausted":
				wrong := input
				wrong.Code = "invalid"
				for range 5 {
					_, err := service.VerifySecurityInput(identity, wrong)
					require.Error(t, err)
				}
			case "session":
				bundle, err := service.CreateLoginSession(user.Id, "password", "192.0.2.1", "second")
				require.NoError(t, err)
				identity, err = service.ParseAccessToken(bundle.AccessToken)
				require.NoError(t, err)
			case "account":
				identity.UserID++
			case "revoked":
				_, err := model.RevokeUserSession(user.Id, identity.SessionID, "test")
				require.NoError(t, err)
			case "resend":
				// Remove only durable cooldown reservations to advance the test past resend delay.
				require.NoError(t, model.DB.Where("purpose = ?", "phone_cooldown").Delete(&model.AuthFlow{}).Error)
				_, err := service.SendAccessTokenSMS(identity, op, "192.0.2.1")
				require.NoError(t, err)
			case "rate_limit":
				_, err := service.SendAccessTokenSMS(identity, op, "192.0.2.1")
				require.Error(t, err)
				return
			case "phone_changed":
				require.NoError(t, model.DB.Model(&model.ExternalIdentityClaim{}).Where("user_id = ?", user.Id).Update("subject", "13900139000").Error)
			case "proof_phone_changed":
				proof, err := service.VerifySecurityInput(identity, input)
				require.NoError(t, err)
				require.NoError(t, model.DB.Model(&model.ExternalIdentityClaim{}).Where("user_id = ?", user.Id).Update("subject", "13900139000").Error)
				_, err = service.ConsumeOperationProof(proof.ProofToken, identity, op)
				require.Error(t, err)
				return
			}
			_, err := service.VerifySecurityInput(identity, input)
			require.Error(t, err)
		})
	}
}

func TestAccessTokenContactDisabledDoesNotFallback(t *testing.T) {
	user, identity := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.Create(&model.ExternalIdentityClaim{Provider: "phone", Subject: "13800138000", UserId: user.Id}).Error)
	oldPhone := *system_setting.GetPhoneSettings()
	*system_setting.GetPhoneSettings() = system_setting.PhoneSettings{}
	oldWeChat := common.WeChatAuthEnabled
	common.WeChatAuthEnabled = false
	t.Cleanup(func() { *system_setting.GetPhoneSettings() = oldPhone; common.WeChatAuthEnabled = oldWeChat })
	for _, method := range []string{"sms", "wechat"} {
		if method == "wechat" {
			require.NoError(t, model.DB.Model(user).Update("wechat_id", "own-wechat").Error)
		}
		result, err := service.GetVerificationRequirements(identity, "access_token.generate")
		require.NoError(t, err)
		require.Len(t, result.Methods, 1)
		assert.Equal(t, method, result.Methods[0].Method)
		assert.False(t, result.Methods[0].Available)
		_, err = service.VerifySecurityInput(identity, service.VerificationInput{Scope: "access_token.generate", Context: []byte(contactCreateContext), Method: "password", Password: "enrollment-password"})
		require.Error(t, err)
	}
}

func TestAccessTokenOldMFAProofRejectedAfterContactBinding(t *testing.T) {
	user, identity := setupSecurityEnrollmentTest(t)
	secret := "JBSWY3DPEHPK3PXP"
	require.NoError(t, model.DB.Create(&model.TwoFA{UserId: user.Id, Secret: secret, IsEnabled: true}).Error)
	code, err := totp.GenerateCode(secret, time.Now())
	require.NoError(t, err)
	op := service.VerificationOperation{Scope: "access_token.generate", Context: []byte(contactCreateContext)}
	proof, err := service.VerifySecurityInput(identity, service.VerificationInput{Scope: op.Scope, Context: op.Context, Method: "2fa", Code: code})
	require.NoError(t, err)
	require.NoError(t, model.DB.Model(user).Update("wechat_id", "own-wechat").Error)
	_, err = service.ConsumeOperationProof(proof.ProofToken, identity, op)
	require.Error(t, err)
}

func TestAccessTokenContactRejectsPersonalTokenAndChangedWeChat(t *testing.T) {
	user, identity := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.Model(user).Update("wechat_id", "own-wechat").Error)
	oldEnabled, oldAddress, oldToken := common.WeChatAuthEnabled, common.WeChatServerAddress, common.WeChatServerToken
	common.WeChatAuthEnabled, common.WeChatServerAddress, common.WeChatServerToken = true, "http://example.test", "test"
	t.Cleanup(func() {
		common.WeChatAuthEnabled, common.WeChatServerAddress, common.WeChatServerToken = oldEnabled, oldAddress, oldToken
	})
	op := service.VerificationOperation{Scope: "access_token.generate", Context: []byte(contactCreateContext)}
	pat := identity
	pat.SessionID = model.AccessTokenSessionID(1)
	_, err := service.CompleteAccessTokenWeChat(pat, op, "own-wechat")
	require.Error(t, err)
	_, err = service.SendAccessTokenSMS(pat, op, "192.0.2.1")
	require.Error(t, err)
	rule, exists := middleware.AccessTokenRouteRule("POST /api/verify/sms/send")
	require.True(t, exists)
	assert.Equal(t, "session", rule.Kind())
	proof, err := service.CompleteAccessTokenWeChat(identity, op, "own-wechat")
	require.NoError(t, err)
	require.NoError(t, model.DB.Model(user).Update("wechat_id", "changed-wechat").Error)
	_, err = service.ConsumeOperationProof(proof.ProofToken, identity, op)
	require.Error(t, err)
}
