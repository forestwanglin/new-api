package model

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCustomSubscriptionDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := os.Getenv("TEST_" + strings.ToUpper(dialect) + "_DSN")
			if dialect == "sqlite" {
				dsn = "local"
				old := common.SQLitePath
				common.SQLitePath = filepath.Join(t.TempDir(), "custom.db")
				t.Cleanup(func() { common.SQLitePath = old })
			}
			if dsn == "" {
				t.Skip("isolated test database DSN is not configured")
			}
			t.Setenv("CUSTOM_SUB_TEST_DSN", dsn)
			db, databaseType, err := chooseDB("CUSTOM_SUB_TEST_DSN", false)
			require.NoError(t, err)
			oldDB, oldType := DB, common.MainDatabaseType()
			DB = db
			common.SetMainDatabaseType(databaseType)
			t.Cleanup(func() { DB = oldDB; common.SetMainDatabaseType(oldType) })
			require.False(t, db.Migrator().HasTable(&PointType{}))
			require.NoError(t, db.AutoMigrate(&PointType{}))

			pt := PointType{Code: "CUSTOM_TEST", Name: "Custom"}
			require.NoError(t, db.Create(&pt).Error)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(&PointType{})); require.NoError(t, sqlDB.Close()) })
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Log(version)
			for _, scenario := range []string{"fresh", "existing_schema"} {
				t.Run(scenario, func(t *testing.T) {
					require.False(t, db.Migrator().HasTable(&CustomSubscriptionPlan{}))
					require.False(t, db.Migrator().HasTable(&CustomSubscriptionOrder{}))
					t.Cleanup(func() {
						require.NoError(t, db.Migrator().DropTable(&CustomSubscriptionOrder{}, &CustomSubscriptionPlan{}))
					})
					type legacy struct {
						Id    int64 `gorm:"primaryKey"`
						Quota int64
					}
					if scenario == "existing_schema" {
						require.NoError(t, db.Table("custom_sub_test_legacy").AutoMigrate(&legacy{}))
						require.NoError(t, db.Table("custom_sub_test_legacy").Create(&legacy{Id: 1, Quota: 9876543210}).Error)
						t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable("custom_sub_test_legacy")) })
					}
					require.NoError(t, migrateCustomSubscriptions(db))
					recorder := &migrationSQLRecorder{}
					require.NoError(t, migrateCustomSubscriptions(db.Session(&gorm.Session{Logger: recorder})))
					assert.Empty(t, recorder.schemaMutations())
					input := CustomSubscriptionPlanInput{Code: "managed", Title: "100%_literal", TierCode: "basic", TierRank: 1, BillingCycle: "month", DurationMonths: 1, Currency: "CNY", PriceAmountMinor: 100, PaidPoints: 101, PaidPointTypeId: pt.Id, Enabled: true, BenefitsJson: "[]"}
					managed, err := CreateCustomSubscriptionPlan(input)
					require.NoError(t, err)
					input.Enabled = false
					input.SortOrder = 0
					managed, err = UpdateCustomSubscriptionPlan(managed.Id, 1, input)
					require.NoError(t, err)
					assert.False(t, managed.Enabled)
					assert.EqualValues(t, 2, managed.Version)
					_, err = UpdateCustomSubscriptionPlan(managed.Id, 1, input)
					require.ErrorIs(t, err, ErrCustomSubscriptionConflict)
					_, err = CreateCustomSubscriptionPlan(input)
					require.ErrorIs(t, err, ErrCustomSubscriptionDuplicate)
					filtered, total, err := ListCustomSubscriptionPlans(CustomSubscriptionPlanFilter{Page: 1, PageSize: 20, Keyword: "%_", Enabled: &input.Enabled})
					require.NoError(t, err)
					assert.EqualValues(t, 1, total)
					require.Len(t, filtered, 1)
					var orderCount int64
					require.NoError(t, db.Model(&CustomSubscriptionOrder{}).Count(&orderCount).Error)
					assert.Zero(t, orderCount)
					assert.Greater(t, managed.CreatedAt, time.Now().Add(-time.Minute).UnixMilli())
					require.NoError(t, DeleteCustomSubscriptionPlan(managed.Id))
					input.PaidPointTypeId = 999999
					_, err = CreateCustomSubscriptionPlan(input)
					require.ErrorIs(t, err, ErrPointTypeNotFound)
					p := CustomSubscriptionPlan{Code: "test", PriceAmountMinor: 9007199254740993, PaidPoints: 9223372036854775807, Version: 1}
					require.NoError(t, db.Create(&p).Error)
					var saved CustomSubscriptionPlan
					require.NoError(t, db.First(&saved, p.Id).Error)
					assert.Equal(t, p, saved)
					p.Id = 0
					require.Error(t, db.Create(&p).Error)
					for _, index := range []string{"idx_cso_trade", "idx_cso_provider", "idx_cso_renewal", "idx_cso_transaction", "idx_cso_user_time", "idx_cso_plan", "idx_cso_status_expiry", "idx_cso_fulfill_time"} {
						assert.True(t, db.Migrator().HasIndex(&CustomSubscriptionOrder{}, index), index)
					}
					for _, trade := range []string{"a", "b"} {
						require.NoError(t, db.Create(&CustomSubscriptionOrder{TradeNo: trade, PlanId: saved.Id, UserId: 9007199254740993}).Error)
					}
					require.ErrorIs(t, DeleteCustomSubscriptionPlan(saved.Id), ErrCustomSubscriptionHasOrders)
					var nullable CustomSubscriptionOrder
					require.NoError(t, db.Where("trade_no = ?", "a").First(&nullable).Error)
					assert.Nil(t, nullable.ProviderTradeNo)
					assert.Nil(t, nullable.RenewalDueAt)
					assert.Nil(t, nullable.PointTransactionId)
					assert.Nil(t, nullable.PaidAt)
					assert.EqualValues(t, 9007199254740993, nullable.UserId)
					agreement, due, transaction := int64(9007199254740993), time.Now().UnixMilli(), int64(9007199254740994)
					renewal := CustomSubscriptionOrder{TradeNo: "renewal-a", RenewalAgreementId: &agreement, RenewalDueAt: &due, PointTransactionId: &transaction}
					require.NoError(t, db.Create(&renewal).Error)
					renewal.Id = 0
					renewal.TradeNo = "renewal-b"
					renewal.PointTransactionId = nil
					require.Error(t, db.Create(&renewal).Error)
					renewal.RenewalAgreementId = nil
					renewal.RenewalDueAt = nil
					renewal.PointTransactionId = &transaction
					require.Error(t, db.Create(&renewal).Error)
					provider := "external"
					order := CustomSubscriptionOrder{TradeNo: "c", PaymentProvider: "test", ProviderTradeNo: &provider}
					require.NoError(t, db.Create(&order).Error)
					order.Id = 0
					order.TradeNo = "d"
					require.Error(t, db.Create(&order).Error)
					// Repeat startup migration with real custom configuration and orders
					// present, not only with empty tables.
					var plansBefore []CustomSubscriptionPlan
					var ordersBefore []CustomSubscriptionOrder
					require.NoError(t, db.Order("id").Find(&plansBefore).Error)
					require.NoError(t, db.Order("id").Find(&ordersBefore).Error)
					require.NotEmpty(t, plansBefore)
					require.NotEmpty(t, ordersBefore)
					for range 2 {
						recorder := &migrationSQLRecorder{}
						require.NoError(t, migrateCustomSubscriptions(db.Session(&gorm.Session{Logger: recorder})))
						assert.Empty(t, recorder.schemaMutations())
						var plansAfter []CustomSubscriptionPlan
						var ordersAfter []CustomSubscriptionOrder
						require.NoError(t, db.Order("id").Find(&plansAfter).Error)
						require.NoError(t, db.Order("id").Find(&ordersAfter).Error)
						assert.Equal(t, plansBefore, plansAfter)
						assert.Equal(t, ordersBefore, ordersAfter)
					}
					if scenario == "existing_schema" {
						var row legacy
						require.NoError(t, db.Table("custom_sub_test_legacy").First(&row).Error)
						assert.EqualValues(t, 9876543210, row.Quota)
					}
				})
			}
		})
	}
}
