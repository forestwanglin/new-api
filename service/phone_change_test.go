package service

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
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
	for _, scenario := range []string{"wrong code", "expired", "other session", "login token", "binding changed", "factor enrolled", "success"} {
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
	_, err := SendPhoneChangeCode(identity, "new", "13900139000", "", "192.0.2.1", false)
	require.Error(t, err)
	require.Empty(t, phones)
	token, err := SendPhoneChangeCode(identity, "old", "13700137000", "", "192.0.2.1", false)
	require.NoError(t, err)
	require.Equal(t, "13800138000", phones[0])
	_, err = SendPhoneChangeCode(identity, "old", "", "", "192.0.2.1", false)
	require.ErrorIs(t, err, ErrPhoneRateLimit)
	require.Len(t, phones, 1)
	verified, err := VerifyPhoneChangeCode(identity, "old", token, "", codes[0])
	require.NoError(t, err)
	token, err = SendPhoneChangeCode(identity, "new", "13900139000", verified, "192.0.2.1", false)
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
			require.NoError(t, db.Create(&model.ExternalIdentityClaim{Provider: "phone", Subject: originalPhone, UserId: user.Id}).Error)
			occupied := model.ExternalIdentityClaim{Provider: "phone", Subject: occupiedPhone, UserId: user.Id + 10000}
			require.NoError(t, db.Create(&occupied).Error)
			t.Cleanup(func() { require.NoError(t, db.Unscoped().Delete(&occupied).Error) })
			payload := phoneChangePayload{Identity: identity, Original: originalPhone, Phone: occupied.Subject, Step: "new"}
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
