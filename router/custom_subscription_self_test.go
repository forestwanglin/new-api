package router

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestCustomSubscriptionSelf(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.CustomUserSubscription{}, &model.CustomUserSubscriptionState{}, &model.CustomSubscriptionEvent{}, &model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}, &model.Option{}))
	oldDB, oldLogDB, oldType, oldRedis, oldSecret := model.DB, model.LOG_DB, common.MainDatabaseType(), common.RedisEnabled, common.SessionSecret
	model.DB, model.LOG_DB = db, db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.RedisEnabled, common.SessionSecret = false, "custom-subscription-self-test"
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.SetMainDatabaseType(oldType)
		common.RedisEnabled, common.SessionSecret = oldRedis, oldSecret
		require.NoError(t, sqlDB.Close())
	})
	user := model.User{Id: 1, Username: "custom-self", Password: "placeholder", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "custom-self"}
	require.NoError(t, db.Create(&user).Error)
	bundle, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "custom-self-test")
	require.NoError(t, err)
	pat := model.AccessTokenPrefix + strings.Repeat("s", 43)
	access := &model.UserAccessToken{Name: "custom self PAT", TokenHash: model.AccessTokenFingerprint(pat), TokenHint: model.AccessTokenHint(pat)}
	require.NoError(t, access.SetScopes([]string{"wallet:read"}))
	require.NoError(t, model.CreateUserAccessToken(user.Id, access, service.AccessTokenMaxPerUser))
	engine := gin.New()
	SetApiRouter(engine)
	read := func(path, token string, status int) pointAdminResponse {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, req)
		require.Equal(t, status, w.Code, w.Body.String())
		var response pointAdminResponse
		if status == http.StatusOK {
			require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
		}
		return response
	}
	const path = "/api/custom_subscription/self"
	read(path, "", http.StatusUnauthorized)
	read(path, pat, http.StatusForbidden)
	assert.False(t, read(path+"?user_id=2", bundle.AccessToken, http.StatusOK).Success)
	empty := read(path, bundle.AccessToken, http.StatusOK)
	require.True(t, empty.Success, empty.Message)
	var data struct {
		ActiveSubscriptionID *string          `json:"active_subscription_id"`
		ObservedAt           string           `json:"observed_at"`
		Items                []map[string]any `json:"items"`
	}
	require.NoError(t, common.Unmarshal(empty.Data, &data))
	assert.Nil(t, data.ActiveSubscriptionID)
	assert.Equal(t, []map[string]any{}, data.Items)
	assert.NotEmpty(t, data.ObservedAt)

	// A delayed request must activate B at A's real expiry, not at request time.
	now := time.Now().UnixMilli()
	start, end := now-2000, now-1000
	active := model.CustomUserSubscription{Id: 9007199254740993, UserId: 1, OrderId: 1, PlanId: 9007199254740995, PlanVersion: 1, Priority: 2, BillingCycle: "month", DurationMonths: 1, TotalDurationMs: 1000, RemainingDurationMs: 1000, Status: "active", PurchasedAt: start, FirstActivatedAt: &start, ActiveSinceAt: &start, ActiveUntilAt: &end, PlanSnapshot: `{"provider_secret":"never-return"}`}
	queued := model.CustomUserSubscription{Id: 9007199254740994, UserId: 1, OrderId: 2, PlanId: 9007199254740996, PlanVersion: 1, Priority: 1, BillingCycle: "month", DurationMonths: 1, TotalDurationMs: 2592000000, RemainingDurationMs: 2592000000, Status: "paused", PurchasedAt: start + 1, PlanSnapshot: `{"Title":"Purchased plan","provider_secret":"never-return"}`}
	other := model.CustomUserSubscription{Id: 9007199254740997, UserId: 2, OrderId: 3, PlanId: 3, PlanVersion: 1, Priority: 99, TotalDurationMs: 1000, RemainingDurationMs: 1000, Status: "paused", PurchasedAt: start}
	require.NoError(t, db.Create(&[]model.CustomUserSubscription{active, queued, other}).Error)
	require.NoError(t, db.Model(&model.CustomUserSubscriptionState{}).Where("user_id = ?", 1).Updates(map[string]any{"active_subscription_id": active.Id, "reconciled_at": start}).Error)
	response := read(path, bundle.AccessToken, http.StatusOK)
	require.True(t, response.Success, response.Message)
	require.NoError(t, common.Unmarshal(response.Data, &data))
	require.NotNil(t, data.ActiveSubscriptionID)
	assert.Equal(t, "9007199254740994", *data.ActiveSubscriptionID)
	require.Len(t, data.Items, 2)
	assert.NotContains(t, string(response.Data), "never-return")
	assert.NotContains(t, string(response.Data), "plan_snapshot")
	assert.NotContains(t, string(response.Data), "9007199254740997")
	for _, item := range data.Items {
		assert.IsType(t, "", item["id"])
		assert.IsType(t, "", item["plan_id"])
		assert.IsType(t, "", item["remaining_duration_ms"])
		if item["id"] == "9007199254740994" {
			assert.Equal(t, "Purchased plan", item["plan_title"])
		}
	}
	var restored model.CustomUserSubscription
	require.NoError(t, db.First(&restored, queued.Id).Error)
	require.NotNil(t, restored.ActiveSinceAt)
	assert.Equal(t, end, *restored.ActiveSinceAt)
	assert.Equal(t, "active", restored.Status)

	t.Run("subscription orders require a browser session and reject owner filters", func(t *testing.T) {
		const ordersPath = "/api/custom_subscription/orders"
		read(ordersPath, "", http.StatusUnauthorized)
		read(ordersPath, pat, http.StatusForbidden)
		require.NoError(t, db.AutoMigrate(&model.CustomSubscriptionOrder{}))
		orders := []model.CustomSubscriptionOrder{
			{Id: 1, UserId: 1, TradeNo: "first", PlanId: 1, PlanVersion: 1, PlanSnapshot: `{"Title":"Original title","private":"never-return"}`, Status: "success", CreatedAt: 1000, PaidPoints: 9007199254740993, AmountPaidMinor: 2900},
			{Id: 2, UserId: 1, TradeNo: "second", PlanId: 2, Status: "pending", CreatedAt: 2000},
			{Id: 3, UserId: 2, TradeNo: "not-owned", CreatedAt: 3000},
		}
		require.NoError(t, db.Create(&orders).Error)
		for _, query := range []string{"user_id=2", "p=0", "p=-1", "p=1&p=2", "p=", "page_size=101", "page_size=0", "page_size=", "p=9223372036854775807&page_size=100", "unknown=1", "bad=%ZZ", "p=1&bad=%ZZ", "bad=1;ignored=2"} {
			assert.False(t, read(ordersPath+"?"+query, bundle.AccessToken, http.StatusOK).Success, query)
		}
		response := read(ordersPath+"?page_size=1", bundle.AccessToken, http.StatusOK)
		require.True(t, response.Success, response.Message)
		var page model.CustomSubscriptionOrderPage
		require.NoError(t, common.Unmarshal(response.Data, &page))
		assert.EqualValues(t, 2, page.Total)
		require.Len(t, page.Items, 1)
		assert.Equal(t, "second", page.Items[0].TradeNo)
		assert.NotContains(t, string(response.Data), "not-owned")
		response = read(ordersPath+"?p=2&page_size=1", bundle.AccessToken, http.StatusOK)
		require.True(t, response.Success, response.Message)
		assert.Contains(t, string(response.Data), `"plan_title":"Original title"`)
		assert.Contains(t, string(response.Data), `"paid_points":"9007199254740993"`)
		assert.NotContains(t, string(response.Data), "never-return")
		require.NoError(t, db.Migrator().DropTable(&model.CustomSubscriptionOrder{}))
		assert.False(t, read(ordersPath, bundle.AccessToken, http.StatusOK).Success)
	})
	require.NoError(t, db.Migrator().DropTable(&model.CustomUserSubscription{}))
	assert.False(t, read(path, bundle.AccessToken, http.StatusOK).Success)
}
