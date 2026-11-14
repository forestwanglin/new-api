package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPointWalletRulesDoNotAppearInSubscriptionRules(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := customSubscriptionSchedulingDB(t, dialect)
			plan := CustomSubscriptionPlan{Code: "wallet-rule-plan", Title: "Plan", Enabled: true, Version: 1}
			require.NoError(t, db.Create(&plan).Error)
			content := `{"blocks":[{"type":"paragraph","children":[{"text":"Configured explanation"}]}]}`
			rules := []CustomSubscriptionRule{
				{RuleKey: "subscription", Title: "Subscription", ContentJson: content, Enabled: true, Version: 1},
				{RuleKey: "wallet-general", Title: "Wallet", ContentJson: content, Enabled: true, Version: 1},
				{PlanId: &plan.Id, RuleKey: "wallet-plan", Title: "Plan wallet", ContentJson: content, Enabled: true, Version: 1},
				{PlanId: &plan.Id, RuleKey: "plan-rule", Title: "Plan rule", ContentJson: content, Enabled: true, Version: 1},
			}
			require.NoError(t, db.Create(&rules).Error)
			global, err := ReadCustomSubscriptionRules(nil)
			require.NoError(t, err)
			require.Len(t, global, 1)
			assert.Equal(t, "subscription", global[0].RuleKey)
			scoped, err := ReadCustomSubscriptionRules(&plan.Id)
			require.NoError(t, err)
			require.Len(t, scoped, 2)
			assert.Equal(t, []string{"subscription", "plan-rule"}, []string{scoped[0].RuleKey, scoped[1].RuleKey})
		})
	}
}

func TestPointWalletRulesDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			for _, scenario := range []string{"fresh", "existing_subscription_rules", "existing_wallet_rules"} {
				t.Run(scenario, func(t *testing.T) {
					db := customSubscriptionSchedulingDB(t, dialect)
					require.False(t, db.Migrator().HasTable(&Option{}), "requires isolated options")
					require.NoError(t, db.AutoMigrate(&Option{}))
					t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(&Option{})) })
					if scenario == "existing_subscription_rules" {
						require.NoError(t, db.Create(&CustomSubscriptionRule{RuleKey: "managed", Title: "Preserve subscription", ContentJson: `{"blocks":[{"type":"paragraph","children":[{"text":"Managed content"}]}]}`, Enabled: true, Version: 7}).Error)
					}
					require.NoError(t, InitializeCustomSubscriptionRules(db))
					before, err := ReadCustomSubscriptionRules(nil)
					require.NoError(t, err)
					if scenario == "existing_wallet_rules" {
						require.NoError(t, db.Create(&CustomSubscriptionRule{RuleKey: "wallet-managed", Title: "Preserve wallet", ContentJson: `{"blocks":[{"type":"paragraph","children":[{"text":"Managed wallet content"}]}]}`, Enabled: true, Version: 3}).Error)
					}
					require.NoError(t, InitializePointWalletRules(db))
					require.NoError(t, InitializeCustomSubscriptionRules(db))
					require.NoError(t, InitializePointWalletRules(db))
					after, err := ReadCustomSubscriptionRules(nil)
					require.NoError(t, err)
					assert.Equal(t, before, after, "wallet initialization must not change subscription content")
					if scenario == "existing_subscription_rules" {
						require.Len(t, after, 1)
						assert.EqualValues(t, 7, after[0].Version)
					} else {
						assert.Len(t, after, 11, "legacy subscription seeds must initialize before wallet seeds")
					}
					rules, err := ReadPointWalletRules()
					require.NoError(t, err)
					if scenario == "existing_wallet_rules" {
						require.Len(t, rules, 1)
						assert.Equal(t, "Preserve wallet", rules[0].Title)
						assert.EqualValues(t, 3, rules[0].Version)
					} else {
						require.Len(t, rules, 18)
						assert.Equal(t, "wallet-usage", rules[0].RuleKey)
						for _, rule := range rules {
							_, err := ParseSubscriptionRuleContent([]byte(rule.ContentJson))
							require.NoError(t, err)
							assert.Nil(t, rule.PlanId)
						}
						assert.Contains(t, rules[4].Title, "向上取整")
						assert.NotContains(t, rules[4].ContentJson, "四舍五入")
					}
					options, err := AllOption()
					require.NoError(t, err)
					assert.Empty(t, options)
					require.ErrorIs(t, UpdateOption(pointWalletRuleSeedKey, "reset"), ErrSubscriptionRuleFields)
					require.ErrorIs(t, UpdateOptionsBulk(map[string]string{pointWalletRuleSeedKey: "reset"}), ErrSubscriptionRuleFields)
					edit := rules[0]
					edit.Title = "Edited wallet explanation"
					edit.Enabled = false
					saved, err := SaveCustomSubscriptionRule(edit.Id, edit.Version, edit)
					require.NoError(t, err)
					require.NoError(t, InitializePointWalletRules(db))
					readback, err := GetCustomSubscriptionRule(edit.Id)
					require.NoError(t, err)
					assert.Equal(t, saved, readback)
					for _, rule := range rules {
						require.NoError(t, DeleteCustomSubscriptionRule(rule.Id))
					}
					require.NoError(t, InitializePointWalletRules(db))
					empty, err := ReadPointWalletRules()
					require.NoError(t, err)
					assert.Empty(t, empty, "deleted wallet content must not be restored on restart")
				})
			}
		})
	}
}

func TestPointWalletRulesReturnEnabledGlobalConfigurationOnly(t *testing.T) {
	db := customSubscriptionSchedulingDB(t, "sqlite")
	plan := CustomSubscriptionPlan{Code: "wallet-scope", Title: "Plan", Version: 1, Enabled: true}
	require.NoError(t, db.Create(&plan).Error)
	content := `{"blocks":[{"type":"paragraph","children":[{"text":"Configured"}]}]}`
	rules := []CustomSubscriptionRule{
		{RuleKey: "wallet-first", Title: "First", ContentJson: content, Enabled: true, SortOrder: 2, Version: 1},
		{RuleKey: "wallet-second", Title: "Second", ContentJson: content, Enabled: true, SortOrder: 1, Version: 1},
		{RuleKey: "wallet-hidden", Title: "Disabled", ContentJson: content, Enabled: false, SortOrder: 3, Version: 1},
		{RuleKey: "wallet-plan", PlanId: &plan.Id, Title: "Scoped", ContentJson: content, Enabled: true, SortOrder: 3, Version: 1},
		{RuleKey: "wallet_extra", Title: "Not in namespace", ContentJson: content, Enabled: true, SortOrder: 3, Version: 1},
	}
	require.NoError(t, db.Create(&rules).Error)
	listed, err := ReadPointWalletRules()
	require.NoError(t, err)
	require.Len(t, listed, 2)
	assert.Equal(t, []string{"wallet-first", "wallet-second"}, []string{listed[0].RuleKey, listed[1].RuleKey})
	require.NoError(t, db.Migrator().DropTable(&CustomSubscriptionRule{}))
	_, err = ReadPointWalletRules()
	require.Error(t, err, "database failures must not become successful empty responses")
}

func TestPointWalletRuleInitializationFailureCanRetry(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := customSubscriptionSchedulingDB(t, dialect)
			require.NoError(t, db.AutoMigrate(&Option{}))
			t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(&Option{})) })
			require.NoError(t, InitializeCustomSubscriptionRules(db))
			original := pointWalletRuleSeed
			t.Cleanup(func() { pointWalletRuleSeed = original })
			pointWalletRuleSeed = []byte(`[{"rule_key":"wallet-valid","title":"First","body":[{"text":"Valid content"}]},{"rule_key":"wallet-invalid","title":"Second","body":[]}]`)
			require.ErrorIs(t, InitializePointWalletRules(db), ErrSubscriptionRuleFields)
			var count int64
			require.NoError(t, db.Model(&Option{}).Where(map[string]any{"key": pointWalletRuleSeedKey}).Count(&count).Error)
			assert.Zero(t, count, "failed seed claim must roll back so startup can retry")
			partial, err := ReadPointWalletRules()
			require.NoError(t, err)
			assert.Empty(t, partial, "failed seed must not leave partially imported explanation")
			pointWalletRuleSeed = original
			require.NoError(t, InitializePointWalletRules(db))
			complete, err := ReadPointWalletRules()
			require.NoError(t, err)
			assert.Len(t, complete, 18)
		})
	}
}

func TestPointWalletRulesConcurrentInitializationDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := customSubscriptionSchedulingDB(t, dialect)
			require.NoError(t, db.AutoMigrate(&Option{}))
			t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(&Option{})) })
			require.NoError(t, InitializeCustomSubscriptionRules(db))
			sqlDB, err := db.DB()
			require.NoError(t, err)
			if dialect == "sqlite" {
				sqlDB.SetMaxOpenConns(1)
			} else {
				sqlDB.SetMaxOpenConns(2)
			}
			start := make(chan struct{})
			results := make(chan error, 2)
			for range 2 {
				go func() {
					<-start
					results <- InitializePointWalletRules(db)
				}()
			}
			close(start)
			for range 2 {
				require.NoError(t, <-results)
			}
			rules, err := ReadPointWalletRules()
			require.NoError(t, err)
			assert.Len(t, rules, 18, "concurrent startup imports exactly one complete wallet seed")
			var count int64
			require.NoError(t, db.Model(&Option{}).Where(map[string]any{"key": pointWalletRuleSeedKey}).Count(&count).Error)
			assert.EqualValues(t, 1, count)
		})
	}
}
