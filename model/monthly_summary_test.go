package model

import (
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

// setupMonthlyTestDB 打开隔离测试库（表前缀隔离），设置全局 DB 并迁移相关表。
func setupMonthlyTestDB(t *testing.T, dialect string) *gorm.DB {
	t.Helper()
	var driver gorm.Dialector
	switch dialect {
	case "sqlite":
		driver = sqlite.Open(":memory:")
	case "mysql":
		dsn := os.Getenv("TEST_MYSQL_DSN")
		if dsn == "" {
			t.Skip("TEST_MYSQL_DSN not configured")
		}
		driver = mysql.Open(dsn)
	case "postgres":
		dsn := os.Getenv("TEST_POSTGRES_DSN")
		if dsn == "" {
			t.Skip("TEST_POSTGRES_DSN not configured")
		}
		driver = postgres.Open(dsn)
	default:
		t.Fatalf("unknown dialect %q", dialect)
	}
	db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "monthly_test_"}})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	previousDB, previousType := DB, common.MainDatabaseType()
	DB = db
	common.SetMainDatabaseType(common.DatabaseType(dialect))
	initCol()
	t.Cleanup(func() {
		require.NoError(t, db.Migrator().DropTable(&QuotaData{}, &PointCallBilling{}, &Token{}))
		DB = previousDB
		common.SetMainDatabaseType(previousType)
		initCol()
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.AutoMigrate(&QuotaData{}, &PointCallBilling{}, &Token{}))
	return db
}

func newTestPointCall(id string, userID, tokenID int, model, state string, createdAt int64, points int64) PointCallBilling {
	return PointCallBilling{
		ID:          id,
		UserID:      userID,
		TokenID:     tokenID,
		Model:       model,
		Rate:        "1",
		Unit:        "1",
		Allocations: "[]",
		Points:      points,
		State:       state,
		CreatedAt:   createdAt,
	}
}

// seedMonthlyTestData 造数：覆盖免费模型、已删除秘钥、token_id=0、跨范围、refunded 等边界。
func seedMonthlyTestData(t *testing.T, db *gorm.DB, start, end int64) {
	t.Helper()
	_ = end
	quotaRows := []QuotaData{
		{UserID: 1, ModelName: "gpt-4", CreatedAt: start + 100, Count: 10, Quota: 1000},
		{UserID: 1, ModelName: "free-model", CreatedAt: start + 200, Count: 5, Quota: 0},
		{UserID: 2, ModelName: "gpt-4", CreatedAt: start + 300, Count: 20, Quota: 2000},
		// 范围外（start 之前），应被排除
		{UserID: 1, ModelName: "gpt-4", CreatedAt: start - 100, Count: 99, Quota: 9999},
	}
	require.NoError(t, db.Create(&quotaRows).Error)

	pointRows := []PointCallBilling{
		newTestPointCall("c1", 1, 100, "gpt-4", "charged", (start+100)*1000, 100),
		newTestPointCall("c2", 1, 100, "gpt-4", "charged", (start+200)*1000, 50),
		newTestPointCall("c3", 2, 200, "gpt-4", "charged", (start+300)*1000, 500),
		// refunded 不计入积分
		newTestPointCall("c4", 1, 100, "gpt-4", "refunded", (start+400)*1000, 999),
		// token_id=0（playground/无秘钥）计入总积分，但不作为最烧钱秘钥
		newTestPointCall("c5", 1, 0, "gpt-4", "charged", (start+500)*1000, 999),
	}
	require.NoError(t, db.Create(&pointRows).Error)

	token100 := Token{Id: 100, UserId: 1, Key: "key-100", Name: "my-key"}
	token200 := Token{Id: 200, UserId: 2, Key: "key-200", Name: "other-key"}
	require.NoError(t, db.Create(&token100).Error)
	require.NoError(t, db.Create(&token200).Error)
	// 软删除 token 200，验证 Unscoped 仍能取到名称
	require.NoError(t, db.Delete(&token200).Error)
}

func TestGetMonthlySummaryDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := setupMonthlyTestDB(t, dialect)
			start := int64(1_700_000_000)
			end := start + 30*86400
			seedMonthlyTestData(t, db, start, end)

			t.Run("all_users", func(t *testing.T) {
				s, err := GetMonthlySummary(0, start, end)
				require.NoError(t, err)
				assert.Equal(t, int64(3000), s.Quota, "免费模型 quota=0 计入，范围外行排除")
				assert.Equal(t, int64(35), s.TotalCalls)
				require.NotNil(t, s.TopModel)
				assert.Equal(t, "gpt-4", s.TopModel.ModelName)
				assert.Equal(t, int64(30), s.TopModel.Count)
				assert.Equal(t, int64(1649), s.Points, "含 token_id=0，排除 refunded")
				require.NotNil(t, s.TopToken)
				assert.Equal(t, 200, s.TopToken.TokenID)
				assert.Equal(t, "other-key", s.TopToken.TokenName, "已删除秘钥仍取到名称")
				assert.Equal(t, int64(500), s.TopToken.Points)
			})

			t.Run("user_1", func(t *testing.T) {
				s, err := GetMonthlySummary(1, start, end)
				require.NoError(t, err)
				assert.Equal(t, int64(1000), s.Quota)
				assert.Equal(t, int64(15), s.TotalCalls)
				require.NotNil(t, s.TopModel)
				assert.Equal(t, "gpt-4", s.TopModel.ModelName)
				assert.Equal(t, int64(10), s.TopModel.Count)
				assert.Equal(t, int64(1149), s.Points)
				require.NotNil(t, s.TopToken)
				assert.Equal(t, 100, s.TopToken.TokenID)
				assert.Equal(t, "my-key", s.TopToken.TokenName)
				assert.Equal(t, int64(150), s.TopToken.Points)
			})

			t.Run("user_2", func(t *testing.T) {
				s, err := GetMonthlySummary(2, start, end)
				require.NoError(t, err)
				assert.Equal(t, int64(2000), s.Quota)
				assert.Equal(t, int64(20), s.TotalCalls)
				require.NotNil(t, s.TopModel)
				assert.Equal(t, "gpt-4", s.TopModel.ModelName)
				assert.Equal(t, int64(20), s.TopModel.Count)
				assert.Equal(t, int64(500), s.Points)
				require.NotNil(t, s.TopToken)
				assert.Equal(t, 200, s.TopToken.TokenID)
				assert.Equal(t, "other-key", s.TopToken.TokenName)
				assert.Equal(t, int64(500), s.TopToken.Points)
			})

			t.Run("empty_range", func(t *testing.T) {
				s, err := GetMonthlySummary(0, start+1_000_000, end+1_000_000)
				require.NoError(t, err)
				assert.Equal(t, int64(0), s.Quota)
				assert.Equal(t, int64(0), s.Points)
				assert.Equal(t, int64(0), s.TotalCalls)
				assert.Nil(t, s.TopModel)
				assert.Nil(t, s.TopToken)
			})
		})
	}
}
