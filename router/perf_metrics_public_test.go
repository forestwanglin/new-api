package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestPerfMetricsRemainPublicRegardlessOfSquareNavigation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.PerfMetric{}))
	oldDB, oldLogDB, oldRedis, oldMaster := model.DB, model.LOG_DB, common.RedisEnabled, common.IsMasterNode
	oldMainType, oldLogType := common.MainDatabaseType(), common.LogDatabaseType()
	t.Setenv("LOG_SQL_DSN", "")
	common.OptionMapRWMutex.Lock()
	oldOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	model.DB, common.RedisEnabled, common.IsMasterNode = db, false, false
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	require.NoError(t, model.InitLogDB())
	t.Cleanup(func() {
		model.DB, model.LOG_DB, common.RedisEnabled, common.IsMasterNode = oldDB, oldLogDB, oldRedis, oldMaster
		common.SetDatabaseTypes(oldMainType, oldLogType)
		common.OptionMapRWMutex.Lock()
		common.OptionMap = oldOptions
		common.OptionMapRWMutex.Unlock()
		require.NoError(t, sqlDB.Close())
	})
	engine := gin.New()
	SetApiRouter(engine)
	for _, options := range []string{
		`{"pricing":{"enabled":true,"requireAuth":false}}`,
		`{"pricing":{"enabled":false,"requireAuth":false}}`,
		`{"pricing":{"enabled":true,"requireAuth":true}}`,
		`{"pricing":false}`,
	} {
		t.Run(options, func(t *testing.T) {
			common.OptionMapRWMutex.Lock()
			common.OptionMap["HeaderNavModules"] = options
			common.OptionMapRWMutex.Unlock()
			for _, path := range []string{"/api/perf-metrics/summary?hours=24", "/api/perf-metrics?model=public-model&hours=24"} {
				recorder := httptest.NewRecorder()
				engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
				require.Equal(t, http.StatusOK, recorder.Code, "%s: %s", path, recorder.Body.String())
				var response struct {
					Success bool `json:"success"`
				}
				require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
				require.True(t, response.Success, recorder.Body.String())
			}
		})
	}
}
