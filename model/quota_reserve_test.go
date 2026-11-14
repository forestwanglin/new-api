package model

import (
	"errors"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func createReserveTestUser(t *testing.T, quota int) User {
	t.Helper()
	user := User{
		Username:    "reserve-user-" + common.GetRandomString(6),
		Password:    "unused-password-hash",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AuthVersion: 1,
		Quota:       quota,
		AffCode:     "reserve-aff-" + common.GetRandomString(8),
	}
	require.NoError(t, DB.Create(&user).Error)
	return user
}

func createReserveTestToken(t *testing.T, remainQuota int) Token {
	t.Helper()
	token := Token{
		UserId:      1,
		Key:         "reserve-token-" + common.GetRandomString(8),
		Name:        "reserve-test",
		Status:      common.TokenStatusEnabled,
		ExpiredTime: -1,
		RemainQuota: remainQuota,
	}
	require.NoError(t, token.Insert())
	return token
}

func getUserQuotaFromDB(t *testing.T, id int) int {
	t.Helper()
	var user User
	require.NoError(t, DB.Select("quota").First(&user, id).Error)
	return user.Quota
}

func getTokenFromDB(t *testing.T, id int) Token {
	t.Helper()
	var token Token
	require.NoError(t, DB.First(&token, id).Error)
	return token
}

func resetBatchUpdateTestState(t *testing.T) {
	t.Helper()
	oldBatchEnabled := common.BatchUpdateEnabled
	common.BatchUpdateEnabled = false
	for i := range BatchUpdateTypeCount {
		batchUpdateLocks[i].Lock()
		batchUpdateStores[i] = make(map[int]int)
		batchUpdateLocks[i].Unlock()
	}
	t.Cleanup(func() {
		common.BatchUpdateEnabled = oldBatchEnabled
		for i := range BatchUpdateTypeCount {
			batchUpdateLocks[i].Lock()
			batchUpdateStores[i] = make(map[int]int)
			batchUpdateLocks[i].Unlock()
		}
	})
}

func TestTryReserveQuotaWithoutRedis(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)

	user := createReserveTestUser(t, 100)
	reserved, err := TryReserveUserQuota(user.Id, 60)
	require.NoError(t, err)
	assert.True(t, reserved)
	assert.Equal(t, 40, getUserQuotaFromDB(t, user.Id))

	reserved, err = TryReserveUserQuota(user.Id, 41)
	require.NoError(t, err)
	assert.False(t, reserved)
	assert.Equal(t, 40, getUserQuotaFromDB(t, user.Id))

	token := createReserveTestToken(t, 80)
	reserved, err = TryReserveTokenQuota(token.Id, token.Key, 25, false)
	require.NoError(t, err)
	assert.True(t, reserved)
	reloaded := getTokenFromDB(t, token.Id)
	assert.Equal(t, 55, reloaded.RemainQuota)
	assert.Equal(t, 25, reloaded.UsedQuota)

	reserved, err = TryReserveTokenQuota(token.Id, token.Key, 56, false)
	require.NoError(t, err)
	assert.False(t, reserved)
	assert.Equal(t, 55, getTokenFromDB(t, token.Id).RemainQuota)
}

func TestRedisBatchReserveNeverFallsBackToStaleDatabaseBalance(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	useUserCacheMiniRedis(t)
	common.BatchUpdateEnabled = true

	user := createReserveTestUser(t, 10)
	reserved, err := TryReserveUserQuota(user.Id, 8)
	require.NoError(t, err)
	assert.True(t, reserved)
	assert.Equal(t, 10, getUserQuotaFromDB(t, user.Id), "batch delta is not flushed yet")

	reserved, err = TryReserveUserQuota(user.Id, 3)
	require.NoError(t, err)
	assert.False(t, reserved, "stale DB balance must not authorize a second spend")
	cachedUser, err := GetUserCache(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 2, cachedUser.Quota)

	token := createReserveTestToken(t, 9)
	reserved, err = TryReserveTokenQuota(token.Id, token.Key, 7, false)
	require.NoError(t, err)
	assert.True(t, reserved)
	reserved, err = TryReserveTokenQuota(token.Id, token.Key, 3, false)
	require.NoError(t, err)
	assert.False(t, reserved)
	assert.Equal(t, 2, getTokenFromDB(t, token.Id).RemainQuota, "token budget is persisted synchronously even with batching enabled")

	batchUpdate()
	assert.Equal(t, 2, getUserQuotaFromDB(t, user.Id))
	reloadedToken := getTokenFromDB(t, token.Id)
	assert.Equal(t, 2, reloadedToken.RemainQuota)
	assert.Equal(t, 7, reloadedToken.UsedQuota)
}

func TestBatchUpdateAccumulatesTwoMaximumRequestCharges(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	common.BatchUpdateEnabled = true

	user := createReserveTestUser(t, common.MaxQuota*2+100)
	require.NoError(t, DecreaseUserQuota(user.Id, common.MaxQuota, false))
	require.NoError(t, DecreaseUserQuota(user.Id, common.MaxQuota, false))

	batchUpdate()
	assert.Equal(t, 100, getUserQuotaFromDB(t, user.Id))
}

func TestBatchUpdateAccumulatorSaturatesOverflow(t *testing.T) {
	resetBatchUpdateTestState(t)

	addNewRecord(BatchUpdateTypeUserQuota, 1, math.MaxInt)
	addNewRecord(BatchUpdateTypeUserQuota, 1, 1)
	batchUpdateLocks[BatchUpdateTypeUserQuota].Lock()
	assert.Equal(t, math.MaxInt, batchUpdateStores[BatchUpdateTypeUserQuota][1])
	batchUpdateLocks[BatchUpdateTypeUserQuota].Unlock()

	batchUpdateLocks[BatchUpdateTypeUserQuota].Lock()
	batchUpdateStores[BatchUpdateTypeUserQuota] = make(map[int]int)
	batchUpdateLocks[BatchUpdateTypeUserQuota].Unlock()
	addNewRecord(BatchUpdateTypeUserQuota, 1, math.MinInt)
	addNewRecord(BatchUpdateTypeUserQuota, 1, -1)
	batchUpdateLocks[BatchUpdateTypeUserQuota].Lock()
	assert.Equal(t, math.MinInt, batchUpdateStores[BatchUpdateTypeUserQuota][1])
	batchUpdateLocks[BatchUpdateTypeUserQuota].Unlock()
}

func TestReserveFallsBackToDatabaseWhenRedisIsUnavailable(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	server := useUserCacheMiniRedis(t)

	user := createReserveTestUser(t, 20)
	require.NoError(t, populateUserCache(user))
	server.Close()

	// Redis 故障时降级为数据库条件更新：服务保持可用且不会超扣。
	reserved, err := TryReserveUserQuota(user.Id, 5)
	require.NoError(t, err)
	assert.True(t, reserved)
	assert.Equal(t, 15, getUserQuotaFromDB(t, user.Id))

	reserved, err = TryReserveUserQuota(user.Id, 16)
	require.NoError(t, err)
	assert.False(t, reserved)
	assert.Equal(t, 15, getUserQuotaFromDB(t, user.Id))
}

func TestSynchronousReserveCompensatesCacheWhenPersistenceFails(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	useUserCacheMiniRedis(t)

	user := createReserveTestUser(t, 10)
	require.NoError(t, populateUserCache(user))
	require.NoError(t, DB.Delete(&user).Error)

	reserved, err := TryReserveUserQuota(user.Id, 6)
	assert.False(t, reserved)
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
	cached, cacheErr := cacheGetUserBase(user.Id)
	require.NoError(t, cacheErr)
	assert.Equal(t, 10, cached.Quota)

	token := createReserveTestToken(t, 12)
	_, err = GetTokenByKey(token.Key, true)
	require.NoError(t, err)
	require.NoError(t, DB.Delete(&token).Error)
	reserved, err = TryReserveTokenQuota(token.Id, token.Key, 7, false)
	assert.False(t, reserved)
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
	cachedToken, cacheErr := cacheGetTokenByKey(token.Key)
	require.NoError(t, cacheErr)
	assert.Equal(t, 12, cachedToken.RemainQuota)
	assert.Zero(t, cachedToken.UsedQuota)
}

func TestTokenCacheInitPreservesLiveQuotaAndFenceBlocksStaleSnapshot(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	server := useUserCacheMiniRedis(t)

	token := createReserveTestToken(t, 100)
	loaded, err := GetTokenByKey(token.Key, true)
	require.NoError(t, err)
	stale := *loaded

	result, err := cacheApplyTokenQuotaDelta(token.Id, token.Key, -70)
	require.NoError(t, err)
	require.Equal(t, cacheQuotaOK, result)

	// 已存在的哈希只刷新 TTL：数据库快照不得覆盖已被原子预扣的余额。
	code, err := cacheInitToken(stale)
	require.NoError(t, err)
	assert.Equal(t, 2, code)
	cached, err := cacheGetTokenByKey(token.Key)
	require.NoError(t, err)
	assert.Equal(t, 30, cached.RemainQuota)

	// 变更期间：fence 删除缓存并拦截并发读者手中的过期快照。
	require.NoError(t, invalidateTokenCacheForMutation(token.Key))
	code, err = cacheInitToken(stale)
	require.NoError(t, err)
	assert.Zero(t, code, "the pre-mutation snapshot must not be published while fenced")
	_, err = cacheGetTokenByKey(token.Key)
	assert.Error(t, err)

	// fence 过期后可重新从数据库水合。
	server.FastForward(time.Duration(tokenCacheFenceSeconds+1) * time.Second)
	fresh, err := GetTokenByKey(token.Key, false)
	require.NoError(t, err)
	assert.Equal(t, 100, fresh.RemainQuota)
	cached, err = cacheGetTokenByKey(token.Key)
	require.NoError(t, err)
	assert.Equal(t, 100, cached.RemainQuota)
}

// Redis counters and enabled batching must never grant or hide DB token budget.
func TestTokenQuotaUsesDatabaseAuthorityWithBatchAndStaleCache(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	useUserCacheMiniRedis(t)
	common.BatchUpdateEnabled = true
	token := createReserveTestToken(t, 20)
	_, err := GetTokenByKey(token.Key, true)
	require.NoError(t, err)
	require.NoError(t, DB.Model(&Token{}).Where("id = ?", token.Id).Update("remain_quota", 8).Error)
	ok, err := TryReserveTokenQuota(token.Id, token.Key, 9, false)
	require.NoError(t, err)
	require.False(t, ok, "stale Redis balance cannot grant a spend")
	ok, err = TryReserveTokenQuota(token.Id, token.Key, 6, false)
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, 2, getTokenFromDB(t, token.Id).RemainQuota)
	require.NoError(t, IncreaseTokenQuota(token.Id, token.Key, 5))
	require.NoError(t, DecreaseTokenQuota(token.Id, token.Key, 3))
	current := getTokenFromDB(t, token.Id)
	assert.Equal(t, 4, current.RemainQuota)
	assert.Equal(t, 4, current.UsedQuota)
	batchUpdate()
	assert.Equal(t, 4, getTokenFromDB(t, token.Id).RemainQuota, "batch flush must not apply token deltas again")
	require.NoError(t, DB.Model(&Token{}).Where("id = ?", token.Id).Update("remain_quota", 30).Error)
	loaded, err := GetTokenByKey(token.Key, false)
	require.NoError(t, err)
	assert.Equal(t, 30, loaded.RemainQuota, "stale low cache cannot deny DB-valid budget")
}

func TestTokenQuotaTransactionRollbackAndOverflow(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	token := createReserveTestToken(t, 10)
	abort := errors.New("point reservation failed")
	err := DB.Transaction(func(tx *gorm.DB) error {
		ok, err := ReserveTokenQuotaTx(tx, token.Id, 7, false)
		require.NoError(t, err)
		require.True(t, ok)
		return abort
	})
	require.ErrorIs(t, err, abort)
	current := getTokenFromDB(t, token.Id)
	assert.Equal(t, 10, current.RemainQuota)
	assert.Zero(t, current.UsedQuota)
	require.NoError(t, DB.Model(&Token{}).Where("id = ?", token.Id).Update("remain_quota", math.MaxInt).Error)
	require.Error(t, IncreaseTokenQuota(token.Id, token.Key, 1))
	assert.Equal(t, math.MaxInt, getTokenFromDB(t, token.Id).RemainQuota)
	require.Error(t, DecreaseTokenQuota(token.Id, token.Key, -1))
	require.Error(t, IncreaseTokenQuota(token.Id+1000, "", 1))
}

func TestDeletedTokenCannotReserveButCanSettleObservedUsage(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	token := createReserveTestToken(t, 10)
	require.NoError(t, token.Delete())
	ok, err := TryReserveTokenQuota(token.Id, token.Key, 1, false)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	assert.False(t, ok)
	require.NoError(t, DecreaseTokenQuota(token.Id, token.Key, 3))
	require.NoError(t, IncreaseTokenQuota(token.Id, token.Key, 1))
	var current Token
	require.NoError(t, DB.Unscoped().First(&current, token.Id).Error)
	assert.Equal(t, 8, current.RemainQuota)
	assert.Equal(t, 2, current.UsedQuota)
}

func TestTokenQuotaAuthorityDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := "local"
			switch dialect {
			case "sqlite":
				original := common.SQLitePath
				common.SQLitePath = filepath.Join(t.TempDir(), "tokens.db")
				t.Cleanup(func() { common.SQLitePath = original })
			case "mysql":
				dsn = os.Getenv("TEST_MYSQL_DSN")
			case "postgres":
				dsn = os.Getenv("TEST_POSTGRES_DSN")
			}
			if dsn == "" {
				t.Skip("isolated test database DSN is not configured")
			}
			t.Setenv("TOKEN_QUOTA_TEST_DSN", dsn)
			db, typ, err := chooseDB("TOKEN_QUOTA_TEST_DSN", false)
			require.NoError(t, err)
			previousDB, previousType := DB, common.MainDatabaseType()
			DB = db
			common.SetMainDatabaseType(typ)
			initCol()
			t.Cleanup(func() { DB = previousDB; common.SetMainDatabaseType(previousType); initCol() })
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			require.False(t, db.Migrator().HasTable(&Token{}), "requires an isolated token database")
			require.NoError(t, db.AutoMigrate(&Token{}))
			t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(&Token{})) })
			require.NoError(t, db.AutoMigrate(&Token{}))
			resetBatchUpdateTestState(t)
			common.BatchUpdateEnabled = true
			token := createReserveTestToken(t, 12)
			ok, err := TryReserveTokenQuota(token.Id, token.Key, 9, false)
			require.NoError(t, err)
			require.True(t, ok)
			ok, err = TryReserveTokenQuota(token.Id, token.Key, 4, false)
			require.NoError(t, err)
			assert.False(t, ok)
			abort := errors.New("points hold failed")
			require.ErrorIs(t, db.Transaction(func(tx *gorm.DB) error {
				ok, err := ReserveTokenQuotaTx(tx, token.Id, 2, false)
				require.NoError(t, err)
				require.True(t, ok)
				return abort
			}), abort)
			require.NoError(t, IncreaseTokenQuota(token.Id, token.Key, 5))
			batchUpdate()
			current := getTokenFromDB(t, token.Id)
			assert.Equal(t, 8, current.RemainQuota)
			assert.Equal(t, 4, current.UsedQuota)
			require.NoError(t, db.Model(&Token{}).Where("id = ?", token.Id).Update("unlimited_quota", true).Error)
			ok, err = TryReserveTokenQuota(token.Id, token.Key, 20, false)
			require.NoError(t, err)
			require.True(t, ok, "persisted unlimited flag owns admission")
			assert.Equal(t, -12, getTokenFromDB(t, token.Id).RemainQuota)
			require.NoError(t, token.Delete())
			require.NoError(t, IncreaseTokenQuota(token.Id, token.Key, 1))
			var deleted Token
			require.NoError(t, db.Unscoped().First(&deleted, token.Id).Error)
			assert.Equal(t, -11, deleted.RemainQuota)
		})
	}
}
