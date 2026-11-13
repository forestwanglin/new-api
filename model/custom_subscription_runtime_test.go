package model

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const customSubscriptionTestNow int64 = 1800000000000
const customSubscriptionTestDay int64 = 86400000

func customSubscriptionSchedulingDB(t *testing.T, dialect string) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("TEST_" + strings.ToUpper(dialect) + "_DSN")
	if dialect == "sqlite" {
		old := common.SQLitePath
		common.SQLitePath = filepath.Join(t.TempDir(), "scheduling.db")
		t.Cleanup(func() { common.SQLitePath = old })
		dsn = "local"
	}
	if dsn == "" {
		t.Skip("isolated test database DSN is not configured")
	}
	t.Setenv("CUSTOM_SCHEDULING_TEST_DSN", dsn)
	db, kind, err := chooseDB("CUSTOM_SCHEDULING_TEST_DSN", false)
	require.NoError(t, err)
	oldDB, oldKind := DB, common.MainDatabaseType()
	DB = db
	common.SetMainDatabaseType(kind)
	t.Cleanup(func() { DB = oldDB; common.SetMainDatabaseType(oldKind) })
	for _, table := range []any{&CustomUserSubscription{}, &CustomUserSubscriptionState{}, &CustomSubscriptionEvent{}, &CustomSubscriptionPlan{}, &CustomSubscriptionOrder{}, &CustomSubscriptionRule{}} {
		require.False(t, db.Migrator().HasTable(table), "requires an isolated empty database")
	}
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, db.Migrator().DropTable(&CustomSubscriptionEvent{}, &CustomUserSubscriptionState{}, &CustomUserSubscription{}, &CustomSubscriptionRule{}, &CustomSubscriptionOrder{}, &CustomSubscriptionPlan{}))
		require.NoError(t, sqlDB.Close())
	})
	query := "SELECT version()"
	if dialect == "sqlite" {
		query = "SELECT sqlite_version()"
	}
	var version string
	require.NoError(t, db.Raw(query).Scan(&version).Error)
	t.Log("database version:", version)
	require.NoError(t, migrateCustomSubscriptions(db))
	return db
}

func customSubscriptionSchedulingOrder(t *testing.T, db *gorm.DB, userID int64, priority int, cycle string, purchased int64) CustomSubscriptionOrder {
	t.Helper()
	months := 1
	if cycle == "year" {
		months = 12
	}
	order := CustomSubscriptionOrder{TradeNo: fmt.Sprintf("order-%d-%d-%d", userID, priority, purchased), UserId: userID, PlanId: 1, PlanVersion: 1, PlanSnapshot: `{"title":"Historical plan"}`, Priority: priority, BillingCycle: cycle, DurationMonths: months, Status: common.TopUpStatusSuccess, AmountDueMinor: 100, AmountPaidMinor: 100, PaidAt: &purchased}
	require.NoError(t, db.Create(&order).Error)
	return order
}

func TestCustomSubscriptionSchedulingDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := customSubscriptionSchedulingDB(t, dialect)
			now := customSubscriptionTestNow
			day := customSubscriptionTestDay
			t.Run("priority_preemption_fifo_catchup", func(t *testing.T) {
				a := customSubscriptionSchedulingOrder(t, db, 1, 1, "month", now)
				subA, err := fulfillCustomSubscriptionOrderAt(a.Id, now)
				require.NoError(t, err)
				assert.EqualValues(t, 30*day, subA.TotalDurationMs)
				b := customSubscriptionSchedulingOrder(t, db, 1, 2, "month", now+10*day)
				subB, err := fulfillCustomSubscriptionOrderAt(b.Id, now+10*day)
				require.NoError(t, err)
				c := customSubscriptionSchedulingOrder(t, db, 1, 2, "year", now+12*day)
				subC, err := fulfillCustomSubscriptionOrderAt(c.Id, now+12*day)
				require.NoError(t, err)
				assert.EqualValues(t, 365*day, subC.TotalDurationMs)
				view, err := getCustomUserSubscriptionsAt(1, now+15*day)
				require.NoError(t, err)
				require.NotNil(t, view.ActiveSubscriptionID)
				assert.Equal(t, subB.Id, *view.ActiveSubscriptionID)
				var storedA CustomUserSubscription
				require.NoError(t, db.First(&storedA, subA.Id).Error)
				assert.Equal(t, "paused", storedA.Status)
				assert.EqualValues(t, 20*day, storedA.RemainingDurationMs)
				assert.Nil(t, storedA.ActiveUntilAt)
				// B ends day 40; C ends day 405; A then runs to day 425.
				view, err = getCustomUserSubscriptionsAt(1, now+410*day)
				require.NoError(t, err)
				assert.Equal(t, subA.Id, *view.ActiveSubscriptionID)
				for _, sub := range view.Subscriptions {
					if sub.Id == subA.Id {
						assert.EqualValues(t, 15*day, sub.RemainingDurationMs)
						require.NotNil(t, sub.ActiveSinceAt)
						assert.EqualValues(t, now+405*day, *sub.ActiveSinceAt)
					} else {
						assert.Equal(t, "expired", sub.Status)
						assert.Zero(t, sub.RemainingDurationMs)
					}
				}
				var countBefore, countAfter int64
				require.NoError(t, db.Model(&CustomSubscriptionEvent{}).Where("user_id = ?", 1).Count(&countBefore).Error)
				require.NoError(t, reconcileCustomUserSubscriptionsAt(1, now+410*day))
				require.NoError(t, db.Model(&CustomSubscriptionEvent{}).Where("user_id = ?", 1).Count(&countAfter).Error)
				assert.Equal(t, countBefore, countAfter)
				var resumed CustomSubscriptionEvent
				require.NoError(t, db.Where("subscription_id = ? AND event_type = ?", subA.Id, "resume").First(&resumed).Error)
				assert.EqualValues(t, now+405*day, resumed.EffectiveAt)
				assert.EqualValues(t, now+410*day, resumed.RecordedAt)
				view, err = getCustomUserSubscriptionsAt(1, now+425*day)
				require.NoError(t, err)
				assert.Nil(t, view.ActiveSubscriptionID)
			})
			t.Run("equal_time_uses_id_snapshot_and_duplicate_order", func(t *testing.T) {
				first := customSubscriptionSchedulingOrder(t, db, 2, 4, "month", now)
				second := first
				second.Id = 0
				second.TradeNo = "same-time-second"
				require.NoError(t, db.Create(&second).Error)
				one, err := fulfillCustomSubscriptionOrderAt(first.Id, now)
				require.NoError(t, err)
				two, err := fulfillCustomSubscriptionOrderAt(second.Id, now)
				require.NoError(t, err)
				assert.NotEqual(t, one.Id, two.Id)
				view, err := getCustomUserSubscriptionsAt(2, now)
				require.NoError(t, err)
				assert.Equal(t, one.Id, *view.ActiveSubscriptionID)
				require.NoError(t, db.Create(&CustomSubscriptionPlan{Id: 1, Code: "changed", Priority: 999, TierRank: 999, BillingCycle: "year", DurationMonths: 12}).Error)
				retry, err := fulfillCustomSubscriptionOrderAt(first.Id, now+1)
				require.NoError(t, err)
				assert.Equal(t, one.Id, retry.Id)
				assert.Equal(t, 4, retry.Priority)
				assert.EqualValues(t, 30*day, retry.TotalDurationMs)
			})
			t.Run("late_fulfilment_uses_purchase_order_not_retroactive_time", func(t *testing.T) {
				newer := customSubscriptionSchedulingOrder(t, db, 3, 8, "month", now)
				active, err := fulfillCustomSubscriptionOrderAt(newer.Id, now)
				require.NoError(t, err)
				older := customSubscriptionSchedulingOrder(t, db, 3, 8, "month", now-1)
				winner, err := fulfillCustomSubscriptionOrderAt(older.Id, now+100)
				require.NoError(t, err)
				assert.Equal(t, "active", winner.Status)
				assert.EqualValues(t, now+100, *winner.FirstActivatedAt)
				var paused CustomUserSubscription
				require.NoError(t, db.First(&paused, active.Id).Error)
				assert.EqualValues(t, 30*day-100, paused.RemainingDurationMs)
			})
			t.Run("cancel_ownership_and_clock_rollback", func(t *testing.T) {
				low := customSubscriptionSchedulingOrder(t, db, 4, 1, "month", now)
				a, err := fulfillCustomSubscriptionOrderAt(low.Id, now)
				require.NoError(t, err)
				high := customSubscriptionSchedulingOrder(t, db, 4, 2, "month", now+1)
				b, err := fulfillCustomSubscriptionOrderAt(high.Id, now+1)
				require.NoError(t, err)
				require.ErrorIs(t, cancelCustomUserSubscriptionAt(999, b.Id, now+2), ErrCustomUserSubscriptionNotFound)
				require.NoError(t, cancelCustomUserSubscriptionAt(4, b.Id, now+100))
				require.NoError(t, cancelCustomUserSubscriptionAt(4, b.Id, now+100))
				view, err := getCustomUserSubscriptionsAt(4, now+50)
				require.NoError(t, err)
				assert.Equal(t, a.Id, *view.ActiveSubscriptionID)
				assert.EqualValues(t, now+100, view.ObservedAt)
				require.NoError(t, db.First(b, b.Id).Error)
				assert.Equal(t, "cancelled", b.Status)
			})
			t.Run("invalid_orders_leave_no_runtime_state", func(t *testing.T) {
				for i, mutate := range []func(*CustomSubscriptionOrder){func(o *CustomSubscriptionOrder) { o.Status = common.TopUpStatusPending }, func(o *CustomSubscriptionOrder) { o.PaidAt = nil }, func(o *CustomSubscriptionOrder) { o.Priority = -1 }, func(o *CustomSubscriptionOrder) { o.BillingCycle = "day" }, func(o *CustomSubscriptionOrder) { o.DurationMonths = 2 }, func(o *CustomSubscriptionOrder) { v := now + 1; o.PaidAt = &v }, func(o *CustomSubscriptionOrder) { o.RefundedAmountMinor = 1 }, func(o *CustomSubscriptionOrder) { o.AmountPaidMinor = 0 }} {
					order := customSubscriptionSchedulingOrder(t, db, int64(100+i), 1, "month", now)
					mutate(&order)
					require.NoError(t, db.Save(&order).Error)
					_, err := fulfillCustomSubscriptionOrderAt(order.Id, now)
					require.ErrorIs(t, err, ErrCustomSubscriptionOrderInvalid)
					var count int64
					require.NoError(t, db.Model(&CustomUserSubscription{}).Where("order_id = ?", order.Id).Count(&count).Error)
					assert.Zero(t, count)
					require.NoError(t, db.Model(&CustomUserSubscriptionState{}).Where("user_id = ?", order.UserId).Count(&count).Error)
					assert.Zero(t, count)
				}
				overflow := customSubscriptionSchedulingOrder(t, db, 199, 1, "year", now)
				_, err := fulfillCustomSubscriptionOrderAt(overflow.Id, math.MaxInt64-1)
				require.ErrorIs(t, err, ErrCustomSubscriptionTimeInvalid)
			})
			t.Run("cancel_after_expiry_preserves_expiry_history", func(t *testing.T) {
				first := customSubscriptionSchedulingOrder(t, db, 8, 2, "month", now)
				one, err := fulfillCustomSubscriptionOrderAt(first.Id, now)
				require.NoError(t, err)
				second := customSubscriptionSchedulingOrder(t, db, 8, 1, "month", now+1)
				two, err := fulfillCustomSubscriptionOrderAt(second.Id, now+1)
				require.NoError(t, err)
				boundary := now + 30*day
				require.NoError(t, cancelCustomUserSubscriptionAt(8, one.Id, boundary+100))
				require.NoError(t, db.First(one, one.Id).Error)
				assert.Equal(t, "expired", one.Status)
				require.NotNil(t, one.EndedAt)
				assert.Equal(t, boundary, *one.EndedAt)
				require.NoError(t, db.First(two, two.Id).Error)
				assert.Equal(t, "active", two.Status)
				require.NotNil(t, two.ActiveSinceAt)
				assert.Equal(t, boundary, *two.ActiveSinceAt)
				var cancelled int64
				require.NoError(t, db.Model(&CustomSubscriptionEvent{}).Where("user_id = ? AND event_type = ?", 8, "cancel").Count(&cancelled).Error)
				assert.Zero(t, cancelled)
				require.NoError(t, cancelCustomUserSubscriptionAt(8, one.Id, boundary+200))
			})
			t.Run("purchase_at_expiry_keeps_completed_history", func(t *testing.T) {
				first := customSubscriptionSchedulingOrder(t, db, 6, 1, "month", now)
				one, err := fulfillCustomSubscriptionOrderAt(first.Id, now)
				require.NoError(t, err)
				second := customSubscriptionSchedulingOrder(t, db, 6, 2, "month", now+30*day)
				two, err := fulfillCustomSubscriptionOrderAt(second.Id, now+30*day)
				require.NoError(t, err)
				assert.Equal(t, "active", two.Status)
				assert.EqualValues(t, now+30*day, *two.FirstActivatedAt)
				require.NoError(t, db.First(one, one.Id).Error)
				assert.Equal(t, "expired", one.Status)
			})
			t.Run("distinct_concurrent_orders_reads_and_reconciliation", func(t *testing.T) {
				orders := []CustomSubscriptionOrder{
					customSubscriptionSchedulingOrder(t, db, 7, 1, "month", now),
					customSubscriptionSchedulingOrder(t, db, 7, 3, "month", now),
					customSubscriptionSchedulingOrder(t, db, 7, 2, "month", now),
				}
				start := make(chan struct{})
				errs := make(chan error, 5)
				var wg sync.WaitGroup
				for _, order := range orders {
					wg.Go(func() { <-start; _, err := fulfillCustomSubscriptionOrderAt(order.Id, now); errs <- err })
				}
				wg.Go(func() { <-start; _, err := getCustomUserSubscriptionsAt(7, now); errs <- err })
				wg.Go(func() { <-start; errs <- reconcileCustomUserSubscriptionsAt(7, now) })
				close(start)
				wg.Wait()
				close(errs)
				for err := range errs {
					require.NoError(t, err)
				}
				view, err := getCustomUserSubscriptionsAt(7, now)
				require.NoError(t, err)
				require.Len(t, view.Subscriptions, 3)
				activeCount, total := 0, int64(0)
				for _, sub := range view.Subscriptions {
					total += sub.RemainingDurationMs
					if sub.Status == "active" {
						activeCount++
						assert.Equal(t, 3, sub.Priority)
						assert.Equal(t, sub.Id, *view.ActiveSubscriptionID)
					}
				}
				assert.Equal(t, 1, activeCount)
				assert.EqualValues(t, 90*day, total)
			})
			t.Run("concurrent_fulfilment_and_background", func(t *testing.T) {
				order := customSubscriptionSchedulingOrder(t, db, 5, 1, "month", now)
				start := make(chan struct{})
				errs := make(chan error, 4)
				var wg sync.WaitGroup
				for range 4 {
					wg.Go(func() { <-start; _, err := fulfillCustomSubscriptionOrderAt(order.Id, now); errs <- err })
				}
				close(start)
				wg.Wait()
				close(errs)
				for err := range errs {
					require.NoError(t, err)
				}
				var count int64
				require.NoError(t, db.Model(&CustomUserSubscription{}).Where("user_id = ?", 5).Count(&count).Error)
				assert.EqualValues(t, 1, count)
				var events []CustomSubscriptionEvent
				require.NoError(t, db.Where("user_id = ?", 5).Find(&events).Error)
				require.Len(t, events, 1)
				n, err := expireDueCustomSubscriptionsAt(500, now+500*day)
				require.NoError(t, err)
				assert.Positive(t, n)
				require.NoError(t, db.Model(&CustomUserSubscription{}).Where("status = ?", "active").Count(&count).Error)
				assert.Zero(t, count)
			})
			t.Run("repeat_migration_preserves_data_and_indexes", func(t *testing.T) {
				var before, after []CustomUserSubscription
				require.NoError(t, db.Order("id").Find(&before).Error)
				require.NotEmpty(t, before)
				for range 2 {
					recorder := &migrationSQLRecorder{}
					require.NoError(t, migrateCustomSubscriptions(db.Session(&gorm.Session{Logger: recorder})))
					assert.Empty(t, recorder.schemaMutations())
				}
				require.NoError(t, db.Order("id").Find(&after).Error)
				assert.Equal(t, before, after)
				for _, entry := range []struct {
					model any
					name  string
				}{{&CustomUserSubscription{}, "idx_cus_order"}, {&CustomUserSubscription{}, "idx_cus_queue"}, {&CustomUserSubscription{}, "idx_cus_expiry"}, {&CustomSubscriptionEvent{}, "idx_cse_operation"}, {&CustomSubscriptionEvent{}, "idx_cse_subscription_time"}} {
					assert.True(t, db.Migrator().HasIndex(entry.model, entry.name), entry.name)
				}
			})
		})
	}
}
