package router

import (
	"fmt"
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

func TestAdminUserPointsAPI(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.PointType{}, &model.PointAccount{}, &model.PointTransaction{}, &model.PointLedger{}, &model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}, &model.Option{}))
	oldDB, oldLogDB, oldType, oldRedis, oldSecret := model.DB, model.LOG_DB, common.MainDatabaseType(), common.RedisEnabled, common.SessionSecret
	model.DB, model.LOG_DB = db, db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	common.SessionSecret = "admin-user-points-test-secret"
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.SetMainDatabaseType(oldType)
		common.RedisEnabled, common.SessionSecret = oldRedis, oldSecret
		require.NoError(t, sqlDB.Close())
	})
	users := map[int]model.User{}
	tokens := map[int]string{}
	var adminPAT string
	for _, role := range []int{common.RoleCommonUser, common.RoleAdminUser, common.RoleRootUser} {
		user := model.User{Username: fmt.Sprint("point-adjust-", role), Password: "placeholder", Role: role, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: fmt.Sprint("points-", role)}
		require.NoError(t, db.Create(&user).Error)
		users[role] = user
		bundle, e := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "point-adjust-test")
		require.NoError(t, e)
		tokens[role] = bundle.AccessToken
		if role == common.RoleAdminUser {
			adminPAT = model.AccessTokenPrefix + strings.Repeat("q", 43)
			token := &model.UserAccessToken{Name: "points test", TokenHash: model.AccessTokenFingerprint(adminPAT), TokenHint: model.AccessTokenHint(adminPAT)}
			require.NoError(t, token.SetScopes([]string{"user:read", "user:write"}))
			require.NoError(t, model.CreateUserAccessToken(user.Id, token, service.AccessTokenMaxPerUser))
		}
	}
	typ := model.PointType{Code: "FUTURE", Name: "Future points", ConsumePriority: 500}
	require.NoError(t, db.Create(&typ).Error)
	engine := gin.New()
	SetApiRouter(engine)
	request := func(method, path, body, token string, status int) pointAdminResponse {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		engine.ServeHTTP(rec, req)
		require.Equal(t, status, rec.Code, rec.Body.String())
		var result pointAdminResponse
		if status == 200 {
			require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &result))
		}
		return result
	}
	path := fmt.Sprintf("/api/user/%d/points", users[common.RoleCommonUser].Id)
	body := fmt.Sprintf(`{"point_type_id":"%d","mode":"add","amount":"9007199254740993","request_id":"request-1"}`, typ.Id)
	for _, method := range []string{"GET", "POST"} {
		request(method, path, body, "", http.StatusUnauthorized)
		request(method, path, body, tokens[common.RoleCommonUser], http.StatusForbidden)
		request(method, path, body, adminPAT, http.StatusForbidden)
	}
	result := request("GET", path, "", tokens[common.RoleAdminUser], 200)
	require.True(t, result.Success)
	var balances model.UserPointBalances
	require.NoError(t, common.Unmarshal(result.Data, &balances))
	require.Len(t, balances.Balances, 1)
	assert.Equal(t, "0", balances.Balances[0].AvailablePoints)
	var count int64
	require.NoError(t, db.Model(&model.PointAccount{}).Count(&count).Error)
	assert.Zero(t, count)
	for _, method := range []string{"GET", "POST"} {
		assert.False(t, request(method, fmt.Sprintf("/api/user/%d/points", users[common.RoleRootUser].Id), body, tokens[common.RoleAdminUser], 200).Success)
	}
	result = request("POST", path, body, tokens[common.RoleAdminUser], 200)
	require.True(t, result.Success, result.Message)
	var adjustment model.UserPointAdjustment
	require.NoError(t, common.Unmarshal(result.Data, &adjustment))
	assert.Equal(t, "9007199254740993", adjustment.AvailablePoints)
	result = request("POST", path, body, tokens[common.RoleAdminUser], 200)
	require.True(t, result.Success)
	require.NoError(t, common.Unmarshal(result.Data, &adjustment))
	assert.True(t, adjustment.Replayed)
	for _, bad := range []string{strings.Replace(body, `"mode":"add"`, `"mode":"override"`, 1), strings.Replace(body, `"9007199254740993"`, `1`, 1), strings.Replace(body, `"9007199254740993"`, `"0"`, 1), strings.Replace(body, `"9007199254740993"`, `"01"`, 1), strings.Replace(body, `"request-1"`, `"bad id"`, 1), strings.TrimSuffix(body, "}") + `,"extra":true}`, body + ` {}`, strings.Replace(body, `"point_type_id"`, `"Point_Type_Id"`, 1), strings.Replace(body, `"request-1"`, `null`, 1), strings.Replace(body, `"9007199254740993"`, `"1"`, 1)} {
		assert.False(t, request("POST", path, bad, tokens[common.RoleAdminUser], 200).Success, bad)
	}
	result = request("GET", path, "", tokens[common.RoleAdminUser], 200)
	require.True(t, result.Success)
	require.NoError(t, common.Unmarshal(result.Data, &balances))
	assert.Equal(t, "9007199254740993", balances.Balances[0].AvailablePoints)
	require.NoError(t, db.Model(&model.PointTransaction{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
	assert.True(t, request("POST", fmt.Sprintf("/api/user/%d/points", users[common.RoleAdminUser].Id), strings.Replace(body, "request-1", "root-request", 1), tokens[common.RoleRootUser], 200).Success)
	assert.False(t, request("GET", "/api/user/999999/points", "", tokens[common.RoleRootUser], 200).Success)
}
