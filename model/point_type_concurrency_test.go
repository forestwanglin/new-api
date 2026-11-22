package model

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func pointTypeConcurrencyDB(t *testing.T, dialect string) *gorm.DB {
	t.Helper()
	dsn := "local"
	if dialect == "mysql" {
		dsn = os.Getenv("TEST_MYSQL_DSN")
	} else if dialect == "postgres" {
		dsn = os.Getenv("TEST_POSTGRES_DSN")
	}
	if dsn == "" {
		t.Skip("isolated test database DSN is not configured")
	}
	oldDB, oldPath, oldType := DB, common.SQLitePath, common.MainDatabaseType()
	// Multiple connections exercise SQLite's real writer arbitration, rather
	// than serializing the competing operations in the connection pool.
	common.SQLitePath = filepath.Join(t.TempDir(), "point-type-concurrency.db") + "?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)"
	t.Setenv("POINT_TYPE_CONCURRENCY_TEST_DSN", dsn)
	db, dbType, err := chooseDB("POINT_TYPE_CONCURRENCY_TEST_DSN", false)
	require.NoError(t, err)
	DB = db
	common.SetMainDatabaseType(dbType)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(4)
	models := []any{&User{}, &PointType{}, &PointModelRule{}, &PointAccount{}, &PointTransaction{}, &PointLedger{}, &CustomSubscriptionPlan{}, &CustomSubscriptionOrder{}, &InvitationCampaignVersion{}, &InvitationReward{}, &PointCallBilling{}}
	for _, m := range models {
		require.False(t, db.Migrator().HasTable(m), "requires a disposable empty database")
	}
	require.NoError(t, db.AutoMigrate(models...))
	t.Cleanup(func() {
		for i := len(models) - 1; i >= 0; i-- {
			require.NoError(t, db.Migrator().DropTable(models[i]))
		}
		require.NoError(t, sqlDB.Close())
		DB, common.SQLitePath = oldDB, oldPath
		common.SetMainDatabaseType(oldType)
	})
	query := "SELECT version()"
	if dialect == "sqlite" {
		query = "SELECT sqlite_version()"
	}
	var version string
	require.NoError(t, db.Raw(query).Scan(&version).Error)
	t.Logf("database version: %s", version)
	return db
}

func TestPointTypeReferenceConcurrencyDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := pointTypeConcurrencyDB(t, dialect)
			for _, rollback := range []bool{false, true} {
				t.Run(fmt.Sprintf("plan reference completes before deletion rollback=%v", rollback), func(t *testing.T) {
					ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
					DB = db.WithContext(ctx)
					typ, err := CreatePointType("PLAN_RACE", "Plan race", 1)
					require.NoError(t, err)
					inserted, deleting, release := make(chan struct{}), make(chan struct{}, 1), make(chan struct{})
					shared := make(chan string, 1)
					var releaseOnce sync.Once
					var workers sync.WaitGroup
					const queryCB = "point-type-race:observe-plan-locks"
					const updateCB = "point-type-race:observe-sqlite-delete"
					const createCB = "point-type-race:hold-plan-transaction"
					failure := errors.New("forced reference transaction rollback")
					require.NoError(t, db.Callback().Query().Before("gorm:query").Register(queryCB, func(tx *gorm.DB) {
						if tx.Statement.Table != "point_types" {
							return
						}
						locking, _ := tx.Statement.Clauses["FOR"].Expression.(clause.Locking)
						if locking.Strength == "UPDATE" {
							select {
							case deleting <- struct{}{}:
							default:
							}
							return
						}
						select {
						case shared <- locking.Strength:
						default:
						}
					}))
					require.NoError(t, db.Callback().Update().Before("gorm:update").Register(updateCB, func(tx *gorm.DB) {
						if dialect == "sqlite" && tx.Statement.Table == "point_types" {
							select {
							case deleting <- struct{}{}:
							default:
							}
						}
					}))
					require.NoError(t, db.Callback().Create().After("gorm:create").Register(createCB, func(tx *gorm.DB) {
						if tx.Statement.Table != "custom_subscription_plans" || tx.Error != nil {
							return
						}
						close(inserted)
						select {
						case <-release:
						case <-ctx.Done():
							tx.AddError(ctx.Err())
						}
						if rollback {
							tx.AddError(failure)
						}
					}))
					t.Cleanup(func() {
						cancel()
						releaseOnce.Do(func() { close(release) })
						workers.Wait()
						require.NoError(t, db.Callback().Query().Remove(queryCB))
						require.NoError(t, db.Callback().Update().Remove(updateCB))
						require.NoError(t, db.Callback().Create().Remove(createCB))
						DB = db
					})
					created := make(chan error, 1)
					workers.Go(func() {
						_, err := CreateCustomSubscriptionPlan(CustomSubscriptionPlanInput{Code: "race-plan", Title: "Race plan", PaidPointTypeId: typ.Id, BenefitsJson: "[]"})
						created <- err
					})
					select {
					case <-inserted:
					case <-ctx.Done():
						t.Fatal("reference transaction did not reach its held insert", ctx.Err())
					}
					if dialect != "sqlite" {
						require.Equal(t, "SHARE", <-shared, "the actual reference writer must protect the type")
					}
					deleted := make(chan error, 1)
					workers.Go(func() { deleted <- DeletePointType(typ.Id, typ.ConfigVersion) })
					select {
					case <-deleting:
					case <-ctx.Done():
						t.Fatal("deletion did not attempt its type lock", ctx.Err())
					}
					releaseOnce.Do(func() { close(release) })
					if rollback {
						require.ErrorIs(t, <-created, failure)
						require.NoError(t, <-deleted, "rolled back references must not protect the type")
					} else {
						require.NoError(t, <-created)
						require.ErrorIs(t, <-deleted, ErrPointTypeHasPlans)
					}
					var plans, types, dangling int64
					require.NoError(t, db.Model(&CustomSubscriptionPlan{}).Where("paid_point_type_id = ?", typ.Id).Count(&plans).Error)
					require.NoError(t, db.Model(&PointType{}).Where("id = ?", typ.Id).Count(&types).Error)
					require.NoError(t, db.Model(&CustomSubscriptionPlan{}).Joins("LEFT JOIN point_types ON point_types.id = custom_subscription_plans.paid_point_type_id").Where("point_types.id IS NULL").Count(&dangling).Error)
					assert.Zero(t, dangling)
					if rollback {
						assert.Zero(t, plans)
						assert.Zero(t, types)
					} else {
						assert.EqualValues(t, 1, plans)
						assert.EqualValues(t, 1, types)
						require.NoError(t, db.Where("paid_point_type_id = ?", typ.Id).Delete(&CustomSubscriptionPlan{}).Error)
						require.NoError(t, DeletePointType(typ.Id, typ.ConfigVersion))
					}
				})
			}

			t.Run("deletion wins before first account adjustment", func(t *testing.T) {
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				DB = db.WithContext(ctx)
				typ, err := CreatePointType("ACCOUNT_RACE", "Account race", 1)
				require.NoError(t, err)
				user := User{Username: "race-target", AffCode: "race-target", Role: common.RoleCommonUser, Quota: 321}
				require.NoError(t, db.Create(&user).Error)
				locked, adjusting, release := make(chan struct{}, 1), make(chan struct{}, 1), make(chan struct{})
				var releaseOnce sync.Once
				var workers sync.WaitGroup
				const queryCB = "point-type-race:hold-delete-lock"
				const updateCB = "point-type-race:observe-adjustment"
				require.NoError(t, db.Callback().Query().After("gorm:query").Register(queryCB, func(tx *gorm.DB) {
					if tx.Statement.Table != "point_types" || tx.Error != nil {
						return
					}
					locking, _ := tx.Statement.Clauses["FOR"].Expression.(clause.Locking)
					if dialect != "sqlite" && locking.Strength != "UPDATE" {
						return
					}
					select {
					case locked <- struct{}{}:
					default:
					}
					select {
					case <-release:
					case <-ctx.Done():
						tx.AddError(ctx.Err())
					}
				}))
				require.NoError(t, db.Callback().Query().Before("gorm:query").Register(updateCB, func(tx *gorm.DB) {
					locking, _ := tx.Statement.Clauses["FOR"].Expression.(clause.Locking)
					if dialect != "sqlite" && tx.Statement.Table == "point_types" && locking.Strength == "SHARE" {
						select {
						case adjusting <- struct{}{}:
						default:
						}
					}
				}))
				require.NoError(t, db.Callback().Update().Before("gorm:update").Register(updateCB, func(tx *gorm.DB) {
					if dialect == "sqlite" && tx.Statement.Table == "users" {
						select {
						case adjusting <- struct{}{}:
						default:
						}
					}
				}))
				t.Cleanup(func() {
					cancel()
					releaseOnce.Do(func() { close(release) })
					workers.Wait()
					require.NoError(t, db.Callback().Query().Remove(queryCB))
					require.NoError(t, db.Callback().Query().Remove(updateCB))
					require.NoError(t, db.Callback().Update().Remove(updateCB))
					DB = db
				})
				deleted := make(chan error, 1)
				workers.Go(func() { deleted <- DeletePointType(typ.Id, typ.ConfigVersion) })
				select {
				case <-locked:
				case <-ctx.Done():
					t.Fatal("deletion did not acquire the type lock", ctx.Err())
				}
				adjusted := make(chan error, 1)
				workers.Go(func() {
					_, err := AdjustUserPoints(user.Id, 999, common.RoleRootUser, typ.Id, "add", "5", "delete-race")
					adjusted <- err
				})
				select {
				case <-adjusting:
				case <-ctx.Done():
					t.Fatal("adjustment did not attempt its reference lock", ctx.Err())
				}
				releaseOnce.Do(func() { close(release) })
				require.NoError(t, <-deleted)
				require.ErrorIs(t, <-adjusted, ErrPointTypeNotFound)
				for _, m := range []any{&PointAccount{}, &PointTransaction{}, &PointLedger{}} {
					var count int64
					require.NoError(t, db.Model(m).Count(&count).Error)
					assert.Zero(t, count, "failed adjustment must create no financial records")
				}
				var saved User
				require.NoError(t, db.First(&saved, user.Id).Error)
				assert.Equal(t, user.Quota, saved.Quota)
			})

			for _, sameIdentity := range []bool{false, true} {
				t.Run(fmt.Sprintf("independent admissions hold shared type locks concurrently same identity=%t", sameIdentity), func(t *testing.T) {
					if dialect == "sqlite" {
						t.Skip("SQLite serializes write transactions; concurrent shared row locks apply to MySQL/PostgreSQL")
					}
					ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
					DB = db.WithContext(ctx)
					types := []PointType{{Code: fmt.Sprintf("ADMISSION_FUNDS_%t", sameIdentity), Name: "Funds", ConsumePriority: 100}, {Code: fmt.Sprintf("ADMISSION_CANDIDATE_%t", sameIdentity), Name: "Unfunded candidate", ConsumePriority: 10}}
					require.NoError(t, db.Create(&types).Error)
					for _, typ := range types {
						require.NoError(t, db.Create(&PointModelRule{PointTypeId: typ.Id, MatchType: PointMatchPattern, MatchValue: "*", Enabled: true}).Error)
					}
					users := []User{{Username: fmt.Sprintf("admission-one-%t", sameIdentity), AffCode: fmt.Sprintf("admission-one-%t", sameIdentity)}, {Username: fmt.Sprintf("admission-two-%t", sameIdentity), AffCode: fmt.Sprintf("admission-two-%t", sameIdentity)}}
					require.NoError(t, db.Create(&users).Error)
					for _, user := range users {
						require.NoError(t, db.Create(&PointAccount{UserId: int64(user.Id), PointTypeId: types[0].Id, AvailablePoints: 10}).Error)
					}
					locked, release := make(chan string, 2), make(chan struct{})
					var releaseOnce sync.Once
					var workers sync.WaitGroup
					const queryCB = "point-type-race:hold-admission-shares"
					require.NoError(t, db.Callback().Query().After("gorm:query").Register(queryCB, func(tx *gorm.DB) {
						if tx.Statement.Table != "point_types" || tx.Error != nil {
							return
						}
						if _, all := tx.Statement.Dest.(*[]PointType); !all {
							return
						}
						locking, _ := tx.Statement.Clauses["FOR"].Expression.(clause.Locking)
						select {
						case locked <- locking.Strength:
						case <-ctx.Done():
							tx.AddError(ctx.Err())
							return
						}
						select {
						case <-release:
						case <-ctx.Done():
							tx.AddError(ctx.Err())
						}
					}))
					t.Cleanup(func() {
						cancel()
						releaseOnce.Do(func() { close(release) })
						workers.Wait()
						require.NoError(t, db.Callback().Query().Remove(queryCB))
						DB = db
					})
					type result struct {
						userID int
						err    error
					}
					results := make(chan result, 2)
					callIDs := []string{fmt.Sprintf("shared-admission-%t-0", sameIdentity), fmt.Sprintf("shared-admission-%t-1", sameIdentity)}
					if sameIdentity {
						callIDs[1] = callIDs[0]
					}
					for i, user := range users {
						workers.Go(func() {
							err := CreatePointCallForRoute(callIDs[i], user.Id, 0, "race-model", "1", "1000", 0, "default")
							results <- result{userID: user.Id, err: err}
						})
					}
					// Both transactions must finish the actual locked SELECT before
					// either may continue, catching accidental exclusive type locks.
					for range users {
						select {
						case strength := <-locked:
							require.Equal(t, "SHARE", strength)
						case <-ctx.Done():
							t.Fatal("independent admissions could not hold their type locks together", ctx.Err())
						}
					}
					releaseOnce.Do(func() { close(release) })
					successes, conflicts, winner := 0, 0, 0
					for range users {
						result := <-results
						if result.err == nil {
							successes++
							winner = result.userID
						} else {
							require.ErrorIs(t, result.err, ErrPointCallConflict)
							conflicts++
						}
					}
					var calls int64
					require.NoError(t, db.Model(&PointCallBilling{}).Where("id IN ?", callIDs).Count(&calls).Error)
					if sameIdentity {
						assert.Equal(t, 1, successes)
						assert.Equal(t, 1, conflicts)
						assert.EqualValues(t, 1, calls)
						var kept PointCallBilling
						require.NoError(t, db.First(&kept, "id = ?", callIDs[0]).Error)
						assert.Equal(t, winner, kept.UserID, "the losing request must not overwrite the winner's call")
					} else {
						assert.Equal(t, 2, successes)
						assert.Zero(t, conflicts)
						assert.EqualValues(t, 2, calls)
					}
					assert.ErrorIs(t, DeletePointType(types[1].Id, types[1].ConfigVersion), ErrPointTypeHasCalls, "the unfunded candidate is protected by both immutable snapshots")
				})
			}
		})
	}
}
