package router

import (
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestCustomSubscriptionPublicPlans(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	oldDB, oldType := model.DB, common.MainDatabaseType()
	model.DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() { model.DB = oldDB; common.SetMainDatabaseType(oldType); require.NoError(t, sqlDB.Close()) })
	require.NoError(t, db.AutoMigrate(&model.CustomSubscriptionPlan{}, &model.PointType{}))
	pointType := model.PointType{Code: "configured", Name: "Configured points"}
	require.NoError(t, db.Create(&pointType).Error)
	engine := gin.New()
	SetApiRouter(engine)
	read := func(path string) pointAdminResponse {
		t.Helper()
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("GET", path, nil))
		require.Equal(t, 200, recorder.Code, recorder.Body.String())
		var result pointAdminResponse
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &result))
		return result
	}
	base := "/api/custom_subscription/plans"
	empty := read(base)
	require.True(t, empty.Success, empty.Message)
	assert.JSONEq(t, `{"items":[]}`, string(empty.Data))
	for i := range 102 {
		plan := model.CustomSubscriptionPlan{Code: fmt.Sprintf("plan-%d", i), Title: "Configured title", Subtitle: "Configured subtitle", BillingCycle: "year", DurationMonths: 12, Currency: "CNY", PriceAmountMinor: 9007199254740993, PaidPoints: 9007199254740993, PaidPointTypeId: pointType.Id, BenefitsJson: `["Configured benefit"]`, Enabled: i != 101, SortOrder: i % 2, AutoRenewBonusBps: 1250, AutoBonusPointTypeId: &pointType.Id}
		require.NoError(t, db.Create(&plan).Error)
	}
	response := read(base)
	require.True(t, response.Success, response.Message)
	var data struct {
		Items []map[string]any `json:"items"`
	}
	require.NoError(t, common.Unmarshal(response.Data, &data))
	require.Len(t, data.Items, 101)
	assert.Equal(t, "100", data.Items[0]["id"])
	assert.Equal(t, "101", data.Items[50]["id"])
	assert.Equal(t, "9007199254740993", data.Items[0]["paid_points"])
	assert.Equal(t, "9007199254740993", data.Items[0]["price_amount_minor"])
	assert.Equal(t, false, data.Items[0]["auto_renew_enabled"])
	assert.EqualValues(t, 1250, data.Items[0]["auto_renew_bonus_bps"])
	assert.Equal(t, "Configured points", data.Items[0]["paid_point_type"].(map[string]any)["name"])
	for _, key := range []string{"version", "enabled", "sort_order", "created_at", "updated_at", "code", "tier_code", "tier_rank"} {
		assert.NotContains(t, data.Items[0], key)
	}
	assert.False(t, read(base+"?enabled=false").Success)
	require.NoError(t, db.Model(&model.CustomSubscriptionPlan{}).Where("id = ?", 1).Update("benefits_json", "invalid").Error)
	assert.False(t, read(base).Success)
	require.NoError(t, db.Model(&model.CustomSubscriptionPlan{}).Where("id = ?", 1).Update("benefits_json", "[]").Error)
	require.NoError(t, db.Model(&model.CustomSubscriptionPlan{}).Where("id = ?", 1).Update("paid_point_type_id", 99999).Error)
	assert.False(t, read(base).Success)
	require.NoError(t, db.Model(&model.CustomSubscriptionPlan{}).Where("id = ?", 1).Update("paid_point_type_id", pointType.Id).Error)
	require.NoError(t, db.Migrator().DropTable(&model.PointType{}))
	assert.False(t, read(base).Success)
	require.NoError(t, db.Migrator().DropTable(&model.CustomSubscriptionPlan{}))
	assert.False(t, read(base).Success)
}
