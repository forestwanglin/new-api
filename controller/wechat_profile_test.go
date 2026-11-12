package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

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
			response := securityEnrollmentRequest("GET", "/api/oauth/wechat?code=login-code", "", "", service.AuthIdentity{}, WeChatAuth)
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
