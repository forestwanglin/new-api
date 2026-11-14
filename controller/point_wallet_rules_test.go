package controller

import (
	"net/http"
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

func TestPointWalletRulesConfiguredContentAndFailures(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	previousDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previousDB; require.NoError(t, sqlDB.Close()) })
	require.NoError(t, db.AutoMigrate(&model.CustomSubscriptionRule{}))
	content := `{"blocks":[{"type":"paragraph","children":[{"text":"Configured <script>plain text</script>","style":{"fontWeight":700}}]}]}`
	wallet := model.CustomSubscriptionRule{Id: 9007199254740993, RuleKey: "wallet-configured", Title: "Configured wallet rule", ContentJson: content, Enabled: true, Version: 5}
	require.NoError(t, db.Create(&wallet).Error)
	engine := gin.New()
	engine.GET("/rules", GetPointWalletRules)
	request := func(path string) struct {
		Success bool           `json:"success"`
		Message string         `json:"message"`
		Data    map[string]any `json:"data"`
	} {
		t.Helper()
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		require.Equal(t, http.StatusOK, recorder.Code)
		var response struct {
			Success bool           `json:"success"`
			Message string         `json:"message"`
			Data    map[string]any `json:"data"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		return response
	}
	response := request("/rules")
	require.True(t, response.Success)
	items, ok := response.Data["items"].([]any)
	require.True(t, ok)
	require.Len(t, items, 1)
	item, ok := items[0].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "9007199254740993", item["id"])
	assert.Equal(t, "Configured wallet rule", item["title"])
	assert.Equal(t, "wallet-configured", item["rule_key"])
	assert.Len(t, item, 4, "public rule DTO omits internal configuration and plan snapshots")
	assert.Contains(t, item, "content")
	for _, path := range []string{"/rules?user_id=1", "/rules?plan_id=1", "/rules?unknown=", "/rules?plan_id=1&plan_id=2", "/rules?bad=%ZZ"} {
		assert.False(t, request(path).Success, path)
	}
	require.NoError(t, db.Model(&wallet).Update("content_json", `{"blocks":[{"type":"paragraph","children":[{"text":"unsafe","style":{"position":"fixed"}}]}]}`).Error)
	assert.False(t, request("/rules").Success, "malformed stored content must not reach the renderer")
	require.NoError(t, db.Delete(&wallet).Error)
	response = request("/rules")
	require.True(t, response.Success)
	assert.Empty(t, response.Data["items"])
	require.NoError(t, db.Migrator().DropTable(&model.CustomSubscriptionRule{}))
	assert.False(t, request("/rules").Success, "query failure must not turn into a successful empty rule list")
}
