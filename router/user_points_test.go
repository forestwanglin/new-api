package router

import (
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestUserPointBalancesAPI(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.PointType{}, &model.PointAccount{}, &model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}, &model.Option{}))
	oldDB, oldLogDB, oldType, oldRedis, oldSecret := model.DB, model.LOG_DB, common.MainDatabaseType(), common.RedisEnabled, common.SessionSecret
	model.DB, model.LOG_DB = db, db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	common.SessionSecret = "user-points-test-secret"
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.SetMainDatabaseType(oldType)
		common.RedisEnabled, common.SessionSecret = oldRedis, oldSecret
		require.NoError(t, sqlDB.Close())
	})
	users := []model.User{
		{Id: 1, Username: "points-admin", DisplayName: "Admin", Password: "private-password", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "admin-points", Quota: 12000},
		{Id: 2, Username: "points-user", DisplayName: "User", Password: "private-password", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "user-points", Quota: 100},
		{Id: 3, Username: "points-empty", DisplayName: "Empty", Password: "private-password", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "other", AuthVersion: 1, AffCode: "empty-points"},
	}
	require.NoError(t, db.Create(&users).Error)
	admin, err := service.CreateLoginSession(users[0].Id, "password", "127.0.0.1", "user-points-test")
	require.NoError(t, err)
	ordinary, err := service.CreateLoginSession(users[1].Id, "password", "127.0.0.1", "user-points-test")
	require.NoError(t, err)
	pat := model.AccessTokenPrefix + strings.Repeat("u", 43)
	accessToken := &model.UserAccessToken{Name: "user points read", TokenHash: model.AccessTokenFingerprint(pat), TokenHint: model.AccessTokenHint(pat)}
	require.NoError(t, accessToken.SetScopes([]string{"user:read"}))
	require.NoError(t, model.CreateUserAccessToken(users[0].Id, accessToken, service.AccessTokenMaxPerUser))
	types := []model.PointType{{Code: "DS", Name: "DeepSeek points"}, {Code: "GPT", Name: "GPT points"}, {Code: "GENERAL", Name: "General points"}, {Code: "ZERO", Name: "Zero points"}}
	require.NoError(t, db.Create(&types).Error)
	accounts := []model.PointAccount{
		{UserId: 1, PointTypeId: types[0].Id, AvailablePoints: 1},
		{UserId: 1, PointTypeId: types[1].Id, AvailablePoints: math.MaxInt64},
		{UserId: 1, PointTypeId: types[2].Id, AvailablePoints: 9007199254740993, FrozenPoints: 2000},
		{UserId: 1, PointTypeId: types[3].Id},
		{UserId: 2, PointTypeId: types[1].Id, FrozenPoints: 500},
	}
	require.NoError(t, db.Create(&accounts).Error)
	engine := gin.New()
	SetApiRouter(engine)
	request := func(t *testing.T, path, token string, status int) pointAdminResponse {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, req)
		require.Equal(t, status, recorder.Code, recorder.Body.String())
		var response pointAdminResponse
		if status == http.StatusOK {
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			assert.NotContains(t, recorder.Body.String(), "private-password")
			assert.NotContains(t, recorder.Body.String(), "token_hash")
		}
		return response
	}
	for _, path := range []string{"/api/user/", "/api/user/search?keyword=points"} {
		request(t, path, "", http.StatusUnauthorized)
		request(t, path, ordinary.AccessToken, http.StatusForbidden)
	}
	for _, token := range []string{admin.AccessToken, pat} {
		for _, path := range []string{"/api/user/?p=1&page_size=1&sort_by=id&sort_order=asc", "/api/user/search?keyword=points&p=1&page_size=1&sort_by=id&sort_order=asc"} {
			response := request(t, path, token, http.StatusOK)
			require.True(t, response.Success, response.Message)
			var page struct {
				Total int `json:"total"`
				Items []struct {
					ID            int                 `json:"id"`
					Quota         int                 `json:"quota"`
					PointBalances []map[string]string `json:"point_balances"`
				} `json:"items"`
			}
			require.NoError(t, common.Unmarshal(response.Data, &page))
			assert.Equal(t, 3, page.Total)
			require.Len(t, page.Items, 1)
			assert.Equal(t, 1, page.Items[0].ID)
			assert.Equal(t, 12000, page.Items[0].Quota)
			assert.Equal(t, []map[string]string{
				{"code": "GENERAL", "name": "General points", "available_points": "9007199254740993", "frozen_points": "2000"},
				{"code": "GPT", "name": "GPT points", "available_points": "9223372036854775807", "frozen_points": "0"},
				{"code": "DS", "name": "DeepSeek points", "available_points": "1", "frozen_points": "0"},
			}, page.Items[0].PointBalances)
		}
	}
	t.Run("filtered frozen-only and empty holdings", func(t *testing.T) {
		for _, test := range []struct {
			id       int
			balances string
		}{
			{2, `[{"code":"GPT","name":"GPT points","available_points":"0","frozen_points":"500"}]`},
			{3, `[]`},
		} {
			response := request(t, fmt.Sprintf("/api/user/search?keyword=%d&role=1&status=1", test.id), admin.AccessToken, 200)
			require.True(t, response.Success, response.Message)
			var page struct {
				Total int `json:"total"`
				Items []struct {
					ID            int               `json:"id"`
					PointBalances common.RawMessage `json:"point_balances"`
				} `json:"items"`
			}
			require.NoError(t, common.Unmarshal(response.Data, &page))
			assert.Equal(t, 1, page.Total)
			require.Len(t, page.Items, 1)
			assert.Equal(t, test.id, page.Items[0].ID)
			assert.JSONEq(t, test.balances, string(page.Items[0].PointBalances))
		}
	})
	t.Run("empty page and errors", func(t *testing.T) {
		for _, path := range []string{"/api/user/?p=20&page_size=10", "/api/user/search?keyword=missing"} {
			response := request(t, path, admin.AccessToken, 200)
			require.True(t, response.Success, response.Message)
			var page struct {
				Items common.RawMessage `json:"items"`
			}
			require.NoError(t, common.Unmarshal(response.Data, &page))
			assert.JSONEq(t, `[]`, string(page.Items))
		}
		require.NoError(t, db.Migrator().DropTable(&model.PointAccount{}))
		for _, path := range []string{"/api/user/", "/api/user/search?keyword=points"} {
			response := request(t, path, admin.AccessToken, 200)
			assert.False(t, response.Success)
			assert.NotContains(t, response.Message, "point_accounts")
		}
	})
}
