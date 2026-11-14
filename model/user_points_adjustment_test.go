package model

import (
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestAdminUserPointsDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := "local"
			if dialect == "mysql" {
				dsn = os.Getenv("TEST_MYSQL_DSN")
			}
			if dialect == "postgres" {
				dsn = os.Getenv("TEST_POSTGRES_DSN")
			}
			if dsn == "" {
				t.Skip("isolated test database DSN is not configured")
			}
			oldPath, oldDB, oldType := common.SQLitePath, DB, common.MainDatabaseType()
			common.SQLitePath = filepath.Join(t.TempDir(), "admin-points.db")
			t.Setenv("ADMIN_POINTS_TEST_DSN", dsn)
			db, dbType, err := chooseDB("ADMIN_POINTS_TEST_DSN", false)
			require.NoError(t, err)
			DB = db
			common.SetMainDatabaseType(dbType)
			models := []any{&PointCallOperation{}, &PointCallEvent{}, &PointCallBilling{}, &PointFreeze{}, &PointModelRule{}, &PointLedger{}, &PointTransaction{}, &PointAccount{}, &PointType{}, &User{}}
			for _, m := range models {
				require.False(t, db.Migrator().HasTable(m), "requires disposable empty database")
			}
			t.Cleanup(func() {
				for _, m := range models {
					require.NoError(t, db.Migrator().DropTable(m))
				}
				sqlDB, e := db.DB()
				require.NoError(t, e)
				require.NoError(t, sqlDB.Close())
				DB = oldDB
				common.SQLitePath = oldPath
				common.SetMainDatabaseType(oldType)
			})
			require.NoError(t, db.AutoMigrate(&User{}, &PointType{}, &PointAccount{}, &PointTransaction{}, &PointLedger{}, &PointFreeze{}, &PointModelRule{}, &PointCallBilling{}, &PointCallEvent{}, &PointCallOperation{}))
			if dialect == "sqlite" {
				sqlDB, e := db.DB()
				require.NoError(t, e)
				sqlDB.SetMaxOpenConns(1)
			}
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Log("version", version)
			user := User{Username: "adjust-target", AffCode: "adjust-target", Role: common.RoleCommonUser, Quota: 321}
			admin := User{Username: "adjust-admin", AffCode: "adjust-admin", Role: common.RoleAdminUser}
			require.NoError(t, db.Create(&user).Error)
			require.NoError(t, db.Create(&admin).Error)
			typ := PointType{Code: "FUTURE", Name: "Future points", ConsumePriority: 999}
			require.NoError(t, db.Create(&typ).Error)
			rows, err := GetUserPointBalances(user.Id, common.RoleAdminUser)
			require.NoError(t, err)
			require.Len(t, rows.Balances, 1)
			assert.Equal(t, "0", rows.Balances[0].AvailablePoints)
			var count int64
			require.NoError(t, db.Model(&PointAccount{}).Count(&count).Error)
			assert.Zero(t, count)
			apply := func(mode, amount, event string) (*UserPointAdjustment, error) {
				return AdjustUserPoints(user.Id, admin.Id, admin.Role, typ.Id, mode, amount, event)
			}
			result, err := apply("add", "9007199254740993", "initial")
			require.NoError(t, err)
			assert.Equal(t, "9007199254740993", result.AvailablePoints)
			result, err = apply("add", "9007199254740993", "initial")
			require.NoError(t, err)
			assert.True(t, result.Replayed)
			_, err = apply("add", "1", "initial")
			require.ErrorIs(t, err, ErrUserPointAdjustmentConflict)
			require.NoError(t, db.Model(&PointAccount{}).Where("user_id = ?", user.Id).Update("frozen_points", 7).Error)
			result, err = apply("subtract", "9007199254740999", "debt")
			require.NoError(t, err)
			assert.Equal(t, "-6", result.AvailablePoints)
			assert.Equal(t, "7", result.FrozenPoints)
			result, err = apply("add", "2", "repay")
			require.NoError(t, err)
			assert.Equal(t, "-4", result.AvailablePoints)
			for i, amount := range []string{"0", "-1", "1.5", "1e3", "01", "9223372036854775808", "+1", " 1"} {
				_, err = apply("add", amount, fmt.Sprint("bad", i))
				require.ErrorIs(t, err, ErrInvalidUserPointAdjustment)
			}
			_, err = apply("override", "2", "override")
			require.ErrorIs(t, err, ErrInvalidUserPointAdjustment)
			_, err = AdjustUserPoints(admin.Id, admin.Id, admin.Role, typ.Id, "add", "1", "peer")
			require.ErrorIs(t, err, ErrUserQuotaPermission)
			_, err = AdjustUserPoints(user.Id, user.Id, common.RoleCommonUser, typ.Id, "add", "1", "ordinary")
			require.ErrorIs(t, err, ErrUserQuotaPermission)
			_, err = AdjustUserPoints(user.Id, admin.Id, admin.Role, typ.Id+999, "add", "1", "missing-type")
			require.ErrorIs(t, err, ErrPointTypeNotFound)
			require.NoError(t, db.Model(&PointAccount{}).Where("user_id = ?", user.Id).Update("available_points", int64(math.MaxInt64)).Error)
			_, err = apply("add", "1", "overflow")
			require.ErrorIs(t, err, ErrUserPointAdjustmentOverflow)
			require.NoError(t, db.Model(&PointTransaction{}).Count(&count).Error)
			assert.EqualValues(t, 3, count)
			require.NoError(t, db.Model(&PointAccount{}).Where("user_id = ?", user.Id).Update("available_points", int64(math.MinInt64)).Error)
			_, err = apply("subtract", "1", "underflow")
			require.ErrorIs(t, err, ErrUserPointAdjustmentOverflow)
			require.NoError(t, db.Model(&PointAccount{}).Where("user_id = ?", user.Id).Update("available_points", 0).Error)
			const cb = "test:admin_points_fail_ledger"
			injected := errors.New("ledger failed")
			require.NoError(t, db.Callback().Create().Before("gorm:create").Register(cb, func(tx *gorm.DB) {
				if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "PointLedger" {
					tx.AddError(injected)
				}
			}))
			_, err = apply("add", "1", "retry-after-failure")
			require.ErrorIs(t, err, injected)
			require.NoError(t, db.Callback().Create().Remove(cb))
			result, err = apply("add", "1", "retry-after-failure")
			require.NoError(t, err)
			assert.Equal(t, "1", result.AvailablePoints)
			var wg sync.WaitGroup
			errs := make(chan error, 20)
			for i := range 10 {
				wg.Go(func() { _, e := apply("add", "1", fmt.Sprint("parallel", i)); errs <- e })
				wg.Go(func() { _, e := apply("subtract", "1", "same-request"); errs <- e })
			}
			wg.Wait()
			close(errs)
			for e := range errs {
				require.NoError(t, e)
			}
			var account PointAccount
			require.NoError(t, db.Where("user_id = ?", user.Id).First(&account).Error)
			assert.EqualValues(t, 10, account.AvailablePoints)
			assert.EqualValues(t, 7, account.FrozenPoints)
			require.NoError(t, db.Model(&PointTransaction{}).Count(&count).Error)
			assert.EqualValues(t, 15, count)
			require.NoError(t, db.Model(&PointLedger{}).Count(&count).Error)
			assert.EqualValues(t, 15, count)
			var latest User
			require.NoError(t, db.First(&latest, user.Id).Error)
			assert.Equal(t, 321, latest.Quota)
			var transaction PointTransaction
			require.NoError(t, db.Where("event_key = ?", fmt.Sprintf("admin-points:%d:same-request", admin.Id)).First(&transaction).Error)
			require.NotNil(t, transaction.OperatorId)
			assert.EqualValues(t, admin.Id, *transaction.OperatorId)

			// Race an actual call reservation against administrator mutations:
			// neither side may overwrite the other's available/frozen change.
			require.NoError(t, db.Create(&PointModelRule{PointTypeId: typ.Id, MatchType: PointMatchPattern, MatchValue: "*", Enabled: true}).Error)
			require.NoError(t, CreatePointCall("admin-race-call", user.Id, 0, "test-model", "1", "1000"))
			mixed := make(chan error, 3)
			wg.Go(func() { mixed <- ReservePointCall("admin-race-call", "admin-race-call:reserve", 3, true) })
			wg.Go(func() { _, e := apply("add", "5", "mixed-credit"); mixed <- e })
			wg.Go(func() { _, e := apply("subtract", "2", "mixed-debit"); mixed <- e })
			wg.Wait()
			close(mixed)
			for e := range mixed {
				require.NoError(t, e)
			}
			require.NoError(t, db.First(&account, account.Id).Error)
			assert.EqualValues(t, 10, account.AvailablePoints)
			assert.EqualValues(t, 10, account.FrozenPoints)
			_, err = SetPointCallTarget("admin-race-call", "admin-race-call:actual", 4, true, false, nil)
			require.NoError(t, err)
			require.NoError(t, db.First(&account, account.Id).Error)
			assert.EqualValues(t, 9, account.AvailablePoints)
			assert.EqualValues(t, 7, account.FrozenPoints)
			require.NoError(t, db.First(&latest, user.Id).Error)
			assert.Equal(t, 317, latest.Quota)

			// A failed first credit must roll back the new account as well.
			fresh := PointType{Code: "NEW", Name: "New", ConsumePriority: 1}
			require.NoError(t, db.Create(&fresh).Error)
			require.NoError(t, db.Callback().Create().Before("gorm:create").Register(cb, func(tx *gorm.DB) {
				if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "PointLedger" {
					tx.AddError(injected)
				}
			}))
			_, err = AdjustUserPoints(user.Id, admin.Id, admin.Role, fresh.Id, "add", "1", "fresh-failed")
			require.ErrorIs(t, err, injected)
			require.NoError(t, db.Callback().Create().Remove(cb))
			require.NoError(t, db.Model(&PointAccount{}).Where("point_type_id = ?", fresh.Id).Count(&count).Error)
			assert.Zero(t, count)
			freshErrors := make(chan error, 5)
			for i := range 5 {
				wg.Go(func() {
					_, e := AdjustUserPoints(user.Id, admin.Id, admin.Role, fresh.Id, "add", "1", fmt.Sprint("fresh", i))
					freshErrors <- e
				})
			}
			wg.Wait()
			close(freshErrors)
			for e := range freshErrors {
				require.NoError(t, e)
			}
			var freshAccount PointAccount
			require.NoError(t, db.Where("user_id = ? AND point_type_id = ?", user.Id, fresh.Id).First(&freshAccount).Error)
			assert.EqualValues(t, 5, freshAccount.AvailablePoints)

			// Case-insensitive SQL collations may collide distinct request IDs.
			// They must never turn a different identity into a successful replay.
			_, err = apply("add", "1", "Case-Request")
			require.NoError(t, err)
			lower, e := apply("add", "1", "case-request")
			if e != nil {
				require.ErrorIs(t, e, ErrUserPointAdjustmentConflict)
			} else {
				assert.False(t, lower.Replayed)
			}
			require.NoError(t, db.First(&account, account.Id).Error)
			if e != nil {
				assert.EqualValues(t, 10, account.AvailablePoints)
			} else {
				assert.EqualValues(t, 11, account.AvailablePoints)
			}

		})
	}
}
