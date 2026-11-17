package service

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func setupPhoneChange(t *testing.T) (*model.User, AuthIdentity) {
	t.Helper()
	user := setupAuthSessionTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.ExternalIdentityClaim{}, &model.TwoFA{}, &model.PasskeyCredential{}))
	identity := AuthIdentity{UserID: user.Id, SessionID: "phone-change-current", UserAuthVersion: 1, SessionVersion: 1}
	require.NoError(t, model.DB.Create(&model.UserSession{SID: identity.SessionID, UserID: user.Id, Version: 1, UserAuthVersion: 1, Status: model.UserSessionStatusActive, RefreshHash: "hash", ExpiresAt: time.Now().Add(time.Hour).Unix()}).Error)
	require.NoError(t, model.DB.Create(&model.ExternalIdentityClaim{Provider: "phone", Subject: "13800138000", UserId: user.Id}).Error)
	return user, identity
}

func TestPhoneChangeVerificationRejectsWrongCodeCrossSessionAndReplay(t *testing.T) {
	_, identity := setupPhoneChange(t)
	for _, scenario := range []string{"wrong code", "expired", "other session", "login token", "binding changed", "success"} {
		t.Run(scenario, func(t *testing.T) {
			payload := phoneChangePayload{Identity: identity, Original: "13800138000", Phone: "13800138000", Step: "old", Digest: phoneTestSMSHash(t, "123456")}
			token, err := newPhoneChangeFlow(phoneChangeSMSPurpose, payload, time.Minute)
			require.NoError(t, err)
			acting := identity
			code := "123456"
			switch scenario {
			case "wrong code":
				for range 5 {
					_, err := VerifyPhoneChangeCode(identity, "old", token, "", "000000")
					require.Error(t, err)
				}
			case "expired":
				require.NoError(t, model.DB.Model(&model.AuthFlow{}).Where("purpose = ?", phoneChangeSMSPurpose).Update("expires_at", time.Now().Add(-time.Second)).Error)
			case "other session":
				acting.SessionID = "different"
			case "login token":
				token, _, err = createPhoneFlow(phoneSMSPurpose, identity.SessionID, phoneFlowPayload{Phone: "13800138000", Digest: payload.Digest}, time.Minute)
				require.NoError(t, err)
			case "binding changed":
				require.NoError(t, model.DB.Model(&model.ExternalIdentityClaim{}).Where("user_id = ?", identity.UserID).Update("subject", "13900139000").Error)
				defer model.DB.Model(&model.ExternalIdentityClaim{}).Where("user_id = ?", identity.UserID).Update("subject", "13800138000")
			case "factor enrolled":
				factor := &model.TwoFA{UserId: identity.UserID, Secret: "unused", IsEnabled: true}
				require.NoError(t, model.DB.Create(factor).Error)
				defer model.DB.Unscoped().Delete(factor)
			}
			proof, err := VerifyPhoneChangeCode(acting, "old", token, "", code)
			if scenario != "success" {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.NotEmpty(t, proof)
			_, err = VerifyPhoneChangeCode(identity, "old", token, "", code)
			require.Error(t, err)
		})
	}
}

func TestPhoneChangeSMSUsesServerBindingAndVerifiedOldPhone(t *testing.T) {
	_, identity := setupPhoneChange(t)
	t.Setenv("ALIYUN_SMS_ACCESS_KEY_ID", "test-key")
	t.Setenv("ALIYUN_SMS_ACCESS_KEY_SECRET", "test-secret")
	oldSettings := *system_setting.GetPhoneSettings()
	*system_setting.GetPhoneSettings() = system_setting.PhoneSettings{Enabled: true, Region: "cn-hangzhou", SignName: "test", TemplateCode: "SMS_TEST"}
	t.Cleanup(func() { *system_setting.GetPhoneSettings() = oldSettings })
	originalClient := http.DefaultClient
	t.Cleanup(func() { http.DefaultClient = originalClient })
	phones := []string{}
	codes := []string{}
	http.DefaultClient = &http.Client{Transport: phoneSMSRoundTripper(func(r *http.Request) (*http.Response, error) {
		require.NoError(t, r.ParseForm())
		phones = append(phones, r.Form.Get("PhoneNumbers"))
		var template map[string]string
		require.NoError(t, common.UnmarshalJsonStr(r.Form.Get("TemplateParam"), &template))
		codes = append(codes, template["code"])
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"Code":"OK"}`)), Header: http.Header{}}, nil
	})}
	_, err := sendPhoneChangeTestCode(t, identity, "new", "13900139000", "", "192.0.2.1")
	require.Error(t, err)
	require.Empty(t, phones)
	token, err := sendPhoneChangeTestCode(t, identity, "old", "13700137000", "", "192.0.2.1")
	require.NoError(t, err)
	require.Equal(t, "13800138000", phones[0])
	_, err = sendPhoneChangeTestCode(t, identity, "old", "", "", "192.0.2.1")
	require.ErrorIs(t, err, ErrPhoneRateLimit)
	require.Len(t, phones, 1)
	verified, err := VerifyPhoneChangeCode(identity, "old", token, "", codes[0])
	require.NoError(t, err)
	token, err = sendPhoneChangeTestCode(t, identity, "new", "13900139000", verified, "192.0.2.1")
	require.NoError(t, err)
	require.Equal(t, "13900139000", phones[1])
	ready, err := VerifyPhoneChangeCode(identity, "new", token, "13900139000", codes[1])
	require.NoError(t, err)
	require.NoError(t, CompletePhoneChange(identity, ready))
	owner, err := model.GetPhoneUserID("13900139000")
	require.NoError(t, err)
	require.Equal(t, identity.UserID, owner)
	owner, err = model.GetPhoneUserID("13800138000")
	require.NoError(t, err)
	require.Zero(t, owner)
}

func TestPhoneChangeDatabaseMatrix(t *testing.T) {
	useTestSessionSecret(t)
	phoneBindingTestProviders(t)
	for _, engine := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(engine, func(t *testing.T) {
			var driver gorm.Dialector
			switch engine {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "phone-change.db"))
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			if engine == "sqlite" {
				sqlDB.SetMaxOpenConns(1)
			}
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			oldDB, oldRedis := model.DB, common.RedisEnabled
			model.DB = db
			common.RedisEnabled = false
			t.Cleanup(func() { model.DB = oldDB; common.RedisEnabled = oldRedis })
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.AuthFlow{}, &model.ExternalIdentityClaim{}, &model.TwoFA{}, &model.PasskeyCredential{}))
			}
			suffix := fmt.Sprintf("%s-%d", engine, time.Now().UnixNano())
			phoneSuffix := time.Now().UnixNano() % 100000000
			originalPhone := fmt.Sprintf("138%08d", phoneSuffix)
			occupiedPhone := fmt.Sprintf("137%08d", phoneSuffix)
			newPhone := fmt.Sprintf("139%08d", phoneSuffix)
			user := model.User{Username: fmt.Sprintf("change-%d", time.Now().UnixNano()%1000000000000), Password: "hash", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1, AffCode: suffix}
			require.NoError(t, db.Create(&user).Error)
			t.Cleanup(func() {
				for _, record := range []interface{}{&model.AuthFlow{}, &model.UserSession{}, &model.ExternalIdentityClaim{}} {
					require.NoError(t, db.Unscoped().Where("user_id = ?", user.Id).Delete(record).Error)
				}
				require.NoError(t, db.Unscoped().Delete(&user).Error)
			})
			identity := AuthIdentity{UserID: user.Id, SessionID: "change-" + suffix, UserAuthVersion: 1, SessionVersion: 1}
			require.NoError(t, db.Create(&model.UserSession{SID: identity.SessionID, UserID: user.Id, Version: 1, UserAuthVersion: 1, Status: model.UserSessionStatusActive, RefreshHash: "hash", ExpiresAt: time.Now().Add(time.Hour).Unix()}).Error)
			// Exercise the real database policy/proof/start/expiry path before binding a phone.
			for _, method := range []string{VerificationMethodPassword, VerificationMethodWeChat} {
				wechat := ""
				if method == VerificationMethodWeChat {
					wechat = "matrix-" + suffix
				}
				require.NoError(t, db.Model(&user).Update("wechat_id", wechat).Error)
				binding, err := BindVerificationOperation(VerificationOperation{Scope: VerificationScopePhoneBinding})
				require.NoError(t, err)
				proof, err := issuePhoneBindingProof(identity, binding, method, wechat)
				require.NoError(t, err)
				authorization, err := ConsumeOperationProof(proof.ProofToken, identity, VerificationOperation{Scope: VerificationScopePhoneBinding})
				require.NoError(t, err)
				started, err := StartPhoneBinding(identity, authorization)
				require.NoError(t, err)
				_, payload, err := readPhoneChangeFlow(identity, started.Token, phoneBindingPurpose)
				require.NoError(t, err)
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return validatePhoneChangeWithTx(tx, payload) }))
				payload.BindingExpiresAt = time.Now().Add(-time.Second).Unix()
				require.ErrorIs(t, db.Transaction(func(tx *gorm.DB) error { return validatePhoneChangeWithTx(tx, payload) }), ErrAuthTokenExpired)
				payload.BindingExpiresAt = started.ExpiresAt
				require.NoError(t, db.Model(&user).Update("wechat_id", "changed-"+suffix).Error)
				require.Error(t, db.Transaction(func(tx *gorm.DB) error { return validatePhoneChangeWithTx(tx, payload) }))
			}
			require.NoError(t, db.Create(&model.ExternalIdentityClaim{Provider: "phone", Subject: originalPhone, UserId: user.Id}).Error)
			// Exercise the actual CAPTCHA attempt/consume transaction and SMS boundary
			// concurrently on each database, not just the final phone claim.
			t.Setenv("ALIYUN_SMS_ACCESS_KEY_ID", "test-key")
			t.Setenv("ALIYUN_SMS_ACCESS_KEY_SECRET", "test-secret")
			oldSettings := *system_setting.GetPhoneSettings()
			*system_setting.GetPhoneSettings() = system_setting.PhoneSettings{Enabled: true, Region: "cn-hangzhou", SignName: "test", TemplateCode: "SMS_TEST"}
			oldClient := http.DefaultClient
			t.Cleanup(func() { *system_setting.GetPhoneSettings() = oldSettings; http.DefaultClient = oldClient })
			var delivered atomic.Int32
			http.DefaultClient = &http.Client{Transport: phoneSMSRoundTripper(func(r *http.Request) (*http.Response, error) {
				delivered.Add(1)
				return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"Code":"OK"}`))}, nil
			})}
			captcha := phoneChangeTestCaptcha(t, identity)
			var captchaWG sync.WaitGroup
			captchaResults := make(chan error, 2)
			for range 2 {
				captchaWG.Go(func() {
					_, err := SendPhoneChangeCode(identity, "old", "", "", "192.0.2.30", captcha, "12345")
					captchaResults <- err
				})
			}
			captchaWG.Wait()
			close(captchaResults)
			captchaSuccesses := 0
			for err := range captchaResults {
				if err == nil {
					captchaSuccesses++
				}
			}
			require.Equal(t, 1, captchaSuccesses)
			require.Equal(t, int32(1), delivered.Load())
			require.NoError(t, db.Where("purpose = ?", "phone_cooldown").Delete(&model.AuthFlow{}).Error)
			_, err = SendPhoneChangeCode(identity, "old", "", "", "192.0.2.30", captcha, "12345")
			require.Error(t, err)
			require.Equal(t, int32(1), delivered.Load())
			occupied := model.ExternalIdentityClaim{Provider: "phone", Subject: occupiedPhone, UserId: user.Id + 10000}
			require.NoError(t, db.Create(&occupied).Error)
			t.Cleanup(func() { require.NoError(t, db.Unscoped().Delete(&occupied).Error) })
			payload := phoneChangePayload{Identity: identity, Original: originalPhone, Phone: occupied.Subject, Step: "new", BindingExpiresAt: time.Now().Add(time.Minute).Unix()}
			conflict, err := newPhoneChangeFlow(phoneChangeReadyPurpose, payload, time.Minute)
			require.NoError(t, err)
			require.ErrorIs(t, CompletePhoneChange(identity, conflict), ErrPhoneOwned)
			owner, err := model.GetPhoneUserID(originalPhone)
			require.NoError(t, err)
			require.Equal(t, user.Id, owner, "a conflict rolls back the original binding")
			payload.Phone = newPhone
			token, err := newPhoneChangeFlow(phoneChangeReadyPurpose, payload, time.Minute)
			require.NoError(t, err)
			var wg sync.WaitGroup
			results := make(chan error, 2)
			for range 2 {
				wg.Go(func() { results <- CompletePhoneChange(identity, token) })
			}
			wg.Wait()
			close(results)
			successes := 0
			for err := range results {
				if err == nil {
					successes++
				}
			}
			require.Equal(t, 1, successes, "one-time flow cannot replace a phone twice")
			owner, err = model.GetPhoneUserID(newPhone)
			require.NoError(t, err)
			require.Equal(t, user.Id, owner)
			owner, err = model.GetPhoneUserID(originalPhone)
			require.NoError(t, err)
			require.Zero(t, owner)
			var current model.User
			require.NoError(t, db.First(&current, user.Id).Error)
			require.Equal(t, int64(2), current.AuthVersion)
			require.Error(t, CompletePhoneChange(identity, token))
		})
	}
}

func TestPhoneBindingVerificationSelectsWeChatOtherwisePasswordDespiteMFA(t *testing.T) {
	for _, wechat := range []string{"", "phone-owner-openid"} {
		t.Run("wechat="+wechat, func(t *testing.T) {
			user, identity := setupPhoneChange(t)
			require.NoError(t, model.DB.Where("user_id = ?", user.Id).Delete(&model.ExternalIdentityClaim{}).Error)
			require.NoError(t, model.DB.Model(user).Update("wechat_id", wechat).Error)
			require.NoError(t, model.DB.Create(&model.TwoFA{UserId: user.Id, Secret: "unused", IsEnabled: true}).Error)
			oldEnabled, oldAddress, oldToken, oldPassword := common.WeChatAuthEnabled, common.WeChatServerAddress, common.WeChatServerToken, common.PasswordLoginEnabled
			common.WeChatAuthEnabled, common.WeChatServerAddress, common.WeChatServerToken, common.PasswordLoginEnabled = true, "https://wechat.test", "test", true
			t.Cleanup(func() {
				common.WeChatAuthEnabled, common.WeChatServerAddress, common.WeChatServerToken, common.PasswordLoginEnabled = oldEnabled, oldAddress, oldToken, oldPassword
			})
			requirements, err := GetVerificationRequirements(identity, "phone.binding")
			require.NoError(t, err)
			want := VerificationMethodPassword
			if wechat != "" {
				want = VerificationMethodWeChat
			}
			require.Equal(t, []VerificationMethodOption{{Method: want, Available: true}}, requirements.Methods)
		})
	}
}

func phoneBindingTestProviders(t *testing.T) {
	t.Helper()
	oldEnabled, oldAddress, oldToken, oldPassword, oldEncryption := common.WeChatAuthEnabled, common.WeChatServerAddress, common.WeChatServerToken, common.PasswordLoginEnabled, common.PasswordLoginEncryptionEnabled
	common.WeChatAuthEnabled, common.WeChatServerAddress, common.WeChatServerToken, common.PasswordLoginEnabled, common.PasswordLoginEncryptionEnabled = true, "https://wechat.test", "test", true, false
	t.Cleanup(func() {
		common.WeChatAuthEnabled, common.WeChatServerAddress, common.WeChatServerToken, common.PasswordLoginEnabled, common.PasswordLoginEncryptionEnabled = oldEnabled, oldAddress, oldToken, oldPassword, oldEncryption
	})
}

func TestPhoneBindingProofOwnershipIsolationExpiryAndContactChanges(t *testing.T) {
	for _, method := range []string{VerificationMethodPassword, VerificationMethodWeChat} {
		t.Run(method, func(t *testing.T) {
			user, identity := setupPhoneChange(t)
			useTestSessionSecret(t)
			phoneBindingTestProviders(t)
			require.NoError(t, model.DB.Where("user_id = ?", user.Id).Delete(&model.ExternalIdentityClaim{}).Error)
			hash, err := common.Password2Hash("initial-password")
			require.NoError(t, err)
			require.NoError(t, model.DB.Model(user).Update("password", hash).Error)
			operation := VerificationOperation{Scope: VerificationScopePhoneBinding}
			var proof *SecurityProof
			if method == VerificationMethodWeChat {
				require.NoError(t, model.DB.Model(user).Update("wechat_id", "own-openid").Error)
				_, err = CompletePhoneBindingWeChat(identity, operation, "other-openid")
				require.Error(t, err)
				_, err = VerifySecurityInput(identity, VerificationInput{Scope: operation.Scope, Method: VerificationMethodPassword, Password: "initial-password"})
				require.ErrorIs(t, err, ErrProofMethod)
				proof, err = CompletePhoneBindingWeChat(identity, operation, "own-openid")
			} else {
				_, err = VerifySecurityInput(identity, VerificationInput{Scope: operation.Scope, Method: method, Password: "wrong-password"})
				require.Error(t, err)
				proof, err = VerifySecurityInput(identity, VerificationInput{Scope: operation.Scope, Method: method, Password: "initial-password"})
			}
			require.NoError(t, err)
			_, err = ConsumeOperationProof(proof.ProofToken, identity, VerificationOperation{Scope: VerificationScopeAccountBind, Context: []byte(`{"provider":"phone"}`)})
			require.Error(t, err)
			other := identity
			other.SessionID = "other-session"
			_, err = ConsumeOperationProof(proof.ProofToken, other, operation)
			require.Error(t, err)
			authorization, err := ConsumeOperationProof(proof.ProofToken, identity, operation)
			require.NoError(t, err)
			_, err = ConsumeOperationProof(proof.ProofToken, identity, operation)
			require.Error(t, err)
			started, err := StartPhoneBinding(identity, authorization)
			require.NoError(t, err)
			_, payload, err := readPhoneChangeFlow(identity, started.Token, phoneBindingPurpose)
			require.NoError(t, err)
			require.NoError(t, model.DB.Transaction(func(tx *gorm.DB) error { return validatePhoneChangeWithTx(tx, payload) }))
			payload.BindingExpiresAt = time.Now().Add(-time.Second).Unix()
			require.ErrorIs(t, model.DB.Transaction(func(tx *gorm.DB) error { return validatePhoneChangeWithTx(tx, payload) }), ErrAuthTokenExpired)
			payload.BindingExpiresAt = started.ExpiresAt
			require.NoError(t, model.DB.Model(user).Update("wechat_id", "new-openid").Error)
			require.Error(t, model.DB.Transaction(func(tx *gorm.DB) error { return validatePhoneChangeWithTx(tx, payload) }))
		})
	}
}

func TestPhoneBindingUnavailableChannelDoesNotDowngrade(t *testing.T) {
	user, identity := setupPhoneChange(t)
	phoneBindingTestProviders(t)
	require.NoError(t, model.DB.Where("user_id = ?", user.Id).Delete(&model.ExternalIdentityClaim{}).Error)
	require.NoError(t, model.DB.Model(user).Update("wechat_id", "own-openid").Error)
	common.WeChatAuthEnabled = false
	requirements, err := GetVerificationRequirements(identity, VerificationScopePhoneBinding)
	require.NoError(t, err)
	require.Equal(t, VerificationMethodWeChat, requirements.Methods[0].Method)
	require.False(t, requirements.Methods[0].Available)
	require.NoError(t, model.DB.Model(user).Updates(map[string]any{"wechat_id": "", "password": ""}).Error)
	requirements, err = GetVerificationRequirements(identity, VerificationScopePhoneBinding)
	require.NoError(t, err)
	require.Equal(t, VerificationMethodPassword, requirements.Methods[0].Method)
	require.False(t, requirements.Methods[0].Available)
}

func TestPhoneChangeRejectsLegacyPurposeAndExpiredOriginalAuthorization(t *testing.T) {
	_, identity := setupPhoneChange(t)
	payload := phoneChangePayload{Identity: identity, Original: "13800138000", Phone: "13900139000", Step: "new", BindingExpiresAt: time.Now().Add(-time.Second).Unix()}
	token, err := newPhoneChangeFlow(phoneChangeReadyPurpose, payload, time.Minute)
	require.NoError(t, err)
	require.ErrorIs(t, CompletePhoneChange(identity, token), ErrAuthTokenExpired)
	token, err = newPhoneChangeFlow("phone_change_ready", payload, time.Minute)
	require.NoError(t, err)
	require.Error(t, CompletePhoneChange(identity, token))
}

func TestPhoneBindingSMSRequiresInitialAuthorizationAndAllowsExplicitResend(t *testing.T) {
	user, identity := setupPhoneChange(t)
	useTestSessionSecret(t)
	phoneBindingTestProviders(t)
	require.NoError(t, model.DB.Where("user_id = ?", user.Id).Delete(&model.ExternalIdentityClaim{}).Error)
	require.NoError(t, model.DB.Model(user).Update("wechat_id", "own-openid").Error)
	t.Setenv("ALIYUN_SMS_ACCESS_KEY_ID", "test-key")
	t.Setenv("ALIYUN_SMS_ACCESS_KEY_SECRET", "test-secret")
	oldSettings := *system_setting.GetPhoneSettings()
	*system_setting.GetPhoneSettings() = system_setting.PhoneSettings{Enabled: true, Region: "cn-hangzhou", SignName: "test", TemplateCode: "SMS_TEST"}
	oldClient := http.DefaultClient
	t.Cleanup(func() { *system_setting.GetPhoneSettings() = oldSettings; http.DefaultClient = oldClient })
	delivered := 0
	code := ""
	http.DefaultClient = &http.Client{Transport: phoneSMSRoundTripper(func(r *http.Request) (*http.Response, error) {
		delivered++
		require.NoError(t, r.ParseForm())
		var template map[string]string
		require.NoError(t, common.UnmarshalJsonStr(r.Form.Get("TemplateParam"), &template))
		code = template["code"]
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"Code":"OK"}`))}, nil
	})}
	_, err := sendPhoneChangeTestCode(t, identity, "new", "13900139000", "", "192.0.2.1")
	require.Error(t, err)
	require.Zero(t, delivered)
	proof, err := CompletePhoneBindingWeChat(identity, VerificationOperation{Scope: VerificationScopePhoneBinding}, "own-openid")
	require.NoError(t, err)
	authorization, err := ConsumeOperationProof(proof.ProofToken, identity, VerificationOperation{Scope: VerificationScopePhoneBinding})
	require.NoError(t, err)
	started, err := StartPhoneBinding(identity, authorization)
	require.NoError(t, err)
	first, err := sendPhoneChangeTestCode(t, identity, "new", "13900139000", started.Token, "192.0.2.1")
	require.NoError(t, err)
	_, err = sendPhoneChangeTestCode(t, identity, "new", "13900139000", started.Token, "192.0.2.1")
	require.ErrorIs(t, err, ErrPhoneRateLimit)
	require.Equal(t, 1, delivered)
	// Clear only the elapsed-cooldown fixture; retain hourly and daily reservations.
	require.NoError(t, model.DB.Where("purpose = ?", "phone_cooldown").Delete(&model.AuthFlow{}).Error)
	second, err := sendPhoneChangeTestCode(t, identity, "new", "13900139000", started.Token, "192.0.2.1")
	require.NoError(t, err)
	require.Equal(t, 2, delivered)
	_, err = VerifyPhoneChangeCode(identity, "new", first, "13900139000", code)
	require.Error(t, err)
	ready, err := VerifyPhoneChangeCode(identity, "new", second, "13900139000", code)
	require.NoError(t, err)
	require.NoError(t, CompletePhoneChange(identity, ready))
	owner, err := model.GetPhoneUserID("13900139000")
	require.NoError(t, err)
	require.Equal(t, identity.UserID, owner)
}

// Use a fresh real image challenge for every existing SMS delivery scenario.
func sendPhoneChangeTestCode(t *testing.T, identity AuthIdentity, step, phone, verifiedToken, ip string) (string, error) {
	t.Helper()
	token := phoneChangeTestCaptcha(t, identity)
	return SendPhoneChangeCode(identity, step, phone, verifiedToken, ip, token, "12345")
}

func phoneChangeTestCaptcha(t *testing.T, identity AuthIdentity) string {
	t.Helper()
	token, image, err := NewPhoneChangeImage(identity)
	require.NoError(t, err)
	require.Contains(t, image, "data:image/png;base64,")
	flow, payload, err := readPhoneChangeFlow(identity, token, phoneChangeImagePurpose)
	require.NoError(t, err)
	payload.Digest = phoneCodeDigest("12345")
	encoded, err := common.Marshal(payload)
	require.NoError(t, err)
	require.NoError(t, model.DB.Model(flow).Update("payload", string(encoded)).Error)
	return token
}

func TestPhoneChangeCaptchaRejectsInvalidChallengesBeforeSMS(t *testing.T) {
	for _, scenario := range []string{"missing", "wrong answer", "expired", "other session", "other user", "auth version", "login purpose", "replayed", "success"} {
		t.Run(scenario, func(t *testing.T) {
			_, identity := setupPhoneChange(t)
			useTestSessionSecret(t)
			t.Setenv("ALIYUN_SMS_ACCESS_KEY_ID", "test-key")
			t.Setenv("ALIYUN_SMS_ACCESS_KEY_SECRET", "test-secret")
			oldSettings := *system_setting.GetPhoneSettings()
			*system_setting.GetPhoneSettings() = system_setting.PhoneSettings{Enabled: true, Region: "cn-hangzhou", SignName: "test", TemplateCode: "SMS_TEST"}
			oldClient := http.DefaultClient
			t.Cleanup(func() { *system_setting.GetPhoneSettings() = oldSettings; http.DefaultClient = oldClient })
			delivered := 0
			http.DefaultClient = &http.Client{Transport: phoneSMSRoundTripper(func(r *http.Request) (*http.Response, error) {
				delivered++
				return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"Code":"OK"}`))}, nil
			})}
			token := phoneChangeTestCaptcha(t, identity)
			answer := "12345"
			switch scenario {
			case "missing":
				token = ""
			case "wrong answer":
				_, err := SendPhoneChangeCode(identity, "old", "", "", "192.0.2.1", token, "00000")
				require.Error(t, err)
			case "expired":
				require.NoError(t, model.DB.Model(&model.AuthFlow{}).Where("purpose = ?", phoneChangeImagePurpose).Update("expires_at", time.Now().Add(-time.Second)).Error)
			case "other session", "other user", "auth version":
				flow, payload, err := readPhoneChangeFlow(identity, token, phoneChangeImagePurpose)
				require.NoError(t, err)
				switch scenario {
				case "other session":
					payload.Identity.SessionID = "another-session"
				case "other user":
					payload.Identity.UserID++
				case "auth version":
					payload.Identity.UserAuthVersion++
				}
				encoded, err := common.Marshal(payload)
				require.NoError(t, err)
				require.NoError(t, model.DB.Model(flow).Update("payload", string(encoded)).Error)
			case "login purpose":
				var err error
				token, _, err = NewPhoneImage(identity.SessionID)
				require.NoError(t, err)
			case "replayed":
				_, err := SendPhoneChangeCode(identity, "old", "", "", "192.0.2.1", token, answer)
				require.NoError(t, err)
				require.NoError(t, model.DB.Where("purpose = ?", "phone_cooldown").Delete(&model.AuthFlow{}).Error)
			}
			_, err := SendPhoneChangeCode(identity, "old", "", "", "192.0.2.1", token, answer)
			if scenario == "success" {
				require.NoError(t, err)
				require.Equal(t, 1, delivered)
			} else {
				require.Error(t, err)
				if scenario == "replayed" {
					require.Equal(t, 1, delivered)
				} else {
					require.Zero(t, delivered)
				}
			}
		})
	}
}
