package model

import (
	"fmt"

	"gorm.io/gorm"
)

const tokenUsedPointsVersion = 1

// adjustTokenUsedPointsTx runs after financial replay checks and before account
// mutation, so the token counter and the call's new cumulative points commit
// together. Legacy-mode calls and deleted-key tombstones must contribute too.
func adjustTokenUsedPointsTx(tx *gorm.DB, tokenID int, delta int64) error {
	tx = tx.Unscoped().Session(&gorm.Session{})
	token, err := lockTokenQuotaTx(tx, tokenID)
	if err != nil {
		return err
	}
	if token.UsedPointsVersion != tokenUsedPointsVersion || token.UsedPoints < 0 {
		return ErrTokenPointLimitInvalid
	}
	next, err := pointAdd(token.UsedPoints, delta)
	if err != nil || next < 0 {
		return ErrTokenPointLimitInvalid
	}
	if delta == 0 {
		return nil
	}
	return tx.Model(&Token{}).Where("id = ?", tokenID).Update("used_points", next).Error
}

// migrateTokenPointCounters is a restart-safe startup backfill. Quiesce all old
// financial writers before upgrading; they do not maintain this counter. Each
// token's total and version commit atomically; incomplete tokens fail closed in
// admission, settlement and management reads. New tokens initialize in Create.
func migrateTokenPointCounters(db *gorm.DB) error {
	const batchSize = 500
	lastID := 0
	for {
		var tokens []Token
		if err := db.Unscoped().Select("id").Where("id > ? AND used_points_version = ?", lastID, 0).Order("id ASC").Limit(batchSize).Find(&tokens).Error; err != nil {
			return fmt.Errorf("read tokens for points counter migration: %w", err)
		}
		if len(tokens) == 0 {
			return nil
		}
		for _, candidate := range tokens {
			if err := db.Transaction(func(tx *gorm.DB) error {
				token, err := lockTokenQuotaTx(tx.Unscoped().Session(&gorm.Session{}), candidate.Id)
				if err != nil {
					return err
				}
				if token.UsedPointsVersion == tokenUsedPointsVersion {
					return nil
				}
				if token.UsedPointsVersion != 0 {
					return ErrTokenPointLimitInvalid
				}
				var total int64
				lastCallID := ""
				for {
					var calls []PointCallBilling
					query := tx.Select("id", "user_id", "points").Where("token_id = ?", token.Id)
					if lastCallID != "" {
						query = query.Where("id > ?", lastCallID)
					}
					if err := query.Order("id ASC").Limit(batchSize).Find(&calls).Error; err != nil {
						return err
					}
					if len(calls) == 0 {
						break
					}
					for _, call := range calls {
						if call.ID == "" || call.UserID != token.UserId || call.Points < 0 {
							return ErrTokenPointLimitInvalid
						}
						total, err = pointAdd(total, call.Points)
						if err != nil {
							return err
						}
						lastCallID = call.ID
					}
				}
				return tx.Unscoped().Model(&Token{}).Where("id = ?", token.Id).Updates(map[string]any{"used_points": total, "used_points_version": tokenUsedPointsVersion}).Error
			}); err != nil {
				return fmt.Errorf("backfill token %d points counter: %w", candidate.Id, err)
			}
			lastID = candidate.Id
		}
	}
}
