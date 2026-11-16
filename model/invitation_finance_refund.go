package model

import (
	"errors"
	"fmt"
	"gorm.io/gorm"
	"strings"
	"time"
)

func PrepareInvitationRefund(orderID, operatorID, amountMinor int64, requestID string) (*InvitationRefundOperation, error) {
	if orderID <= 0 || operatorID <= 0 || amountMinor <= 0 || len(requestID) < 1 || len(requestID) > 64 || strings.TrimSpace(requestID) != requestID {
		return nil, ErrInvitationInvalid
	}
	var result InvitationRefundOperation
	err := invitationTransaction(func() int64 { return time.Now().UnixMilli() }, func(tx *gorm.DB, now int64) error {
		if err := reconcileInvitationQualifications(tx, now); err != nil {
			return err
		}
		var order CustomSubscriptionOrder
		if err := lockForUpdate(tx).First(&order, orderID).Error; err != nil {
			return ErrInvitationNotFound
		}
		found := tx.Where("order_id = ? AND request_id = ?", orderID, requestID).Limit(1).Find(&result)
		if found.Error != nil {
			return found.Error
		}
		if found.RowsAffected > 0 {
			if result.RequestId != requestID || result.AmountMinor != amountMinor || result.OperatorId != operatorID {
				return ErrInvitationRefundConflict
			}
			return nil
		}
		if order.Status != "success" || order.AmountPaidMinor <= 0 || order.RefundedAmountMinor < 0 || amountMinor > order.AmountPaidMinor-order.RefundedAmountMinor {
			return ErrInvitationRefundConflict
		}
		var pending []InvitationRefundOperation
		if err := tx.Where("order_id = ? AND status = ?", orderID, "PREPARED").Find(&pending).Error; err != nil {
			return err
		}
		remaining := order.AmountPaidMinor - order.RefundedAmountMinor
		for _, op := range pending {
			if op.AmountMinor > remaining {
				return ErrInvitationRefundConflict
			}
			remaining -= op.AmountMinor
		}
		if amountMinor > remaining {
			return ErrInvitationRefundConflict
		}
		result = InvitationRefundOperation{OrderId: orderID, OperatorId: operatorID, AmountMinor: amountMinor, RequestId: requestID, Status: "PREPARED", PreparedAt: now}
		if err := tx.Create(&result).Error; err != nil {
			return err
		}
		return invitationAudit(tx, operatorID, "refund_prepare", "refund", result.Id, now)
	})
	return &result, err
}

func CompleteInvitationRefund(orderID, refundID, operatorID, amountMinor int64, provider, providerRefundID string) (*InvitationRefundOperation, error) {
	if orderID <= 0 || refundID <= 0 || operatorID <= 0 || amountMinor <= 0 || len(provider) < 1 || len(provider) > 32 || len(providerRefundID) < 1 || len(providerRefundID) > 128 || strings.TrimSpace(provider) != provider || strings.TrimSpace(providerRefundID) != providerRefundID {
		return nil, ErrInvitationInvalid
	}
	var result InvitationRefundOperation
	err := invitationTransaction(func() int64 { return time.Now().UnixMilli() }, func(tx *gorm.DB, now int64) error {
		if err := reconcileInvitationQualifications(tx, now); err != nil {
			return err
		}
		var order CustomSubscriptionOrder
		if err := lockForUpdate(tx).First(&order, orderID).Error; err != nil {
			return ErrInvitationNotFound
		}
		if err := lockForUpdate(tx).Where("id = ? AND order_id = ?", refundID, orderID).First(&result).Error; err != nil {
			return ErrInvitationNotFound
		}
		if result.Status == "SUCCEEDED" {
			if result.AmountMinor != amountMinor || result.Provider != provider || result.ProviderRefundId == nil || *result.ProviderRefundId != providerRefundID {
				return ErrInvitationRefundConflict
			}
			return nil
		}
		if result.Status != "PREPARED" || amountMinor != result.AmountMinor || amountMinor > order.AmountPaidMinor-order.RefundedAmountMinor {
			return ErrInvitationRefundConflict
		}
		order.RefundedAmountMinor += amountMinor
		order.RefundStatus = "partial"
		if order.RefundedAmountMinor == order.AmountPaidMinor {
			order.RefundStatus = "full"
		}
		if err := tx.Model(&order).Updates(map[string]any{"refunded_amount_minor": order.RefundedAmountMinor, "refund_status": order.RefundStatus, "updated_at": now}).Error; err != nil {
			return err
		}
		result.Status = "SUCCEEDED"
		result.Provider = provider
		result.ProviderRefundId = &providerRefundID
		result.CompletedAt = &now
		result.CompletedBy = &operatorID
		if err := tx.Save(&result).Error; err != nil {
			return err
		}
		if err := invitationAudit(tx, operatorID, "refund_complete", "refund", result.Id, now); err != nil {
			return err
		}
		var reward InvitationReward
		found := lockForUpdate(tx).Where("order_id = ?", orderID).Limit(1).Find(&reward)
		if found.Error != nil {
			return found.Error
		}
		if found.RowsAffected > 0 {
			reward.NetPaidAmountMinor = order.AmountPaidMinor - order.RefundedAmountMinor
			target, err := invitationRewardPoints(reward.NetPaidAmountMinor, reward.RateBps)
			if err != nil {
				return err
			}
			cancelled := reward.OriginalPoints - target
			switch reward.Status {
			case InvitationRewardCaptured:
				if reward.FreezeId != nil {
					return ErrInvitationConflict
				}
				reward.CancelledPoints = cancelled
				reward.ProcessingPoints = target
				// The pending durable event still needs acknowledgment at zero target.
			case InvitationRewardCancelled:
				// Further cash refunds can leave an already cancelled target at zero.
				// Keep the closed freeze and completed event as historical evidence.
				if target != 0 || reward.ProcessingPoints != 0 || reward.FrozenPoints != 0 || reward.ReleasedPoints != 0 || reward.CancelledPoints != reward.OriginalPoints {
					return ErrInvitationConflict
				}

			case InvitationRewardFrozen:
				delta := cancelled - reward.CancelledPoints
				if delta < 0 || delta > reward.FrozenPoints {
					return ErrInvitationConflict
				}
				if delta > 0 {
					if err := invitationPointsMutation(tx, &reward, 0, -delta, PointActionRevoke, invitationEventKey(reward.Id, fmt.Sprintf("refund:%d", refundID)), &operatorID, "Invitation reward refund cancellation", now); err != nil {
						return err
					}
				}
				reward.CancelledPoints = cancelled
				reward.FrozenPoints -= delta
				if reward.FrozenPoints == 0 {
					reward.Status = InvitationRewardCancelled
				}
			case InvitationRewardReleased, InvitationRewardReview:
				reward.ReviewDuePoints = max(0, reward.ReleasedPoints-target-reward.ReversedPoints)
				if reward.ReviewDuePoints > 0 {
					reward.Status = InvitationRewardReview
				}
			default:
				return ErrInvitationConflict
			}
			reward.UpdatedAt = now
			if err := tx.Save(&reward).Error; err != nil {
				return err
			}
		}
		return reconcileInvitationQualifications(tx, now)
	})
	return &result, err
}

func CancelInvitationRefund(orderID, refundID, operatorID int64) (*InvitationRefundOperation, error) {
	if orderID <= 0 || refundID <= 0 || operatorID <= 0 {
		return nil, ErrInvitationInvalid
	}
	var result InvitationRefundOperation
	err := invitationTransaction(func() int64 { return time.Now().UnixMilli() }, func(tx *gorm.DB, now int64) error {
		if err := reconcileInvitationQualifications(tx, now); err != nil {
			return err
		}
		if err := lockForUpdate(tx).Where("id = ? AND order_id = ?", refundID, orderID).First(&result).Error; err != nil {
			return ErrInvitationNotFound
		}
		if result.Status == "CANCELLED" {
			return nil
		}
		if result.Status != "PREPARED" {
			return ErrInvitationRefundConflict
		}
		result.Status = "CANCELLED"
		result.CancelledAt = &now
		result.CancelledBy = &operatorID
		if err := tx.Save(&result).Error; err != nil {
			return err
		}
		if err := invitationAudit(tx, operatorID, "refund_cancel", "refund", result.Id, now); err != nil {
			return err
		}
		if err := tx.Model(&InvitationReward{}).Where("order_id = ?", orderID).Update("release_retry_at", int64(0)).Error; err != nil {
			return err
		}
		return reconcileInvitationQualifications(tx, now)
	})
	return &result, err
}

func ReverseInvitationReward(rewardID, operatorID, points int64, requestID, reason string) (*InvitationRewardView, error) {
	if rewardID <= 0 || operatorID <= 0 || points <= 0 || len(requestID) < 1 || len(requestID) > 64 || strings.TrimSpace(requestID) != requestID || strings.TrimSpace(reason) == "" || len(reason) > 512 {
		return nil, ErrInvitationInvalid
	}
	var reward InvitationReward
	err := invitationTransaction(func() int64 { return time.Now().UnixMilli() }, func(tx *gorm.DB, now int64) error {
		if err := lockForUpdate(tx).First(&reward, rewardID).Error; err != nil {
			return ErrInvitationNotFound
		}
		var existing InvitationRewardReversal
		found := tx.Where("reward_id = ? AND request_id = ?", rewardID, requestID).Limit(1).Find(&existing)
		if found.Error != nil {
			return found.Error
		}
		if found.RowsAffected > 0 {
			if existing.RequestId != requestID || existing.OperatorId != operatorID || existing.Points != points || existing.Reason != reason {
				return ErrInvitationConflict
			}
			return nil
		}
		if reward.Status != InvitationRewardReview || points > reward.ReviewDuePoints || points > reward.ReleasedPoints-reward.ReversedPoints {
			return ErrInvitationReviewRequired
		}
		reversal := InvitationRewardReversal{RewardId: rewardID, OperatorId: operatorID, Points: points, RequestId: requestID, Reason: reason, CreatedAt: now}
		if err := tx.Create(&reversal).Error; err != nil {
			return err
		}
		if err := invitationAudit(tx, operatorID, "reward_reversal", "reward", rewardID, now); err != nil {
			return err
		}
		if err := invitationPointsMutation(tx, &reward, -points, 0, PointActionRevoke, invitationEventKey(reward.Id, fmt.Sprintf("reversal:%d", reversal.Id)), &operatorID, reason, now); err != nil {
			return err
		}
		reward.ReversedPoints += points
		reward.ReviewDuePoints -= points
		if reward.ReviewDuePoints == 0 {
			reward.Status = InvitationRewardReleased
		}
		reward.UpdatedAt = now
		return tx.Save(&reward).Error
	})
	if err != nil {
		return nil, err
	}
	view := invitationRewardView(reward)
	return &view, nil
}

// normalizeInvitationFinanceError never exposes database evidence through APIs.
func normalizeInvitationFinanceError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrInvitationNotFound
	}
	return err
}
