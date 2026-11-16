package model

import (
	"fmt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"math"
	"time"
)

// invitationPointsMutation journals one owned freeze or available mutation.
// Control -> reward -> user -> account -> freeze is shared by every writer.
func invitationPointsMutation(tx *gorm.DB, r *InvitationReward, available, frozen int64, action, key string, operator *int64, remark string, now int64) error {
	if available == 0 && frozen == 0 {
		return ErrInvitationInvalid
	}
	var user User
	if err := lockForUpdate(tx).Select("id").First(&user, r.InviterId).Error; err != nil {
		return err
	}
	account := PointAccount{UserId: r.InviterId, PointTypeId: r.PointTypeId}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
		return err
	}
	if err := lockForUpdate(tx).Where("user_id = ? AND point_type_id = ?", r.InviterId, r.PointTypeId).First(&account).Error; err != nil {
		return err
	}
	if account.Version < 0 || account.Version == math.MaxInt64 || account.FrozenPoints < 0 || (available > 0 && account.AvailablePoints > math.MaxInt64-available) || (available < 0 && account.AvailablePoints < math.MinInt64-available) || (frozen > 0 && account.FrozenPoints > math.MaxInt64-frozen) || (frozen < 0 && account.FrozenPoints < -frozen) {
		return ErrInvitationConflict
	}
	operatorType := PointOperatorSystem
	if operator != nil {
		operatorType = PointOperatorAdmin
	}
	points := max(available, frozen)
	if points <= 0 {
		points = -min(available, frozen)
	}
	transaction := PointTransaction{UserId: r.InviterId, EventKey: key, Action: action, BizType: "INVITATION_REWARD", BizId: fmt.Sprint(r.Id), Points: points, OperatorType: operatorType, OperatorId: operator, Remark: remark, CreatedAt: now}
	if err := tx.Create(&transaction).Error; err != nil {
		return err
	}
	var freeze PointFreeze
	if action == PointActionCredit {
		if r.FreezeId != nil || available != 0 || frozen <= 0 {
			return ErrInvitationConflict
		}
		freeze = PointFreeze{AccountId: account.Id, TransactionId: transaction.Id, OriginalPoints: frozen, RemainingPoints: frozen, ReasonCode: "INVITATION_REWARD", Reason: "Invitation reward", Status: PointFreezeActive, CreatedAt: now, UpdatedAt: now}
		if err := tx.Create(&freeze).Error; err != nil {
			return err
		}
		r.FreezeId = &freeze.Id
	} else if frozen != 0 {
		if r.FreezeId == nil {
			return ErrInvitationConflict
		}
		if err := lockForUpdate(tx).First(&freeze, *r.FreezeId).Error; err != nil {
			return err
		}
		if freeze.AccountId != account.Id || freeze.ReasonCode != "INVITATION_REWARD" || freeze.Status != PointFreezeActive || freeze.RemainingPoints != r.FrozenPoints || frozen > 0 || freeze.RemainingPoints < -frozen {
			return ErrInvitationConflict
		}
		freeze.RemainingPoints += frozen
		freeze.UpdatedAt = now
		if freeze.RemainingPoints == 0 {
			freeze.Status = PointFreezeClosed
			freeze.ClosedAt = &now
		}
		if err := tx.Save(&freeze).Error; err != nil {
			return err
		}
	}
	nextAvailable, nextFrozen := account.AvailablePoints+available, account.FrozenPoints+frozen
	result := tx.Model(&PointAccount{}).Where("id = ? AND version = ?", account.Id, account.Version).Updates(map[string]any{"available_points": nextAvailable, "frozen_points": nextFrozen, "version": account.Version + 1, "updated_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrInvitationConflict
	}
	return tx.Create(&PointLedger{TransactionId: transaction.Id, AccountId: account.Id, AccountVersion: account.Version + 1, FreezeId: r.FreezeId, AvailableDelta: available, FrozenDelta: frozen, AvailableBefore: account.AvailablePoints, AvailableAfter: nextAvailable, FrozenBefore: account.FrozenPoints, FrozenAfter: nextFrozen, CreatedAt: now}).Error
}

func ProcessInvitationRewards(limit int) (int, error) {
	return processInvitationRewardsAt(limit, time.Now().UnixMilli())
}
func processInvitationRewardsAt(limit int, now int64) (int, error) {
	if limit < 1 || limit > 1000 {
		return 0, ErrInvitationInvalid
	}
	if err := invitationTransaction(func() int64 { return now }, func(tx *gorm.DB, at int64) error { return reconcileInvitationQualifications(tx, at) }); err != nil {
		return 0, err
	}
	var events []InvitationRewardEvent
	if err := DB.Where("status = ? AND next_attempt_at <= ?", "PENDING", now).Order("next_attempt_at ASC, id ASC").Limit(limit).Find(&events).Error; err != nil {
		return 0, err
	}
	processed := 0
	var firstError error
	for _, event := range events {
		err := invitationTransaction(func() int64 { return now }, func(tx *gorm.DB, at int64) error {
			var e InvitationRewardEvent
			if err := lockForUpdate(tx).First(&e, event.Id).Error; err != nil {
				return err
			}
			if e.Status != "PENDING" || e.NextAttemptAt > at {
				return nil
			}
			var r InvitationReward
			if err := lockForUpdate(tx).First(&r, e.RewardId).Error; err != nil {
				return err
			}
			if r.Status != InvitationRewardCaptured {
				return ErrInvitationConflict
			}
			points := r.ProcessingPoints
			if points > 0 {
				if err := invitationPointsMutation(tx, &r, 0, points, PointActionCredit, invitationEventKey(r.Id, "credit"), nil, "Invitation reward frozen", at); err != nil {
					return err
				}
				r.FrozenPoints = points
				r.ProcessingPoints = 0
				r.Status = InvitationRewardFrozen
			} else {
				r.Status = InvitationRewardCancelled
			}
			r.UpdatedAt = at
			if err := tx.Save(&r).Error; err != nil {
				return err
			}
			return tx.Model(&e).Updates(map[string]any{"status": "DONE", "last_error": "", "updated_at": at}).Error
		})
		if err != nil {
			if firstError == nil {
				firstError = err
			}
			retryErr := invitationTransaction(func() int64 { return now }, func(tx *gorm.DB, at int64) error {
				var e InvitationRewardEvent
				if err := lockForUpdate(tx).First(&e, event.Id).Error; err != nil {
					return err
				}
				if e.Status != "PENDING" {
					return nil
				}
				e.Attempts = min(e.Attempts+1, 1000000)
				e.NextAttemptAt = at + int64(min(e.Attempts, 60))*30000
				e.LastError = "Invitation reward processing failed"
				e.UpdatedAt = at
				return tx.Save(&e).Error
			})
			if retryErr != nil && firstError == nil {
				firstError = retryErr
			}
			continue
		}
		processed++
	}
	var rewards []InvitationReward
	if err := DB.Where("status = ? AND release_at <= ? AND release_retry_at <= ?", InvitationRewardFrozen, now, now).Order("release_at ASC, id ASC").Limit(limit).Find(&rewards).Error; err != nil {
		return processed, err
	}
	for _, candidate := range rewards {
		err := invitationTransaction(func() int64 { return now }, func(tx *gorm.DB, at int64) error {
			var r InvitationReward
			if err := lockForUpdate(tx).First(&r, candidate.Id).Error; err != nil {
				return err
			}
			if r.Status != InvitationRewardFrozen || r.ReleaseAt > at {
				return nil
			}
			var holds int64
			if err := tx.Model(&InvitationRefundOperation{}).Where("order_id = ? AND status = ?", r.OrderId, "PREPARED").Count(&holds).Error; err != nil {
				return err
			}
			if holds > 0 {
				return tx.Model(&r).Updates(map[string]any{"release_retry_at": at + 30000, "release_last_error": "Refund operation pending"}).Error
			}
			points := r.FrozenPoints
			if points <= 0 {
				return ErrInvitationConflict
			}
			if err := invitationPointsMutation(tx, &r, points, -points, PointActionUnfreeze, invitationEventKey(r.Id, "release"), nil, "Invitation reward released", at); err != nil {
				return err
			}
			r.FrozenPoints = 0
			r.ReleasedPoints += points
			r.Status = InvitationRewardReleased
			r.UpdatedAt = at
			return tx.Save(&r).Error
		})
		if err != nil {
			if firstError == nil {
				firstError = err
			}
			retryErr := invitationTransaction(func() int64 { return now }, func(tx *gorm.DB, at int64) error {
				var r InvitationReward
				if err := lockForUpdate(tx).First(&r, candidate.Id).Error; err != nil {
					return err
				}
				if r.Status != InvitationRewardFrozen {
					return nil
				}
				r.ReleaseAttempts = min(r.ReleaseAttempts+1, 1000000)
				r.ReleaseRetryAt = at + int64(min(r.ReleaseAttempts, 60))*30000
				r.ReleaseLastError = "Invitation reward release failed"
				return tx.Save(&r).Error
			})
			if retryErr != nil {
				return processed, retryErr
			}
			continue
		}
		processed++
	}
	return processed, firstError
}
