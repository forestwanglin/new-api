package service

import (
	"errors"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestPhoneCaptchaRequiresCorrectBrowserAndSingleUse(t *testing.T) {
	setupAuthSessionTestDB(t)
	token, _, err := createPhoneFlow(phoneImagePurpose, "browser-a", phoneFlowPayload{Digest: phoneCodeDigest("12345")}, time.Minute)
	require.NoError(t, err)
	_, err = VerifyPhoneImage(token, "12345", "13800138000", "", "browser-b")
	require.Error(t, err)
	_, err = VerifyPhoneImage(token, "54321", "13800138000", "", "browser-a")
	require.Error(t, err)
	_, err = VerifyPhoneImage(token, "12345", "13800138000", "", "browser-a")
	require.Error(t, err)
	token, _, err = createPhoneFlow(phoneImagePurpose, "browser-a", phoneFlowPayload{Digest: phoneCodeDigest("12345")}, time.Minute)
	require.NoError(t, err)
	permit, err := VerifyPhoneImage(token, "12345", "13800138000", "", "browser-a")
	require.NoError(t, err)
	require.NotEmpty(t, permit)
	_, err = VerifyPhoneImage(token, "12345", "13800138000", "", "browser-a")
	require.Error(t, err)
	flow, err := model.GetAuthFlow(permit, model.AuthFlowMatch{Purpose: phoneSendPurpose, SessionId: "browser-a"})
	require.NoError(t, err)
	require.Contains(t, flow.Payload, "13800138000")
	require.NotContains(t, flow.Payload, "12345")
}

func TestPhoneSMSRejectsGuessesReplayAndCrossBrowser(t *testing.T) {
	user := setupAuthSessionTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.ExternalIdentityClaim{}))
	require.NoError(t, model.DB.Create(&model.ExternalIdentityClaim{Provider: "phone", Subject: "13800138000", UserId: user.Id}).Error)
	token, _, err := createPhoneFlow(phoneSMSPurpose, "browser-a", phoneFlowPayload{Phone: "13800138000", Digest: phoneTestSMSHash(t, "123456")}, time.Minute)
	require.NoError(t, err)
	_, err = CompletePhoneLogin(token, "123456", "browser-b")
	require.Error(t, err)
	for range 5 {
		_, err = CompletePhoneLogin(token, "000000", "browser-a")
		require.Error(t, err)
	}
	_, err = CompletePhoneLogin(token, "123456", "browser-a")
	require.Error(t, err)
	token, _, err = createPhoneFlow(phoneSMSPurpose, "browser-a", phoneFlowPayload{Phone: "13800138000", Digest: phoneTestSMSHash(t, "123456")}, time.Minute)
	require.NoError(t, err)
	result, err := CompletePhoneLogin(token, "123456", "browser-a")
	require.NoError(t, err)
	require.Equal(t, user.Id, result.Id)
	_, err = CompletePhoneLogin(token, "123456", "browser-a")
	require.Error(t, err)
	require.Equal(t, common.UserStatusEnabled, result.Status)
}

func phoneTestSMSHash(t *testing.T, code string) string {
	t.Helper()
	hash, err := common.Password2Hash(phoneCodeDigest(code))
	require.NoError(t, err)
	return hash
}

func TestPhoneWeChatBindingRejectsOtherOwnersAndCommitsBothProofs(t *testing.T) {
	user := setupAuthSessionTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.ExternalIdentityClaim{}))
	other := model.User{Username: "phone-other", Password: "unused", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1, AffCode: "phone-other"}
	require.NoError(t, model.DB.Create(&other).Error)
	require.NoError(t, model.DB.Create(&model.ExternalIdentityClaim{Provider: "phone", Subject: "13800138000", UserId: other.Id}).Error)
	bindToken, err := StartWeChatPhoneFlow(user, "browser")
	require.NoError(t, err)
	bind, err := RequireWeChatPhoneFlow(bindToken, "browser")
	require.NoError(t, err)
	sms, _, err := createPhoneFlow(phoneSMSPurpose, "browser", phoneFlowPayload{Phone: "13800138000", BindFlowID: bind.Id, Digest: phoneTestSMSHash(t, "123456")}, time.Minute)
	require.NoError(t, err)
	_, err = CompletePhoneLogin(sms, "123456", "browser")
	require.ErrorIs(t, err, ErrPhoneOwned)
	_, err = RequireWeChatPhoneFlow(bindToken, "browser")
	require.NoError(t, err)
	sms, _, err = createPhoneFlow(phoneSMSPurpose, "browser", phoneFlowPayload{Phone: "13900139000", BindFlowID: bind.Id, Digest: phoneTestSMSHash(t, "123456")}, time.Minute)
	require.NoError(t, err)
	bound, err := CompletePhoneLogin(sms, "123456", "browser")
	require.NoError(t, err)
	require.Equal(t, user.Id, bound.Id)
	owner, err := model.GetPhoneUserID("13900139000")
	require.NoError(t, err)
	require.Equal(t, user.Id, owner)
	_, err = RequireWeChatPhoneFlow(bindToken, "browser")
	require.Error(t, err)
	_, err = CompletePhoneLogin(sms, "123456", "browser")
	require.Error(t, err)
	var sessions int64
	require.NoError(t, model.DB.Model(&model.UserSession{}).Count(&sessions).Error)
	require.Zero(t, sessions, "binding alone must not bypass shared login policy")
}

func TestPhoneWeChatBindingRejectsRevokedPrimaryIdentity(t *testing.T) {
	user := setupAuthSessionTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.ExternalIdentityClaim{}))
	bindToken, err := StartWeChatPhoneFlow(user, "browser")
	require.NoError(t, err)
	bind, err := RequireWeChatPhoneFlow(bindToken, "browser")
	require.NoError(t, err)
	sms, _, err := createPhoneFlow(phoneSMSPurpose, "browser", phoneFlowPayload{Phone: "13800138000", BindFlowID: bind.Id, Digest: phoneTestSMSHash(t, "123456")}, time.Minute)
	require.NoError(t, err)
	require.NoError(t, model.DB.Model(user).Update("auth_version", user.AuthVersion+1).Error)
	_, err = CompletePhoneLogin(sms, "123456", "browser")
	require.Error(t, err)
	owner, err := model.GetPhoneUserID("13800138000")
	require.NoError(t, err)
	require.Zero(t, owner)
}

func TestPhoneSMSCooldownAndDailyLimitAreDurable(t *testing.T) {
	setupAuthSessionTestDB(t)
	require.NoError(t, model.DB.Transaction(func(tx *gorm.DB) error { return reservePhoneSend(tx, "13800138000", "192.0.2.1") }))
	require.ErrorIs(t, model.DB.Transaction(func(tx *gorm.DB) error { return reservePhoneSend(tx, "13800138000", "192.0.2.2") }), ErrPhoneRateLimit)
	// A fresh IP cannot bypass the phone cooldown, and a different phone may send.
	require.NoError(t, model.DB.Transaction(func(tx *gorm.DB) error { return reservePhoneSend(tx, "13900139000", "192.0.2.2") }))
}

type phoneSMSRoundTripper func(*http.Request) (*http.Response, error)

func (send phoneSMSRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return send(r) }

func TestPhoneAliyunSignsRPCAndHandlesDeliveryFailureWithoutRetry(t *testing.T) {
	params := url.Values{"AccessKeyId": {"testid"}, "Action": {"SendSms"}, "PhoneNumbers": {"13800138000"}, "SignName": {"测试 签名"}, "TemplateParam": {`{"code":"123456"}`}}
	require.Equal(t, "wVA/vnhlwqjqPOfJbsufNHfR9vs=", aliyunSMSRequestSignature(params, "testsecret"))
	t.Setenv("ALIYUN_SMS_ACCESS_KEY_ID", "testid")
	t.Setenv("ALIYUN_SMS_ACCESS_KEY_SECRET", "testsecret")
	settings := system_setting.GetPhoneSettings()
	old := *settings
	*settings = system_setting.PhoneSettings{Enabled: true, Region: "cn-hangzhou", SignName: "测试 签名", TemplateCode: "SMS_TEST"}
	t.Cleanup(func() { *settings = old })
	original := http.DefaultClient
	t.Cleanup(func() { http.DefaultClient = original })
	calls := 0
	http.DefaultClient = &http.Client{Transport: phoneSMSRoundTripper(func(r *http.Request) (*http.Response, error) {
		calls++
		require.Equal(t, "https://dysmsapi.aliyuncs.com/", r.URL.String())
		require.Equal(t, http.MethodPost, r.Method)
		require.NoError(t, r.ParseForm())
		require.Equal(t, "13800138000", r.Form.Get("PhoneNumbers"))
		require.Equal(t, `{"code":"123456"}`, r.Form.Get("TemplateParam"))
		require.Equal(t, "SendSms", r.Form.Get("Action"))
		require.NotEmpty(t, r.Form.Get("Signature"))
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"Code":"OK"}`)), Header: http.Header{}}, nil
	})}
	require.NoError(t, SendAliyunSMS("13800138000", "123456"))
	require.Equal(t, 1, calls)
	calls = 0
	http.DefaultClient = &http.Client{Transport: phoneSMSRoundTripper(func(r *http.Request) (*http.Response, error) {
		calls++
		return nil, errors.New("ambiguous timeout with provider detail")
	})}
	err := SendAliyunSMS("13800138000", "123456")
	require.Error(t, err)
	require.Equal(t, 1, calls)
	require.NotContains(t, err.Error(), "provider detail")
}

func TestPhoneExpiredFlowsAndSendPermitBypass(t *testing.T) {
	user := setupAuthSessionTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.ExternalIdentityClaim{}))
	for _, purpose := range []string{phoneImagePurpose, phoneSendPurpose, phoneSMSPurpose} {
		token, _, err := createPhoneFlow(purpose, "browser", phoneFlowPayload{Phone: "13800138000", Digest: phoneTestSMSHash(t, "123456")}, time.Minute)
		require.NoError(t, err)
		require.NoError(t, model.DB.Model(&model.AuthFlow{}).Where("purpose = ?", purpose).Update("expires_at", time.Now().Add(-time.Second)).Error)
		switch purpose {
		case phoneImagePurpose:
			_, err = VerifyPhoneImage(token, "12345", "13800138000", "", "browser")
		case phoneSendPurpose:
			_, err = SendPhoneSMS(token, "browser", "192.0.2.1")
		case phoneSMSPurpose:
			_, err = CompletePhoneLogin(token, "123456", "browser")
		}
		require.Error(t, err, purpose)
	}
	bind, err := StartWeChatPhoneFlow(user, "browser")
	require.NoError(t, err)
	require.NoError(t, model.DB.Model(&model.AuthFlow{}).Where("purpose = ?", WeChatPhonePurpose).Update("expires_at", time.Now().Add(-time.Second)).Error)
	_, err = RequireWeChatPhoneFlow(bind, "browser")
	require.Error(t, err)
	image, _, err := createPhoneFlow(phoneImagePurpose, "browser", phoneFlowPayload{Digest: phoneCodeDigest("12345")}, time.Minute)
	require.NoError(t, err)
	_, err = SendPhoneSMS(image, "browser", "192.0.2.1")
	require.Error(t, err, "image token cannot substitute for a verified send permit")
	permit, _, err := createPhoneFlow(phoneSendPurpose, "browser", phoneFlowPayload{Phone: "13800138000"}, time.Minute)
	require.NoError(t, err)
	_, err = SendPhoneSMS(permit, "other-browser", "192.0.2.1")
	require.Error(t, err)
}

func TestPhoneSMSResendInvalidatesOldCodeAndFailedSendConsumesPermit(t *testing.T) {
	setupAuthSessionTestDB(t)
	t.Setenv("ALIYUN_SMS_ACCESS_KEY_ID", "testid")
	t.Setenv("ALIYUN_SMS_ACCESS_KEY_SECRET", "testsecret")
	settings := system_setting.GetPhoneSettings()
	oldSettings := *settings
	*settings = system_setting.PhoneSettings{Enabled: true, Region: "cn-hangzhou", SignName: "test", TemplateCode: "SMS_TEST"}
	t.Cleanup(func() { *settings = oldSettings })
	original := http.DefaultClient
	t.Cleanup(func() { http.DefaultClient = original })
	calls := 0
	http.DefaultClient = &http.Client{Transport: phoneSMSRoundTripper(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"Code":"OK"}`)), Header: http.Header{}}, nil
	})}
	oldSMS, _, err := createPhoneFlow(phoneSMSPurpose, "browser", phoneFlowPayload{Phone: "13800138000", Digest: phoneTestSMSHash(t, "123456")}, time.Minute)
	require.NoError(t, err)
	permit, _, err := createPhoneFlow(phoneSendPurpose, "browser", phoneFlowPayload{Phone: "13800138000"}, time.Minute)
	require.NoError(t, err)
	fresh, err := SendPhoneSMS(permit, "browser", "192.0.2.1")
	require.NoError(t, err)
	require.NotEmpty(t, fresh)
	_, err = CompletePhoneLogin(oldSMS, "123456", "browser")
	require.Error(t, err)
	_, err = SendPhoneSMS(permit, "browser", "192.0.2.1")
	require.Error(t, err)
	require.Equal(t, 1, calls)
	http.DefaultClient = &http.Client{Transport: phoneSMSRoundTripper(func(r *http.Request) (*http.Response, error) { calls++; return nil, errors.New("timeout") })}
	failed, _, err := createPhoneFlow(phoneSendPurpose, "browser", phoneFlowPayload{Phone: "13900139000"}, time.Minute)
	require.NoError(t, err)
	_, err = SendPhoneSMS(failed, "browser", "192.0.2.1")
	require.Error(t, err)
	_, err = SendPhoneSMS(failed, "browser", "192.0.2.1")
	require.Error(t, err)
	require.Equal(t, 2, calls, "failed provider request must never be retried with the same permit")
}

func TestPhoneNewRegistrationRespectsRegistrationSwitch(t *testing.T) {
	setupAuthSessionTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.ExternalIdentityClaim{}))
	previous := common.RegisterEnabled
	common.RegisterEnabled = false
	t.Cleanup(func() { common.RegisterEnabled = previous })
	token, _, err := createPhoneFlow(phoneSMSPurpose, "browser", phoneFlowPayload{Phone: "13800138000", Digest: phoneTestSMSHash(t, "123456")}, time.Minute)
	require.NoError(t, err)
	_, err = CompletePhoneLogin(token, "123456", "browser")
	require.Error(t, err)
	owner, err := model.GetPhoneUserID("13800138000")
	require.NoError(t, err)
	require.Zero(t, owner)
}
