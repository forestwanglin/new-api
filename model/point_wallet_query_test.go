package model

import (
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPointWalletAndOrdersDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "wallet.db"))
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("isolated MySQL test DSN not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("isolated PostgreSQL test DSN not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			tables := []any{&PointLedger{}, &PointTransaction{}, &PointAccount{}, &PointType{}, &CustomSubscriptionOrder{}, &InvitationReward{}}
			for _, table := range tables {
				require.False(t, db.Migrator().HasTable(table), "requires an empty isolated database")
			}
			require.NoError(t, db.AutoMigrate(tables...))
			t.Cleanup(func() {
				for _, table := range tables {
					require.NoError(t, db.Migrator().DropTable(table))
				}
			})
			previousDB := DB
			DB = db
			t.Cleanup(func() { DB = previousDB })
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database version: %s", version)

			types := []PointType{{Id: 1, Code: PointTypeGeneral, Name: "General", ConsumePriority: 100}, {Id: 2, Code: PointTypeGPT, Name: "GPT", ConsumePriority: 10}, {Id: 3, Code: "FUTURE", Name: "Future", ConsumePriority: 1}}
			require.NoError(t, db.Create(&types).Error)
			accounts := []PointAccount{{Id: 1, UserId: 1, PointTypeId: 1, AvailablePoints: 9007199254740993, FrozenPoints: 12}, {Id: 2, UserId: 2, PointTypeId: 1, AvailablePoints: 999}, {Id: 3, UserId: 1, PointTypeId: 99, AvailablePoints: 4}}
			require.NoError(t, db.Create(&accounts).Error)
			txns := []PointTransaction{{Id: 1, UserId: 1, EventKey: "credit", Action: PointActionCredit, BizType: "custom_subscription"}, {Id: 2, UserId: 1, EventKey: "more-credit", Action: PointActionCredit, BizType: "custom_subscription"}, {Id: 3, UserId: 1, EventKey: "freeze", Action: PointActionFreeze, BizType: "freeze"}, {Id: 4, UserId: 2, EventKey: "other", Action: PointActionCredit, BizType: "custom_subscription"}, {Id: 5, UserId: 1, EventKey: "debit", Action: PointActionConsume, BizType: "custom_subscription"}, {Id: 6, UserId: 1, EventKey: "unknown", Action: "FUTURE", BizType: "future-source"}}
			require.NoError(t, db.Create(&txns).Error)
			ledger := []PointLedger{{Id: 1, AccountId: 1, AccountVersion: 1, TransactionId: 1, AvailableDelta: math.MaxInt64}, {Id: 2, AccountId: 1, AccountVersion: 2, TransactionId: 2, AvailableDelta: math.MaxInt64}, {Id: 3, AccountId: 1, AccountVersion: 3, TransactionId: 3, AvailableDelta: -20, FrozenDelta: 20}, {Id: 4, AccountId: 2, AccountVersion: 1, TransactionId: 4, AvailableDelta: 999}, {Id: 5, AccountId: 1, AccountVersion: 4, TransactionId: 4, AvailableDelta: 500}, {Id: 6, AccountId: 1, AccountVersion: 5, TransactionId: 99, AvailableDelta: 500}, {Id: 7, AccountId: 1, AccountVersion: 6, TransactionId: 5, AvailableDelta: math.MinInt64}, {Id: 8, AccountId: 3, AccountVersion: 1, TransactionId: 6, AvailableDelta: 4}}
			require.NoError(t, db.Create(&ledger).Error)
			wallet, err := GetPointWallet(1)
			require.NoError(t, err)
			require.Len(t, wallet.Balances, 3)
			assert.Equal(t, "FUTURE", wallet.Balances[0].Code)
			assert.Equal(t, "0", wallet.Balances[0].AvailablePoints)
			assert.Equal(t, "GPT", wallet.Balances[1].Code)
			assert.Equal(t, "9007199254740993", wallet.Balances[2].AvailablePoints)
			assert.Equal(t, "12", wallet.Balances[2].FrozenPoints)
			require.NotNil(t, wallet.PendingGPTPoints)
			assert.Equal(t, "0", *wallet.PendingGPTPoints)
			assert.Empty(t, wallet.PendingInvitationRewards)
			require.Len(t, wallet.SourceSummaries, 3)
			assert.Equal(t, PointWalletSourceSummary{PointTypeID: "1", PointTypeCode: PointTypeGeneral, PointTypeName: "General", BizType: "custom_subscription", IncreasedPoints: "18446744073709551614", DecreasedPoints: "9223372036854775808", NetPoints: "9223372036854775806"}, wallet.SourceSummaries[0])
			assert.Equal(t, "0", wallet.SourceSummaries[1].NetPoints)
			assert.Equal(t, "99", wallet.SourceSummaries[2].PointTypeID)
			assert.Equal(t, "future-source", wallet.SourceSummaries[2].BizType)
			encoded, err := common.Marshal(wallet)
			require.NoError(t, err)
			assert.Contains(t, string(encoded), `"available_points":"9007199254740993"`)
			assert.Contains(t, string(encoded), `"pending_gpt_points":"0"`)
			assert.NotContains(t, string(encoded), "event_key")
			empty, err := GetPointWallet(3)
			require.NoError(t, err)
			assert.Empty(t, empty.SourceSummaries)
			assert.Equal(t, "0", empty.Balances[2].AvailablePoints)
			_, err = GetPointWallet(0)
			require.Error(t, err)
			for table, want := range map[string]int64{"point_accounts": 3, "point_transactions": 6, "point_ledger": 8} {
				var count int64
				require.NoError(t, db.Table(table).Count(&count).Error)
				assert.Equal(t, want, count, "read must not write %s", table)
			}
			var storedAccounts []PointAccount
			var storedTransactions []PointTransaction
			var storedLedger []PointLedger
			require.NoError(t, db.Order("id").Find(&storedAccounts).Error)
			require.NoError(t, db.Order("id").Find(&storedTransactions).Error)
			require.NoError(t, db.Order("id").Find(&storedLedger).Error)
			assert.Equal(t, accounts, storedAccounts, "wallet reads must preserve account balances")
			assert.Equal(t, txns, storedTransactions, "wallet reads must preserve transaction metadata")
			assert.Equal(t, ledger, storedLedger, "wallet reads must preserve ledger snapshots")

			rewards := []InvitationReward{
				{Id: 1, OrderId: 11, InviterId: 1, PointTypeId: 1, PointTypeCode: "GENERAL", PointTypeName: "Old general", ProcessingPoints: 9007199254740993, Status: InvitationRewardCaptured},
				{Id: 2, OrderId: 12, InviterId: 1, PointTypeId: 1, PointTypeCode: "GENERAL", FrozenPoints: math.MaxInt64, Status: InvitationRewardFrozen},
				{Id: 3, OrderId: 13, InviterId: 1, PointTypeId: 1, PointTypeCode: "GENERAL", FrozenPoints: math.MaxInt64, Status: InvitationRewardFrozen},
				{Id: 4, OrderId: 14, InviterId: 1, PointTypeId: 2, PointTypeCode: "GPT", PointTypeName: "Old GPT", ProcessingPoints: 3, FrozenPoints: 7, CancelledPoints: 5, Status: InvitationRewardFrozen},
				{Id: 5, OrderId: 15, InviterId: 1, PointTypeId: 99, PointTypeCode: "HISTORIC", PointTypeName: "Historical type", FrozenPoints: 8, Status: InvitationRewardFrozen},
				{Id: 6, OrderId: 16, InviterId: 1, PointTypeId: 2, PointTypeCode: "GPT", ReleasedPoints: 500, ReversedPoints: 40, Status: InvitationRewardReleased},
				{Id: 7, OrderId: 17, InviterId: 2, PointTypeId: 2, PointTypeCode: "GPT", ProcessingPoints: 999, Status: InvitationRewardCaptured},
				{Id: 8, OrderId: 18, InviterId: 1, PointTypeId: 3, PointTypeCode: "FUTURE", CancelledPoints: 20, Status: InvitationRewardCancelled},
			}
			require.NoError(t, db.Create(&rewards).Error)
			wallet, err = GetPointWallet(1)
			require.NoError(t, err)
			require.Len(t, wallet.PendingInvitationRewards, 3)
			assert.Equal(t, PointWalletPendingReward{PointTypeID: "1", Code: "GENERAL", Name: "General", ProcessingPoints: "9007199254740993", FrozenPoints: "18446744073709551614", PendingPoints: "18455751272964292607"}, wallet.PendingInvitationRewards[0])
			assert.Equal(t, PointWalletPendingReward{PointTypeID: "2", Code: "GPT", Name: "GPT", ProcessingPoints: "3", FrozenPoints: "7", PendingPoints: "10"}, wallet.PendingInvitationRewards[1])
			assert.Equal(t, PointWalletPendingReward{PointTypeID: "99", Code: "HISTORIC", Name: "Historical type", ProcessingPoints: "0", FrozenPoints: "8", PendingPoints: "8"}, wallet.PendingInvitationRewards[2])
			assert.Equal(t, "10", *wallet.PendingGPTPoints)
			assert.Equal(t, "9007199254740993", wallet.Balances[2].AvailablePoints, "pending rewards must not change available accounts")
			var afterRewards []InvitationReward
			require.NoError(t, db.Order("id").Find(&afterRewards).Error)
			assert.Equal(t, rewards, afterRewards, "wallet reads must not reconcile or mutate rewards")
			// A refund reduces only the still-pending amount; a later release removes it.
			require.NoError(t, db.Model(&InvitationReward{}).Where("id = ?", 4).Updates(map[string]any{"processing_points": 0, "frozen_points": 4, "cancelled_points": 11}).Error)
			wallet, err = GetPointWallet(1)
			require.NoError(t, err)
			assert.Equal(t, "4", *wallet.PendingGPTPoints)
			require.NoError(t, db.Model(&InvitationReward{}).Where("id = ?", 4).Updates(map[string]any{"frozen_points": 0, "released_points": 4, "status": InvitationRewardReleased}).Error)
			wallet, err = GetPointWallet(1)
			require.NoError(t, err)
			assert.Equal(t, "0", *wallet.PendingGPTPoints)
			require.Len(t, wallet.PendingInvitationRewards, 2)
			empty, err = GetPointWallet(3)
			require.NoError(t, err)
			assert.Empty(t, empty.PendingInvitationRewards)
			require.NoError(t, db.Model(&InvitationReward{}).Where("id = ?", 8).Update("processing_points", -1).Error)
			_, err = GetPointWallet(1)
			require.Error(t, err, "invalid reward amounts must not display a fabricated balance")
			require.NoError(t, db.Model(&InvitationReward{}).Where("id = ?", 8).Update("processing_points", 0).Error)

			paidAt := int64(9007199254740993)
			orders := []CustomSubscriptionOrder{{Id: 1, UserId: 1, TradeNo: "older", PlanId: 4, PlanVersion: 1, PlanSnapshot: `{"Title":"Purchased title","provider_secret":"hidden"}`, BillingCycle: "month", AmountPaidMinor: 9007199254740993, PaidPoints: math.MaxInt64, Status: "success", CreatedAt: 1000, PaidAt: &paidAt, ProviderPayload: "secret-provider-payload"}, {Id: 2, UserId: 1, TradeNo: "same-time-first", PlanId: 5, PlanVersion: 2, PlanSnapshot: "bad-history", Status: "pending", CreatedAt: 2000}, {Id: 3, UserId: 1, TradeNo: "same-time-last", PlanId: 6, PlanVersion: 3, Status: "expired", CreatedAt: 2000}, {Id: 4, UserId: 2, TradeNo: "other-user", Status: "success", CreatedAt: 3000}}
			require.NoError(t, db.Create(&orders).Error)
			page, err := ListCustomSubscriptionOrdersForUser(1, 1, 2)
			require.NoError(t, err)
			assert.EqualValues(t, 3, page.Total)
			require.Len(t, page.Items, 2)
			assert.EqualValues(t, []int64{3, 2}, []int64{page.Items[0].ID, page.Items[1].ID})
			assert.Equal(t, "expired", page.Items[0].Status)
			assert.Equal(t, "", page.Items[1].PlanTitle)
			last, err := ListCustomSubscriptionOrdersForUser(1, 2, 2)
			require.NoError(t, err)
			require.Len(t, last.Items, 1)
			assert.Equal(t, "Purchased title", last.Items[0].PlanTitle)
			encoded, err = common.Marshal(last)
			require.NoError(t, err)
			assert.Contains(t, string(encoded), `"amount_paid_minor":"9007199254740993"`)
			assert.Contains(t, string(encoded), `"paid_points":"9223372036854775807"`)
			assert.Contains(t, string(encoded), `"paid_at":"9007199254740993"`)
			assert.NotContains(t, string(encoded), "provider_secret")
			assert.NotContains(t, string(encoded), "secret-provider-payload")
			noOrders, err := ListCustomSubscriptionOrdersForUser(3, 1, 20)
			require.NoError(t, err)
			assert.Empty(t, noOrders.Items)
			for _, invalid := range [][3]int{{0, 1, 20}, {1, 0, 20}, {1, 1, 101}, {1, math.MaxInt, 100}} {
				_, err := ListCustomSubscriptionOrdersForUser(int64(invalid[0]), invalid[1], invalid[2])
				require.Error(t, err)
			}
			var after []CustomSubscriptionOrder
			require.NoError(t, db.Order("id").Find(&after).Error)
			assert.Equal(t, orders, after, "listing must not mutate orders")
			require.NoError(t, db.Migrator().DropTable(&InvitationReward{}))
			_, err = GetPointWallet(1)
			require.Error(t, err, "reward query failure must not become successful zero")
			require.NoError(t, db.AutoMigrate(&InvitationReward{}))
			require.NoError(t, db.Migrator().DropTable(&PointLedger{}))
			_, err = GetPointWallet(1)
			require.Error(t, err, "query errors must not fabricate empty balances")
			require.NoError(t, db.Migrator().DropTable(&CustomSubscriptionOrder{}))
			_, err = ListCustomSubscriptionOrdersForUser(1, 1, 20)
			require.Error(t, err)
		})
	}
}
