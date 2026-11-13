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
						require.NoError(t, db.Migrator().DropTable(&CustomSubscriptionEvent{}, &CustomUserSubscriptionState{}, &CustomUserSubscription{}, &CustomSubscriptionRule{}, &CustomSubscriptionOrder{}, &CustomSubscriptionPlan{}))
					})
					type legacy struct {
						Id    int64 `gorm:"primaryKey"`
						Quota int64
					}
					if scenario == "existing_schema" {
						require.NoError(t, db.Table("custom_sub_test_legacy").AutoMigrate(&legacy{}))
						require.NoError(t, db.Table("custom_sub_test_legacy").Create(&legacy{Id: 1, Quota: 9876543210}).Error)
						t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable("custom_sub_test_legacy")) })
						// Reconstruct the exact additive pre-scheduling custom schema:
						// plans/orders existed, but neither had priority or runtime tables.
						require.NoError(t, db.AutoMigrate(&CustomSubscriptionPlan{}, &CustomSubscriptionOrder{}, &CustomSubscriptionRule{}))
						require.NoError(t, db.Migrator().DropColumn(&CustomSubscriptionPlan{}, "priority"))
						require.NoError(t, db.Migrator().DropColumn(&CustomSubscriptionOrder{}, "priority"))
						require.False(t, db.Migrator().HasColumn(&CustomSubscriptionPlan{}, "priority"))
						require.False(t, db.Migrator().HasColumn(&CustomSubscriptionOrder{}, "priority"))
						require.False(t, db.Migrator().HasTable(&CustomUserSubscription{}))
						oldPlan := CustomSubscriptionPlan{Id: 7001, Code: "historical", Title: "Historical", BillingCycle: "month", DurationMonths: 1, PriceAmountMinor: 9007199254740993, PaidPoints: 9007199254740993, PaidPointTypeId: pt.Id, BenefitsJson: "[]", Version: 3}
						require.NoError(t, db.Omit("Priority").Create(&oldPlan).Error)
						oldOrder := CustomSubscriptionOrder{Id: 7001, TradeNo: "historical-order", UserId: 9007199254740993, PlanId: oldPlan.Id, PlanVersion: 3, PlanSnapshot: `{"title":"Historical"}`, BillingCycle: "month", DurationMonths: 1}
						require.NoError(t, db.Omit("Priority").Create(&oldOrder).Error)
					}
					require.NoError(t, migrateCustomSubscriptions(db))
					if scenario == "existing_schema" {
						var historicalPlan CustomSubscriptionPlan
						var historicalOrder CustomSubscriptionOrder
						require.NoError(t, db.First(&historicalPlan, 7001).Error)
						require.NoError(t, db.First(&historicalOrder, 7001).Error)
						assert.Zero(t, historicalPlan.Priority)
						assert.Zero(t, historicalOrder.Priority)
						assert.EqualValues(t, 9007199254740993, historicalPlan.PriceAmountMinor)
						assert.EqualValues(t, 9007199254740993, historicalPlan.PaidPoints)
						assert.EqualValues(t, 3, historicalPlan.Version)
						assert.EqualValues(t, 9007199254740993, historicalOrder.UserId)
						assert.Equal(t, `{"title":"Historical"}`, historicalOrder.PlanSnapshot)
						assert.Nil(t, historicalOrder.ProviderTradeNo)
						assert.Nil(t, historicalOrder.PaidAt)
					}
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
					if scenario == "existing_schema" {
						assert.EqualValues(t, 1, orderCount)
					} else {
						assert.Zero(t, orderCount)
					}
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

func TestSubscriptionRuleContent(t *testing.T) {
	valid := `{"blocks":[{"type":"paragraph","children":[{"text":"<script>literal</script>","style":{"fontWeight":700,"color":"#0052d9","backgroundColor":"#eaf3ff"}}]}]}`
	content, err := ParseSubscriptionRuleContent([]byte(valid))
	require.NoError(t, err)
	require.Len(t, content.Blocks, 1)
	assert.Equal(t, "<script>literal</script>", content.Blocks[0].Children[0].Text)
	for name, raw := range map[string]string{
		"unknown document field": strings.Replace(valid, `{"blocks":`, `{"extra":true,"blocks":`, 1),
		"unknown block field":    strings.Replace(valid, `"type":"paragraph"`, `"type":"paragraph","html":"x"`, 1),
		"unknown fragment field": strings.Replace(valid, `"text":`, `"onclick":"alert()","text":`, 1),
		"arbitrary CSS":          strings.Replace(valid, `"fontWeight":700`, `"fontWeight":700,"position":"fixed"`, 1),
		"unsafe color":           strings.Replace(valid, "#0052d9", "url(https://example.com)", 1),
		"invalid weight":         strings.Replace(valid, `"fontWeight":700`, `"fontWeight":900`, 1),
		"null style":             strings.Replace(valid, `{"fontWeight":700,"color":"#0052d9","backgroundColor":"#eaf3ff"}`, `null`, 1),
		"empty document":         `{"blocks":[]}`,
		"blank content":          `{"blocks":[{"type":"paragraph","children":[{"text":"  "}]}]}`,
		"too much text":          strings.Replace(valid, "<script>literal</script>", strings.Repeat("中", 10001), 1),
		"trailing JSON":          valid + `{}`,
	} {
		t.Run(name, func(t *testing.T) {
			_, err := ParseSubscriptionRuleContent([]byte(raw))
			require.ErrorIs(t, err, ErrSubscriptionRuleFields)
		})
	}
}

func TestSubscriptionRuleDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := os.Getenv("TEST_" + strings.ToUpper(dialect) + "_DSN")
			if dialect == "sqlite" {
				dsn = "local"
				old := common.SQLitePath
				common.SQLitePath = filepath.Join(t.TempDir(), "rules.db")
				t.Cleanup(func() { common.SQLitePath = old })
			}
			if dsn == "" {
				t.Skip("isolated test database DSN is not configured")
			}
			t.Setenv("CUSTOM_RULE_TEST_DSN", dsn)
			db, databaseType, err := chooseDB("CUSTOM_RULE_TEST_DSN", false)
			require.NoError(t, err)
			oldDB, oldType := DB, common.MainDatabaseType()
			DB = db
			common.SetMainDatabaseType(databaseType)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			t.Cleanup(func() { DB = oldDB; common.SetMainDatabaseType(oldType); require.NoError(t, sqlDB.Close()) })
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Log(version)
			for _, scenario := range []string{"fresh", "existing_plan_schema", "preexisting_rules"} {
				t.Run(scenario, func(t *testing.T) {
					require.False(t, db.Migrator().HasTable(&CustomSubscriptionRule{}))
					t.Cleanup(func() {
						require.NoError(t, db.Migrator().DropTable(&CustomSubscriptionEvent{}, &CustomUserSubscriptionState{}, &CustomUserSubscription{}, &CustomSubscriptionRule{}, &CustomSubscriptionOrder{}, &CustomSubscriptionPlan{}, &Option{}))
					})
					require.NoError(t, db.AutoMigrate(&Option{}))
					if scenario == "existing_plan_schema" {
						require.NoError(t, db.AutoMigrate(&CustomSubscriptionPlan{}, &CustomSubscriptionOrder{}))
						require.NoError(t, db.Create(&CustomSubscriptionPlan{Code: "existing", Title: "preserved", Version: 7}).Error)
					}
					require.NoError(t, migrateCustomSubscriptions(db))
					if scenario == "preexisting_rules" {
						managed := CustomSubscriptionRule{RuleKey: "existing_rule", Title: "Keep managed text", ContentJson: `{"blocks":[{"type":"paragraph","children":[{"text":"Existing content"}]}]}`, Enabled: true, Version: 4}
						require.NoError(t, db.Create(&managed).Error)
						require.NoError(t, InitializeCustomSubscriptionRules(db))
						items, err := ReadCustomSubscriptionRules(nil)
						require.NoError(t, err)
						require.Len(t, items, 1)
						assert.Equal(t, managed, items[0])
						return
					}
					// Two startup transactions contend for one unique seed claim.
					// SQLite shares a single connection; server databases use two.
					if dialect != "sqlite" {
						sqlDB.SetMaxOpenConns(2)
					}
					start := make(chan struct{})
					failures := make(chan error, 2)
					for range 2 {
						go func() { <-start; failures <- InitializeCustomSubscriptionRules(db) }()
					}
					close(start)
					for range 2 {
						require.NoError(t, <-failures)
					}
					sqlDB.SetMaxOpenConns(1)
					require.NoError(t, InitializeCustomSubscriptionRules(db))
					rules, err := ReadCustomSubscriptionRules(nil)
					require.NoError(t, err)
					require.Len(t, rules, 11)
					assert.Equal(t, "monthly_price", rules[0].RuleKey)
					assert.Equal(t, "cycle_switch", rules[10].RuleKey)
					initial, err := ParseSubscriptionRuleContent([]byte(rules[0].ContentJson))
					require.NoError(t, err)
					assert.Equal(t, "#0052d9", initial.Blocks[0].Children[1].Style.Color)
					options, err := AllOption()
					require.NoError(t, err)
					assert.Empty(t, options)
					require.ErrorIs(t, UpdateOption(customSubscriptionRuleSeedKey, "reset"), ErrSubscriptionRuleFields)
					require.ErrorIs(t, UpdateOptionsBulk(map[string]string{customSubscriptionRuleSeedKey: "reset"}), ErrSubscriptionRuleFields)
					plan := CustomSubscriptionPlan{Code: "scope", Title: "Scope", Enabled: true, Version: 1}
					require.NoError(t, db.Create(&plan).Error)
					input := CustomSubscriptionRule{PlanId: &plan.Id, RuleKey: "scoped", Title: "Scoped 100%_literal", ContentJson: rules[0].ContentJson, Enabled: true}
					scoped, err := SaveCustomSubscriptionRule(0, 0, input)
					require.NoError(t, err)
					_, err = SaveCustomSubscriptionRule(0, 0, input)
					require.ErrorIs(t, err, ErrSubscriptionRuleDuplicate)
					require.ErrorIs(t, DeleteCustomSubscriptionPlan(plan.Id), ErrCustomSubscriptionHasRules)
					effective, err := ReadCustomSubscriptionRules(&plan.Id)
					require.NoError(t, err)
					assert.Len(t, effective, 12)
					globals, err := ReadCustomSubscriptionRules(nil)
					require.NoError(t, err)
					assert.Len(t, globals, 11)
					matches, total, err := ListCustomSubscriptionRules(CustomSubscriptionRuleFilter{Page: 1, PageSize: 20, Keyword: "%_", Scope: "plan"})
					require.NoError(t, err)
					assert.EqualValues(t, 1, total)
					require.Len(t, matches, 1)
					input.Enabled = false
					input.SortOrder = 0
					saved, err := SaveCustomSubscriptionRule(scoped.Id, 1, input)
					require.NoError(t, err)
					assert.False(t, saved.Enabled)
					assert.EqualValues(t, 2, saved.Version)
					_, err = SaveCustomSubscriptionRule(scoped.Id, 1, input)
					require.ErrorIs(t, err, ErrSubscriptionRuleConflict)
					input.RuleKey = "changed"
					_, err = SaveCustomSubscriptionRule(scoped.Id, 2, input)
					require.ErrorIs(t, err, ErrSubscriptionRuleKeyChanged)
					effective, err = ReadCustomSubscriptionRules(&plan.Id)
					require.NoError(t, err)
					assert.Len(t, effective, 11)
					require.NoError(t, DeleteCustomSubscriptionRule(scoped.Id))
					require.NoError(t, DeleteCustomSubscriptionPlan(plan.Id))
					_, err = ReadCustomSubscriptionRules(&plan.Id)
					require.ErrorIs(t, err, ErrSubscriptionRulePlan)
					edit := rules[0]
					edit.Title = "Administrator edited title"
					edit.Enabled = false
					edited, err := SaveCustomSubscriptionRule(edit.Id, edit.Version, edit)
					require.NoError(t, err)
					require.NoError(t, InitializeCustomSubscriptionRules(db))
					readback, err := GetCustomSubscriptionRule(edit.Id)
					require.NoError(t, err)
					assert.Equal(t, edited, readback)
					for _, rule := range rules {
						require.NoError(t, DeleteCustomSubscriptionRule(rule.Id))
					}
					require.NoError(t, InitializeCustomSubscriptionRules(db))
					remaining, err := ReadCustomSubscriptionRules(nil)
					require.NoError(t, err)
					assert.Empty(t, remaining, "deleting all managed rules must not trigger reseeding")
					recorder := &migrationSQLRecorder{}
					require.NoError(t, migrateCustomSubscriptions(db.Session(&gorm.Session{Logger: recorder})))
					assert.Empty(t, recorder.schemaMutations())
					if scenario == "existing_plan_schema" {
						var old CustomSubscriptionPlan
						require.NoError(t, db.Where("code = ?", "existing").First(&old).Error)
						assert.Equal(t, "preserved", old.Title)
						assert.EqualValues(t, 7, old.Version)
					}
				})
			}
		})
	}
}
