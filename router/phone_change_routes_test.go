package router

import (
	"github.com/QuantumNous/new-api/middleware"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestPhoneChangeRoutesRequireBrowserSession(t *testing.T) {
	engine := newAccessTokenScopeTestEngine(t)
	registered := make(map[string]bool)
	for _, route := range engine.Routes() {
		registered[route.Method+" "+route.Path] = true
	}
	for _, key := range []string{"GET /api/user/phone/change/status", "POST /api/user/phone/change/send", "POST /api/user/phone/change/verify", "POST /api/user/phone/change/complete"} {
		t.Run(key, func(t *testing.T) {
			require.True(t, registered[key])
			rule, exists := middleware.AccessTokenRouteRule(key)
			require.True(t, exists)
			require.Equal(t, "session", rule.Kind())
		})
	}
}
