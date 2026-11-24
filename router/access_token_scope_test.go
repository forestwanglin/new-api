package router

import (
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// accessTokenExemptRoutes are /api routes that never reach dashboard
// authentication, so a personal access token has no rule to satisfy there.
var accessTokenExemptRoutes = []string{
	"GET /api/oauth/wechat_official/browser",
	"GET /api/oauth/wechat_official/start",
	"GET /api/oauth/wechat_official/callback",
	"GET /api/oauth/wechat_official/confirmation",
	"POST /api/oauth/wechat_official/confirm",

	// Anonymous pages and setup.
	"GET /api/setup",
	"POST /api/setup",
	"GET /api/status",
	"GET /api/uptime/status",
	"GET /api/notice",
	"GET /api/user-agreement",
	"GET /api/subscription-agreement",
	"GET /api/privacy-policy",
	"GET /api/about",
	"GET /api/home_page_content",
	"GET /api/ratio_config",
	"GET /api/user/groups",

	// Anonymous account entry points.
	"GET /api/verification",
	"GET /api/reset_password",
	"POST /api/user/reset",
	"POST /api/user/register",
	"GET /api/user/login/encryption-key",
	"POST /api/user/login",
	"POST /api/user/login/2fa",
	"POST /api/user/login/verify",
	"POST /api/user/login/passkey/begin",
	"POST /api/user/login/passkey/finish",
	"POST /api/user/passkey/login/begin",
	"POST /api/user/passkey/login/finish",
	"GET /api/oauth/wechat",
	"GET /api/oauth/telegram/login",
	"GET /api/oauth/telegram/bind/:flow_token",

	// Browser session cookie endpoints.
	"POST /api/user/auth/refresh",
	"POST /api/user/auth/logout",

	// Payment callbacks.
	"POST /api/stripe/webhook",
	"POST /api/creem/webhook",
	"POST /api/waffo/webhook",
	"POST /api/waffo-pancake/webhook/:env",
	"GET /api/user/epay/notify",
	"POST /api/user/epay/notify",
	"GET /api/subscription/epay/notify",
	"POST /api/subscription/epay/notify",
	"GET /api/subscription/epay/return",
	"POST /api/subscription/epay/return",

	// API key authentication (TokenAuthReadOnly).
	"GET /api/usage/token/",
	"GET /api/log/token",
}

// accessTokenHelperRoutes are declared through handlePermissionRoute outside
// channelPermissionRoutes.
var accessTokenHelperRoutes = map[string]authz.Permission{
	"GET /api/task_plugin_options": authz.TaskPluginBind,
	"GET /api/audit":               authz.AuditRead,
}

func newAccessTokenScopeTestEngine(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	// A permission route that is also in the static table panics here.
	require.NotPanics(t, func() {
		SetApiRouter(engine)
		SetDashboardRouter(engine)
		SetRelayRouter(engine)
		SetTaskPluginProtocolRouter(engine)
		SetVideoRouter(engine)
		SetTaskRouter(engine)
	})
	return engine
}

func TestAccessTokenRouteRulesCoverEveryDashboardRoute(t *testing.T) {
	engine := newAccessTokenScopeTestEngine(t)
	exempt := map[string]bool{}
	for _, key := range accessTokenExemptRoutes {
		exempt[key] = true
	}
	registered := map[string]bool{}
	panel := map[string]bool{}
	for _, route := range engine.Routes() {
		if !strings.HasPrefix(route.Path, "/api/") && !strings.HasPrefix(route.Path, "/pg/") {
			continue
		}
		key := route.Method + " " + route.Path
		registered[key] = true
		if !exempt[key] {
			panel[key] = true
		}
	}
	for _, key := range accessTokenExemptRoutes {
		assert.True(t, registered[key], "exempt route %s is no longer registered", key)
	}

	declared := map[string]int{}
	for _, key := range middleware.AccessTokenRouteRuleKeys() {
		declared[key]++
	}
	for key := range panel {
		assert.Equal(t, 1, declared[key], "panel route %s must be declared exactly once", key)
	}
	for key := range declared {
		assert.True(t, panel[key], "declared route %s is not a registered panel route", key)
	}

	permissionRoutes := map[string]authz.Permission{}
	for _, route := range channelPermissionRoutes {
		permissionRoutes[route.method+" "+joinPaths("/api/channel", route.path)] = route.permission
	}
	for key, permission := range accessTokenHelperRoutes {
		permissionRoutes[key] = permission
	}
	for key, permission := range permissionRoutes {
		rule, ok := middleware.AccessTokenRouteRule(key)
		require.True(t, ok, key)
		assert.Equal(t, "scope", rule.Kind(), key)
		assert.Equal(t, service.AccessTokenScopeOf(permission), rule.Scope(), key)
	}
}

func TestAccessTokenCatalogCoversEveryPermission(t *testing.T) {
	catalog := service.AccessTokenCatalog(1, common.RoleRootUser)
	scopes := map[string]bool{}
	resources := map[string]int{}
	for _, group := range catalog {
		for _, resource := range group.Resources {
			resources[resource.Resource]++
			for _, action := range resource.Actions {
				scopes[resource.Resource+":"+action.Action] = true
			}
		}
	}
	for _, permission := range authz.AllPermissions() {
		assert.True(t, scopes[service.AccessTokenScopeOf(permission)], "root catalog lacks %s", service.AccessTokenScopeOf(permission))
	}
	for resource, count := range resources {
		assert.Equal(t, 1, count, "resource %s appears in more than one catalog entry", resource)
	}
}

func TestAccessTokenVerificationScopesAreAllListed(t *testing.T) {
	files, err := filepath.Glob("../service/*.go")
	require.NoError(t, err)
	fileSet := token.NewFileSet()
	var scopes []string
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		parsed, err := parser.ParseFile(fileSet, file, nil, 0)
		require.NoError(t, err)
		for _, declaration := range parsed.Decls {
			general, ok := declaration.(*ast.GenDecl)
			if !ok || general.Tok != token.CONST {
				continue
			}
			for _, spec := range general.Specs {
				value := spec.(*ast.ValueSpec)
				for i, name := range value.Names {
					if !strings.HasPrefix(name.Name, "VerificationScope") || i >= len(value.Values) {
						continue
					}
					literal, ok := value.Values[i].(*ast.BasicLit)
					require.True(t, ok, name.Name)
					scope, err := strconv.Unquote(literal.Value)
					require.NoError(t, err)
					scopes = append(scopes, scope)
				}
			}
		}
	}
	require.NotEmpty(t, scopes)
	for _, scope := range scopes {
		_, listed := service.AccessTokenVerificationScope(scope)
		assert.True(t, listed, "verification scope %s has no access token rule", scope)
	}
}

func TestWeChatOfficialPollingPreservesCriticalRateBudget(t *testing.T) {
	previousCritical, previousGlobal, previousRedis, previousSecure := common.CriticalRateLimitEnable, common.GlobalApiRateLimitEnable, common.RedisEnabled, common.SessionCookieSecure
	common.CriticalRateLimitEnable = true
	common.GlobalApiRateLimitEnable = false
	common.RedisEnabled = false
	common.SessionCookieSecure = false
	t.Cleanup(func() {
		common.CriticalRateLimitEnable = previousCritical
		common.GlobalApiRateLimitEnable = previousGlobal
		common.RedisEnabled = previousRedis
		common.SessionCookieSecure = previousSecure
	})
	engine := newAccessTokenScopeTestEngine(t)
	// A full QR lifetime's reads cannot spend the shared login/SMS critical quota.
	for range 151 {
		r := httptest.NewRequest(http.MethodPost, "/api/oauth/wechat_official/flows/status", strings.NewReader(`{}`))
		r.RemoteAddr = "192.0.2.188:1234"
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, r)
		require.NotEqual(t, http.StatusTooManyRequests, w.Code)
	}
	r := httptest.NewRequest(http.MethodPost, "/api/oauth/wechat", strings.NewReader(`{}`))
	r.RemoteAddr = "192.0.2.188:1234"
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, r)
	require.NotEqual(t, http.StatusTooManyRequests, w.Code)
}

func TestWeChatOfficialRoutesHaveExplicitCredentialPolicy(t *testing.T) {
	engine := newAccessTokenScopeTestEngine(t)
	expected := map[string]string{
		"GET /api/oauth/wechat_official/browser":           "public",
		"GET /api/oauth/wechat_official/start":             "public",
		"GET /api/oauth/wechat_official/callback":          "public",
		"GET /api/oauth/wechat_official/confirmation":      "public",
		"POST /api/oauth/wechat_official/confirm":          "public",
		"POST /api/oauth/wechat_official/flows":            "session",
		"POST /api/oauth/wechat_official/flows/status":     "session",
		"POST /api/oauth/wechat_official/flows/cancel":     "session",
		"POST /api/oauth/wechat_official/flows/resume":     "session",
		"POST /api/oauth/wechat_official/flows/complete":   "session",
		"GET /api/oauth/wechat_official/bind/verification": "session",
		"POST /api/oauth/wechat_official/bind/sms/send":    "session",
		"POST /api/oauth/wechat_official/bind/sms/verify":  "session",
		"POST /api/oauth/wechat_official/bind":             "session",
	}
	count := 0
	for _, route := range engine.Routes() {
		if !strings.HasPrefix(route.Path, "/api/oauth/wechat_official/") {
			continue
		}
		key := route.Method + " " + route.Path
		kind, exists := expected[key]
		require.True(t, exists, "unclassified official route %s", key)
		count++
		rule, declared := middleware.AccessTokenRouteRule(key)
		if kind == "public" {
			assert.False(t, declared, key)
		} else {
			require.True(t, declared, key)
			assert.Equal(t, "session", rule.Kind(), key)
			assert.Empty(t, rule.Scope(), "official ceremonies cannot become PAT catalog grants: %s", key)
		}
	}
	assert.Equal(t, len(expected), count)
}

func TestWeChatOfficialMutationsRejectForeignOriginAndDisableCache(t *testing.T) {
	previousSecure, previousTrusted := common.SessionCookieSecure, common.SessionCookieTrustedURLs
	previousCritical, previousGlobal := common.CriticalRateLimitEnable, common.GlobalApiRateLimitEnable
	common.SessionCookieSecure = true
	common.SessionCookieTrustedURLs = []string{"https://site.example"}
	common.CriticalRateLimitEnable, common.GlobalApiRateLimitEnable = false, false
	t.Cleanup(func() {
		common.SessionCookieSecure, common.SessionCookieTrustedURLs = previousSecure, previousTrusted
		common.CriticalRateLimitEnable, common.GlobalApiRateLimitEnable = previousCritical, previousGlobal
	})
	engine := newAccessTokenScopeTestEngine(t)
	for _, path := range []string{"/confirm", "/flows", "/flows/status", "/flows/cancel", "/flows/resume", "/flows/complete", "/bind/sms/send", "/bind/sms/verify", "/bind"} {
		t.Run(path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "https://site.example/api/oauth/wechat_official"+path, strings.NewReader(`{}`))
			request.Header.Set("Origin", "https://foreign.example")
			response := httptest.NewRecorder()
			engine.ServeHTTP(response, request)
			assert.Equal(t, http.StatusForbidden, response.Code)
			assert.Contains(t, response.Body.String(), "AUTH_ORIGIN_FORBIDDEN")
			assert.Contains(t, response.Header().Get("Cache-Control"), "no-store")
		})
	}
}
