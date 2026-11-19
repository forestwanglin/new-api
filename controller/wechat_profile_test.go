package controller

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestWeChatOfficialBrowserProofWithoutCaptcha(t *testing.T) {
	setupSecurityEnrollmentTest(t)
	previousSecure := common.SessionCookieSecure
	common.SessionCookieSecure = true
	t.Cleanup(func() { common.SessionCookieSecure = previousSecure })
	var before int64
	require.NoError(t, model.DB.Model(&model.AuthFlow{}).Count(&before).Error)
	var browser string
	for range 2 {
		response := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(response)
		c.Request = httptest.NewRequest(http.MethodGet, "https://site.example/api/oauth/wechat_official/browser", nil)
		if browser != "" {
			c.Request.AddCookie(&http.Cookie{Name: phoneBrowserCookie, Value: browser})
		}
		WeChatOfficialBrowser(c)
		var result struct {
			Success bool `json:"success"`
			Data    struct {
				BrowserToken string `json:"browser_token"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success)
		require.Len(t, result.Data.BrowserToken, 43)
		if browser != "" {
			assert.Equal(t, browser, result.Data.BrowserToken)
		}
		browser = result.Data.BrowserToken
		cookies := response.Result().Cookies()
		require.Len(t, cookies, 1)
		assert.Equal(t, phoneBrowserCookie, cookies[0].Name)
		assert.Equal(t, browser, cookies[0].Value)
		assert.Equal(t, "/api", cookies[0].Path)
		assert.True(t, cookies[0].HttpOnly)
		assert.True(t, cookies[0].Secure)
		assert.Equal(t, http.SameSiteLaxMode, cookies[0].SameSite)
		assert.Contains(t, response.Header().Get("Cache-Control"), "no-store")
		assert.NotContains(t, response.Body.String(), "challenge_token")
		assert.NotContains(t, response.Body.String(), "data:image")
	}
	var after int64
	require.NoError(t, model.DB.Model(&model.AuthFlow{}).Count(&after).Error)
	assert.Equal(t, before, after, "issuing browser proof must not create a CAPTCHA challenge")
}

func TestWeChatOfficialCallbackRejectsScannerMismatchBeforeExchange(t *testing.T) {
	setupSecurityEnrollmentTest(t)
	previousTransport := http.DefaultTransport
	calls := 0
	http.DefaultTransport = controllerSMSRoundTripper(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: http.StatusBadGateway, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}}, nil
	})
	t.Cleanup(func() { http.DefaultTransport = previousTransport })
	for _, scanner := range []string{"", strings.Repeat("b", 64)} {
		response := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(response)
		c.Request = httptest.NewRequest(http.MethodGet, "https://site.example/api/oauth/wechat_official/callback?state="+strings.Repeat("a", 64)+"&code=provider-sensitive-code", nil)
		if scanner != "" {
			c.Request.AddCookie(&http.Cookie{Name: officialScannerCookie, Value: scanner})
		}
		CallbackWeChatOfficial(c)
		assert.Contains(t, response.Body.String(), `"success":false`)
		assert.NotContains(t, response.Body.String(), "provider-sensitive-code")
		assert.NotContains(t, response.Body.String(), "access_token")
		assert.Empty(t, response.Header().Get("Location"))
	}
	assert.Zero(t, calls, "a scanner mismatch must reject before provider HTTP")
}

func TestWeChatOfficialOptionSecretRedactionAndBlankRetention(t *testing.T) {
	setupSecurityEnrollmentTest(t)
	previousMap := common.OptionMap
	common.OptionMap = map[string]string{}
	t.Cleanup(func() { common.OptionMap = previousMap })
	for key, value := range map[string]string{
		"ServerAddress": "https://site.example", "wechat_official.app_secret": "write-only-official-secret",
		"wechat_official.app_id": "wx0123456789abcdef", "wechat_official.revision": "private-revision",
		"wechat_official.pinned_app_id": "wx0123456789abcdef",
	} {
		require.NoError(t, model.DB.Create(&model.Option{Key: key, Value: value}).Error)
		common.OptionMap[key] = value
	}
	require.NoError(t, model.UpdateOption("wechat_official.app_secret", "  "))
	configuration, err := model.ReadWeChatOfficialConfig(model.DB)
	require.NoError(t, err)
	assert.Equal(t, "write-only-official-secret", configuration.AppSecret)
	assert.Equal(t, "private-revision", configuration.Revision)
	// Another process may have changed the authoritative configuration while this
	// instance's legacy option cache still contains a different namespace/site.
	common.OptionMap["wechat_official.app_id"] = "wxstale00000000000"
	common.OptionMap["wechat_official.enabled"] = "true"
	common.OptionMap["wechat_official.callback_url"] = "https://stale.example/callback"
	common.OptionMap["wechat_official.app_secret_configured"] = "false"
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest(http.MethodGet, "https://site.example/api/option/", nil)
	GetOptions(c)
	var result struct {
		Success bool           `json:"success"`
		Data    []model.Option `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	require.True(t, result.Success, response.Body.String())
	values := map[string]string{}
	for _, option := range result.Data {
		values[option.Key] = option.Value
	}
	assert.NotContains(t, values, "wechat_official.app_secret")
	assert.NotContains(t, values, "wechat_official.revision")
	assert.NotContains(t, values, "wechat_official.pinned_app_id")
	assert.Equal(t, "true", values["wechat_official.app_secret_configured"])
	assert.Equal(t, "wx0123456789abcdef", values["wechat_official.app_id"])
	assert.Equal(t, "false", values["wechat_official.enabled"])
	assert.Equal(t, "https://site.example/api/oauth/wechat_official/callback", values["wechat_official.callback_url"])
	assert.NotContains(t, response.Body.String(), "write-only-official-secret")
}

func TestWeChatOptionalProfileExchange(t *testing.T) {
	for _, tc := range []struct{ name, profile, nickname, avatar string }{
		{name: "legacy"},
		{name: "full", profile: `,"profile":{"nickname":"  微信昵称  ","avatar_url":"https://example.com/avatar"}`, nickname: "微信昵称", avatar: "https://example.com/avatar"},
		{name: "wrong type", profile: `,"profile":{"nickname":123}`},
		{name: "invalid URL", profile: `,"profile":{"nickname":"ok","avatar_url":"javascript:alert(1)"}`, nickname: "ok"},
		{name: "null", profile: `,"profile":null`},
		{name: "long name", profile: `,"profile":{"nickname":"` + strings.Repeat("中", 25) + `"}`, nickname: strings.Repeat("中", 20)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				assert.Equal(t, "secret", r.Header.Get("Authorization"))
				_, _ = w.Write([]byte(`{"success":true,"data":"openid"` + tc.profile + `}`))
			}))
			defer server.Close()
			oldAddress, oldToken := common.WeChatServerAddress, common.WeChatServerToken
			common.WeChatServerAddress, common.WeChatServerToken = server.URL, "secret"
			t.Cleanup(func() { common.WeChatServerAddress, common.WeChatServerToken = oldAddress, oldToken })
			result, err := getWeChatIdentityByCode("code")
			require.NoError(t, err)
			assert.Equal(t, "openid", result.OpenID)
			assert.Equal(t, tc.nickname, result.Profile.Nickname)
			assert.Equal(t, tc.avatar, result.Profile.AvatarURL)
			assert.Equal(t, 1, calls)
		})
	}
}

func TestWeChatProfileSynchronization(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous })
	for _, tc := range []struct {
		name, display, avatar, source string
		binding                       bool
		wantName, wantAvatar          string
	}{
		{name: "default", display: "WeChat User", wantName: "微信昵称", wantAvatar: "https://example.com/new"},
		{name: "custom", display: "My name", avatar: "https://example.com/custom", source: "upload", wantName: "My name", wantAvatar: "https://example.com/custom"},
		{name: "wechat refresh", display: "My name", avatar: "https://example.com/old", source: "wechat", wantName: "My name", wantAvatar: "https://example.com/new"},
		{name: "binding", display: "WeChat User", binding: true, wantName: "WeChat User", wantAvatar: "https://example.com/new"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			user := model.User{Username: tc.name, AffCode: tc.name, DisplayName: tc.display, AvatarURL: tc.avatar, AvatarSource: tc.source, WeChatId: "openid"}
			require.NoError(t, db.Create(&user).Error)
			require.NoError(t, model.SyncWeChatProfile(user.Id, "openid", "微信昵称", "https://example.com/new", tc.binding))
			require.NoError(t, db.First(&user, user.Id).Error)
			assert.Equal(t, tc.wantName, user.DisplayName)
			assert.Equal(t, tc.wantAvatar, user.AvatarURL)
			require.NoError(t, model.SyncWeChatProfile(user.Id, "openid", "", "", false))
			require.NoError(t, db.First(&user, user.Id).Error)
			assert.Equal(t, tc.wantAvatar, user.AvatarURL)
			profile, err := model.GetSelfUserById(user.Id)
			require.NoError(t, err)
			assert.Equal(t, tc.wantAvatar, profile.AvatarURL)
			assert.Equal(t, tc.wantAvatar, buildSelfUserData(profile)["avatar_url"])
			encoded, err := common.Marshal(profile)
			require.NoError(t, err)
			assert.NotContains(t, string(encoded), "avatar_source")
			require.NoError(t, model.SyncWeChatProfile(user.Id, "different-openid", "wrong", "https://example.com/wrong", false))
			require.NoError(t, db.First(&user, user.Id).Error)
			assert.Equal(t, tc.wantName, user.DisplayName)
			assert.Equal(t, tc.wantAvatar, user.AvatarURL)
		})
	}
}

// Each remote DSN must reference a disposable test database: this test creates
// and drops its own uniquely named tables, never the application's users table.
func TestWeChatAvatarMigrationMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(":memory:")
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { assert.NoError(t, sqlDB.Close()) })
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("engine=%s version=%s", dialect, version)
			for _, upgrade := range []bool{false, true} {
				table := "wechat_avatar_fresh_test"
				if upgrade {
					table = "wechat_avatar_upgrade_test"
				}
				require.False(t, db.Migrator().HasTable(table), "test table exists; refusing to modify it")
				t.Cleanup(func() { assert.NoError(t, db.Migrator().DropTable(table)) })
				if upgrade {
					// Reproduce the preceding User schema without the two additive columns.
					require.NoError(t, db.Table(table).Migrator().CreateTable(&model.User{}))
					require.NoError(t, db.Table(table).Migrator().DropColumn(&model.User{}, "avatar_url"))
					require.NoError(t, db.Table(table).Migrator().DropColumn(&model.User{}, "avatar_source"))
					require.False(t, db.Table(table).Migrator().HasColumn(&model.User{}, "avatar_url"))
					require.NoError(t, db.Table(table).Omit("AvatarURL", "AvatarSource").Create(&model.User{Username: "existing", Password: "preserve-hash", AffCode: "existing"}).Error)
				}
				for range 2 {
					require.NoError(t, db.Table(table).AutoMigrate(&model.User{}))
				}
				var user model.User
				if upgrade {
					require.NoError(t, db.Table(table).Where("username = ?", "existing").First(&user).Error)
					assert.Equal(t, "preserve-hash", user.Password)
					assert.Empty(t, user.AvatarURL)
					assert.Empty(t, user.AvatarSource)
				} else {
					user = model.User{Username: "fresh", AffCode: "fresh", AvatarURL: "https://example.com/avatar", AvatarSource: "wechat"}
					require.NoError(t, db.Table(table).Create(&user).Error)
				}
				require.NoError(t, db.Table(table).Where("id = ?", user.Id).Updates(map[string]any{"avatar_url": "https://example.com/new", "avatar_source": "wechat"}).Error)
				require.NoError(t, db.Table(table).First(&user, user.Id).Error)
				assert.Equal(t, "https://example.com/new", user.AvatarURL)
			}
		})
	}
}

func TestWeChatBindingProfilePreservesSecurityProof(t *testing.T) {
	for _, failUpdate := range []bool{false, true} {
		t.Run(fmt.Sprint("metadata failure=", failUpdate), func(t *testing.T) {
			user, identity := setupSecurityEnrollmentTest(t)
			oldEnabled, oldAddress := common.WeChatAuthEnabled, common.WeChatServerAddress
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(`{"success":true,"data":"bind-openid","profile":{"nickname":"not applied","avatar_url":"https://example.com/avatar"}}`))
			}))
			common.WeChatAuthEnabled, common.WeChatServerAddress = true, upstream.URL
			t.Cleanup(func() {
				upstream.Close()
				common.WeChatAuthEnabled, common.WeChatServerAddress = oldEnabled, oldAddress
			})
			originalName := user.DisplayName
			// No proof: binding and metadata must both remain unchanged.
			denied := securityEnrollmentRequest("POST", "/api/oauth/wechat/bind", `{"code":"bind-code"}`, "", identity, WeChatBind)
			assert.NotContains(t, denied.Body.String(), `"success":true`)
			require.NoError(t, model.DB.First(user, user.Id).Error)
			assert.Empty(t, user.WeChatId)
			assert.Empty(t, user.AvatarURL)
			if failUpdate {
				require.NoError(t, model.DB.Callback().Update().Before("gorm:update").Register("test:profile_error", func(tx *gorm.DB) {
					if fields, ok := tx.Statement.Dest.(map[string]any); ok {
						if _, updatingAvatar := fields["avatar_url"]; updatingAvatar {
							tx.AddError(fmt.Errorf("profile storage unavailable"))
						}
					}
				}))
				t.Cleanup(func() { _ = model.DB.Callback().Update().Remove("test:profile_error") })
			}
			context, err := common.Marshal(service.AccountBindingContext{Provider: "wechat", Code: "bind-code"})
			require.NoError(t, err)
			proof := issueSecurityEnrollmentProof(t, identity, service.VerificationOperation{Scope: service.VerificationScopeAccountBind, Context: context}, service.VerificationMethodPassword)
			response := securityEnrollmentRequest("POST", "/api/oauth/wechat/bind", `{"code":"bind-code"}`, proof, identity, WeChatBind)
			assert.Contains(t, response.Body.String(), `"success":true`, response.Body.String())
			require.NoError(t, model.DB.First(user, user.Id).Error)
			assert.Equal(t, "bind-openid", user.WeChatId)
			assert.Equal(t, originalName, user.DisplayName)
			if failUpdate {
				assert.Empty(t, user.AvatarURL)
			} else {
				assert.Equal(t, "https://example.com/avatar", user.AvatarURL)
			}
		})
	}
}

func TestWeChatLoginProfileDoesNotBypassVerification(t *testing.T) {
	for _, scenario := range []string{"metadata", "metadata failure", "banned"} {
		t.Run(scenario, func(t *testing.T) {
			user, _ := setupSecurityEnrollmentTest(t)
			require.NoError(t, model.DB.Model(user).Updates(map[string]any{"wechat_id": "login-openid", "display_name": "WeChat User"}).Error)
			newSecurityLoginPasskey(t, user.Id)
			require.NoError(t, model.DB.AutoMigrate(&model.ExternalIdentityClaim{}))
			require.NoError(t, model.DB.Create(&model.ExternalIdentityClaim{Provider: "phone", Subject: "13800138000", UserId: user.Id}).Error)
			oldEnabled, oldAddress := common.WeChatAuthEnabled, common.WeChatServerAddress
			calls := 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				_, _ = w.Write([]byte(`{"success":true,"data":"login-openid","profile":{"nickname":"微信昵称","avatar_url":"https://example.com/avatar"}}`))
			}))
			common.WeChatAuthEnabled, common.WeChatServerAddress = true, upstream.URL
			t.Cleanup(func() {
				upstream.Close()
				common.WeChatAuthEnabled, common.WeChatServerAddress = oldEnabled, oldAddress
			})
			if scenario == "metadata failure" {
				require.NoError(t, model.DB.Callback().Update().Before("gorm:update").Register("test:login_profile_error", func(tx *gorm.DB) { tx.AddError(fmt.Errorf("profile unavailable")) }))
				t.Cleanup(func() { _ = model.DB.Callback().Update().Remove("test:login_profile_error") })
			}
			if scenario == "banned" {
				require.NoError(t, model.DB.Model(user).Update("status", common.UserStatusDisabled).Error)
			}
			response := phoneAuthControllerRequest("GET", "/api/oauth/wechat?code=login-code", "", strings.Repeat("a", 43), WeChatAuth)
			if scenario == "banned" {
				assert.NotContains(t, response.Body.String(), `"success":true`)
			} else {
				assert.Contains(t, response.Body.String(), `"success":true`)
				assert.Contains(t, response.Body.String(), `"require_verification":true`)
				assert.NotContains(t, response.Body.String(), `"access_token"`)
			}
			require.NoError(t, model.DB.First(user, user.Id).Error)
			if scenario == "metadata" {
				assert.Equal(t, "微信昵称", user.DisplayName)
				assert.Equal(t, "https://example.com/avatar", user.AvatarURL)
			} else {
				assert.Equal(t, "WeChat User", user.DisplayName)
				assert.Empty(t, user.AvatarURL)
			}
			assert.Equal(t, 1, calls)
		})
	}
}

// This matrix runs against TEST_SECURITY_DIALECT plus TEST_MYSQL_DSN or
// TEST_POSTGRES_DSN. Only the external SMS/WeChat HTTP exchanges are doubled.
func TestWeChatBindingSMS(t *testing.T) {
	for _, scenario := range []string{"success", "wrong codes exhaust attempts", "expired", "cross session", "cross context", "phone changed before proof use", "openid owned", "mfa cannot downgrade", "no phone", "concurrent verification", "revoked session"} {
		t.Run(scenario, func(t *testing.T) {
			user, identity := setupSecurityEnrollmentTest(t)
			originalClient := http.DefaultClient
			oldEnabled := common.WeChatAuthEnabled
			oldAddress := common.WeChatServerAddress
			oldSettings := *system_setting.GetPhoneSettings()
			t.Setenv("ALIYUN_SMS_ACCESS_KEY_ID", "test-key")
			t.Setenv("ALIYUN_SMS_ACCESS_KEY_SECRET", "test-secret")
			*system_setting.GetPhoneSettings() = system_setting.PhoneSettings{Enabled: true, Region: "cn-hangzhou", SignName: "test", TemplateCode: "SMS_TEST"}
			common.WeChatAuthEnabled = true
			wechatServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(`{"success":true,"data":"sms-bind-openid"}`))
			}))
			common.WeChatServerAddress = wechatServer.URL
			t.Cleanup(func() {
				wechatServer.Close()
				http.DefaultClient = originalClient
				common.WeChatAuthEnabled = oldEnabled
				common.WeChatServerAddress = oldAddress
				*system_setting.GetPhoneSettings() = oldSettings
			})
			smsCode := ""
			sends := 0
			http.DefaultClient = &http.Client{Transport: controllerSMSRoundTripper(func(r *http.Request) (*http.Response, error) {
				body := `{"success":true,"data":"sms-bind-openid"}`
				if r.URL.Host == "dysmsapi.aliyuncs.com" {
					sends++
					require.NoError(t, r.ParseForm())
					assert.Equal(t, "13800138000", r.Form.Get("PhoneNumbers"))
					var template map[string]string
					require.NoError(t, common.UnmarshalJsonStr(r.Form.Get("TemplateParam"), &template))
					smsCode = template["code"]
					body = `{"Code":"OK"}`
				}
				return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}, nil
			})}
			if scenario != "no phone" {
				require.NoError(t, model.DB.Create(&model.ExternalIdentityClaim{Provider: "phone", Subject: "13800138000", UserId: user.Id}).Error)
			}
			if scenario == "mfa cannot downgrade" {
				require.NoError(t, model.DB.Create(&model.TwoFA{UserId: user.Id, Secret: "unused", IsEnabled: true}).Error)
			}
			status := securityEnrollmentRequest("GET", "/api/oauth/wechat/bind/verification", "", "", identity, GetWeChatBindingVerification)
			if scenario == "no phone" || scenario == "mfa cannot downgrade" {
				assert.Contains(t, status.Body.String(), `"sms_required":false`)
				denied := securityEnrollmentRequest("POST", "/api/oauth/wechat/bind/sms/send", `{"code":"wechat-code"}`, "", identity, SendWeChatBindingSMS)
				assert.Contains(t, denied.Body.String(), `"success":false`)
				assert.Zero(t, sends)
				return
			}
			assert.Contains(t, status.Body.String(), `"phone_masked":"138****8000"`)
			assert.NotContains(t, status.Body.String(), "13800138000")
			sent := securityEnrollmentRequest("POST", "/api/oauth/wechat/bind/sms/send", `{"code":"wechat-code"}`, "", identity, SendWeChatBindingSMS)
			var sentResult struct {
				Success bool `json:"success"`
				Data    struct {
					Token string `json:"sms_token"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(sent.Body.Bytes(), &sentResult))
			require.True(t, sentResult.Success, sent.Body.String())
			require.Len(t, smsCode, 6)
			limited := securityEnrollmentRequest("POST", "/api/oauth/wechat/bind/sms/send", `{"code":"wechat-code"}`, "", identity, SendWeChatBindingSMS)
			assert.Equal(t, 429, limited.Code)
			assert.Equal(t, 1, sends)
			// A password proof must not bypass SMS for a phone-bound account.
			operation, err := wechatBindingOperation("wechat-code")
			require.NoError(t, err)
			passwordProof := issueSecurityEnrollmentProof(t, identity, operation, service.VerificationMethodPassword)
			bypass := securityEnrollmentRequest("POST", "/api/oauth/wechat/bind", `{"code":"wechat-code"}`, passwordProof, identity, WeChatBind)
			assert.Contains(t, bypass.Body.String(), `"code":"SECURITY_PROOF_METHOD_MISMATCH"`)
			if scenario == "concurrent verification" {
				responses := make(chan *httptest.ResponseRecorder, 2)
				for range 2 {
					go func() {
						responses <- securityEnrollmentRequest("POST", "/api/oauth/wechat/bind/sms/verify", fmt.Sprintf(`{"code":"wechat-code","sms_token":%q,"sms_code":%q}`, sentResult.Data.Token, smsCode), "", identity, VerifyWeChatBindingSMS)
					}()
				}
				successes := 0
				for range 2 {
					if strings.Contains((<-responses).Body.String(), `"success":true`) {
						successes++
					}
				}
				assert.Equal(t, 1, successes, "a single SMS ceremony can issue at most one proof")
				return
			}
			if scenario == "revoked session" {
				_, err := model.RevokeUserSession(user.Id, identity.SessionID, "test")
				require.NoError(t, err)
			}
			verifyIdentity := identity
			verifyCode := "wechat-code"
			if scenario == "cross session" {
				bundle, err := service.CreateLoginSession(user.Id, "phone", "127.0.0.1", "second")
				require.NoError(t, err)
				verifyIdentity, err = service.ParseAccessToken(bundle.AccessToken)
				require.NoError(t, err)
			}
			if scenario == "cross context" {
				verifyCode = "different-code"
			}
			if scenario == "expired" {
				require.NoError(t, model.DB.Model(&model.AuthFlow{}).Where("purpose = ?", "wechat_binding_sms").Update("expires_at", time.Now().Add(-time.Minute)).Error)
			}
			if scenario == "wrong codes exhaust attempts" {
				for range 5 {
					wrong := securityEnrollmentRequest("POST", "/api/oauth/wechat/bind/sms/verify", fmt.Sprintf(`{"code":"wechat-code","sms_token":%q,"sms_code":"bad"}`, sentResult.Data.Token), "", identity, VerifyWeChatBindingSMS)
					assert.Contains(t, wrong.Body.String(), `"success":false`)
				}
			}
			verified := securityEnrollmentRequest("POST", "/api/oauth/wechat/bind/sms/verify", fmt.Sprintf(`{"code":%q,"sms_token":%q,"sms_code":%q}`, verifyCode, sentResult.Data.Token, smsCode), "", verifyIdentity, VerifyWeChatBindingSMS)
			if scenario == "wrong codes exhaust attempts" || scenario == "expired" || scenario == "cross session" || scenario == "cross context" || scenario == "revoked session" {
				assert.Contains(t, verified.Body.String(), `"success":false`)
				require.NoError(t, model.DB.First(user, user.Id).Error)
				assert.Empty(t, user.WeChatId)
				return
			}
			var proof struct {
				Success bool                  `json:"success"`
				Data    service.SecurityProof `json:"data"`
			}
			require.NoError(t, common.Unmarshal(verified.Body.Bytes(), &proof))
			require.True(t, proof.Success, verified.Body.String())
			replay := securityEnrollmentRequest("POST", "/api/oauth/wechat/bind/sms/verify", fmt.Sprintf(`{"code":"wechat-code","sms_token":%q,"sms_code":%q}`, sentResult.Data.Token, smsCode), "", identity, VerifyWeChatBindingSMS)
			assert.Contains(t, replay.Body.String(), `"success":false`)
			if scenario == "phone changed before proof use" {
				require.NoError(t, model.DB.Model(&model.ExternalIdentityClaim{}).Where("user_id = ?", user.Id).Update("subject", "13900139000").Error)
			}
			if scenario == "openid owned" {
				require.NoError(t, model.DB.Create(&model.User{Username: "openid-owner", AffCode: "openid-owner", WeChatId: "sms-bind-openid", Status: common.UserStatusEnabled, AuthVersion: 1}).Error)
			}
			bound := securityEnrollmentRequest("POST", "/api/oauth/wechat/bind", `{"code":"wechat-code"}`, proof.Data.ProofToken, identity, WeChatBind)
			require.NoError(t, model.DB.First(user, user.Id).Error)
			if scenario == "phone changed before proof use" || scenario == "openid owned" {
				assert.NotEqual(t, 500, bound.Code)
				assert.Contains(t, bound.Body.String(), `"success":false`)
				assert.Empty(t, user.WeChatId)
			} else {
				assert.Contains(t, bound.Body.String(), `"success":true`, bound.Body.String())
				assert.Equal(t, "sms-bind-openid", user.WeChatId)
				reused := securityEnrollmentRequest("POST", "/api/oauth/wechat/bind", `{"code":"wechat-code"}`, proof.Data.ProofToken, identity, WeChatBind)
				assert.Contains(t, reused.Body.String(), `"success":false`)
			}
		})
	}
}

// Both providers converge here after independently authenticating the OpenID.
func TestWeChatOfficialSharedLoginRegistrationPolicy(t *testing.T) {
	for _, scenario := range []string{"existing", "registration-disabled", "banned", "invited-new-user"} {
		t.Run(scenario, func(t *testing.T) {
			user, _ := setupSecurityEnrollmentTest(t)
			previousRegister, previousSecure, previousTrusted := common.RegisterEnabled, common.SessionCookieSecure, common.SessionCookieTrustedURLs
			common.RegisterEnabled, common.SessionCookieSecure = false, true
			common.SessionCookieTrustedURLs = []string{"https://site.example"}
			t.Cleanup(func() {
				common.RegisterEnabled, common.SessionCookieSecure, common.SessionCookieTrustedURLs = previousRegister, previousSecure, previousTrusted
			})
			for key, value := range map[string]string{"ServerAddress": "https://site.example", "wechat_official.enabled": "true", "wechat_official.app_id": "wx0123456789abcdef", "wechat_official.app_secret": "test-secret", "wechat_official.pinned_app_id": "wx0123456789abcdef", "wechat_official.revision": "login-test"} {
				require.NoError(t, model.DB.Create(&model.Option{Key: key, Value: value}).Error)
			}
			cfg, err := model.RequireWeChatOfficialConfig(model.DB, "")
			require.NoError(t, err)
			if scenario == "existing" || scenario == "banned" {
				updates := map[string]interface{}{"wechat_id": "shared-login-openid", "display_name": "custom display", "avatar_url": "https://custom.example/avatar", "avatar_source": "custom"}
				if scenario == "banned" {
					updates["status"] = common.UserStatusDisabled
				}
				require.NoError(t, model.DB.Model(user).Updates(updates).Error)
			}
			affiliate := ""
			if scenario == "invited-new-user" {
				common.RegisterEnabled = true
				affiliate = "inviter-code"
				require.NoError(t, model.DB.Model(user).Update("aff_code", affiliate).Error)
			}
			fingerprints := []string{cfg.Fingerprint}
			if scenario == "existing" {
				fingerprints = []string{"", cfg.Fingerprint}
			}
			for _, fingerprint := range fingerprints {
				response := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(response)
				c.Request = httptest.NewRequest(http.MethodPost, "https://site.example/api/oauth/wechat_official/flows/complete", nil)
				completeWeChatLogin(c, wechatIdentity{OpenID: "shared-login-openid", Profile: wechatProfile{Nickname: "provider nickname", AvatarURL: "https://provider.example/avatar"}}, "owner-browser", affiliate, fingerprint)
				var result struct {
					Success bool `json:"success"`
					Data    struct {
						RequirePhoneBinding bool   `json:"require_phone_binding"`
						BindToken           string `json:"bind_token"`
					} `json:"data"`
				}
				require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
				if scenario == "registration-disabled" || scenario == "banned" {
					require.False(t, result.Success, response.Body.String())
					var count int64
					require.NoError(t, model.DB.Model(&model.AuthFlow{}).Where("purpose = ?", service.WeChatPhonePurpose).Count(&count).Error)
					assert.Zero(t, count)
					continue
				}
				require.True(t, result.Success, response.Body.String())
				require.True(t, result.Data.RequirePhoneBinding)
				require.NotEmpty(t, result.Data.BindToken)
				flow, err := service.RequireWeChatPhoneFlow(result.Data.BindToken, "owner-browser")
				require.NoError(t, err)
				var account model.User
				require.NoError(t, model.DB.First(&account, flow.UserId).Error)
				if scenario == "existing" {
					assert.Equal(t, user.Id, account.Id)
					assert.Equal(t, "custom display", account.DisplayName)
					assert.Equal(t, "https://custom.example/avatar", account.AvatarURL)
				} else {
					assert.Equal(t, user.Id, account.InviterId)
					assert.Equal(t, "provider nickname", account.DisplayName)
					assert.LessOrEqual(t, len(account.Username), 20)
				}
				var payload map[string]interface{}
				require.NoError(t, common.UnmarshalJsonStr(flow.Payload, &payload))
				if fingerprint != "" {
					assert.Contains(t, flow.Payload, fingerprint)
				}
				assert.NotContains(t, response.Body.String(), "access_token")
			}
			var count int64
			require.NoError(t, model.DB.Model(&model.User{}).Count(&count).Error)
			expected := int64(1)
			if scenario == "invited-new-user" {
				expected = 2
			}
			assert.Equal(t, expected, count)
		})
	}
}
