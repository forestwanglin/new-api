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

type pointAdminResponse struct {
	Success bool              `json:"success"`
	Message string            `json:"message"`
	Data    common.RawMessage `json:"data"`
}

func TestPointsAdminAPI(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.PointType{}, &model.PointModelRule{}, &model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}, &model.Option{}))
	oldDB, oldLogDB, oldType, oldRedis, oldSecret := model.DB, model.LOG_DB, common.MainDatabaseType(), common.RedisEnabled, common.SessionSecret
	model.DB, model.LOG_DB = db, db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	common.SessionSecret = "points-admin-test-secret"
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.SetMainDatabaseType(oldType)
		common.RedisEnabled, common.SessionSecret = oldRedis, oldSecret
		require.NoError(t, sqlDB.Close())
	})
	tokens := map[int]string{}
	var adminPAT string
	for _, role := range []int{common.RoleCommonUser, common.RoleAdminUser, common.RoleRootUser} {
		user := model.User{Username: fmt.Sprintf("points-%d", role), Password: "placeholder", Role: role, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: fmt.Sprintf("points-%d", role)}
		require.NoError(t, db.Create(&user).Error)
		bundle, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "points-admin-test")
		require.NoError(t, err)
		tokens[role] = bundle.AccessToken
		if role == common.RoleAdminUser {
			adminPAT = model.AccessTokenPrefix + strings.Repeat("p", 43)
			token := &model.UserAccessToken{Name: "points session-only test", TokenHash: model.AccessTokenFingerprint(adminPAT), TokenHint: model.AccessTokenHint(adminPAT)}
			require.NoError(t, token.SetScopes([]string{"group:read", "group:write"}))
			require.NoError(t, model.CreateUserAccessToken(user.Id, token, service.AccessTokenMaxPerUser))
		}
	}
	types := []model.PointType{{Code: "GENERAL", Name: "General", ConsumePriority: 100}, {Code: "GPT", Name: "GPT", ConsumePriority: 10}, {Code: "DS", Name: "Future", ConsumePriority: 10}}
	require.NoError(t, db.Create(&types).Error)
	engine := gin.New()
	SetApiRouter(engine)
	request := func(t *testing.T, method, path, body, token string, status int) pointAdminResponse {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, req)
		require.Equal(t, status, recorder.Code, recorder.Body.String())
		var response pointAdminResponse
		if status == http.StatusOK {
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		}
		return response
	}
	admin := tokens[common.RoleAdminUser]
	base := fmt.Sprintf("/api/points/types/%d/rules", types[1].Id)
	other := fmt.Sprintf("/api/points/types/%d/rules", types[0].Id)
	t.Run("authorization and readonly types", func(t *testing.T) {
		for _, route := range []struct{ method, path, body string }{
			{"GET", "/api/points/types", ""}, {"GET", base, ""}, {"POST", base, `{"match_type":"EXACT","match_value":"restricted","enabled":true}`}, {"PUT", base + "/1", `{}`}, {"DELETE", base + "/1", ""},
		} {
			request(t, route.method, route.path, route.body, "", http.StatusUnauthorized)
			request(t, route.method, route.path, route.body, tokens[common.RoleCommonUser], http.StatusForbidden)
			request(t, route.method, route.path, route.body, adminPAT, http.StatusForbidden)
		}
		assert.True(t, request(t, "GET", "/api/points/types", "", tokens[common.RoleRootUser], 200).Success)
		for _, method := range []string{"POST", "PUT", "DELETE"} {
			request(t, method, "/api/points/types", `{}`, admin, 404)
			request(t, method, "/api/points/types/1", `{}`, admin, 404)
		}
	})
	t.Run("all types sorted and empty rules", func(t *testing.T) {
		response := request(t, "GET", "/api/points/types", "", admin, 200)
		require.True(t, response.Success)
		var got []model.PointType
		require.NoError(t, common.Unmarshal(response.Data, &got))
		require.Len(t, got, 3)
		assert.Equal(t, []string{"GPT", "DS", "GENERAL"}, []string{got[0].Code, got[1].Code, got[2].Code})
		empty := request(t, "GET", base, "", admin, 200)
		assert.True(t, empty.Success)
		assert.JSONEq(t, `[]`, string(empty.Data))
	})
	t.Run("CRUD false case-sensitive duplicates and ownership", func(t *testing.T) {
		response := request(t, "POST", base, `{"match_type":"EXACT","match_value":"Vendor/[model].v1","enabled":false}`, admin, 200)
		require.True(t, response.Success, response.Message)
		var rule model.PointModelRule
		require.NoError(t, common.Unmarshal(response.Data, &rule))
		require.Positive(t, rule.Id)
		assert.False(t, rule.Enabled)
		path := fmt.Sprintf("%s/%d", base, rule.Id)
		crossPath := fmt.Sprintf("%s/%d", other, rule.Id)
		assert.False(t, request(t, "PUT", crossPath, `{"match_type":"EXACT","match_value":"stolen","enabled":true}`, admin, 200).Success)
		assert.False(t, request(t, "DELETE", crossPath, "", admin, 200).Success)
		duplicate := request(t, "POST", base, `{"match_type":"EXACT","match_value":"Vendor/[model].v1","enabled":true}`, admin, 200)
		assert.False(t, duplicate.Success)
		assert.NotContains(t, duplicate.Message, "UNIQUE")
		assert.True(t, request(t, "POST", base, `{"match_type":"EXACT","match_value":"vendor/[model].v1","enabled":true}`, admin, 200).Success)
		assert.True(t, request(t, "POST", other, `{"match_type":"EXACT","match_value":"Vendor/[model].v1","enabled":true}`, admin, 200).Success)
		assert.False(t, request(t, "PUT", path, `{"match_type":"EXACT","match_value":"vendor/[model].v1","enabled":false}`, admin, 200).Success)
		for _, enabled := range []bool{true, false, false} {
			updated := request(t, "PUT", path, fmt.Sprintf(`{"match_type":"PATTERN","match_value":"future-?*","enabled":%t}`, enabled), admin, 200)
			require.True(t, updated.Success, updated.Message)
			var saved model.PointModelRule
			require.NoError(t, common.Unmarshal(updated.Data, &saved))
			assert.Equal(t, enabled, saved.Enabled)
			assert.Equal(t, types[1].Id, saved.PointTypeId)
		}
		listed := request(t, "GET", base, "", admin, 200)
		require.True(t, listed.Success)
		var rules []model.PointModelRule
		require.NoError(t, common.Unmarshal(listed.Data, &rules))
		require.Len(t, rules, 2)
		assert.Equal(t, rule.Id, rules[0].Id)
		assert.False(t, rules[0].Enabled)
		assert.Equal(t, model.PointModelMatchValue("future-?*"), rules[0].MatchValue)
		assert.True(t, request(t, "DELETE", path, "", admin, 200).Success)
		assert.False(t, request(t, "DELETE", path, "", admin, 200).Success)
		assert.False(t, request(t, "PUT", path, `{"match_type":"EXACT","match_value":"missing","enabled":true}`, admin, 200).Success)
	})
	t.Run("strict validation", func(t *testing.T) {
		created := request(t, "POST", base, `{"match_type":"EXACT","match_value":"validation-original","enabled":false}`, admin, 200)
		require.True(t, created.Success)
		var rule model.PointModelRule
		require.NoError(t, common.Unmarshal(created.Data, &rule))
		path := fmt.Sprintf("%s/%d", base, rule.Id)
		for _, body := range []string{
			`{}`, `null`, `[]`, `{"match_type":"EXACT","match_value":"x"}`, `{"match_type":"EXACT","match_value":"x","enabled":null}`, `{"match_type":"EXACT","match_value":"x","enabled":"false"}`,
			`{"match_type":"REGEX","match_value":"x","enabled":true}`, `{"match_type":"EXACT","match_value":"","enabled":true}`, `{"match_type":"EXACT","match_value":" x","enabled":true}`, `{"match_type":"EXACT","match_value":"x ","enabled":true}`, `{"match_type":"EXACT","match_value":"x\ny","enabled":true}`,
			`{"match_type":"EXACT","match_value":"x","enabled":true,"point_type_id":1}`, `{"match_type":"EXACT","match_value":"x","enabled":true,"id":1}`, `{"match_type":"EXACT","match_value":"x","enabled":true,"created_at":1}`, `{"Match_type":"EXACT","match_value":"x","enabled":true}`, `{"match_type":"EXACT","match_value":"x","enabled":true} {}`,
			fmt.Sprintf(`{"match_type":"EXACT","match_value":%q,"enabled":true}`, strings.Repeat("中", 256)),
		} {
			assert.False(t, request(t, "POST", base, body, admin, 200).Success, body)
			assert.False(t, request(t, "PUT", path, body, admin, 200).Success, body)
		}
		var unchanged model.PointModelRule
		require.NoError(t, db.First(&unchanged, rule.Id).Error)
		assert.Equal(t, rule, unchanged)
		assert.True(t, request(t, "POST", base, fmt.Sprintf(`{"match_type":"EXACT","match_value":%q,"enabled":true}`, strings.Repeat("中", 255)), admin, 200).Success)
		for _, id := range []string{"0", "-1", "no", "9223372036854775808", "99999"} {
			path := "/api/points/types/" + id + "/rules"
			assert.False(t, request(t, "GET", path, "", admin, 200).Success)
			assert.False(t, request(t, "POST", path, `{"match_type":"EXACT","match_value":"x","enabled":true}`, admin, 200).Success)
			assert.False(t, request(t, "PUT", path+"/1", `{"match_type":"EXACT","match_value":"x","enabled":true}`, admin, 200).Success)
			assert.False(t, request(t, "DELETE", path+"/1", "", admin, 200).Success)
			assert.False(t, request(t, "DELETE", base+"/"+id, "", admin, 200).Success)
		}
	})
}
