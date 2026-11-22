package model

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestPointTypeAdminDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := "local"
			if dialect == "sqlite" {
				old := common.SQLitePath
				common.SQLitePath = filepath.Join(t.TempDir(), "point-type-admin.db")
				t.Cleanup(func() { common.SQLitePath = old })
			} else if dialect == "mysql" {
				dsn = os.Getenv("TEST_MYSQL_DSN")
			} else {
				dsn = os.Getenv("TEST_POSTGRES_DSN")
			}
			if dsn == "" {
				t.Skip("isolated test database DSN is not configured")
			}
			t.Setenv("POINT_TYPE_TEST_DSN", dsn)
			db, databaseType, err := chooseDB("POINT_TYPE_TEST_DSN", false)
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
			tables := []any{&PointType{}, &PointModelRule{}, &PointAccount{}, &CustomSubscriptionPlan{}, &CustomSubscriptionOrder{}, &InvitationCampaignVersion{}, &InvitationReward{}, &PointCallBilling{}}
			for _, table := range tables {
				require.False(t, db.Migrator().HasTable(table), "use a disposable database")
			}
			require.NoError(t, db.AutoMigrate(tables...))
			t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(tables...)) })
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("database version: %s", version)

			t.Run("create edit duplicate and version guard", func(t *testing.T) {
				typ, err := CreatePointType("RESEARCH_1", "研究积分", -10)
				require.NoError(t, err)
				assert.EqualValues(t, 1, typ.ConfigVersion)
				policy, err := GetPointEligibilityPolicy(typ.Id)
				require.NoError(t, err)
				assert.False(t, policy.Policy.Matches("anything", 0), "new types require explicit eligibility")
				_, err = CreatePointType(typ.Code, "Duplicate", 1)
				assert.ErrorIs(t, err, ErrPointTypeDuplicate)
				priority := 0
				saved, err := UpdatePointType(typ.Id, typ.ConfigVersion, "Updated", &priority)
				require.NoError(t, err)
				assert.Equal(t, 0, saved.ConsumePriority)
				assert.Equal(t, typ.Code, saved.Code)
				_, err = UpdatePointType(typ.Id, typ.ConfigVersion, "Stale", nil)
				assert.ErrorIs(t, err, ErrPointConfigConflict)
				assert.ErrorIs(t, DeletePointType(typ.Id, typ.ConfigVersion), ErrPointConfigConflict)
				require.NoError(t, DeletePointType(typ.Id, saved.ConfigVersion))
				assert.ErrorIs(t, DeletePointType(typ.Id, saved.ConfigVersion), ErrPointTypeNotFound)
				_, err = CreatePointType("lower", "Invalid", 1)
				assert.ErrorIs(t, err, ErrInvalidPointTypeCode)
				_, err = CreatePointType("INVALID_NAME", " leading", 1)
				assert.ErrorIs(t, err, ErrInvalidPointTypeName)
			})
			t.Run("GENERAL protected and legacy GPT preserved", func(t *testing.T) {
				general := PointType{Code: PointTypeGeneral, Name: "Custom general", ConsumePriority: -3}
				gpt := PointType{Code: PointTypeGPT, Name: "Historical GPT", ConsumePriority: 213}
				require.NoError(t, db.Create(&general).Error)
				require.NoError(t, db.Create(&gpt).Error)
				legacyRule := PointModelRule{PointTypeId: gpt.Id, MatchType: PointMatchPattern, MatchValue: "changed-*", Enabled: false}
				require.NoError(t, db.Create(&legacyRule).Error)
				for range 2 {
					require.NoError(t, initializePointTypes(db))
				}
				var preserved PointType
				require.NoError(t, db.First(&preserved, gpt.Id).Error)
				assert.Equal(t, gpt, preserved)
				require.NoError(t, db.First(&preserved, gpt.Id).Error)
				assert.ErrorIs(t, DeletePointType(general.Id, general.ConfigVersion), ErrPointTypeProtected)
				require.NoError(t, DeletePointType(gpt.Id, gpt.ConfigVersion))
				require.NoError(t, initializePointTypes(db))
				var count int64
				require.NoError(t, db.Model(&PointType{}).Where("code = ?", PointTypeGPT).Count(&count).Error)
				assert.Zero(t, count, "GPT must not return after removal")
				require.NoError(t, db.Model(&PointModelRule{}).Where("point_type_id = ?", gpt.Id).Count(&count).Error)
				assert.Zero(t, count, "owned rules are removed with unused type")
				preserved = PointType{}
				require.NoError(t, db.First(&preserved, general.Id).Error)
				assert.Equal(t, general, preserved)
			})
			references := []struct {
				name string
				row  func(int64) any
				want error
			}{
				{"zero balance account", func(id int64) any { return &PointAccount{UserId: 1, PointTypeId: id} }, ErrPointTypeHasAccounts},
				{"disabled plan paid", func(id int64) any { return &CustomSubscriptionPlan{Code: "paid", PaidPointTypeId: id} }, ErrPointTypeHasPlans},
				{"disabled plan bonus", func(id int64) any { return &CustomSubscriptionPlan{Code: "bonus", BonusPointTypeId: &id} }, ErrPointTypeHasPlans},
				{"disabled plan automatic bonus", func(id int64) any { return &CustomSubscriptionPlan{Code: "auto", AutoBonusPointTypeId: &id} }, ErrPointTypeHasPlans},
				{"unpaid order paid", func(id int64) any {
					return &CustomSubscriptionOrder{TradeNo: "paid", PaidPointTypeId: id, Status: "pending"}
				}, ErrPointTypeHasOrders},
				{"historical order bonus", func(id int64) any {
					return &CustomSubscriptionOrder{TradeNo: "bonus", BonusPointTypeId: &id, Status: "paid"}
				}, ErrPointTypeHasOrders},
				{"historical order automatic bonus", func(id int64) any { return &CustomSubscriptionOrder{TradeNo: "auto", AutoBonusPointTypeId: &id} }, ErrPointTypeHasOrders},
				{"historical campaign", func(id int64) any {
					return &InvitationCampaignVersion{RewardPointTypeId: id, CampaignId: id, Version: 1}
				}, ErrPointTypeHasCampaigns},
				{"cancelled reward", func(id int64) any {
					return &InvitationReward{OrderId: id, PointTypeId: id, Status: InvitationRewardCancelled}
				}, ErrPointTypeHasRewards},
				{"historical candidate snapshot", func(id int64) any {
					s := fmt.Sprintf(`{"version":1,"types":[{"type_id":%d}]}`, id)
					return &PointCallBilling{ID: fmt.Sprint(id), EligibilitySnapshot: &s, Allocations: "[]", State: "refunded"}
				}, ErrPointTypeHasCalls},
				{"legacy allocation", func(id int64) any {
					return &PointCallBilling{ID: fmt.Sprint(id), Allocations: fmt.Sprintf(`[{"type_id":%d}]`, id), State: "charged"}
				}, ErrPointTypeHasCalls},
			}
			for i, tc := range references {
				t.Run(tc.name, func(t *testing.T) {
					typ, err := CreatePointType(fmt.Sprintf("REFERENCE_%d", i), tc.name, 1)
					require.NoError(t, err)
					row := tc.row(typ.Id)
					require.NoError(t, db.Create(row).Error)
					assert.ErrorIs(t, DeletePointType(typ.Id, typ.ConfigVersion), tc.want)
					var kept PointType
					require.NoError(t, db.First(&kept, typ.Id).Error)
					require.NoError(t, db.Delete(row).Error)
					require.NoError(t, DeletePointType(typ.Id, typ.ConfigVersion))
				})
			}
			t.Run("billing scan visits later batches and compares exact type IDs", func(t *testing.T) {
				typ, err := CreatePointType("BATCHED", "Batched", 1)
				require.NoError(t, err)
				calls := make([]PointCallBilling, 201)
				for i := range calls {
					calls[i] = PointCallBilling{ID: fmt.Sprintf("batch-%03d", i), Allocations: fmt.Sprintf(`[{"type_id":%d}]`, typ.Id+1000)}
				}
				calls[200].Allocations = fmt.Sprintf(`[{"type_id":%d}]`, typ.Id)
				require.NoError(t, db.CreateInBatches(&calls, 50).Error)
				assert.ErrorIs(t, DeletePointType(typ.Id, typ.ConfigVersion), ErrPointTypeHasCalls)
				require.NoError(t, db.Model(&PointCallBilling{}).Where("id = ?", calls[200].ID).Update("allocations", "[]").Error)
				require.NoError(t, DeletePointType(typ.Id, typ.ConfigVersion), "different numeric IDs must not count as this type")
				ids := make([]string, len(calls))
				for i := range calls {
					ids[i] = calls[i].ID
				}
				require.NoError(t, db.Where("id IN ?", ids).Delete(&PointCallBilling{}).Error)
			})

			t.Run("malformed billing fails closed and deletion rolls back rules", func(t *testing.T) {
				typ := PointType{Code: "ROLLBACK", Name: "Rollback"}
				require.NoError(t, db.Create(&typ).Error)
				rule := PointModelRule{PointTypeId: typ.Id, MatchType: PointMatchExact, MatchValue: "x"}
				require.NoError(t, db.Create(&rule).Error)
				call := PointCallBilling{ID: "malformed", Allocations: "invalid JSON"}
				require.NoError(t, db.Create(&call).Error)
				require.Error(t, DeletePointType(typ.Id, typ.ConfigVersion))
				require.NoError(t, db.First(&rule, rule.Id).Error)
				require.NoError(t, db.Delete(&call).Error)
				const callback = "point-type-test:fail-delete"
				failure := errors.New("forced type delete failure")
				require.NoError(t, db.Callback().Delete().Before("gorm:delete").Register(callback, func(tx *gorm.DB) {
					if tx.Statement.Table == "point_types" {
						tx.AddError(failure)
					}
				}))
				assert.ErrorIs(t, DeletePointType(typ.Id, typ.ConfigVersion), failure)
				require.NoError(t, db.Callback().Delete().Remove(callback))
				require.NoError(t, db.First(&rule, rule.Id).Error)
				require.NoError(t, DeletePointType(typ.Id, typ.ConfigVersion))
			})
			t.Run("missing reference table fails closed without deleting configuration", func(t *testing.T) {
				typ, err := CreatePointType("MISSING_TABLE", "Missing table", 1)
				require.NoError(t, err)
				require.NoError(t, db.Migrator().DropTable(&InvitationReward{}))
				require.Error(t, DeletePointType(typ.Id, typ.ConfigVersion))
				var kept PointType
				require.NoError(t, db.First(&kept, typ.Id).Error)
				require.NoError(t, db.AutoMigrate(&InvitationReward{}))
				require.NoError(t, DeletePointType(typ.Id, typ.ConfigVersion))
			})

		})
	}
}
