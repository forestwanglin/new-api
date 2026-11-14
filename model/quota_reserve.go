package model

import (
	"context"
	"errors"
	"math"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type cacheQuotaResult int

const (
	cacheQuotaInsufficient cacheQuotaResult = iota
	cacheQuotaOK
	cacheQuotaMiss
)

const userQuotaReserveScript = `
if tonumber(redis.call('HGET', KEYS[1], 'Id') or '0') ~= tonumber(ARGV[2])
  or tonumber(redis.call('HGET', KEYS[1], 'CacheSchema') or '0') ~= tonumber(ARGV[3])
  or redis.call('HEXISTS', KEYS[1], 'Quota') == 0 then
  return -1
end
local quota = tonumber(redis.call('HGET', KEYS[1], 'Quota'))
if quota == nil or quota < tonumber(ARGV[1]) then
  return 0
end
redis.call('HINCRBY', KEYS[1], 'Quota', -tonumber(ARGV[1]))
return 1`

const userQuotaDeltaScript = `
if tonumber(redis.call('HGET', KEYS[1], 'Id') or '0') ~= tonumber(ARGV[2])
  or tonumber(redis.call('HGET', KEYS[1], 'CacheSchema') or '0') ~= tonumber(ARGV[3])
  or redis.call('HEXISTS', KEYS[1], 'Quota') == 0 then
  return -1
end
redis.call('HINCRBY', KEYS[1], 'Quota', ARGV[1])
return 1`

const tokenQuotaReserveScript = `
if tonumber(redis.call('HGET', KEYS[1], 'Id') or '0') ~= tonumber(ARGV[2])
  or redis.call('HEXISTS', KEYS[1], 'RemainQuota') == 0
  or redis.call('HEXISTS', KEYS[1], 'UsedQuota') == 0 then
  return -1
end
local remain = tonumber(redis.call('HGET', KEYS[1], 'RemainQuota'))
if remain == nil or remain < tonumber(ARGV[1]) then
  return 0
end
redis.call('HINCRBY', KEYS[1], 'RemainQuota', -tonumber(ARGV[1]))
redis.call('HINCRBY', KEYS[1], 'UsedQuota', tonumber(ARGV[1]))
redis.call('HSET', KEYS[1], 'AccessedTime', ARGV[3])
return 1`

const tokenQuotaDeltaScript = `
if tonumber(redis.call('HGET', KEYS[1], 'Id') or '0') ~= tonumber(ARGV[2])
  or redis.call('HEXISTS', KEYS[1], 'RemainQuota') == 0
  or redis.call('HEXISTS', KEYS[1], 'UsedQuota') == 0 then
  return -1
end
redis.call('HINCRBY', KEYS[1], 'RemainQuota', tonumber(ARGV[1]))
redis.call('HINCRBY', KEYS[1], 'UsedQuota', -tonumber(ARGV[1]))
redis.call('HSET', KEYS[1], 'AccessedTime', ARGV[3])
return 1`

func quotaResultFromLua(result int, err error) (cacheQuotaResult, error) {
	if err != nil {
		return cacheQuotaMiss, err
	}
	switch result {
	case 1:
		return cacheQuotaOK, nil
	case 0:
		return cacheQuotaInsufficient, nil
	default:
		return cacheQuotaMiss, nil
	}
}

func cacheTryReserveUserQuota(userID int, amount int64) (cacheQuotaResult, error) {
	result, err := common.RDB.Eval(context.Background(), userQuotaReserveScript,
		[]string{getUserCacheKey(userID)}, amount, userID, userCacheSchemaVersion).Int()
	return quotaResultFromLua(result, err)
}

func cacheApplyUserQuotaDelta(userID int, delta int64) (cacheQuotaResult, error) {
	result, err := common.RDB.Eval(context.Background(), userQuotaDeltaScript,
		[]string{getUserCacheKey(userID)}, delta, userID, userCacheSchemaVersion).Int()
	return quotaResultFromLua(result, err)
}

func cacheTryReserveTokenQuota(id int, key string, amount int64) (cacheQuotaResult, error) {
	result, err := common.RDB.Eval(context.Background(), tokenQuotaReserveScript,
		[]string{getTokenCacheKey(key)}, amount, id, common.GetTimestamp()).Int()
	return quotaResultFromLua(result, err)
}

func cacheApplyTokenQuotaDelta(id int, key string, delta int64) (cacheQuotaResult, error) {
	result, err := common.RDB.Eval(context.Background(), tokenQuotaDeltaScript,
		[]string{getTokenCacheKey(key)}, delta, id, common.GetTimestamp()).Int()
	return quotaResultFromLua(result, err)
}

// persistUserQuotaDelta 把已在缓存侧预扣成功的增量落库；批量模式下入队，
// 直写模式下要求行存在（用户已删除时报错，交由调用方补偿缓存）。
func persistUserQuotaDelta(id int, delta int) error {
	if common.BatchUpdateEnabled {
		addNewRecord(BatchUpdateTypeUserQuota, id, delta)
		return nil
	}
	result := DB.Model(&User{}).Where("id = ?", id).Update("quota", gorm.Expr("quota + ?", delta))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func reserveUserQuotaDB(id int, quota int) (bool, error) {
	result := DB.Model(&User{}).
		Where("id = ? AND quota >= ?", id, quota).
		Update("quota", gorm.Expr("quota - ?", quota))
	return result.RowsAffected == 1, result.Error
}

// TryReserveUserQuota atomically checks and deducts a user's wallet quota.
// 缓存命中时以缓存余额为准（避免批量模式下过期的数据库余额放大并发超扣）；
// Redis 异常或水合失败时降级为数据库条件更新，保证服务可用。
func TryReserveUserQuota(id int, quota int) (bool, error) {
	if quota < 0 {
		return false, errors.New("quota cannot be negative")
	}
	if quota == 0 {
		return true, nil
	}
	if !common.RedisEnabled {
		return reserveUserQuotaDB(id, quota)
	}

	result, err := cacheTryReserveUserQuota(id, int64(quota))
	if err == nil && result == cacheQuotaMiss {
		if _, hydrateErr := GetUserCache(id); hydrateErr == nil {
			result, err = cacheTryReserveUserQuota(id, int64(quota))
		}
	}
	if err != nil || result == cacheQuotaMiss {
		if err != nil {
			common.SysLog(common.LogText("user quota cache reserve unavailable, falling back to database: %s", err.Error()))
		}
		return reserveUserQuotaDB(id, quota)
	}
	if result == cacheQuotaInsufficient {
		return false, nil
	}
	if err = persistUserQuotaDelta(id, -quota); err != nil {
		compensated, compensateErr := cacheApplyUserQuotaDelta(id, int64(quota))
		if compensateErr != nil || compensated != cacheQuotaOK {
			common.SysError(common.LogText("failed to compensate reserved user quota: result=%d error=%v", compensated, compensateErr))
		}
		return false, err
	}
	return true, nil
}

// ReserveTokenQuotaTx uses the current persisted token, never a cached budget.
// The caller owns the transaction and must invalidate the cache after commit.
func ReserveTokenQuotaTx(tx *gorm.DB, id int, quota int, _ bool) (bool, error) {
	if quota < 0 {
		return false, errors.New("quota cannot be negative")
	}
	token, err := lockTokenQuotaTx(tx, id)
	if err != nil {
		return false, err
	}
	if token.Status != common.TokenStatusEnabled || (token.ExpiredTime != -1 && token.ExpiredTime < common.GetTimestamp()) {
		return false, nil
	}
	if !token.UnlimitedQuota && token.RemainQuota < quota {
		return false, nil
	}
	if err := adjustLockedTokenQuotaTx(tx, token, -quota); err != nil {
		return false, err
	}
	return true, nil
}

// AdjustTokenQuotaTx records an observed debit (negative) or refund (positive).
// Unlike admission, already-observed usage may exceed the remaining budget.
func AdjustTokenQuotaTx(tx *gorm.DB, id int, delta int) error {
	// A key deleted during an in-flight call is unusable for new admission,
	// but its tombstone must still account for observed usage and refunds.
	tx = tx.Unscoped().Session(&gorm.Session{})
	token, err := lockTokenQuotaTx(tx, id)
	if err != nil {
		return err
	}
	return adjustLockedTokenQuotaTx(tx, token, delta)
}

func lockTokenQuotaTx(tx *gorm.DB, id int) (*Token, error) {
	if id <= 0 {
		return nil, errors.New("invalid token id")
	}
	// Acquire SQLite's writer lock before reading; other engines use row locks.
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		if err := tx.Model(&Token{}).Where("id = ?", id).UpdateColumn("accessed_time", gorm.Expr("accessed_time")).Error; err != nil {
			return nil, err
		}
	}
	var token Token
	if err := lockForUpdate(tx).First(&token, id).Error; err != nil {
		return nil, err
	}
	return &token, nil
}

func adjustLockedTokenQuotaTx(tx *gorm.DB, token *Token, delta int) error {
	if (delta > 0 && (token.RemainQuota > math.MaxInt-delta || token.UsedQuota < math.MinInt+delta)) ||
		(delta < 0 && (token.RemainQuota < math.MinInt-delta || token.UsedQuota > math.MaxInt+delta)) {
		return errors.New("token quota overflow")
	}
	result := tx.Model(&Token{}).Where("id = ?", token.Id).Updates(map[string]any{
		"remain_quota":  token.RemainQuota + delta,
		"used_quota":    token.UsedQuota - delta,
		"accessed_time": common.GetTimestamp(),
	})
	return result.Error
}

// TryReserveTokenQuota keeps the legacy API but uses the same DB authority as
// points reservations. BatchUpdateEnabled and Redis cannot change admission.
func TryReserveTokenQuota(id int, key string, quota int, unlimited bool) (bool, error) {
	var reserved bool
	err := DB.Transaction(func(tx *gorm.DB) error {
		var err error
		reserved, err = ReserveTokenQuotaTx(tx, id, quota, unlimited)
		return err
	})
	if err == nil && reserved {
		invalidateTokenQuotaAfterCommit(key)
	}
	return reserved && err == nil, err
}
