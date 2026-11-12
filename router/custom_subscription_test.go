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

func TestCustomSubscriptionAdminAPI(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.PointType{}, &model.PointModelRule{}, &model.CustomSubscriptionPlan{}, &model.CustomSubscriptionOrder{}, &model.PointAccount{}, &model.PointLedger{}, &model.PointTransaction{}, &model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}, &model.Option{}))
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
	base := "/api/custom_subscription/admin/plans"
	payload := func(code string) string {
		return fmt.Sprintf(`{"code":%q,"title":"Plan 100%%_literal","subtitle":"","tier_code":"basic","tier_rank":1,"billing_cycle":"month","duration_months":1,"currency":"CNY","price_amount_minor":"9007199254740993","paid_points":"9007199254740993","paid_point_type_id":"%d","bonus_points":"0","bonus_point_type_id":null,"auto_renew_enabled":false,"auto_renew_bonus_bps":0,"auto_bonus_point_type_id":null,"benefits":[],"enabled":true,"sort_order":0}`, code, types[0].Id)
	}
	for _, route := range []struct{ method, path string }{{"GET", base}, {"POST", base}, {"GET", base + "/1"}, {"PUT", base + "/1"}, {"DELETE", base + "/1"}} {
		request(t, route.method, route.path, payload("guard"), "", 401)
		request(t, route.method, route.path, payload("guard"), tokens[common.RoleCommonUser], 403)
		request(t, route.method, route.path, payload("guard"), adminPAT, 403)
	}
	created := request(t, "POST", base, payload("basic"), admin, 200)
	require.True(t, created.Success, created.Message)
	var plan map[string]any
	require.NoError(t, common.Unmarshal(created.Data, &plan))
	assert.Equal(t, "9007199254740993", plan["paid_points"])
	assert.Equal(t, "9007199254740993", plan["price_amount_minor"])
	assert.Nil(t, plan["bonus_point_type_id"])
	path := base + "/" + plan["id"].(string)
	assert.True(t, request(t, "GET", path, "", admin, 200).Success)
	assert.False(t, request(t, "POST", base, payload("basic"), admin, 200).Success)
	for _, bad := range []string{`{}`, payload("bad") + ` {}`, strings.Replace(payload("bad"), `"sort_order":0`, `"sort_order":0,"id":"42"`, 1), strings.Replace(payload("bad"), `"paid_points":"9007199254740993"`, `"paid_points":"-1"`, 1), strings.Replace(payload("bad"), `"paid_points":"9007199254740993"`, `"paid_points":"9223372036854775808"`, 1), strings.Replace(payload("bad"), `"paid_points":"9007199254740993"`, `"paid_points":"1.5"`, 1), strings.Replace(payload("bad"), fmt.Sprintf(`"paid_point_type_id":"%d"`, types[0].Id), `"paid_point_type_id":"99999"`, 1), strings.Replace(payload("bad"), `"bonus_points":"0"`, `"bonus_points":"9223372036854775807"`, 1)} {
		assert.False(t, request(t, "POST", base, bad, admin, 200).Success, bad)
	}
	update := strings.TrimSuffix(payload("basic"), "}") + `,"version":"1"}`
	update = strings.Replace(update, `"enabled":true`, `"enabled":false`, 1)
	updated := request(t, "PUT", path, update, admin, 200)
	require.True(t, updated.Success, updated.Message)
	var saved map[string]any
	require.NoError(t, common.Unmarshal(updated.Data, &saved))
	assert.Equal(t, false, saved["enabled"])
	assert.Equal(t, "2", saved["version"])
	assert.False(t, request(t, "PUT", path, update, admin, 200).Success)
	for _, query := range []string{"?p=0", "?page_size=101", "?p=1&p=2", "?unknown=x", "?enabled=1", "?billing_cycle=week", "?p=9223372036854775807&page_size=100"} {
		assert.False(t, request(t, "GET", base+query, "", admin, 200).Success)
	}
	listed := request(t, "GET", base+"?keyword=%25_&enabled=false&billing_cycle=month&page_size=1", "", admin, 200)
	require.True(t, listed.Success, listed.Message)
	var list struct {
		Total      int
		Items      []map[string]any
		PointTypes []map[string]string `json:"point_types"`
	}
	require.NoError(t, common.Unmarshal(listed.Data, &list))
	assert.Equal(t, 1, list.Total)
	assert.Len(t, list.PointTypes, 3)
	assert.Len(t, list.Items, 1)
	t.Run("positive bonuses and normalization", func(t *testing.T) {
		var positive map[string]any
		require.NoError(t, common.UnmarshalJsonStr(payload("positive"), &positive))
		positive["paid_points"] = "101"
		positive["bonus_points"] = "7"
		positive["bonus_point_type_id"] = fmt.Sprint(types[1].Id)
		positive["auto_renew_enabled"] = true
		positive["auto_renew_bonus_bps"] = 1250
		positive["auto_bonus_point_type_id"] = fmt.Sprint(types[2].Id)
		encode := func(fields map[string]any) string {
			t.Helper()
			body, err := common.Marshal(fields)
			require.NoError(t, err)
			return string(body)
		}
		response := request(t, "POST", base, encode(positive), admin, 200)
		require.True(t, response.Success, response.Message)
		var got map[string]any
		require.NoError(t, common.Unmarshal(response.Data, &got))
		positivePath := base + "/" + got["id"].(string)
		for _, method := range []string{"POST response", "GET"} {
			if method == "GET" {
				response = request(t, "GET", positivePath, "", admin, 200)
				require.True(t, response.Success, response.Message)
				require.NoError(t, common.Unmarshal(response.Data, &got))
			}
			assert.Equal(t, "101", got["paid_points"])
			assert.Equal(t, "7", got["bonus_points"])
			assert.Equal(t, true, got["auto_renew_enabled"])
			assert.EqualValues(t, 1250, got["auto_renew_bonus_bps"])
			for index, field := range []string{"paid_point_type", "bonus_point_type", "auto_bonus_point_type"} {
				assert.Equal(t, fmt.Sprint(types[index].Id), got[field+"_id"])
				assert.Equal(t, map[string]any{"id": fmt.Sprint(types[index].Id), "code": types[index].Code, "name": types[index].Name}, got[field])
			}
		}
		for _, field := range []string{"bonus_point_type_id", "auto_bonus_point_type_id"} {
			for _, value := range []any{nil, "99999"} {
				original := positive[field]
				positive[field] = value
				positive["code"] = "invalid-bonus"
				assert.False(t, request(t, "POST", base, encode(positive), admin, 200).Success, "%s=%v", field, value)
				positive[field] = original
			}
		}
		positive["code"] = "positive"
		positive["version"] = "1"
		positive["bonus_points"] = "0"
		positive["auto_renew_enabled"] = false
		positive["auto_renew_bonus_bps"] = 0
		// Send the previous type IDs: the server must normalize unused IDs to NULL.
		response = request(t, "PUT", positivePath, encode(positive), admin, 200)
		require.True(t, response.Success, response.Message)
		require.NoError(t, common.Unmarshal(response.Data, &got))
		assert.Equal(t, "0", got["bonus_points"])
		assert.Equal(t, false, got["auto_renew_enabled"])
		assert.EqualValues(t, 0, got["auto_renew_bonus_bps"])
		for _, field := range []string{"bonus_point_type_id", "auto_bonus_point_type_id", "bonus_point_type", "auto_bonus_point_type"} {
			assert.Nil(t, got[field], field)
		}
		var persisted model.CustomSubscriptionPlan
		require.NoError(t, db.Where("code = ?", "positive").First(&persisted).Error)
		assert.Zero(t, persisted.BonusPoints)
		assert.False(t, persisted.AutoRenewEnabled)
		assert.Zero(t, persisted.AutoRenewBonusBps)
		assert.Nil(t, persisted.BonusPointTypeId)
		assert.Nil(t, persisted.AutoBonusPointTypeId)
	})
	t.Run("automatic renewal rewards independent of switch", func(t *testing.T) {
		var fields map[string]any
		require.NoError(t, common.UnmarshalJsonStr(payload("independent-auto-reward"), &fields))
		fields["paid_points"] = "101"
		fields["bonus_points"] = "7"
		fields["bonus_point_type_id"] = fmt.Sprint(types[1].Id)
		fields["auto_renew_bonus_bps"] = 1250
		fields["auto_bonus_point_type_id"] = fmt.Sprint(types[2].Id)
		encode := func() string {
			t.Helper()
			body, err := common.Marshal(fields)
			require.NoError(t, err)
			return string(body)
		}
		response := request(t, "POST", base, encode(), admin, 200)
		require.True(t, response.Success, response.Message)
		var got map[string]any
		require.NoError(t, common.Unmarshal(response.Data, &got))
		rewardPath := base + "/" + got["id"].(string)
		assert.Equal(t, false, got["auto_renew_enabled"])
		assert.EqualValues(t, 1250, got["auto_renew_bonus_bps"])
		assert.Equal(t, fmt.Sprint(types[2].Id), got["auto_bonus_point_type_id"])
		response = request(t, "GET", rewardPath, "", admin, 200)
		require.True(t, response.Success, response.Message)
		require.NoError(t, common.Unmarshal(response.Data, &got))
		assert.EqualValues(t, 1250, got["auto_renew_bonus_bps"])
		assert.Equal(t, map[string]any{"id": fmt.Sprint(types[2].Id), "code": types[2].Code, "name": types[2].Name}, got["auto_bonus_point_type"])
		// Update rewards while disabled, then enable and disable without clearing them.
		fields["auto_renew_bonus_bps"] = 2500
		for _, enabled := range []bool{false, true, false} {
			fields["auto_renew_enabled"] = enabled
			fields["version"] = got["version"]
			response = request(t, "PUT", rewardPath, encode(), admin, 200)
			require.True(t, response.Success, response.Message)
			require.NoError(t, common.Unmarshal(response.Data, &got))
			assert.Equal(t, enabled, got["auto_renew_enabled"])
			assert.EqualValues(t, 2500, got["auto_renew_bonus_bps"])
			assert.Equal(t, fmt.Sprint(types[2].Id), got["auto_bonus_point_type_id"])
		}
		var persisted model.CustomSubscriptionPlan
		require.NoError(t, db.Where("code = ?", "independent-auto-reward").First(&persisted).Error)
		assert.False(t, persisted.AutoRenewEnabled)
		assert.Equal(t, 2500, persisted.AutoRenewBonusBps)
		require.NotNil(t, persisted.AutoBonusPointTypeId)
		assert.Equal(t, types[2].Id, *persisted.AutoBonusPointTypeId)
		delete(fields, "version")
		fields["code"] = "invalid-disabled-reward"
		for _, invalidType := range []any{nil, "99999"} {
			fields["auto_bonus_point_type_id"] = invalidType
			assert.False(t, request(t, "POST", base, encode(), admin, 200).Success)
		}
		fields["auto_bonus_point_type_id"] = fmt.Sprint(types[2].Id)
		fields["paid_points"] = "9223372036854775807"
		fields["bonus_points"] = "0"
		assert.False(t, request(t, "POST", base, encode(), admin, 200).Success)
	})
	t.Run("floor bonus and total overflow boundaries", func(t *testing.T) {
		for _, tc := range []struct {
			name, paid            string
			accepted, autoEnabled bool
		}{
			{"floor-zero", "1", true, true},
			// floor(base/10000) leaves total exactly MaxInt64; ceil would overflow.
			{"floor-max-total", "9222449791875588249", true, true},
			{"overflow-total", "9222449791875588250", false, true},
			{"disabled-floor-zero", "1", true, false},
			{"disabled-floor-max-total", "9222449791875588249", true, false},
			{"disabled-overflow-total", "9222449791875588250", false, false},
		} {
			t.Run(tc.name, func(t *testing.T) {
				var fields map[string]any
				require.NoError(t, common.UnmarshalJsonStr(payload(tc.name), &fields))
				fields["paid_points"] = tc.paid
				fields["auto_renew_enabled"] = tc.autoEnabled
				fields["auto_renew_bonus_bps"] = 1
				fields["auto_bonus_point_type_id"] = fmt.Sprint(types[2].Id)
				body, err := common.Marshal(fields)
				require.NoError(t, err)
				response := request(t, "POST", base, string(body), admin, 200)
				assert.Equal(t, tc.accepted, response.Success, response.Message)
			})
		}
	})
	for _, table := range []any{&model.PointAccount{}, &model.PointLedger{}, &model.PointTransaction{}, &model.CustomSubscriptionOrder{}} {
		var count int64
		require.NoError(t, db.Model(table).Count(&count).Error)
		assert.Zero(t, count)
	}
	id := int64(1)
	require.NoError(t, db.Create(&model.CustomSubscriptionOrder{TradeNo: "protected", PlanId: id}).Error)
	assert.False(t, request(t, "DELETE", path, "", admin, 200).Success)
	second := request(t, "POST", base, payload("delete"), admin, 200)
	require.True(t, second.Success)
	var deletable map[string]any
	require.NoError(t, common.Unmarshal(second.Data, &deletable))
	assert.True(t, request(t, "DELETE", base+"/"+deletable["id"].(string), "", admin, 200).Success)
}
