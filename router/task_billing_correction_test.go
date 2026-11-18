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
	"gorm.io/gorm"

	"github.com/QuantumNous/new-api/middleware"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTaskBillingCorrectionRouteRequiresSession(t *testing.T) {
	engine := newAccessTokenScopeTestEngine(t)
	const key = "POST /api/system-task/task-billing/:task_id/correct"
	registered := false
	for _, route := range engine.Routes() {
		if route.Method+" "+route.Path == key {
			registered = true
		}
	}
	require.True(t, registered)
	rule, exists := middleware.AccessTokenRouteRule(key)
	require.True(t, exists)
	assert.Equal(t, "session", rule.Kind())
}

func TestTaskBillingCorrectionAuthorizationAndAudit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.Task{}, &model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}, &model.Option{}))
	oldDB, oldLogDB, oldType, oldRedis, oldSecret := model.DB, model.LOG_DB, common.MainDatabaseType(), common.RedisEnabled, common.SessionSecret
	model.DB, model.LOG_DB = db, db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	common.SessionSecret = "task-correction-test-secret"
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.SetMainDatabaseType(oldType)
		common.RedisEnabled, common.SessionSecret = oldRedis, oldSecret
		require.NoError(t, sqlDB.Close())
	})
	tokens := map[int]string{}
	var rootPAT string
	for _, role := range []int{common.RoleCommonUser, common.RoleAdminUser, common.RoleRootUser} {
		user := model.User{Username: fmt.Sprintf("correction-%d", role), Password: "placeholder", Role: role, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: fmt.Sprintf("correction-%d", role)}
		require.NoError(t, db.Create(&user).Error)
		bundle, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "correction-test")
		require.NoError(t, err)
		tokens[role] = bundle.AccessToken
		if role == common.RoleRootUser {
			rootPAT = model.AccessTokenPrefix + strings.Repeat("c", 43)
			token := &model.UserAccessToken{Name: "correction session-only", TokenHash: model.AccessTokenFingerprint(rootPAT), TokenHint: model.AccessTokenHint(rootPAT)}
			require.NoError(t, token.SetScopes([]string{"ops:read", "ops:write"}))
			require.NoError(t, model.CreateUserAccessToken(user.Id, token, service.AccessTokenMaxPerUser))
		}
	}
	task := model.Task{TaskID: "legacy-task-no-correction", Status: model.TaskStatusSuccess, Quota: 10}
	require.NoError(t, db.Create(&task).Error)
	engine := gin.New()
	SetApiRouter(engine)
	request := func(id, token string, want int) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/api/system-task/task-billing/"+id+"/correct", nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, req)
		assert.Equal(t, want, recorder.Code, recorder.Body.String())
	}
	id := fmt.Sprint(task.ID)
	request(id, "", http.StatusUnauthorized)
	request(id, tokens[common.RoleCommonUser], http.StatusForbidden)
	request(id, tokens[common.RoleAdminUser], http.StatusForbidden)
	request(id, rootPAT, http.StatusForbidden)
	request("invalid", tokens[common.RoleRootUser], http.StatusBadRequest)
	request("999999", tokens[common.RoleRootUser], http.StatusNotFound)
	request(id, tokens[common.RoleRootUser], http.StatusBadRequest)
	var audits []model.AuditLog
	require.NoError(t, db.Where("action = ?", "task.billing_correct").Find(&audits).Error)
	require.Len(t, audits, 2)
	for _, audit := range audits {
		assert.Equal(t, common.RoleRootUser, audit.ActorRole)
		assert.False(t, audit.Success)
		assert.Equal(t, "session", audit.AuthMethod)
	}
}
