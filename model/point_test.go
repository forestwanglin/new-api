package model

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestPointsInitializationRollsBackFailedRule(t *testing.T) {
	previousPath := common.SQLitePath
	common.SQLitePath = filepath.Join(t.TempDir(), "points-initialization.db")
	t.Cleanup(func() { common.SQLitePath = previousPath })
	t.Setenv("POINT_TEST_DSN", "local")
	db, _, err := chooseDB("POINT_TEST_DSN", false)
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	require.NoError(t, db.AutoMigrate(&PointType{}, &PointModelRule{}))

	ruleError := errors.New("initial rule insert failed")
	const callback = "points_test:fail_initial_rule"
	require.NoError(t, db.Callback().Create().Before("gorm:create").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "PointModelRule" {
			tx.AddError(ruleError)
		}
	}))
	require.ErrorIs(t, initializePointTypes(db), ruleError)
	var count int64
	require.NoError(t, db.Model(&PointType{}).Count(&count).Error)
	assert.Zero(t, count, "a failed default rule must not leave an unusable seeded type")
	require.NoError(t, db.Model(&PointModelRule{}).Count(&count).Error)
	assert.Zero(t, count)

	require.NoError(t, db.Callback().Create().Remove(callback))
	require.NoError(t, initializePointTypes(db))
	require.NoError(t, db.Model(&PointType{}).Count(&count).Error)
	assert.EqualValues(t, 2, count)
	require.NoError(t, db.Model(&PointModelRule{}).Count(&count).Error)
	assert.EqualValues(t, 2, count, "a later startup must be able to retry initialization")
}

func TestPointsDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var dsn string
			switch dialect {
			case "sqlite":
				dsn = "local"
				previousPath := common.SQLitePath
				common.SQLitePath = filepath.Join(t.TempDir(), "points.db")
				t.Cleanup(func() { common.SQLitePath = previousPath })
			case "mysql":
				dsn = os.Getenv("TEST_MYSQL_DSN")
			case "postgres":
				dsn = os.Getenv("TEST_POSTGRES_DSN")
			}
			if dsn == "" {
				t.Skip("isolated test database DSN is not configured")
			}
			t.Setenv("POINT_TEST_DSN", dsn)
			db, databaseType, err := chooseDB("POINT_TEST_DSN", false)
			require.NoError(t, err)
			previousType := common.MainDatabaseType()
			common.SetMainDatabaseType(databaseType)
			t.Cleanup(func() { common.SetMainDatabaseType(previousType) })
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("database version: %s", version)

			for _, scenario := range []string{"fresh", "existing_schema"} {
				t.Run(scenario, func(t *testing.T) {
					models := []any{&PointFreeze{}, &PointLedger{}, &PointTransaction{}, &PointAccount{}, &PointModelRule{}, &PointType{}}
					for _, model := range models {
						require.False(t, db.Migrator().HasTable(model), "points tests require an isolated database without existing point tables")
					}
					t.Cleanup(func() {
						for _, model := range models {
							require.NoError(t, db.Migrator().DropTable(model))
						}
					})
					if scenario == "existing_schema" {
						// A representative legacy wallet row protects additive behavior;
						// this is not a claim to test the full latest-release schema.
						const legacyTable = "point_test_legacy_wallet"
						require.False(t, db.Migrator().HasTable(legacyTable))
						type legacyWallet struct {
							Id    int64 `gorm:"primaryKey"`
							Quota int64 `gorm:"not null"`
						}
						require.NoError(t, db.Table(legacyTable).AutoMigrate(&legacyWallet{}))
						t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(legacyTable)) })
						require.NoError(t, db.Table(legacyTable).Create(&legacyWallet{Id: 1, Quota: 9876543210}).Error)
						t.Cleanup(func() {
							var saved legacyWallet
							require.NoError(t, db.Table(legacyTable).First(&saved, 1).Error)
							assert.EqualValues(t, 9876543210, saved.Quota)
						})
					}
					require.NoError(t, migratePoints(db))
					recorder := &migrationSQLRecorder{}
					require.NoError(t, migratePoints(db.Session(&gorm.Session{Logger: recorder})))
					assert.Empty(t, recorder.schemaMutations(), "repeat startup must not mutate the schema")
					for _, model := range models {
						assert.True(t, db.Migrator().HasTable(model))
					}
					assert.False(t, db.Migrator().HasTable("point_ledgers"))
					var types []PointType
					require.NoError(t, db.Order("consume_priority").Find(&types).Error)
					require.Len(t, types, 2)
					assert.Equal(t, PointTypeGPT, types[0].Code)
					assert.Equal(t, 10, types[0].ConsumePriority)
					assert.Equal(t, PointTypeGeneral, types[1].Code)
					assert.Equal(t, 100, types[1].ConsumePriority)
					assert.GreaterOrEqual(t, types[0].CreatedAt, time.Now().Add(-time.Minute).UnixMilli())
					var rules []PointModelRule
					require.NoError(t, db.Order("point_type_id").Find(&rules).Error)
					require.Len(t, rules, 2)
					assert.Equal(t, PointModelMatchValue("*"), rules[0].MatchValue)
					assert.Equal(t, PointModelMatchValue("gpt-*"), rules[1].MatchValue)
					assert.True(t, rules[0].Enabled)
					require.Error(t, db.Create(&PointType{Code: PointTypeGPT, Name: "duplicate"}).Error)
					require.Error(t, db.Create(&PointModelRule{PointTypeId: types[0].Id, MatchType: PointMatchPattern, MatchValue: "gpt-*"}).Error)
					for _, value := range []PointModelMatchValue{"Model-X", "model-x"} {
						require.NoError(t, db.Create(&PointModelRule{PointTypeId: types[0].Id, MatchType: PointMatchExact, MatchValue: value, Enabled: false}).Error)
					}
					var disabled int64
					require.NoError(t, db.Model(&PointModelRule{}).Where("enabled = ?", false).Count(&disabled).Error)
					assert.EqualValues(t, 2, disabled)

					const large int64 = 1 << 40
					account := PointAccount{UserId: large, PointTypeId: types[0].Id, AvailablePoints: large, FrozenPoints: large / 2, Version: large}
					require.NoError(t, db.Create(&account).Error)
					require.Error(t, db.Create(&PointAccount{UserId: large, PointTypeId: types[0].Id}).Error)
					var savedAccount PointAccount
					require.NoError(t, db.First(&savedAccount, account.Id).Error)
					assert.Equal(t, account, savedAccount)
					transaction := PointTransaction{UserId: large, EventKey: "request:1:consume", Action: PointActionConsume, BizType: "MODEL_REQUEST", BizId: "request-1", Points: large, OperatorType: PointOperatorSystem}
					require.NoError(t, db.Create(&transaction).Error)
					require.Error(t, db.Create(&PointTransaction{UserId: large, EventKey: transaction.EventKey}).Error)
					var savedTransaction PointTransaction
					require.NoError(t, db.First(&savedTransaction, transaction.Id).Error)
					assert.Equal(t, transaction, savedTransaction)
					assert.Nil(t, savedTransaction.OperatorId)
					assert.Nil(t, savedTransaction.RelatedTransactionId)
					assert.Nil(t, savedTransaction.BillingSnapshot)
					freeze := PointFreeze{AccountId: account.Id, TransactionId: transaction.Id, OriginalPoints: large / 2, RemainingPoints: large / 2, ReasonCode: "REVIEW", Reason: "人工审核", Status: PointFreezeActive}
					require.NoError(t, db.Create(&freeze).Error)
					var savedFreeze PointFreeze
					require.NoError(t, db.First(&savedFreeze, freeze.Id).Error)
					assert.Equal(t, freeze, savedFreeze)
					assert.Nil(t, savedFreeze.ClosedAt)
					ledger := PointLedger{TransactionId: transaction.Id, AccountId: account.Id, AccountVersion: large, AvailableDelta: -large, AvailableBefore: large}
					require.NoError(t, db.Create(&ledger).Error)
					require.Error(t, db.Create(&PointLedger{TransactionId: transaction.Id, AccountId: account.Id, AccountVersion: large}).Error)
					var savedLedger PointLedger
					require.NoError(t, db.First(&savedLedger, ledger.Id).Error)
					assert.Equal(t, ledger, savedLedger)
					assert.Nil(t, savedLedger.FreezeId)
					ledger.Id = 0
					ledger.AccountVersion++
					ledger.FreezeId = &freeze.Id
					ledger.AvailableDelta = large
					require.NoError(t, db.Create(&ledger).Error)
					savedLedger = PointLedger{}
					require.NoError(t, db.First(&savedLedger, ledger.Id).Error)
					assert.Equal(t, ledger, savedLedger)

					for _, index := range []struct {
						model any
						name  string
					}{
						{&PointLedger{}, "idx_point_ledger_transaction"}, {&PointLedger{}, "idx_point_ledger_freeze"},
						{&PointFreeze{}, "idx_point_freezes_account_status"}, {&PointFreeze{}, "idx_point_freezes_transaction"},
						{&PointTransaction{}, "idx_point_transactions_business"}, {&PointTransaction{}, "idx_point_transactions_user_time"},
					} {
						assert.True(t, db.Migrator().HasIndex(index.model, index.name), index.name)
					}
					// Repeated startup must preserve operator changes and not resurrect
					// a deliberately removed default rule.
					require.NoError(t, db.Model(&types[0]).Updates(map[string]any{"name": "自定义名称", "consume_priority": 0}).Error)
					require.NoError(t, db.Model(&rules[0]).Update("enabled", false).Error)
					require.NoError(t, db.Delete(&rules[1]).Error)
					require.NoError(t, migratePoints(db))
					var configured PointType
					require.NoError(t, db.First(&configured, types[0].Id).Error)
					assert.Equal(t, "自定义名称", configured.Name)
					assert.Zero(t, configured.ConsumePriority)
					var count int64
					require.NoError(t, db.Model(&PointModelRule{}).Where("id = ?", rules[1].Id).Count(&count).Error)
					assert.Zero(t, count)
					require.NoError(t, db.First(&rules[0], rules[0].Id).Error)
					assert.False(t, rules[0].Enabled)

					// Reinitialize missing types concurrently. Existing configured
					// types remain untouched, and there is exactly one initial rule.
					require.NoError(t, db.Where("point_type_id = ?", types[1].Id).Delete(&PointModelRule{}).Error)
					require.NoError(t, db.Delete(&types[1]).Error)
					if dialect == "sqlite" {
						sqlDB.SetMaxOpenConns(1)
					}
					var workers sync.WaitGroup
					errors := make(chan error, 3)
					for range 3 {
						workers.Go(func() { errors <- initializePointTypes(db) })
					}
					workers.Wait()
					close(errors)
					for err := range errors {
						require.NoError(t, err)
					}
					require.NoError(t, db.Model(&PointType{}).Where("code = ?", PointTypeGeneral).Count(&count).Error)
					assert.EqualValues(t, 1, count)
					var restored PointType
					require.NoError(t, db.Where("code = ?", PointTypeGeneral).First(&restored).Error)
					require.NoError(t, db.Model(&PointModelRule{}).Where("point_type_id = ?", restored.Id).Count(&count).Error)
					assert.EqualValues(t, 1, count)
				})
			}
		})
	}
}

func TestPointRulesAdminDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var dsn string
			switch dialect {
			case "sqlite":
				dsn = "local"
				oldPath := common.SQLitePath
				common.SQLitePath = filepath.Join(t.TempDir(), "points-admin.db")
				t.Cleanup(func() { common.SQLitePath = oldPath })
			case "mysql":
				dsn = os.Getenv("TEST_MYSQL_DSN")
			case "postgres":
				dsn = os.Getenv("TEST_POSTGRES_DSN")
			}
			if dsn == "" {
				t.Skip("isolated test database DSN is not configured")
			}
			t.Setenv("POINT_ADMIN_TEST_DSN", dsn)
			db, databaseType, err := chooseDB("POINT_ADMIN_TEST_DSN", false)
			require.NoError(t, err)
			oldDB, oldType := DB, common.MainDatabaseType()
			DB = db
			common.SetMainDatabaseType(databaseType)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			if dialect == "sqlite" {
				sqlDB.SetMaxOpenConns(1)
			}
			t.Cleanup(func() {
				DB = oldDB
				common.SetMainDatabaseType(oldType)
				require.NoError(t, sqlDB.Close())
			})
			for _, table := range []any{&PointType{}, &PointModelRule{}} {
				require.False(t, db.Migrator().HasTable(table), "isolated DB must have no existing point tables")
			}
			require.NoError(t, db.AutoMigrate(&PointType{}, &PointModelRule{}))
			t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(&PointModelRule{}, &PointType{})) })
			types := []PointType{{Code: "GENERAL", Name: "General", ConsumePriority: 100}, {Code: "GPT", Name: "GPT", ConsumePriority: 10}, {Code: "DS", Name: "Future", ConsumePriority: 10}}
			require.NoError(t, db.Create(&types).Error)
			gotTypes, err := GetPointTypes()
			require.NoError(t, err)
			require.Len(t, gotTypes, 3)
			assert.Equal(t, []string{"GPT", "DS", "GENERAL"}, []string{gotTypes[0].Code, gotTypes[1].Code, gotTypes[2].Code})
			gotRules, err := GetPointModelRules(types[1].Id)
			require.NoError(t, err)
			assert.Empty(t, gotRules)
			_, err = GetPointModelRules(99999)
			require.ErrorIs(t, err, ErrPointTypeNotFound)
			rule := &PointModelRule{MatchType: PointMatchExact, MatchValue: "Vendor/[model].v1", Enabled: true}
			require.NoError(t, CreatePointModelRule(types[1].Id, rule))
			require.Positive(t, rule.Id)
			updated, err := UpdatePointModelRule(types[1].Id, rule.Id, &PointModelRule{MatchType: PointMatchPattern, MatchValue: "future-?*", Enabled: false})
			require.NoError(t, err)
			assert.False(t, updated.Enabled)
			assert.Equal(t, rule.CreatedAt, updated.CreatedAt)
			_, err = UpdatePointModelRule(types[1].Id, rule.Id, updated)
			require.NoError(t, err, "no-op update must succeed on MySQL")
			_, err = UpdatePointModelRule(types[0].Id, rule.Id, updated)
			require.ErrorIs(t, err, ErrPointModelRuleNotFound)
			require.ErrorIs(t, DeletePointModelRule(types[0].Id, rule.Id), ErrPointModelRuleNotFound)
			require.ErrorIs(t, CreatePointModelRule(99999, &PointModelRule{MatchType: PointMatchExact, MatchValue: "missing"}), ErrPointTypeNotFound)
			_, err = UpdatePointModelRule(99999, rule.Id, updated)
			require.ErrorIs(t, err, ErrPointTypeNotFound)
			require.ErrorIs(t, DeletePointModelRule(99999, rule.Id), ErrPointTypeNotFound)
			// The unique constraint is the arbiter even with concurrent creators.
			var workers sync.WaitGroup
			results := make(chan error, 2)
			for range 2 {
				workers.Go(func() {
					results <- CreatePointModelRule(types[1].Id, &PointModelRule{MatchType: PointMatchExact, MatchValue: "race"})
				})
			}
			workers.Wait()
			close(results)
			successes, duplicates := 0, 0
			for err := range results {
				if err == nil {
					successes++
				} else {
					require.ErrorIs(t, err, ErrPointModelRuleDuplicate)
					duplicates++
				}
			}
			assert.Equal(t, 1, successes)
			assert.Equal(t, 1, duplicates)
			_, err = UpdatePointModelRule(types[1].Id, rule.Id, &PointModelRule{MatchType: PointMatchExact, MatchValue: "race"})
			require.ErrorIs(t, err, ErrPointModelRuleDuplicate)
			for _, value := range []PointModelMatchValue{"Model-X", "model-x"} {
				require.NoError(t, CreatePointModelRule(types[1].Id, &PointModelRule{MatchType: PointMatchExact, MatchValue: value}))
			}
			require.NoError(t, DeletePointModelRule(types[1].Id, rule.Id))
			require.ErrorIs(t, DeletePointModelRule(types[1].Id, rule.Id), ErrPointModelRuleNotFound)
			_, err = UpdatePointModelRule(types[1].Id, rule.Id, updated)
			require.ErrorIs(t, err, ErrPointModelRuleNotFound)
			// No CRUD operation can mutate a type or restore removed rules.
			var savedTypes []PointType
			require.NoError(t, db.Order("id").Find(&savedTypes).Error)
			assert.Equal(t, types, savedTypes)
			gotRules, err = GetPointModelRules(types[1].Id)
			require.NoError(t, err)
			require.Len(t, gotRules, 3)
			assert.Less(t, gotRules[0].Id, gotRules[1].Id)
			assert.Less(t, gotRules[1].Id, gotRules[2].Id)
		})
	}
}

// The enrichment is bounded by the current user page and must remain read-only.
func TestUserPointBalancesDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := os.Getenv("TEST_" + strings.ToUpper(dialect) + "_DSN")
			if dialect == "sqlite" {
				dsn = "local"
				previousPath := common.SQLitePath
				common.SQLitePath = filepath.Join(t.TempDir(), "user-points.db")
				t.Cleanup(func() { common.SQLitePath = previousPath })
			}
			if dsn == "" {
				t.Skip("isolated test database DSN is not configured")
			}
			t.Setenv("USER_POINTS_TEST_DSN", dsn)
			db, databaseType, err := chooseDB("USER_POINTS_TEST_DSN", false)
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			previousDB, previousType := DB, common.MainDatabaseType()
			common.SetMainDatabaseType(databaseType)
			t.Cleanup(func() { DB = previousDB; common.SetMainDatabaseType(previousType) })
			for _, table := range []any{&PointAccount{}, &PointType{}} {
				require.False(t, db.Migrator().HasTable(table), "requires an isolated database")
			}
			require.NoError(t, db.AutoMigrate(&PointType{}, &PointAccount{}))
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&PointAccount{}, &PointType{}))
			})
			types := []PointType{
				{Code: "ZZ", Name: "Future last"}, {Code: PointTypeGPT, Name: "GPT"},
				{Code: "DS", Name: "Future first"}, {Code: PointTypeGeneral, Name: "General"},
			}
			require.NoError(t, db.Create(&types).Error)
			accounts := []PointAccount{
				{UserId: 7, PointTypeId: types[0].Id, AvailablePoints: -1},
				{UserId: 7, PointTypeId: types[1].Id, AvailablePoints: math.MaxInt64},
				{UserId: 7, PointTypeId: types[2].Id, FrozenPoints: 300},
				{UserId: 7, PointTypeId: types[3].Id, AvailablePoints: 9007199254740993, FrozenPoints: 2000},
				{UserId: 8, PointTypeId: types[1].Id, FrozenPoints: 500},
				{UserId: 9, PointTypeId: types[0].Id},
				{UserId: 99, PointTypeId: types[0].Id, AvailablePoints: 123},
			}
			require.NoError(t, db.Create(&accounts).Error)
			recorder := &migrationSQLRecorder{}
			DB = db.Session(&gorm.Session{Logger: recorder})
			users := []*User{{Id: 8}, {Id: 7}, {Id: 9}, {Id: 10}}
			items, err := AttachUserPointBalances(users)
			require.NoError(t, err)
			require.Len(t, recorder.statements, 1, "one batch read regardless of page size; no writes")
			assert.True(t, strings.HasPrefix(strings.ToUpper(recorder.statements[0]), "SELECT "))
			require.Len(t, items, 4)
			for i := range users {
				assert.Same(t, users[i], items[i].User, "preserve page order and fields")
			}
			assert.Equal(t, []UserPointBalance{{Code: "GPT", Name: "GPT", AvailablePoints: "0", FrozenPoints: "500"}}, items[0].PointBalances)
			assert.Equal(t, []UserPointBalance{
				{Code: "GENERAL", Name: "General", AvailablePoints: "9007199254740993", FrozenPoints: "2000"},
				{Code: "GPT", Name: "GPT", AvailablePoints: "9223372036854775807", FrozenPoints: "0"},
				{Code: "DS", Name: "Future first", AvailablePoints: "0", FrozenPoints: "300"},
				{Code: "ZZ", Name: "Future last", AvailablePoints: "-1", FrozenPoints: "0"},
			}, items[1].PointBalances)
			assert.Equal(t, []UserPointBalance{}, items[2].PointBalances)
			assert.Equal(t, []UserPointBalance{}, items[3].PointBalances)
			var after []PointAccount
			require.NoError(t, db.Order("id").Find(&after).Error)
			assert.Equal(t, accounts, after, "viewing a list must not change accounts")
			recorder.reset()
			empty, err := AttachUserPointBalances(nil)
			require.NoError(t, err)
			assert.Equal(t, []UserWithPointBalances{}, empty)
			assert.Empty(t, recorder.statements, "empty pages issue no points query")
			require.NoError(t, db.Migrator().DropTable(&PointAccount{}))
			items, err = AttachUserPointBalances(users)
			require.Error(t, err)
			assert.Nil(t, items, "read failure must not fabricate empty balances")
		})
	}
}

func TestPointCallExactConversionAndModelMatch(t *testing.T) {
	for _, tt := range []struct {
		quota      int64
		rate, unit string
		want       int64
	}{
		{0, "1", "10000", 0}, {1, "1", "10000", 1}, {10, "1", "10000", 1}, {11, "1", "10000", 2},
		{1, "0.0000000000000000000000000001", "1", 1},
	} {
		got, err := PointCallPoints(tt.quota, tt.rate, tt.unit)
		require.NoError(t, err)
		assert.Equal(t, tt.want, got)
	}
	_, err := PointCallPoints(1, "0", "1")
	require.Error(t, err)
	_, err = PointCallPoints(math.MaxInt64, "1000", "1")
	require.Error(t, err)
	assert.True(t, PointModelMatches(PointMatchPattern, "gpt-*", "gpt-a/b[1]"))
	assert.True(t, PointModelMatches(PointMatchPattern, "a[?]", "a[x]"))
	assert.False(t, PointModelMatches(PointMatchPattern, "gpt-*", "GPT-a"))
	assert.False(t, PointModelMatches(PointMatchExact, "gpt-*", "gpt-a"))
}

func TestPointCallFinancialLifecycle(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) { testPointCallFinancialLifecycle(t, dialect) })
	}
}
func testPointCallFinancialLifecycle(t *testing.T, dialect string) {
	previousEnabled := common.LogConsumeEnabled
	common.LogConsumeEnabled = true
	t.Cleanup(func() { common.LogConsumeEnabled = previousEnabled })
	previousPath, previousDB := common.SQLitePath, DB
	common.SQLitePath = filepath.Join(t.TempDir(), "point-call.db")
	t.Cleanup(func() { common.SQLitePath = previousPath; DB = previousDB })
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
	t.Setenv("POINT_CALL_TEST_DSN", dsn)
	db, dbType, err := chooseDB("POINT_CALL_TEST_DSN", false)
	require.NoError(t, err)
	DB = db
	previousType := common.MainDatabaseType()
	common.SetMainDatabaseType(dbType)
	t.Cleanup(func() { common.SetMainDatabaseType(previousType) })
	t.Cleanup(func() {
		for _, m := range []any{&PointCallOperation{}, &PointCallEvent{}, &PointCallBilling{}, &PointFreeze{}, &PointLedger{}, &PointTransaction{}, &PointAccount{}, &PointModelRule{}, &PointType{}, &Token{}, &User{}} {
			require.NoError(t, db.Migrator().DropTable(m))
		}
		connection, e := db.DB()
		require.NoError(t, e)
		require.NoError(t, connection.Close())
	})
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	// Connection closed by database teardown after dropping fixtures.
	require.NoError(t, db.AutoMigrate(&User{}, &Token{}))
	require.NoError(t, migratePoints(db))
	require.NoError(t, migratePoints(db))
	user := User{Username: "point-call", Quota: -100}
	require.NoError(t, db.Create(&user).Error)
	token := Token{UserId: user.Id, Key: "point-call-key", RemainQuota: 100, Status: common.TokenStatusEnabled, ExpiredTime: -1}
	require.NoError(t, db.Create(&token).Error)
	var general, gpt PointType
	require.NoError(t, db.Where("code = ?", PointTypeGeneral).First(&general).Error)
	require.NoError(t, db.Where("code = ?", PointTypeGPT).First(&gpt).Error)
	require.NoError(t, db.Model(&gpt).Update("consume_priority", 200).Error)
	gptAccount := PointAccount{UserId: int64(user.Id), PointTypeId: gpt.Id, AvailablePoints: 10, FrozenPoints: 7}
	generalAccount := PointAccount{UserId: int64(user.Id), PointTypeId: general.Id, AvailablePoints: 5}
	require.NoError(t, db.Create(&gptAccount).Error)
	require.NoError(t, db.Create(&generalAccount).Error)
	require.NoError(t, CreatePointCall("call", user.Id, token.Id, "gpt-test", "1", "1000"))
	require.NoError(t, ReservePointCall("call", "call:reserve", 15, false))
	dispatchedCall, err := GetPointCall("call")
	require.NoError(t, err)
	assert.Equal(t, "dispatching", dispatchedCall.Dispatch)
	var a PointAccount
	a = PointAccount{}
	require.NoError(t, db.First(&a, gptAccount.Id).Error)
	assert.EqualValues(t, 0, a.AvailablePoints)
	assert.EqualValues(t, 17, a.FrozenPoints)
	require.NoError(t, CreatePointCall("other", user.Id, token.Id, "gpt-test", "1", "1000"))
	require.ErrorIs(t, ReservePointCall("other", "other:reserve", 1, false), ErrInsufficientPoints)
	require.NoError(t, db.First(&token, token.Id).Error)
	assert.EqualValues(t, 85, token.RemainQuota, "failed point reserve rolls back key")
	r, err := SetPointCallTarget("call", "call:charge", 20, true, false, nil)
	require.NoError(t, err)
	assert.Equal(t, "20", r.Metadata.TotalPoints)
	require.Len(t, r.Metadata.Items, 2)
	assert.Equal(t, "10", r.Metadata.Items[0].Points)
	assert.Equal(t, "10", r.Metadata.Items[1].Points)
	a = PointAccount{}
	require.NoError(t, db.First(&a, gptAccount.Id).Error)
	assert.EqualValues(t, 0, a.AvailablePoints)
	assert.EqualValues(t, 7, a.FrozenPoints, "foreign freezes untouched")
	a = PointAccount{}
	require.NoError(t, db.First(&a, generalAccount.Id).Error)
	assert.EqualValues(t, -5, a.AvailablePoints)
	replay, err := SetPointCallTarget("call", "call:charge", 20, true, false, nil)
	require.NoError(t, err)
	assert.True(t, replay.Replayed)
	_, err = SetPointCallTarget("call", "call:charge", 21, true, false, nil)
	require.ErrorIs(t, err, ErrPointCallConflict)
	require.NoError(t, db.First(&user, user.Id).Error)
	assert.Equal(t, -120, user.Quota)
	require.NoError(t, db.First(&token, token.Id).Error)
	assert.Equal(t, 80, token.RemainQuota)
	r, err = SetPointCallTarget("call", "call:refund", 0, true, false, nil)
	require.NoError(t, err)
	assert.Equal(t, "-20", r.Metadata.TotalPoints)
	a = PointAccount{}
	require.NoError(t, db.First(&a, generalAccount.Id).Error)
	assert.EqualValues(t, 5, a.AvailablePoints)
	require.NoError(t, db.First(&token, token.Id).Error)
	assert.Equal(t, 100, token.RemainQuota)
	require.NoError(t, db.First(&user, user.Id).Error)
	assert.Equal(t, -100, user.Quota)
	var freezes []PointFreeze
	require.NoError(t, db.Where("reason = ?", "call").Find(&freezes).Error)
	for _, f := range freezes {
		assert.Zero(t, f.RemainingPoints)
		assert.Equal(t, PointFreezeClosed, f.Status)
	}

	// Dispatch intent and holds commit together; a failed marker must not leave
	// a successful token/points reservation without a returned session.
	require.NoError(t, CreatePointCall("dispatch-rollback", user.Id, token.Id, "gpt-test", "1", "1000"))
	require.NoError(t, db.Callback().Update().Before("gorm:update").Register("test:dispatch-failure", func(tx *gorm.DB) {
		if call, ok := tx.Statement.Dest.(*PointCallBilling); ok && call.ID == "dispatch-rollback" && call.Dispatch == "dispatching" {
			tx.AddError(errors.New("injected dispatch persistence failure"))
		}
	}))
	require.Error(t, ReservePointCall("dispatch-rollback", "dispatch-rollback:reserve", 3, false))
	require.NoError(t, db.Callback().Update().Remove("test:dispatch-failure"))
	dispatchedCall, err = GetPointCall("dispatch-rollback")
	require.NoError(t, err)
	assert.Equal(t, "unsubmitted", dispatchedCall.Dispatch)
	assert.Zero(t, dispatchedCall.ReservedQuota)
	require.NoError(t, db.First(&token, token.Id).Error)
	assert.Equal(t, 100, token.RemainQuota)
	a = PointAccount{}
	require.NoError(t, db.First(&a, gptAccount.Id).Error)
	assert.EqualValues(t, 10, a.AvailablePoints)
	assert.EqualValues(t, 7, a.FrozenPoints)

	// An already-owned zero account can absorb post-use overage (including fees).
	require.NoError(t, db.Model(&PointAccount{}).Where("user_id = ?", user.Id).Update("available_points", 0).Error)
	require.NoError(t, CreatePointCall("zero", user.Id, token.Id, "gpt-test", "1", "1000"))
	require.NoError(t, ReservePointCall("zero", "zero:reserve", 0, false))
	zero, err := SetPointCallTarget("zero", "zero:actual", 2, true, false, nil)
	require.NoError(t, err)
	assert.Equal(t, "2", zero.Metadata.TotalPoints)
	a = PointAccount{}
	require.NoError(t, db.First(&a, generalAccount.Id).Error)
	assert.EqualValues(t, -2, a.AvailablePoints)
	// Same-type credit naturally repays debt, preserving foreign frozen funds.
	order := CustomSubscriptionOrder{Id: 991, UserId: int64(user.Id), PaidPoints: 100, PaidPointTypeId: general.Id, PlanSnapshot: "{}"}
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
		_, err := creditCustomSubscriptionPoints(tx, &order, time.Now().UnixMilli())
		return err
	}))
	a = PointAccount{}
	require.NoError(t, db.First(&a, generalAccount.Id).Error)
	assert.EqualValues(t, 98, a.AvailablePoints)
	require.NoError(t, db.Model(&PointAccount{}).Where("id = ?", gptAccount.Id).Update("available_points", -97).Error)
	require.NoError(t, CreatePointCall("net", user.Id, token.Id, "gpt-test", "1", "1000"))
	require.ErrorIs(t, ReservePointCall("net", "net:reserve", 2, false), ErrInsufficientPoints, "eligible debt is not clamped away")
	require.NoError(t, db.Model(&PointAccount{}).Where("id = ?", gptAccount.Id).Update("available_points", -99).Error)
	require.NoError(t, CreatePointCall("negative-zero", user.Id, token.Id, "gpt-test", "1", "1000"))
	require.ErrorIs(t, ReservePointCall("negative-zero", "negative-zero:reserve", 0, false), ErrInsufficientPoints, "negative net available cannot cover even a zero estimate")
	require.NoError(t, db.Model(&PointAccount{}).Where("id = ?", gptAccount.Id).Update("available_points", 0).Error)
	// Cumulative ceil includes fees, not independently rounded charge deltas.
	require.NoError(t, CreatePointCall("round", user.Id, token.Id, "gpt-test", "1", "10000"))
	require.NoError(t, ReservePointCall("round", "round:reserve", 1, false))
	rounded, err := SetPointCallTarget("round", "round:base", 1, true, false, nil)
	require.NoError(t, err)
	assert.Equal(t, "1", rounded.Metadata.TotalPoints)
	rounded, err = SetPointCallTarget("round", "round:fee", 1, true, true, nil)
	require.NoError(t, err)
	assert.Equal(t, "0", rounded.Metadata.TotalPoints)
	rounded, err = SetPointCallTarget("round", "round:base-refund", 0, true, false, nil)
	require.NoError(t, err)
	assert.Equal(t, "0", rounded.Metadata.TotalPoints, "base refund retains independently due fee")
	rounded, err = SetPointCallTarget("round", "round:fee-refund", 0, true, true, nil)
	require.NoError(t, err)
	assert.Equal(t, "-1", rounded.Metadata.TotalPoints)
	// A financial SQL error rolls back quota/key/points, leaving a durable target.
	require.NoError(t, CreatePointCall("recover", user.Id, token.Id, "gpt-test", "1", "1000"))
	require.NoError(t, ReservePointCall("recover", "recover:reserve", 2, false))
	const callback = "point_call:fail_ledger"
	require.NoError(t, db.Callback().Create().Before("gorm:create").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "PointLedger" {
			tx.AddError(errors.New("injected ledger failure"))
		}
	}))
	_, err = SetPointCallTarget("recover", "recover:actual", 3, true, false, nil)
	require.Error(t, err)
	require.NoError(t, db.Callback().Create().Remove(callback))
	c, err := GetPointCall("recover")
	require.NoError(t, err)
	assert.Zero(t, c.BookedQuota)
	assert.EqualValues(t, 2, c.TokenQuota)
	var op PointCallOperation
	require.NoError(t, db.First(&op, "id = ?", "recover:actual").Error)
	assert.Equal(t, "pending", op.State)
	previousLogDB := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previousLogDB })
	require.NoError(t, db.AutoMigrate(&Log{}))
	t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(&Log{})) })
	_, err = ReconcilePointCallEffects(context.Background(), 100)
	require.NoError(t, err)
	c, err = GetPointCall("recover")
	require.NoError(t, err)
	assert.EqualValues(t, 3, c.BookedQuota)
	var logsBefore int64
	require.NoError(t, db.Model(&Log{}).Count(&logsBefore).Error)
	require.Positive(t, logsBefore)
	// Simulate crash after external insert and before primary acknowledgment.
	require.NoError(t, db.Model(&PointCallEvent{}).Where("id = ?", "recover:actual").Updates(map[string]any{"log_state": "pending", "retry_at": 0}).Error)
	_, err = ReconcilePointCallEffects(context.Background(), 100)
	require.NoError(t, err)
	var logsAfter int64
	require.NoError(t, db.Model(&Log{}).Count(&logsAfter).Error)
	assert.Equal(t, logsBefore, logsAfter)
	var replayEvent PointCallEvent
	require.NoError(t, db.First(&replayEvent, "id = ?", "recover:actual").Error)
	assert.Equal(t, "done", replayEvent.LogState)
	// A permanently bad head item cannot starve a later financial target or
	// event when the recovery batch is smaller than the outstanding queue.
	require.NoError(t, db.Create(&PointCallOperation{ID: "0-bad-op", CallID: "missing", State: "pending"}).Error)
	require.NoError(t, db.Create(&PointCallEvent{ID: "0-bad-event", CallID: "missing", Payload: "{}", Metadata: "{}", CacheState: "pending", LogState: "pending"}).Error)
	require.NoError(t, stagePointCallTarget("recover", "fair:actual", 4, true, false))
	_, err = ReconcilePointCallEffects(context.Background(), 1)
	require.NoError(t, err)
	_, err = ReconcilePointCallEffects(context.Background(), 1)
	require.NoError(t, err)
	fairCall, err := GetPointCall("recover")
	require.NoError(t, err)
	assert.EqualValues(t, 4, fairCall.BookedQuota)
	var fairEvent PointCallEvent
	require.NoError(t, db.First(&fairEvent, "id = ?", "fair:actual").Error)
	assert.Equal(t, "done", fairEvent.CacheState)
	assert.Equal(t, "done", fairEvent.LogState)
	var badOperation PointCallOperation
	require.NoError(t, db.First(&badOperation, "id = ?", "0-bad-op").Error)
	assert.Greater(t, badOperation.RetryAt, time.Now().UnixMilli())
	// A zero lower-priority account does not steal debt from the last account
	// actually consumed; a subsequent correction preserves its original type.
	require.NoError(t, db.Model(&PointAccount{}).Where("id = ?", gptAccount.Id).Update("available_points", 5).Error)
	require.NoError(t, db.Model(&PointAccount{}).Where("id = ?", generalAccount.Id).Update("available_points", 0).Error)
	require.NoError(t, CreatePointCall("last", user.Id, token.Id, "gpt-test", "1", "1000"))
	require.NoError(t, ReservePointCall("last", "last:reserve", 5, false))
	_, err = SetPointCallTarget("last", "last:actual", 8, true, false, nil)
	require.NoError(t, err)
	a = PointAccount{}
	require.NoError(t, db.First(&a, gptAccount.Id).Error)
	assert.EqualValues(t, -3, a.AvailablePoints)
	a = PointAccount{}
	require.NoError(t, db.First(&a, generalAccount.Id).Error)
	assert.Zero(t, a.AvailablePoints)
	_, err = SetPointCallTarget("last", "last:refund", 0, true, false, nil)
	require.NoError(t, err)
	require.NoError(t, db.Model(&PointAccount{}).Where("id = ?", gptAccount.Id).Update("available_points", 0).Error)
	// Parallel callers cannot hold more than the signed available balance.
	require.NoError(t, db.Model(&PointAccount{}).Where("id = ?", generalAccount.Id).Update("available_points", 50).Error)
	require.NoError(t, db.Model(&Token{}).Where("id = ?", token.Id).Update("remain_quota", 1000).Error)
	for i := range 8 {
		require.NoError(t, CreatePointCall(fmt.Sprintf("parallel-%d", i), user.Id, token.Id, "gpt-test", "1", "1000"))
	}
	if dialect != "sqlite" {
		sqlDB.SetMaxOpenConns(8)
	}
	answers := make(chan error, 8)
	var wg sync.WaitGroup
	for i := range 8 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			answers <- ReservePointCall(fmt.Sprintf("parallel-%d", i), fmt.Sprintf("parallel-%d:reserve", i), 10, false)
		}(i)
	}
	wg.Wait()
	close(answers)
	successful := 0
	for err := range answers {
		if err == nil {
			successful++
		} else {
			require.ErrorIs(t, err, ErrInsufficientPoints)
		}
	}
	assert.Equal(t, 5, successful)
	// Each account snapshot must reconcile to its preceding snapshot/version.
	var rows []PointLedger
	require.NoError(t, db.Order("account_id, account_version").Find(&rows).Error)
	for _, row := range rows {
		assert.Equal(t, row.AvailableBefore+row.AvailableDelta, row.AvailableAfter)
		assert.Equal(t, row.FrozenBefore+row.FrozenDelta, row.FrozenAfter)
	}
}
