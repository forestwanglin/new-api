package service

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func configureSMSRecoveryTest(t *testing.T, transport phoneSMSRoundTripper) {
	t.Helper()
	t.Setenv("ALIYUN_SMS_ACCESS_KEY_ID", "testid")
	t.Setenv("ALIYUN_SMS_ACCESS_KEY_SECRET", "testsecret")
	settings := system_setting.GetPhoneSettings()
	oldSettings, oldClient := *settings, http.DefaultClient
	*settings = system_setting.PhoneSettings{Enabled: true, Region: "cn-hangzhou", SignName: "test", TemplateCode: "SMS_TEST"}
	http.DefaultClient = &http.Client{Transport: transport}
	t.Cleanup(func() { *settings, http.DefaultClient = oldSettings, oldClient })
}

func TestPhoneSMSUnknownResultReturnsPersistedVerifiableToken(t *testing.T) {
	user := setupAuthSessionTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.ExternalIdentityClaim{}))
	require.NoError(t, model.DB.Create(&model.ExternalIdentityClaim{Provider: "phone", Subject: "13800138000", UserId: user.Id}).Error)
	var code string
	calls := 0
	configureSMSRecoveryTest(t, func(r *http.Request) (*http.Response, error) {
		calls++
		require.NoError(t, r.ParseForm())
		var params struct {
			Code string `json:"code"`
		}
		require.NoError(t, common.UnmarshalJsonStr(r.Form.Get("TemplateParam"), &params))
		code = params.Code
		var flow model.AuthFlow
		require.NoError(t, model.DB.Where("purpose = ? AND provider = ? AND consumed_at IS NULL", phoneSMSPurpose, "13800138000").First(&flow).Error)
		var payload phoneFlowPayload
		require.NoError(t, common.UnmarshalJsonStr(flow.Payload, &payload))
		assert.True(t, common.ValidatePasswordAndHash(phoneCodeDigest(code), payload.Digest))
		return nil, errors.New("ambiguous provider timeout")
	})
	permit, _, err := createPhoneFlow(phoneSendPurpose, "browser", phoneFlowPayload{Phone: "13800138000"}, time.Minute)
	require.NoError(t, err)
	token, err := SendPhoneSMS(permit, "browser", "192.0.2.1")
	require.NoError(t, err)
	require.NotEmpty(t, token)
	result, err := CompletePhoneLogin(token, code, "browser")
	require.NoError(t, err)
	assert.Equal(t, user.Id, result.Id)
	_, err = CompletePhoneLogin(token, code, "browser")
	require.Error(t, err)
	_, err = SendPhoneSMS(permit, "browser", "192.0.2.1")
	require.Error(t, err)
	assert.Equal(t, 1, calls)
}

func TestPhoneSMSPreparationFailureNeverCallsProvider(t *testing.T) {
	setupAuthSessionTestDB(t)
	calls := 0
	configureSMSRecoveryTest(t, func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"Code":"OK"}`)), Header: http.Header{}}, nil
	})
	permit, _, err := createPhoneFlow(phoneSendPurpose, "browser", phoneFlowPayload{Phone: "13800138000"}, time.Minute)
	require.NoError(t, err)
	failure := errors.New("test verification persistence failed")
	require.NoError(t, model.DB.Callback().Create().Before("gorm:create").Register("test:sms-flow-failure", func(tx *gorm.DB) {
		if flow, ok := tx.Statement.Dest.(*model.AuthFlow); ok && flow.Purpose == phoneSMSPurpose {
			tx.AddError(failure)
		}
	}))
	t.Cleanup(func() { require.NoError(t, model.DB.Callback().Create().Remove("test:sms-flow-failure")) })
	_, err = SendPhoneSMS(permit, "browser", "192.0.2.1")
	require.ErrorIs(t, err, failure)
	assert.Zero(t, calls)
	_, err = model.GetAuthFlow(permit, model.AuthFlowMatch{Purpose: phoneSendPurpose, SessionId: "browser"})
	require.NoError(t, err, "preparation rollback retains the original permit")
}

func TestPhoneSMSRejectionIssuesBoundedBrowserBoundRetry(t *testing.T) {
	setupAuthSessionTestDB(t)
	calls := 0
	configureSMSRecoveryTest(t, func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"Code":"isv.AMOUNT_NOT_ENOUGH","Message":"provider private detail"}`)), Header: http.Header{}}, nil
	})
	permit, initial, err := createPhoneFlow(phoneSendPurpose, "browser", phoneFlowPayload{Phone: "13800138000"}, 2*time.Minute)
	require.NoError(t, err)
	for attempt := range 3 {
		_, err = SendPhoneSMS(permit, "browser", "192.0.2.1")
		var delivery *SMSDeliveryError
		require.ErrorAs(t, err, &delivery)
		assert.NotContains(t, err.Error(), "provider private detail")
		assert.Equal(t, attempt+1, calls)
		var verifications []model.AuthFlow
		require.NoError(t, model.DB.Where("purpose = ?", phoneSMSPurpose).Find(&verifications).Error)
		for _, flow := range verifications {
			assert.NotNil(t, flow.ConsumedAt)
		}
		if attempt == 2 {
			assert.Empty(t, delivery.RetryToken)
			break
		}
		require.NotEmpty(t, delivery.RetryToken)
		retry, err := model.GetAuthFlow(delivery.RetryToken, model.AuthFlowMatch{Purpose: phoneSendPurpose, SessionId: "browser"})
		require.NoError(t, err)
		assert.WithinDuration(t, initial.ExpiresAt, retry.ExpiresAt, time.Millisecond)
		_, err = SendPhoneSMS(delivery.RetryToken, "other-browser", "192.0.2.1")
		require.Error(t, err)
		_, err = SendPhoneSMS(delivery.RetryToken, "browser", "192.0.2.1")
		require.ErrorIs(t, err, ErrPhoneRateLimit)
		assert.Equal(t, attempt+1, calls, "recovery retains cooldown")
		require.NoError(t, model.DB.Where("purpose = ?", "phone_cooldown").Delete(&model.AuthFlow{}).Error)
		permit = delivery.RetryToken
	}
}

func TestPhoneSMSRejectedRetryCannotExtendExpiredAuthorization(t *testing.T) {
	setupAuthSessionTestDB(t)
	configureSMSRecoveryTest(t, func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"Code":"isv.INVALID_PARAMETERS"}`)), Header: http.Header{}}, nil
	})
	permit, _, err := createPhoneFlow(phoneSendPurpose, "browser", phoneFlowPayload{Phone: "13800138000"}, time.Minute)
	require.NoError(t, err)
	_, err = SendPhoneSMS(permit, "browser", "192.0.2.1")
	var delivery *SMSDeliveryError
	require.ErrorAs(t, err, &delivery)
	require.NotEmpty(t, delivery.RetryToken)
	retry, err := model.GetAuthFlow(delivery.RetryToken, model.AuthFlowMatch{Purpose: phoneSendPurpose, SessionId: "browser"})
	require.NoError(t, err)
	require.NoError(t, model.DB.Model(retry).Update("expires_at", time.Now().Add(-time.Second)).Error)
	_, err = SendPhoneSMS(delivery.RetryToken, "browser", "192.0.2.1")
	require.Error(t, err)
}

func TestPhoneChangeAndAccessTokenUnknownSMSRemainVerifiable(t *testing.T) {
	for _, purpose := range []string{phoneChangeSMSPurpose, accessTokenSMSPurpose} {
		t.Run(purpose, func(t *testing.T) {
			_, identity := setupPhoneChange(t)
			var code string
			configureSMSRecoveryTest(t, func(r *http.Request) (*http.Response, error) {
				require.NoError(t, r.ParseForm())
				var template map[string]string
				require.NoError(t, common.UnmarshalJsonStr(r.Form.Get("TemplateParam"), &template))
				code = template["code"]
				var flow model.AuthFlow
				require.NoError(t, model.DB.Where("purpose = ? AND consumed_at IS NULL", purpose).First(&flow).Error)
				return nil, errors.New("ambiguous timeout")
			})
			operation := VerificationOperation{Scope: VerificationScopeAccessTokenGenerate, Context: []byte(`{"scopes":["profile:read"],"expires_at":0}`)}
			var token string
			var err error
			if purpose == phoneChangeSMSPurpose {
				token, err = sendPhoneChangeTestCode(t, identity, "old", "", "", "192.0.2.1")
			} else {
				token, err = SendAccessTokenSMS(identity, operation, "192.0.2.1")
			}
			require.NoError(t, err)
			require.NotEmpty(t, token)
			if purpose == phoneChangeSMSPurpose {
				_, err = VerifyPhoneChangeCode(identity, "old", token, "", code)
			} else {
				_, err = verifyAccessTokenSMS(identity, operation, token, code)
			}
			require.NoError(t, err)
		})
	}
}

func TestPhoneChangeRejectedRetryBindsTargetAndPrimaryAuthorization(t *testing.T) {
	_, identity := setupPhoneChange(t)
	calls := 0
	configureSMSRecoveryTest(t, func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"Code":"isv.INVALID_PARAMETERS"}`)), Header: http.Header{}}, nil
	})
	primary, err := newPhoneChangeFlow(phoneChangeOldPurpose, phoneChangePayload{Identity: identity, Original: "13800138000", Phone: "13800138000", Step: "old", BindingExpiresAt: time.Now().Add(time.Minute).Unix()}, time.Minute)
	require.NoError(t, err)
	captcha := phoneChangeTestCaptcha(t, identity)
	_, err = SendPhoneChangeCode(identity, "new", "13900139000", primary, "192.0.2.1", captcha, "12345")
	var delivery *SMSDeliveryError
	require.ErrorAs(t, err, &delivery)
	require.NotEmpty(t, delivery.RetryToken)
	_, err = model.GetAuthFlow(captcha, model.AuthFlowMatch{Purpose: phoneChangeImagePurpose, UserId: identity.UserID, SessionId: identity.SessionID})
	require.Error(t, err, "the original CAPTCHA stays consumed")
	for _, target := range []string{"13700137000", "13900139000"} {
		acting := identity
		if target == "13900139000" {
			acting.SessionID = "other-session"
		}
		_, err = SendPhoneChangeCodeWithRetry(acting, "new", target, primary, "192.0.2.1", "", "", delivery.RetryToken)
		require.Error(t, err)
	}
	_, err = SendPhoneChangeCodeWithRetry(identity, "old", "", "", "192.0.2.1", "", "", delivery.RetryToken)
	require.Error(t, err)
	_, err = SendPhoneChangeCodeWithRetry(identity, "new", "13900139000", "", "192.0.2.1", "", "", delivery.RetryToken)
	require.Error(t, err)
	require.NoError(t, model.DB.Where("purpose = ?", "phone_cooldown").Delete(&model.AuthFlow{}).Error)
	flow, err := model.GetAuthFlow(primary, model.AuthFlowMatch{Purpose: phoneChangeOldPurpose, UserId: identity.UserID, SessionId: identity.SessionID})
	require.NoError(t, err)
	require.NoError(t, model.DB.Model(flow).Update("consumed_at", time.Now()).Error)
	_, err = SendPhoneChangeCodeWithRetry(identity, "new", "13900139000", primary, "192.0.2.1", "", "", delivery.RetryToken)
	require.Error(t, err)
	assert.Equal(t, 1, calls)
}

func TestPhoneSMSPendingAndFinalizationFailureNeverReturnVerification(t *testing.T) {
	setupAuthSessionTestDB(t)
	calls := 0
	failure := errors.New("test finalization failure")
	configureSMSRecoveryTest(t, func(r *http.Request) (*http.Response, error) {
		calls++
		var flow model.AuthFlow
		require.NoError(t, model.DB.Where("purpose = ? AND consumed_at IS NULL", phoneSMSPurpose).First(&flow).Error)
		assert.False(t, smsFlowVerifiable(&flow))
		require.NoError(t, model.DB.Callback().Update().Before("gorm:update").Register("test:sms-finalize-failure", func(tx *gorm.DB) { tx.AddError(failure) }))
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"Code":"OK"}`)), Header: http.Header{}}, nil
	})
	t.Cleanup(func() { require.NoError(t, model.DB.Callback().Update().Remove("test:sms-finalize-failure")) })
	permit, _, err := createPhoneFlow(phoneSendPurpose, "browser", phoneFlowPayload{Phone: "13800138000"}, time.Minute)
	require.NoError(t, err)
	token, err := SendPhoneSMS(permit, "browser", "192.0.2.1")
	require.ErrorIs(t, err, failure)
	assert.Empty(t, token)
	_, err = SendPhoneSMS(permit, "browser", "192.0.2.1")
	require.Error(t, err)
	assert.Equal(t, 1, calls)
}

func TestAliyunSMSOutcomeClassification(t *testing.T) {
	for _, tc := range []struct {
		name     string
		status   int
		body     string
		rejected bool
		accepted bool
	}{
		{"accepted", 200, `{"Code":"OK"}`, false, true},
		{"known rejection", 200, `{"Code":"isv.BUSINESS_LIMIT_CONTROL"}`, true, false},
		{"unknown client error", 400, `{"Code":"UNKNOWN"}`, false, false},
		{"server error", 503, `{"Code":"isv.INVALID_PARAMETERS"}`, false, false},
		{"malformed", 200, `broken`, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			configureSMSRecoveryTest(t, func(r *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body)), Header: http.Header{}}, nil
			})
			err := SendAliyunSMS("13800138000", "123456")
			if tc.accepted {
				require.NoError(t, err)
				return
			}
			var outcome *smsProviderError
			require.ErrorAs(t, err, &outcome)
			assert.Equal(t, tc.rejected, outcome.rejected)
			assert.NotContains(t, err.Error(), "123456")
			assert.NotContains(t, err.Error(), "13800138000")
		})
	}
}
