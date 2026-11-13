package model

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReadPublicCustomSubscriptionPlansDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := os.Getenv("TEST_" + strings.ToUpper(dialect) + "_DSN")
			if dialect == "sqlite" {
				dsn = "local"
				old := common.SQLitePath
				common.SQLitePath = filepath.Join(t.TempDir(), "public-plans.db")
				t.Cleanup(func() { common.SQLitePath = old })
			}
			if dsn == "" {
				t.Skip("isolated test database DSN is not configured")
			}
			t.Setenv("PUBLIC_PLAN_TEST_DSN", dsn)
			db, dbType, err := chooseDB("PUBLIC_PLAN_TEST_DSN", false)
			require.NoError(t, err)
			oldDB, oldType := DB, common.MainDatabaseType()
			DB = db
			common.SetMainDatabaseType(dbType)
			t.Cleanup(func() { DB = oldDB; common.SetMainDatabaseType(oldType) })
			require.False(t, db.Migrator().HasTable(&CustomSubscriptionPlan{}))
			require.NoError(t, db.AutoMigrate(&CustomSubscriptionPlan{}))
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&CustomSubscriptionPlan{}))
				require.NoError(t, sqlDB.Close())
			})
			empty, err := ReadPublicCustomSubscriptionPlans()
			require.NoError(t, err)
			assert.NotNil(t, empty)
			assert.Empty(t, empty)
			for i := range 102 {
				require.NoError(t, db.Create(&CustomSubscriptionPlan{Code: fmt.Sprintf("public-%d", i), Title: "configured", PriceAmountMinor: 9007199254740993, PaidPoints: 9007199254740993, Enabled: i != 101, SortOrder: i % 2}).Error)
			}
			plans, err := ReadPublicCustomSubscriptionPlans()
			require.NoError(t, err)
			require.Len(t, plans, 101)
			assert.EqualValues(t, 100, plans[0].Id)
			assert.EqualValues(t, 101, plans[50].Id)
			assert.EqualValues(t, 9007199254740993, plans[0].PaidPoints)
			for _, plan := range plans {
				assert.True(t, plan.Enabled)
			}
			require.NoError(t, db.Exec("ALTER TABLE custom_subscription_plans RENAME TO unavailable_public_plans").Error)
			_, err = ReadPublicCustomSubscriptionPlans()
			require.Error(t, err)
			require.NoError(t, db.Exec("ALTER TABLE unavailable_public_plans RENAME TO custom_subscription_plans").Error)
		})
	}
}
