package model

import (
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestPointEligibilityAdminDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := "local"
			if dialect == "sqlite" {
				old := common.SQLitePath
				common.SQLitePath = filepath.Join(t.TempDir(), "eligibility.db")
				t.Cleanup(func() { common.SQLitePath = old })
			} else if dialect == "mysql" {
				dsn = os.Getenv("TEST_MYSQL_DSN")
			} else {
				dsn = os.Getenv("TEST_POSTGRES_DSN")
			}
			if dsn == "" {
				t.Skip("isolated test database DSN is not configured")
			}
			t.Setenv("POINT_POLICY_TEST_DSN", dsn)
			db, databaseType, err := chooseDB("POINT_POLICY_TEST_DSN", false)
			require.NoError(t, err)
			oldDB, oldType := DB, common.MainDatabaseType()
			DB = db
			common.SetMainDatabaseType(databaseType)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			if dialect == "sqlite" {
				sqlDB.SetMaxOpenConns(1)
			}
			t.Cleanup(func() { DB = oldDB; common.SetMainDatabaseType(oldType); require.NoError(t, sqlDB.Close()) })
			for _, table := range []any{&PointType{}, &PointModelRule{}} {
				require.False(t, db.Migrator().HasTable(table), "use a disposable database")
			}
			require.False(t, db.Migrator().HasTable("channels"), "use a disposable database")
			require.NoError(t, db.AutoMigrate(&PointType{}, &PointModelRule{}))
			type channel struct {
				Id   int `gorm:"primaryKey"`
				Name string
			}
			require.NoError(t, db.Table("channels").AutoMigrate(&channel{}))
			t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(&PointModelRule{}, &PointType{}, "channels")) })
			require.NoError(t, db.Table("channels").Create(&channel{Id: 12, Name: "channel twelve"}).Error)
			typ := PointType{Code: "CUSTOM", Name: "Original", ConsumePriority: 17}
			require.NoError(t, db.Create(&typ).Error)
			require.EqualValues(t, 1, typ.ConfigVersion)
			rule := &PointModelRule{MatchType: PointMatchExact, MatchValue: "a", Enabled: true}
			require.NoError(t, CreatePointModelRule(typ.Id, rule))
			legacy, err := GetPointEligibilityPolicy(typ.Id)
			require.NoError(t, err)
			assert.EqualValues(t, 2, legacy.ConfigVersion)
			assert.True(t, legacy.Policy.Matches("a", 0))
			renamed, err := RenamePointType(typ.Id, legacy.ConfigVersion, "动态名称")
			require.NoError(t, err)
			assert.Equal(t, "动态名称", renamed.Name)
			assert.Equal(t, typ.Code, renamed.Code)
			assert.Equal(t, 17, renamed.ConsumePriority)
			_, err = RenamePointType(typ.Id, legacy.ConfigVersion, "stale")
			assert.ErrorIs(t, err, ErrPointConfigConflict)
			policy := &PointEligibilityPolicy{Version: 1, Operator: "AND", Groups: []PointEligibilityGroup{{Operator: "OR", Enabled: true, Conditions: []PointEligibilityCondition{{Kind: "MODEL", MatchType: "EXACT", MatchValue: "b", Enabled: true}}}, {Operator: "OR", Enabled: true, Conditions: []PointEligibilityCondition{{Kind: "CHANNEL", ChannelID: "12", Enabled: true}}}}}
			saved, err := UpdatePointEligibilityPolicy(typ.Id, renamed.ConfigVersion, policy)
			require.NoError(t, err)
			assert.True(t, saved.Policy.Matches("b", 12))
			assert.False(t, saved.Policy.Matches("b", 13))
			assert.False(t, saved.Policy.Matches("a", 12))
			assert.ErrorIs(t, CreatePointModelRule(typ.Id, &PointModelRule{MatchType: PointMatchExact, MatchValue: "hidden", Enabled: true}), ErrPointPolicyManaged)
			_, err = UpdatePointModelRule(typ.Id, rule.Id, rule)
			assert.ErrorIs(t, err, ErrPointPolicyManaged)
			assert.ErrorIs(t, DeletePointModelRule(typ.Id, rule.Id), ErrPointPolicyManaged)
			rules, err := GetPointModelRules(typ.Id)
			require.NoError(t, err)
			require.Len(t, rules, 1)
			assert.Equal(t, "a", string(rules[0].MatchValue))
			policy.Groups[1].Conditions[0].ChannelID = "99"
			_, err = UpdatePointEligibilityPolicy(typ.Id, saved.ConfigVersion, policy)
			assert.ErrorIs(t, err, ErrPointPolicyChannelNotFound)
			read, err := GetPointEligibilityPolicy(typ.Id)
			require.NoError(t, err)
			assert.Equal(t, saved, read, "invalid channel cannot alter policy/version")
			var workers sync.WaitGroup
			results := make(chan error, 2)
			for _, name := range []string{"Winner One", "Winner Two"} {
				workers.Go(func() { _, err := RenamePointType(typ.Id, saved.ConfigVersion, name); results <- err })
			}
			workers.Wait()
			close(results)
			success, conflicts := 0, 0
			for err := range results {
				if err == nil {
					success++
				} else {
					require.ErrorIs(t, err, ErrPointConfigConflict)
					conflicts++
				}
			}
			assert.Equal(t, 1, success)
			assert.Equal(t, 1, conflicts)
			read, err = GetPointEligibilityPolicy(typ.Id)
			require.NoError(t, err)
			empty := &PointEligibilityPolicy{Version: 1, Operator: "AND", Groups: []PointEligibilityGroup{}}
			saved, err = UpdatePointEligibilityPolicy(typ.Id, read.ConfigVersion, empty)
			require.NoError(t, err)
			assert.False(t, saved.Policy.Matches("a", 12))
			catalog, err := GetPointCatalog()
			require.NoError(t, err)
			require.Len(t, catalog, 1)
			assert.Equal(t, typ.Code, catalog[0].Code)
			assert.NotEqual(t, "Original", catalog[0].Name)
			_, err = RenamePointType(typ.Id, saved.ConfigVersion, " bad")
			assert.ErrorIs(t, err, ErrInvalidPointTypeName)
			require.NoError(t, db.AutoMigrate(&PointType{}, &PointModelRule{}))
			require.NoError(t, db.AutoMigrate(&PointType{}, &PointModelRule{}))
			after, err := GetPointEligibilityPolicy(typ.Id)
			require.NoError(t, err)
			assert.Equal(t, saved, after)
			// A failed write rolls back the shared version as well as the requested name.
			const callback = "point-policy-test:fail-write"
			require.NoError(t, db.Callback().Update().Before("gorm:update").Register(callback, func(tx *gorm.DB) {
				if tx.Statement.Table == "point_types" && tx.Statement.Changed("name") {
					tx.AddError(gorm.ErrInvalidData)
				}
			}))
			_, err = RenamePointType(typ.Id, after.ConfigVersion, "must rollback")
			require.Error(t, err)
			require.NoError(t, db.Callback().Update().Remove(callback))
			var persisted PointType
			require.NoError(t, db.First(&persisted, typ.Id).Error)
			assert.Equal(t, after.ConfigVersion, persisted.ConfigVersion)
		})
	}
}

// The fixture reproduces the immediately preceding PointType schema, including
// customized data; it does not claim to be a full released-application fixture.
func TestPointEligibilityUpgradeDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := "local"
			if dialect == "sqlite" {
				old := common.SQLitePath
				common.SQLitePath = filepath.Join(t.TempDir(), "policy-upgrade.db")
				t.Cleanup(func() { common.SQLitePath = old })
			} else if dialect == "mysql" {
				dsn = os.Getenv("TEST_MYSQL_DSN")
			} else {
				dsn = os.Getenv("TEST_POSTGRES_DSN")
			}
			if dsn == "" {
				t.Skip("isolated test database DSN is not configured")
			}
			t.Setenv("POINT_POLICY_UPGRADE_DSN", dsn)
			db, databaseType, err := chooseDB("POINT_POLICY_UPGRADE_DSN", false)
			require.NoError(t, err)
			oldDB, oldType := DB, common.MainDatabaseType()
			DB = db
			common.SetMainDatabaseType(databaseType)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { DB = oldDB; common.SetMainDatabaseType(oldType); require.NoError(t, sqlDB.Close()) })
			type legacyType struct {
				Id              int64  `gorm:"primaryKey"`
				Code            string `gorm:"type:varchar(32);not null;uniqueIndex:idx_point_types_code"`
				Name            string `gorm:"type:varchar(64);not null"`
				ConsumePriority int    `gorm:"not null"`
				CreatedAt       int64  `gorm:"autoCreateTime:milli"`
				UpdatedAt       int64  `gorm:"autoUpdateTime:milli"`
			}
			for _, table := range []any{&PointType{}, &PointModelRule{}, &PointAccount{}} {
				require.False(t, db.Migrator().HasTable(table), "use a disposable database")
			}
			require.NoError(t, db.Table("point_types").AutoMigrate(&legacyType{}))
			require.NoError(t, db.AutoMigrate(&PointModelRule{}, &PointAccount{}))
			t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(&PointModelRule{}, &PointAccount{}, &PointType{})) })
			original := legacyType{Id: 7, Code: "CUSTOM", Name: "Preserved name", ConsumePriority: 51}
			require.NoError(t, db.Table("point_types").Create(&original).Error)
			rule := PointModelRule{PointTypeId: 7, MatchType: PointMatchPattern, MatchValue: "Vendor-*", Enabled: true}
			require.NoError(t, db.Create(&rule).Error)
			account := PointAccount{UserId: 19, PointTypeId: 7, AvailablePoints: -18, FrozenPoints: 4, Version: 9}
			require.NoError(t, db.Create(&account).Error)
			require.NoError(t, db.AutoMigrate(&PointType{}, &PointModelRule{}))
			recorder := &migrationSQLRecorder{}
			require.NoError(t, db.Session(&gorm.Session{Logger: recorder}).AutoMigrate(&PointType{}, &PointModelRule{}))
			assert.Empty(t, recorder.schemaMutations(), "second migration emits no schema change")
			var saved PointType
			require.NoError(t, db.First(&saved, 7).Error)
			assert.Equal(t, "Preserved name", saved.Name)
			assert.Equal(t, "CUSTOM", saved.Code)
			assert.Equal(t, 51, saved.ConsumePriority)
			assert.Equal(t, original.CreatedAt, saved.CreatedAt)
			assert.Equal(t, original.UpdatedAt, saved.UpdatedAt)
			assert.EqualValues(t, 1, saved.ConfigVersion)
			assert.Nil(t, saved.EligibilityPolicy)
			policy, err := GetPointEligibilityPolicy(7)
			require.NoError(t, err)
			assert.True(t, policy.Policy.Matches("Vendor-a", 0))
			assert.False(t, policy.Policy.Matches("vendor-a", 0))
			var savedRule PointModelRule
			require.NoError(t, db.First(&savedRule, rule.Id).Error)
			assert.Equal(t, rule, savedRule)
			var savedAccount PointAccount
			require.NoError(t, db.First(&savedAccount, account.Id).Error)
			assert.Equal(t, account, savedAccount)
			assert.True(t, db.Migrator().HasIndex(&PointType{}, "idx_point_types_code"))
			assert.True(t, db.Migrator().HasIndex(&PointModelRule{}, "idx_point_model_rules_match"))
		})
	}
}
