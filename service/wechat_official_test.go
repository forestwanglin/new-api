package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
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

type officialTransport func(*http.Request) (*http.Response, error)

func (f officialTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func officialProviderMock(t *testing.T, profile string) {
	t.Helper()
	previous := weChatOfficialHTTPClient
	t.Cleanup(func() { weChatOfficialHTTPClient = previous })
	weChatOfficialHTTPClient = &http.Client{Transport: officialTransport(func(r *http.Request) (*http.Response, error) {
		require.Equal(t, "https", r.URL.Scheme)
		require.Equal(t, "api.weixin.qq.com", r.URL.Host)
		body := profile
		if r.URL.Path == "/sns/oauth2/access_token" {
			require.Equal(t, "wx0123456789abcdef", r.URL.Query().Get("appid"))
			require.Equal(t, "provider-secret", r.URL.Query().Get("secret"))
			require.Equal(t, "authorization_code", r.URL.Query().Get("grant_type"))
			body = `{"access_token":"provider-token","openid":"official-owner","scope":"snsapi_userinfo"}`
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}
}
func configureOfficialTest(t *testing.T) {
	t.Helper()
	previousTrusted := common.SessionCookieTrustedURLs
	common.SessionCookieTrustedURLs = []string{"https://site.example"}
	t.Cleanup(func() { common.SessionCookieTrustedURLs = previousTrusted })
	previousSecure := common.SessionCookieSecure
	common.SessionCookieSecure = true
	t.Cleanup(func() { common.SessionCookieSecure = previousSecure })
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	t.Cleanup(func() { common.OptionMap = previousOptions })
	require.NoError(t, model.DB.AutoMigrate(&model.Option{}, &model.AuthFlow{}, &model.ExternalIdentityClaim{}, &model.UserSession{}))
	for key, value := range map[string]string{"ServerAddress": "https://site.example", "wechat_official.app_id": "wx0123456789abcdef", "wechat_official.app_secret": "provider-secret", "wechat_official.pinned_app_id": "wx0123456789abcdef", "wechat_official.enabled": "true", "wechat_official.revision": "revision-one", "wechat_official.display_name": "示例服务号", "wechat_official.logo_url": "https://image.example/official.png"} {
		require.NoError(t, model.DB.Create(&model.Option{Key: key, Value: value}).Error)
	}
}
func officialAuthorizedTestFlow(t *testing.T, intent string, identity AuthIdentity) (*WeChatOfficialFlow, string) {
	t.Helper()
	flow, err := NewWeChatOfficialFlow("browser", identity, WeChatOfficialFlowRequest{Intent: intent, SameDevice: true})
	require.NoError(t, err)
	u, err := url.Parse(flow.QRURL)
	require.NoError(t, err)
	require.NotContains(t, flow.QRURL, flow.FlowToken)
	state, redirect, err := StartWeChatOfficial(u.Query().Get("ref"))
	require.NoError(t, err)
	require.Regexp(t, regexp.MustCompile(`^[a-zA-Z0-9]{64}$`), state)
	require.Contains(t, redirect, "scope=snsapi_userinfo")
	_, _, err = StartWeChatOfficial(u.Query().Get("ref"))
	require.Error(t, err)
	consent, err := CallbackWeChatOfficial(context.Background(), state, "provider-code")
	require.NoError(t, err)
	_, err = CallbackWeChatOfficial(context.Background(), state, "provider-code")
	require.Error(t, err)
	c, err := GetWeChatOfficialConfirmation(consent)
	require.NoError(t, err)
	require.Equal(t, intent, c.Intent)
	require.Equal(t, "site.example", c.SiteName)
	require.Equal(t, "示例服务号", c.OfficialAccountName)
	require.Equal(t, "https://image.example/official.png", c.OfficialAccountLogo)
	_, _, _, err = CompleteWeChatOfficial(flow.FlowToken, "browser", identity)
	require.Error(t, err, "GET callback must not authorize")
	require.NoError(t, ConfirmWeChatOfficial(consent, true))
	require.Error(t, ConfirmWeChatOfficial(consent, true))
	return flow, consent
}
func TestWeChatOfficialCapabilitiesAndConfiguration(t *testing.T) {
	setupAuthSessionTestDB(t)
	configureOfficialTest(t)
	officialProviderMock(t, `{"openid":"official-owner","nickname":"微信","headimgurl":"https://image.example/avatar"}`)
	flow, _ := officialAuthorizedTestFlow(t, "login", AuthIdentity{})
	_, err := WeChatOfficialStatus(flow.FlowToken, "another-browser", AuthIdentity{})
	require.Error(t, err)
	_, err = ResumeWeChatOfficial(flow.FlowToken, "browser", AuthIdentity{})
	require.NoError(t, err)
	p, _, _, err := CompleteWeChatOfficial(flow.FlowToken, "browser", AuthIdentity{})
	require.NoError(t, err)
	require.Equal(t, "official-owner", p.Subject.OpenID)
	_, _, _, err = CompleteWeChatOfficial(flow.FlowToken, "browser", AuthIdentity{})
	require.Error(t, err)
	cfg, err := model.RequireWeChatOfficialConfig(model.DB, "")
	require.NoError(t, err)
	require.NoError(t, model.UpdateWeChatOfficialOption("wechat_official.app_secret", ""))
	current, err := model.RequireWeChatOfficialConfig(model.DB, cfg.Fingerprint)
	require.NoError(t, err)
	require.Equal(t, "provider-secret", current.AppSecret)
	require.ErrorIs(t, model.UpdateWeChatOfficialOption("wechat_official.app_id", "wx1111111111111111"), model.ErrWeChatOfficialAppIDPinned)
	fresh, err := NewWeChatOfficialFlow("browser", AuthIdentity{}, WeChatOfficialFlowRequest{Intent: "login"})
	require.NoError(t, err)
	require.NoError(t, model.UpdateWeChatOfficialOption("wechat_official.enabled", "false"))
	_, err = WeChatOfficialStatus(fresh.FlowToken, "browser", AuthIdentity{})
	require.Error(t, err)
	require.NoError(t, model.UpdateWeChatOfficialOption("wechat_official.enabled", "true"))
	_, err = model.RequireWeChatOfficialConfig(model.DB, cfg.Fingerprint)
	require.Error(t, err, "re-enable must not revive old revision")
	for _, target := range []string{"//evil.example", "https://evil.example", "/\\evil.example", "/path\n", "/%2fevil.example", "/%5cevil.example", "/path%0a", "/path%00"} {
		_, err := NewWeChatOfficialFlow("browser", AuthIdentity{}, WeChatOfficialFlowRequest{Intent: "login", ReturnTarget: target})
		require.Error(t, err)
	}
}
func TestWeChatOfficialBrandingConfiguration(t *testing.T) {
	setupAuthSessionTestDB(t)
	configureOfficialTest(t)
	cfg, err := model.RequireWeChatOfficialConfig(model.DB, "")
	require.NoError(t, err)
	require.Equal(t, "示例服务号", cfg.DisplayName)
	require.Equal(t, "https://image.example/official.png", cfg.LogoURL)
	for _, option := range []struct{ name, key, value string }{
		{"name_exceeds_unicode_limit", "wechat_official.display_name", strings.Repeat("服", 129)},
		{"name_contains_control", "wechat_official.display_name", "服务\n号"},
		{"logo_uses_http", "wechat_official.logo_url", "http://image.example/logo.png"},
		{"logo_is_relative", "wechat_official.logo_url", "/logo.png"},
		{"logo_contains_userinfo", "wechat_official.logo_url", "https://name:secret@image.example/logo.png"},
		{"logo_exceeds_url_limit", "wechat_official.logo_url", "https://image.example/" + strings.Repeat("a", 2048)},
		{"logo_contains_control", "wechat_official.logo_url", "https://image.example/logo.png\x00"},
	} {
		t.Run(option.name, func(t *testing.T) {
			require.ErrorIs(t, model.UpdateWeChatOfficialOption(option.key, option.value), model.ErrWeChatOfficialBranding)
			unchanged, err := model.RequireWeChatOfficialConfig(model.DB, cfg.Fingerprint)
			require.NoError(t, err, "rejected branding edits must not invalidate active ceremonies")
			require.Equal(t, cfg.DisplayName, unchanged.DisplayName)
			require.Equal(t, cfg.LogoURL, unchanged.LogoURL)
		})
	}
	require.NoError(t, model.UpdateWeChatOfficialOption("wechat_official.display_name", "  "+strings.Repeat("服", 128)+"  "))
	_, err = model.RequireWeChatOfficialConfig(model.DB, cfg.Fingerprint)
	require.ErrorIs(t, err, model.ErrWeChatOfficialUnavailable, "accepted edits must invalidate pending ceremonies")
	current, err := model.RequireWeChatOfficialConfig(model.DB, "")
	require.NoError(t, err)
	require.Equal(t, strings.Repeat("服", 128), current.DisplayName)
	require.NoError(t, model.UpdateWeChatOfficialOption("wechat_official.logo_url", "  https://image.example/new.png  "))
	current, err = model.ReadWeChatOfficialConfig(model.DB)
	require.NoError(t, err)
	require.Equal(t, "https://image.example/new.png", current.LogoURL)
	for _, key := range []string{"wechat_official.display_name", "wechat_official.logo_url"} {
		require.NoError(t, model.UpdateWeChatOfficialOption(key, ""))
	}
	current, err = model.RequireWeChatOfficialConfig(model.DB, "")
	require.NoError(t, err, "branding is optional for existing installations")
	require.Empty(t, current.DisplayName)
	require.Empty(t, current.LogoURL)
}

func TestWeChatOfficialCancellationAndOptionalProfile(t *testing.T) {
	setupAuthSessionTestDB(t)
	configureOfficialTest(t)
	officialProviderMock(t, `{"errcode":40003}`)
	cfg, err := model.RequireWeChatOfficialConfig(model.DB, "")
	require.NoError(t, err)
	subject, err := exchangeWeChatOfficial(context.Background(), cfg, "code")
	require.NoError(t, err)
	require.Equal(t, "official-owner", subject.OpenID)
	require.Empty(t, subject.AvatarURL)
	flow, err := NewWeChatOfficialFlow("browser", AuthIdentity{}, WeChatOfficialFlowRequest{Intent: "login"})
	require.NoError(t, err)
	u, _ := url.Parse(flow.QRURL)
	state, _, err := StartWeChatOfficial(u.Query().Get("ref"))
	require.NoError(t, err)
	require.NoError(t, CancelWeChatOfficial(flow.FlowToken, "browser", AuthIdentity{}))
	_, err = CallbackWeChatOfficial(context.Background(), state, "code")
	require.Error(t, err)
	previous := weChatOfficialHTTPClient
	weChatOfficialHTTPClient = &http.Client{Transport: officialTransport(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("secret https://credentials.invalid?secret=provider-secret")
	})}
	_, err = exchangeWeChatOfficial(context.Background(), cfg, "code")
	require.Equal(t, ErrWeChatOfficialFailed, err)
	require.NotContains(t, err.Error(), "provider-secret")
	weChatOfficialHTTPClient = previous
}

func TestWeChatOfficialProofMethodIsolation(t *testing.T) {
	useTestSessionSecret(t)
	user := setupAuthSessionTestDB(t)
	configureOfficialTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.TwoFA{}, &model.PasskeyCredential{}, &model.UserOAuthBinding{}))
	require.NoError(t, model.DB.Model(user).Update("wechat_id", "official-owner").Error)
	bundle, err := CreateLoginSession(user.Id, "password", "127.0.0.1", "test")
	require.NoError(t, err)
	claims, err := ParseAccessToken(bundle.AccessToken)
	require.NoError(t, err)
	identity := AuthIdentity{UserID: user.Id, SessionID: claims.SessionID, UserAuthVersion: claims.UserAuthVersion, SessionVersion: claims.SessionVersion}
	cfg, err := model.RequireWeChatOfficialConfig(model.DB, "")
	require.NoError(t, err)
	op := VerificationOperation{Scope: VerificationScopePhoneBinding}
	proof, err := completeOfficialVerification(identity, op, "official-owner", cfg.Fingerprint)
	require.NoError(t, err)
	_, err = completeOfficialVerification(identity, op, "another-owner", cfg.Fingerprint)
	require.Error(t, err)
	oldEnabled, oldAddress, oldToken := common.WeChatAuthEnabled, common.WeChatServerAddress, common.WeChatServerToken
	common.WeChatAuthEnabled = true
	common.WeChatServerAddress = "https://legacy.example"
	common.WeChatServerToken = "old-token"
	t.Cleanup(func() {
		common.WeChatAuthEnabled, common.WeChatServerAddress, common.WeChatServerToken = oldEnabled, oldAddress, oldToken
	})
	require.NoError(t, model.UpdateWeChatOfficialOption("wechat_official.enabled", "false"))
	_, err = ConsumeOperationProof(proof.ProofToken, identity, op)
	require.Error(t, err, "legacy enabled must not rescue official proof")
}

// Remote DSNs MUST point at disposable, isolated databases. This suite refuses
// to touch an existing options/users/auth_flows table; no production fixture.
func TestWeChatOfficialPersistenceMatrix(t *testing.T) {
	for _, engine := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(engine, func(t *testing.T) {
			var driver gorm.Dialector
			switch engine {
			case "sqlite":
				driver = sqlite.Open(t.TempDir() + "/official.db?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate")
			case "mysql":
				dsn := os.Getenv("WECHAT_TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("WECHAT_TEST_MYSQL_DSN not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("WECHAT_TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("WECHAT_TEST_POSTGRES_DSN not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { _ = sqlDB.Close() })
			sqlDB.SetMaxOpenConns(8)
			var version string
			query := "SELECT version()"
			if engine == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("engine=%s version=%s", engine, version)
			for _, table := range []string{"options", "users", "auth_flows", "external_identity_claims"} {
				require.False(t, db.Migrator().HasTable(table), "refusing existing DB")
			}
			previousType, previousLogType := common.MainDatabaseType(), common.LogDatabaseType()
			dbType := common.DatabaseTypeSQLite
			if engine == "mysql" {
				dbType = common.DatabaseTypeMySQL
			}
			if engine == "postgres" {
				dbType = common.DatabaseTypePostgreSQL
			}
			common.SetDatabaseTypes(dbType, previousLogType)
			t.Cleanup(func() { common.SetDatabaseTypes(previousType, previousLogType) })
			previous := model.DB
			model.DB = db
			t.Cleanup(func() { model.DB = previous })
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.Option{}, &model.User{}, &model.AuthFlow{}, &model.ExternalIdentityClaim{}, &model.UserSession{}))
			}
			t.Cleanup(func() {
				for _, table := range []string{"external_identity_claims", "auth_flows", "user_sessions", "users", "options"} {
					require.NoError(t, db.Migrator().DropTable(table))
				}
			})
			configureOfficialTest(t)
			beforeBranding, err := model.RequireWeChatOfficialConfig(db, "")
			require.NoError(t, err)
			require.NoError(t, model.UpdateWeChatOfficialOption("wechat_official.display_name", "  示例服务号  "))
			require.NoError(t, model.UpdateWeChatOfficialOption("wechat_official.logo_url", "  https://image.example/official.png  "))
			branding, err := model.RequireWeChatOfficialConfig(db, "")
			require.NoError(t, err)
			require.Equal(t, "示例服务号", branding.DisplayName)
			require.Equal(t, "https://image.example/official.png", branding.LogoURL)
			require.NotEqual(t, beforeBranding.Fingerprint, branding.Fingerprint)
			require.ErrorIs(t, model.UpdateWeChatOfficialOption("wechat_official.logo_url", "javascript:alert(1)"), model.ErrWeChatOfficialBranding)
			_, err = model.RequireWeChatOfficialConfig(db, branding.Fingerprint)
			require.NoError(t, err, "invalid presentation data must not mutate the stored revision")
			legacy := model.User{Username: "legacy", AffCode: "legacy", WeChatId: "legacy-openid", Status: common.UserStatusEnabled}
			require.NoError(t, db.Create(&legacy).Error)
			for range 2 {
				require.NoError(t, model.InitializeExternalIdentityClaims())
			}
			require.NoError(t, db.Delete(&legacy).Error)
			other := model.User{Username: "other", AffCode: "other"}
			require.NoError(t, db.Create(&other).Error)
			require.ErrorIs(t, db.Transaction(func(tx *gorm.DB) error {
				return model.ClaimExternalIdentityWithTx(tx, "wechat", "legacy-openid", other.Id)
			}), model.ErrExternalIdentityAlreadyClaimed)
			token, _, err := model.CreateAuthFlow(model.AuthFlowCreate{Purpose: "matrix", ExpiresAt: time.Now().Add(time.Minute)})
			require.NoError(t, err)
			var mu sync.Mutex
			wins := 0
			var wg sync.WaitGroup
			for range 6 {
				wg.Go(func() {
					_, err := model.ConsumeAuthFlow(token, model.AuthFlowMatch{Purpose: "matrix"})
					if err == nil {
						mu.Lock()
						wins++
						mu.Unlock()
					}
				})
			}
			wg.Wait()
			require.Equal(t, 1, wins)

			// Two different accounts compete through the production binding transaction.
			racer := model.User{Username: "racer", AffCode: "racer", Status: common.UserStatusEnabled}
			require.NoError(t, db.Create(&racer).Error)
			users := []model.User{other, racer}
			identities := make([]AuthIdentity, len(users))
			for i, u := range users {
				sid := "race-session-" + u.Username
				session := model.UserSession{SID: sid, UserID: u.Id, Version: 1, UserAuthVersion: u.AuthVersion, Status: model.UserSessionStatusActive, ExpiresAt: time.Now().Add(time.Hour).Unix()}
				require.NoError(t, db.Create(&session).Error)
				identities[i] = AuthIdentity{UserID: u.Id, SessionID: sid, SessionVersion: 1, UserAuthVersion: u.AuthVersion}
			}
			results := make(chan error, 2)
			for i := range users {
				wg.Go(func() {
					results <- db.Transaction(func(tx *gorm.DB) error {
						return model.UpdateUserBindColumnForSessionWithTx(tx, identities[i], "wechat_id", "racing-openid")
					})
				})
			}
			wg.Wait()
			close(results)
			wins = 0
			for err := range results {
				if err == nil {
					wins++
				} else {
					require.ErrorIs(t, err, model.ErrExternalIdentityAlreadyClaimed)
				}
			}
			require.Equal(t, 1, wins)
			var claim model.ExternalIdentityClaim
			require.NoError(t, db.Where("provider = ? AND subject = ?", "wechat", "racing-openid").First(&claim).Error)
			for _, u := range users {
				var actual model.User
				require.NoError(t, db.First(&actual, u.Id).Error)
				if actual.Id == claim.UserId {
					require.Equal(t, "racing-openid", actual.WeChatId)
				} else {
					require.Empty(t, actual.WeChatId)
				}
			}
			// MySQL default collations may find a case variant; it must never validate
			// that variant as the same provider subject.
			caseOwner := model.User{Username: "case", AffCode: "case"}
			require.NoError(t, db.Create(&caseOwner).Error)
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
				return model.ClaimExternalIdentityWithTx(tx, "wechat", "OpaqueCase", caseOwner.Id)
			}))
			require.ErrorIs(t, db.Transaction(func(tx *gorm.DB) error {
				return model.ClaimExternalIdentityWithTx(tx, "wechat", "opaquecase", caseOwner.Id)
			}), model.ErrExternalIdentityAlreadyClaimed)
			officialProviderMock(t, `{"openid":"official-owner"}`)
			authorized, _ := officialAuthorizedTestFlow(t, "login", AuthIdentity{})
			wins = 0
			for range 4 {
				wg.Go(func() {
					_, _, _, err := CompleteWeChatOfficial(authorized.FlowToken, "browser", AuthIdentity{})
					if err == nil {
						mu.Lock()
						wins++
						mu.Unlock()
					}
				})
			}
			wg.Wait()
			require.Equal(t, 1, wins)

			duplicate := model.User{Username: "duplicate", AffCode: "duplicate", WeChatId: "legacy-openid"}
			require.NoError(t, db.Create(&duplicate).Error)
			require.ErrorIs(t, model.InitializeExternalIdentityClaims(), model.ErrExternalIdentityAlreadyClaimed)
		})
	}
}

func TestWeChatOfficialBindingAtomicProofAndRevocation(t *testing.T) {
	useTestSessionSecret(t)
	user := setupAuthSessionTestDB(t)
	configureOfficialTest(t)
	officialProviderMock(t, `{"openid":"official-owner"}`)
	require.NoError(t, model.DB.AutoMigrate(&model.TwoFA{}, &model.PasskeyCredential{}, &model.UserOAuthBinding{}))
	bundle, err := CreateLoginSession(user.Id, "password", "127.0.0.1", "test")
	require.NoError(t, err)
	identity, err := ParseAccessToken(bundle.AccessToken)
	require.NoError(t, err)
	flow, _ := officialAuthorizedTestFlow(t, "bind", identity)
	_, assertion, _, err := CompleteWeChatOfficial(flow.FlowToken, "browser", identity)
	require.NoError(t, err)
	context, _ := common.Marshal(AccountBindingContext{Provider: "wechat_official", Code: assertion})
	operation := VerificationOperation{Scope: VerificationScopeAccountBind, Context: context}
	binding, err := BindVerificationOperation(operation)
	require.NoError(t, err)
	proof, _, err := issueSecurityProof(identity, VerificationMethodPassword, binding, "")
	require.NoError(t, err)
	// A conflict rolls back BOTH one-time authorizations, so the user can retry
	// safely after resolving it without a proof/identity mismatch window.
	conflicting := model.User{Username: "conflict", AffCode: "conflict", Status: common.UserStatusEnabled}
	require.NoError(t, model.DB.Create(&conflicting).Error)
	require.NoError(t, model.DB.Transaction(func(tx *gorm.DB) error {
		return model.ClaimExternalIdentityWithTx(tx, "wechat", "official-owner", conflicting.Id)
	}))
	_, err = BindWeChatOfficialAssertion(assertion, "browser", proof, identity)
	require.ErrorIs(t, err, model.ErrExternalIdentityAlreadyClaimed)
	_, err = GetWeChatOfficialAssertion(assertion, "browser", identity)
	require.NoError(t, err)
	require.NoError(t, model.DB.Transaction(func(tx *gorm.DB) error { return model.ReleaseExternalIdentityWithTx(tx, "wechat", conflicting.Id) }))
	_, err = BindWeChatOfficialAssertion(assertion, "browser", proof, identity)
	require.NoError(t, err)
	_, err = BindWeChatOfficialAssertion(assertion, "browser", proof, identity)
	require.Error(t, err)
	var current model.User
	require.NoError(t, model.DB.First(&current, user.Id).Error)
	require.Equal(t, "official-owner", current.WeChatId)
	_, err = NewWeChatOfficialFlow("browser", identity, WeChatOfficialFlowRequest{Intent: "bind"})
	require.ErrorIs(t, err, model.ErrAccountBindingChanged, "no direct overwrite")
}

func TestWeChatOfficialPendingLoginRevocation(t *testing.T) {
	useTestSessionSecret(t)
	user := setupAuthSessionTestDB(t)
	configureOfficialTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.TwoFA{}, &model.PasskeyCredential{}, &model.UserOAuthBinding{}))
	require.NoError(t, model.DB.Model(user).Update("wechat_id", "official-owner").Error)
	user.WeChatId = "official-owner"
	cfg, err := model.RequireWeChatOfficialConfig(model.DB, "")
	require.NoError(t, err)
	user.WeChatConfig = cfg.Fingerprint
	pending, err := StartWeChatPhoneFlow(user, "browser")
	require.NoError(t, err)
	require.NoError(t, model.DB.Create(&model.TwoFA{UserId: user.Id, IsEnabled: true, Secret: "secret"}).Error)
	challenge, err := StartLoginVerification(user, "wechat", nil)
	require.NoError(t, err)
	require.NotNil(t, challenge)
	verification, err := RequireLoginVerification(challenge.FlowToken, VerificationMethodTwoFA)
	require.NoError(t, err)
	require.NoError(t, model.UpdateWeChatOfficialOption("wechat_official.enabled", "false"))
	_, err = RequireWeChatPhoneFlow(pending, "browser")
	require.Error(t, err)
	_, err = RequireLoginVerification(challenge.FlowToken, VerificationMethodTwoFA)
	require.Error(t, err)
	_, _, err = CompleteLoginVerification(challenge.FlowToken, verification, VerificationMethodTwoFA, "127.0.0.1", "test")
	require.Error(t, err)
	require.NoError(t, model.UpdateWeChatOfficialOption("wechat_official.enabled", "true"))
	cfg, err = model.RequireWeChatOfficialConfig(model.DB, "")
	require.NoError(t, err)
	require.NoError(t, model.DB.Model(user).Update("wechat_id", "").Error)
	_, err = CreateLoginSessionAtAuthVersion(user.Id, user.AuthVersion, "wechat", "127.0.0.1", "test", cfg.Fingerprint, "official-owner")
	require.Error(t, err, "unbinding invalidates pending immediate session issuance")
}

func TestWeChatOfficialVerificationBindsScopeContextAndSession(t *testing.T) {
	for _, scope := range []string{VerificationScopeAccessTokenGenerate, VerificationScopeAccessTokenUpdate, VerificationScopeAccessTokenRevoke} {
		t.Run(scope, func(t *testing.T) {
			useTestSessionSecret(t)
			user := setupAuthSessionTestDB(t)
			configureOfficialTest(t)
			officialProviderMock(t, `{"openid":"official-owner"}`)
			require.NoError(t, model.DB.AutoMigrate(&model.TwoFA{}, &model.PasskeyCredential{}, &model.UserOAuthBinding{}))
			require.NoError(t, model.DB.Model(user).Update("wechat_id", "official-owner").Error)
			bundle, err := CreateLoginSession(user.Id, "password", "127.0.0.1", "test")
			require.NoError(t, err)
			identity, err := ParseAccessToken(bundle.AccessToken)
			require.NoError(t, err)
			context := []byte(`{"scopes":["profile:read"],"expires_at":0}`)
			if scope == VerificationScopeAccessTokenUpdate {
				context = []byte(`{"token_id":42,"scopes":["profile:read"]}`)
			}
			if scope == VerificationScopeAccessTokenRevoke {
				context = []byte(`{"token_id":42}`)
			}
			operation := VerificationOperation{Scope: scope, Context: context}
			cfg, err := model.RequireWeChatOfficialConfig(model.DB, "")
			require.NoError(t, err)
			proof, err := completeOfficialVerification(identity, operation, "official-owner", cfg.Fingerprint)
			require.NoError(t, err)
			wrong := operation
			wrong.Scope = VerificationScopePhoneBinding
			_, err = ConsumeOperationProof(proof.ProofToken, identity, wrong)
			require.Error(t, err)
			wrong = operation
			wrong.Context = []byte(`{"token_id":43}`)
			_, err = ConsumeOperationProof(proof.ProofToken, identity, wrong)
			require.Error(t, err)
			other := identity
			other.SessionVersion++
			_, err = ConsumeOperationProof(proof.ProofToken, other, operation)
			require.Error(t, err)
			_, err = ConsumeOperationProof(proof.ProofToken, identity, operation)
			require.NoError(t, err)
			_, err = ConsumeOperationProof(proof.ProofToken, identity, operation)
			require.Error(t, err)
			// A bound contact remains mandatory; neither a password fallback nor a new
			// arbitrary verification scope is admitted by enabling Official Account.
			_, err = NewWeChatOfficialFlow("browser", identity, WeChatOfficialFlowRequest{Intent: "verify", Scope: VerificationScopePasswordChange})
			require.Error(t, err)
			flow, err := NewWeChatOfficialFlow("browser", identity, WeChatOfficialFlowRequest{Intent: "verify", Scope: scope, Context: context})
			require.NoError(t, err)
			require.NoError(t, model.DB.Model(&model.UserSession{}).Where("sid = ?", identity.SessionID).Update("revoked_at", time.Now().Unix()).Error)
			_, err = WeChatOfficialStatus(flow.FlowToken, "browser", identity)
			require.Error(t, err)
		})
	}
}

func TestWeChatOfficialNetworkReturnCannotReviveCancelledFlow(t *testing.T) {
	setupAuthSessionTestDB(t)
	configureOfficialTest(t)
	flow, err := NewWeChatOfficialFlow("browser", AuthIdentity{}, WeChatOfficialFlowRequest{Intent: "login"})
	require.NoError(t, err)
	u, _ := url.Parse(flow.QRURL)
	state, _, err := StartWeChatOfficial(u.Query().Get("ref"))
	require.NoError(t, err)
	previous := weChatOfficialHTTPClient
	t.Cleanup(func() { weChatOfficialHTTPClient = previous })
	entered, release := make(chan struct{}), make(chan struct{})
	weChatOfficialHTTPClient = &http.Client{Transport: officialTransport(func(r *http.Request) (*http.Response, error) {
		body := `{"openid":"official-owner"}`
		if r.URL.Path == "/sns/oauth2/access_token" {
			close(entered)
			<-release
			body = `{"access_token":"provider-token","openid":"official-owner","scope":"snsapi_userinfo"}`
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}
	result := make(chan error, 1)
	go func() { _, err := CallbackWeChatOfficial(context.Background(), state, "code"); result <- err }()
	<-entered
	// The independently claimed provider state cannot exchange a second time.
	_, err = CallbackWeChatOfficial(context.Background(), state, "other-code")
	require.Error(t, err)
	require.NoError(t, CancelWeChatOfficial(flow.FlowToken, "browser", AuthIdentity{}))
	close(release)
	require.Error(t, <-result)
	status, err := WeChatOfficialStatus(flow.FlowToken, "browser", AuthIdentity{})
	require.NoError(t, err)
	require.Equal(t, "cancelled", status)
	_, _, _, err = CompleteWeChatOfficial(flow.FlowToken, "browser", AuthIdentity{})
	require.Error(t, err)
	// Expiry remains absolute and is never extended by polling.
	expires, err := NewWeChatOfficialFlow("browser", AuthIdentity{}, WeChatOfficialFlowRequest{Intent: "login"})
	require.NoError(t, err)
	stored, err := model.GetAuthFlow(expires.FlowToken, officialMatch(officialFlowPurpose))
	require.NoError(t, err)
	require.NoError(t, model.DB.Model(stored).Update("expires_at", time.Now().Add(-time.Second)).Error)
	_, err = WeChatOfficialStatus(expires.FlowToken, "browser", AuthIdentity{})
	require.Error(t, err)
}

func TestWeChatOfficialBindingKeepsSMSAndMFARequirement(t *testing.T) {
	for _, enrollMFA := range []bool{false, true} {
		t.Run(fmt.Sprint("enroll MFA after SMS=", enrollMFA), func(t *testing.T) {
			useTestSessionSecret(t)
			_, identity := setupPhoneChange(t)
			configureOfficialTest(t)
			officialProviderMock(t, `{"openid":"official-owner"}`)
			require.NoError(t, model.DB.AutoMigrate(&model.UserOAuthBinding{}))
			oldSettings := *system_setting.GetPhoneSettings()
			*system_setting.GetPhoneSettings() = system_setting.PhoneSettings{Enabled: true, Region: "cn-hangzhou", SignName: "test", TemplateCode: "test"}
			t.Cleanup(func() { *system_setting.GetPhoneSettings() = oldSettings })
			t.Setenv("ALIYUN_SMS_ACCESS_KEY_ID", "test-id")
			t.Setenv("ALIYUN_SMS_ACCESS_KEY_SECRET", "test-secret")
			previousClient := http.DefaultClient
			t.Cleanup(func() { http.DefaultClient = previousClient })
			var smsCode string
			http.DefaultClient = &http.Client{Transport: officialTransport(func(r *http.Request) (*http.Response, error) {
				require.Equal(t, "dysmsapi.aliyuncs.com", r.URL.Host)
				require.NoError(t, r.ParseForm())
				var param map[string]string
				require.NoError(t, common.UnmarshalJsonStr(r.Form.Get("TemplateParam"), &param))
				smsCode = param["code"]
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"Code":"OK"}`)), Header: make(http.Header)}, nil
			})}
			flow, _ := officialAuthorizedTestFlow(t, "bind", identity)
			_, assertion, _, err := CompleteWeChatOfficial(flow.FlowToken, "browser", identity)
			require.NoError(t, err)
			context, _ := common.Marshal(AccountBindingContext{Provider: "wechat_official", Code: assertion})
			operation := VerificationOperation{Scope: VerificationScopeAccountBind, Context: context}
			binding, err := BindVerificationOperation(operation)
			require.NoError(t, err)
			passwordProof, _, err := issueSecurityProof(identity, VerificationMethodPassword, binding, "")
			require.NoError(t, err)
			_, err = BindWeChatOfficialAssertion(assertion, "browser", passwordProof, identity)
			require.ErrorIs(t, err, ErrProofMethod)
			sms, err := SendWeChatBindingSMS(identity, operation, "192.0.2.192")
			require.NoError(t, err)
			require.Len(t, smsCode, 6)
			wrongContext, _ := common.Marshal(AccountBindingContext{Provider: "wechat_official", Code: strings.Repeat("a", 43)})
			_, err = VerifyWeChatBindingSMS(identity, VerificationOperation{Scope: VerificationScopeAccountBind, Context: wrongContext}, sms, smsCode)
			require.Error(t, err)
			proof, err := VerifyWeChatBindingSMS(identity, operation, sms, smsCode)
			require.NoError(t, err)
			if enrollMFA {
				require.NoError(t, model.DB.Create(&model.TwoFA{UserId: identity.UserID, Secret: "test", IsEnabled: true}).Error)
			}
			_, err = BindWeChatOfficialAssertion(assertion, "browser", proof.ProofToken, identity)
			if enrollMFA {
				require.Error(t, err)
				var user model.User
				require.NoError(t, model.DB.First(&user, identity.UserID).Error)
				require.Empty(t, user.WeChatId)
			} else {
				require.NoError(t, err)
			}
		})
	}
}
