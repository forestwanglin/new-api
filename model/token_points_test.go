package model

import (
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestTokenPointsProjectionDoesNotReadBillingHistory(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	previousDB := DB
	DB = db
	t.Cleanup(func() { DB = previousDB })
	require.NoError(t, db.AutoMigrate(&Token{}, &PointCallBilling{}))
	token := Token{UserId: 7, Key: "counter-projection", Status: common.TokenStatusEnabled, ExpiredTime: -1}
	require.NoError(t, db.Create(&token).Error)
	require.NoError(t, db.Migrator().DropTable(&PointCallBilling{}))
	used, err := GetTokenUsedPoints(7, []int{token.Id})
	require.NoError(t, err, "management usage reads only the persisted token counter")
	assert.EqualValues(t, 0, used[token.Id])
	foreign, err := GetTokenUsedPoints(8, []int{token.Id})
	require.NoError(t, err)
	assert.Empty(t, foreign)
}

func TestUnlimitedTokenAdmissionDoesNotReadHistoricalPoints(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	previousDB := DB
	DB = db
	t.Cleanup(func() { DB = previousDB })
	require.NoError(t, db.AutoMigrate(&Token{}, &PointCallBilling{}))
	token := Token{UserId: 7, Key: "counter-unlimited", PointLimitEnabled: true, UnlimitedQuota: true, Status: common.TokenStatusEnabled, ExpiredTime: -1}
	require.NoError(t, db.Create(&token).Error)
	require.NoError(t, db.Create(&PointCallBilling{ID: "unlimited-call", UserID: 7, TokenID: token.Id, Rate: "1", Unit: "1000", Model: "test", Allocations: "[]"}).Error)
	blocked := errors.New("historical points query is unavailable")
	require.NoError(t, db.Callback().Query().Before("gorm:query").Register("test:reject_history_scan", func(tx *gorm.DB) {
		if tx.Statement.Table == "point_call_billings" && len(tx.Statement.Selects) == 1 && tx.Statement.Selects[0] == "points" {
			tx.AddError(blocked)
		}
	}))
	err = db.Transaction(func(tx *gorm.DB) error {
		ok, err := ReserveTokenPointLimitTx(tx, token.Id, "unlimited-call", 5)
		if err != nil {
			return err
		}
		require.True(t, ok)
		return nil
	})
	require.NoError(t, err)
	require.NoError(t, db.First(&token, token.Id).Error)
	assert.EqualValues(t, 5, token.ReservedPoints)
}

func TestTokenPointsCounterDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := "local"
			switch dialect {
			case "mysql":
				dsn = os.Getenv("TEST_MYSQL_DSN")
			case "postgres":
				dsn = os.Getenv("TEST_POSTGRES_DSN")
			}
			if dsn == "" {
				t.Skip("isolated test database DSN is not configured")
			}
			previousPath, previousDB, previousType := common.SQLitePath, DB, common.MainDatabaseType()
			common.SQLitePath = filepath.Join(t.TempDir(), "token-counter.db")
			t.Cleanup(func() { common.SQLitePath, DB = previousPath, previousDB; common.SetMainDatabaseType(previousType) })
			t.Setenv("TOKEN_POINTS_TEST_DSN", dsn)
			db, dbType, err := chooseDB("TOKEN_POINTS_TEST_DSN", false)
			require.NoError(t, err)
			DB = db
			common.SetMainDatabaseType(dbType)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&PointCallBilling{}, &Token{}))
				require.NoError(t, sqlDB.Close())
			})
			require.NoError(t, db.AutoMigrate(&Token{}, &PointCallBilling{}))
			fresh := Token{UserId: 7, Key: "fresh-counter", UsedPoints: 900, UsedPointsVersion: -1}
			require.NoError(t, db.Create(&fresh).Error)
			assert.Zero(t, fresh.UsedPoints, "new-key caller counters never become authoritative")
			assert.Equal(t, tokenUsedPointsVersion, fresh.UsedPointsVersion)
			legacy := Token{UserId: 7, Key: "legacy-counter", PointLimitEnabled: true, PointLimit: 100, ReservedPoints: 4, RemainQuota: 25, UsedQuota: 9}
			tombstone := Token{UserId: 8, Key: "deleted-counter"}
			require.NoError(t, db.Create(&legacy).Error)
			require.NoError(t, db.Create(&tombstone).Error)
			require.NoError(t, db.Delete(&tombstone).Error)
			for _, call := range []PointCallBilling{
				{ID: "legacy-a", UserID: 7, TokenID: legacy.Id, Points: 3},
				{ID: "legacy-b", UserID: 7, TokenID: legacy.Id, Points: 4},
				{ID: "deleted-a", UserID: 8, TokenID: tombstone.Id, Points: 9},
			} {
				require.NoError(t, db.Create(&call).Error)
			}
			// Representative previous schema keeps historical rows and quotas.
			for _, field := range []string{"UsedPoints", "UsedPointsVersion"} {
				require.NoError(t, db.Migrator().DropColumn(&Token{}, field))
			}
			for range 2 {
				require.NoError(t, db.AutoMigrate(&Token{}))
				require.NoError(t, migrateTokenPointCounters(db))
			}
			require.NoError(t, db.First(&legacy, legacy.Id).Error)
			assert.EqualValues(t, 7, legacy.UsedPoints)
			assert.EqualValues(t, 4, legacy.ReservedPoints)
			assert.EqualValues(t, 100, legacy.PointLimit)
			assert.Equal(t, 25, legacy.RemainQuota)
			assert.Equal(t, 9, legacy.UsedQuota)
			require.NoError(t, db.Unscoped().First(&tombstone, tombstone.Id).Error)
			assert.EqualValues(t, 9, tombstone.UsedPoints)
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return adjustTokenUsedPointsTx(tx, tombstone.Id, -2) }))
			require.NoError(t, migrateTokenPointCounters(db), "restart must not overwrite an initialized live counter")
			require.NoError(t, db.Unscoped().First(&tombstone, tombstone.Id).Error)
			assert.EqualValues(t, 7, tombstone.UsedPoints)
			used, err := GetTokenUsedPoints(7, []int{legacy.Id, tombstone.Id})
			require.NoError(t, err)
			assert.Equal(t, map[int]int64{legacy.Id: 7}, used)
			err = db.Transaction(func(tx *gorm.DB) error { return adjustTokenUsedPointsTx(tx, legacy.Id, -8) })
			require.ErrorIs(t, err, ErrTokenPointLimitInvalid, "counter underflow must roll back")
			require.NoError(t, db.Model(&Token{}).Where("id = ?", legacy.Id).Update("used_points", math.MaxInt64).Error)
			err = db.Transaction(func(tx *gorm.DB) error { return adjustTokenUsedPointsTx(tx, legacy.Id, 1) })
			require.ErrorIs(t, err, ErrTokenPointLimitInvalid, "counter overflow must roll back")
			// Restart resumes incomplete rows but never exposes their partial zero.
			incomplete := Token{UserId: 10, Key: "incomplete-counter"}
			require.NoError(t, db.Create(&incomplete).Error)
			require.NoError(t, db.Model(&Token{}).Where("id = ?", incomplete.Id).Update("used_points_version", 0).Error)
			_, err = GetTokenUsedPoints(10, []int{incomplete.Id})
			require.ErrorIs(t, err, ErrTokenPointLimitInvalid)
			badCall := PointCallBilling{ID: "invalid-counter", UserID: 10, TokenID: incomplete.Id, Points: -1}
			require.NoError(t, db.Create(&badCall).Error)
			require.Error(t, migrateTokenPointCounters(db))
			require.NoError(t, db.Model(&PointCallBilling{}).Where("id = ?", badCall.ID).Updates(map[string]any{"points": 1, "user_id": 11}).Error)
			require.Error(t, migrateTokenPointCounters(db), "cross-owner history must not be attributed")
			require.NoError(t, db.Model(&PointCallBilling{}).Where("id = ?", badCall.ID).Update("user_id", 10).Error)
			calls := make([]PointCallBilling, 501)
			for i := range calls {
				calls[i] = PointCallBilling{ID: fmt.Sprintf("batch-%04d", i), UserID: 10, TokenID: incomplete.Id, Points: 1}
			}
			require.NoError(t, db.CreateInBatches(calls, 100).Error)
			require.NoError(t, migrateTokenPointCounters(db))
			require.NoError(t, db.First(&incomplete, incomplete.Id).Error)
			assert.EqualValues(t, 502, incomplete.UsedPoints, "history keyset traverses more than one page")
			assert.Equal(t, tokenUsedPointsVersion, incomplete.UsedPointsVersion)
		})
	}
}
