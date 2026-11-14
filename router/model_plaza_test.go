package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestModelPlazaPricingPreservesPricingContractWhenSquareIsClosed(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}, &model.Model{}, &model.Vendor{}, &model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}, &model.Option{}))
	oldDB, oldLogDB, oldRedis, oldSecret := model.DB, model.LOG_DB, common.RedisEnabled, common.SessionSecret
	oldGroups := setting.UserUsableGroups2JSONString()
	common.OptionMapRWMutex.Lock()
	oldOptions := common.OptionMap
	common.OptionMap = map[string]string{"HeaderNavModules": `{"pricing":{"enabled":true,"requireAuth":false}}`}
	common.OptionMapRWMutex.Unlock()
	model.DB, model.LOG_DB, common.RedisEnabled = db, db, false
	common.SessionSecret = "model-plaza-pricing-test-secret"
	model.InvalidatePricingCache()
	t.Cleanup(func() {
		model.InvalidatePricingCache()
		model.DB, model.LOG_DB, common.RedisEnabled, common.SessionSecret = oldDB, oldLogDB, oldRedis, oldSecret
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(oldGroups))
		common.OptionMapRWMutex.Lock()
		common.OptionMap = oldOptions
		common.OptionMapRWMutex.Unlock()
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default group"}`))
	require.NoError(t, db.Create(&model.Channel{Id: 1, Name: "public", Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Key: "test-only-key"}).Error)
	require.NoError(t, db.Create(&[]model.Ability{
		{ChannelId: 1, Group: "default", Model: "public-model", Enabled: true},
		{ChannelId: 1, Group: "vip", Model: "vip-model", Enabled: true},
		{ChannelId: 1, Group: "default", Model: "hidden-model", Enabled: true},
		{ChannelId: 1, Group: "default", Model: "disabled-ability", Enabled: false},
	}).Error)
	require.NoError(t, db.Create(&model.Model{ModelName: "hidden-model", Status: 2}).Error)
	user := model.User{Username: "plaza-user", DisplayName: "Plaza user", Password: "test-only-password", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "vip", AuthVersion: 1}
	require.NoError(t, db.Create(&user).Error)
	login, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "model-plaza-test")
	require.NoError(t, err)

	engine := gin.New()
	SetApiRouter(engine)
	request := func(path, token string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, req)
		return recorder
	}
	original := request("/api/pricing", "")
	require.Equal(t, http.StatusOK, original.Code)
	for _, test := range []struct {
		name      string
		options   string
		oldStatus int
	}{
		{"disabled", `{"pricing":{"enabled":false,"requireAuth":false}}`, http.StatusForbidden},
		{"login required", `{"pricing":{"enabled":true,"requireAuth":true}}`, http.StatusUnauthorized},
	} {
		t.Run(test.name, func(t *testing.T) {
			common.OptionMapRWMutex.Lock()
			common.OptionMap["HeaderNavModules"] = test.options
			common.OptionMapRWMutex.Unlock()
			assert.Equal(t, test.oldStatus, request("/api/pricing", "").Code)
			public := request("/api/model/pricing", "")
			require.Equal(t, http.StatusOK, public.Code)
			assert.JSONEq(t, original.Body.String(), public.Body.String())
			var response struct {
				Success bool            `json:"success"`
				Data    []model.Pricing `json:"data"`
			}
			require.NoError(t, common.Unmarshal(public.Body.Bytes(), &response))
			require.True(t, response.Success)
			require.Len(t, response.Data, 1)
			assert.Equal(t, "public-model", response.Data[0].ModelName)
		})
	}
	t.Run("authenticated group visibility is unchanged", func(t *testing.T) {
		public := request("/api/model/pricing", login.AccessToken)
		require.Equal(t, http.StatusOK, public.Code)
		common.OptionMapRWMutex.Lock()
		common.OptionMap["HeaderNavModules"] = `{"pricing":{"enabled":true,"requireAuth":false}}`
		common.OptionMapRWMutex.Unlock()
		assert.JSONEq(t, request("/api/pricing", login.AccessToken).Body.String(), public.Body.String())
		var response struct {
			Data []model.Pricing `json:"data"`
		}
		require.NoError(t, common.Unmarshal(public.Body.Bytes(), &response))
		names := make([]string, 0, len(response.Data))
		for _, item := range response.Data {
			names = append(names, item.ModelName)
		}
		assert.ElementsMatch(t, []string{"public-model", "vip-model"}, names)
	})
}
