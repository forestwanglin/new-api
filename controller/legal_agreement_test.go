package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestStatusLegalAgreementsEnabled(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Option{}))
	oldDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = oldDB; sqlDB, _ := db.DB(); _ = sqlDB.Close() })
	settings := system_setting.GetLegalSettings()
	old := *settings
	t.Cleanup(func() { *settings = old })
	for _, tc := range []struct {
		name, user, subscription         string
		userEnabled, subscriptionEnabled bool
	}{
		{name: "empty"},
		{name: "whitespace", user: " \n\t", subscription: " \t "},
		{name: "user only", user: "# User", userEnabled: true},
		{name: "subscription only", subscription: "# Subscription", subscriptionEnabled: true},
		{name: "both", user: "# User", subscription: "# Subscription", userEnabled: true, subscriptionEnabled: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			settings.UserAgreement = tc.user
			settings.SubscriptionAgreement = tc.subscription
			rec := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(rec)
			ctx.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)
			GetStatus(ctx)
			var payload struct {
				Success bool
				Data    map[string]any
			}
			require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &payload))
			require.True(t, payload.Success)
			require.Equal(t, tc.userEnabled, payload.Data["user_agreement_enabled"])
			require.Equal(t, tc.subscriptionEnabled, payload.Data["subscription_agreement_enabled"])
		})
	}
}

func TestSubscriptionAgreementPublicReadRevalidatesAfterEdit(t *testing.T) {
	settings := system_setting.GetLegalSettings()
	old := settings.SubscriptionAgreement
	t.Cleanup(func() { settings.SubscriptionAgreement = old })
	settings.SubscriptionAgreement = "# Personal subscription\n\nService terms"
	router := gin.New()
	router.GET("/api/subscription-agreement", GetSubscriptionAgreement)
	first := httptest.NewRecorder()
	router.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/api/subscription-agreement", nil))
	require.Equal(t, http.StatusOK, first.Code)
	var payload struct {
		Success bool
		Data    string
	}
	require.NoError(t, common.Unmarshal(first.Body.Bytes(), &payload))
	require.True(t, payload.Success)
	require.Equal(t, settings.SubscriptionAgreement, payload.Data)
	require.Equal(t, "no-cache", first.Header().Get("Cache-Control"))
	etag := first.Header().Get("ETag")
	require.NotEmpty(t, etag)
	request := httptest.NewRequest(http.MethodGet, "/api/subscription-agreement", nil)
	request.Header.Set("If-None-Match", etag)
	second := httptest.NewRecorder()
	router.ServeHTTP(second, request)
	require.Equal(t, http.StatusNotModified, second.Code)
	settings.SubscriptionAgreement = "# Updated terms"
	third := httptest.NewRecorder()
	router.ServeHTTP(third, request)
	require.Equal(t, http.StatusOK, third.Code)
	require.NotEqual(t, etag, third.Header().Get("ETag"))
}
