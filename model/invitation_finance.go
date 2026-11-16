package model

import (
	"errors"
	"fmt"
	"gorm.io/gorm"
	"math/big"
)

const (
	InvitationRewardCaptured  = "CAPTURED"
	InvitationRewardFrozen    = "FROZEN"
	InvitationRewardReleased  = "RELEASED"
	InvitationRewardCancelled = "CANCELLED"
	InvitationRewardReview    = "REVIEW_REQUIRED"
)

type InvitationReward struct {
	ReleaseRetryAt     int64  `gorm:"type:bigint;not null;default:0"`
	ReleaseAttempts    int    `gorm:"not null;default:0"`
	ReleaseLastError   string `gorm:"type:varchar(256)"`
	Id                 int64  `gorm:"primaryKey"`
	OrderId            int64  `gorm:"type:bigint;not null;uniqueIndex:idx_inv_reward_order"`
	InviterId          int64  `gorm:"type:bigint;not null;index:idx_inv_reward_user"`
	InviteeId          int64  `gorm:"type:bigint;not null"`
	CampaignId         int64  `gorm:"type:bigint;not null"`
	CampaignVersion    int64  `gorm:"type:bigint;not null"`
	CampaignName       string `gorm:"type:varchar(128);not null"`
	PointTypeId        int64  `gorm:"type:bigint;not null"`
	PointTypeCode      string `gorm:"type:varchar(32);not null"`
	PointTypeName      string `gorm:"type:varchar(64);not null"`
	PaidAmountMinor    int64  `gorm:"type:bigint;not null"`
	NetPaidAmountMinor int64  `gorm:"type:bigint;not null"`
	RateBps            int    `gorm:"not null"`
	EffectiveCount     int64  `gorm:"type:bigint;not null"`
	FreezeDays         int    `gorm:"not null"`
	PaidAt             int64  `gorm:"type:bigint;not null"`
	ReleaseAt          int64  `gorm:"type:bigint;not null;index:idx_inv_reward_due,priority:2"`
	OriginalPoints     int64  `gorm:"type:bigint;not null"`
	ProcessingPoints   int64  `gorm:"type:bigint;not null"`
	FrozenPoints       int64  `gorm:"type:bigint;not null"`
	ReleasedPoints     int64  `gorm:"type:bigint;not null"`
	CancelledPoints    int64  `gorm:"type:bigint;not null"`
	ReversedPoints     int64  `gorm:"type:bigint;not null"`
	ReviewDuePoints    int64  `gorm:"type:bigint;not null"`
	FreezeId           *int64 `gorm:"type:bigint"`
	Status             string `gorm:"type:varchar(32);not null;index:idx_inv_reward_due,priority:1"`
	CreatedAt          int64  `gorm:"type:bigint;autoCreateTime:milli"`
	UpdatedAt          int64  `gorm:"type:bigint;autoUpdateTime:milli"`
}

type InvitationRewardEvent struct {
	Id            int64  `gorm:"primaryKey"`
	RewardId      int64  `gorm:"type:bigint;not null;uniqueIndex:idx_inv_event_reward"`
	Status        string `gorm:"type:varchar(16);not null;index:idx_inv_event_due,priority:1"`
	Attempts      int    `gorm:"not null"`
	NextAttemptAt int64  `gorm:"type:bigint;not null;index:idx_inv_event_due,priority:2"`
	LastError     string `gorm:"type:varchar(256);not null"`
	CreatedAt     int64  `gorm:"type:bigint;autoCreateTime:milli"`
	UpdatedAt     int64  `gorm:"type:bigint;autoUpdateTime:milli"`
}

type InvitationRefundOperation struct {
	CompletedBy      *int64  `json:"-" gorm:"type:bigint"`
	CancelledBy      *int64  `json:"-" gorm:"type:bigint"`
	Id               int64   `json:"id,string" gorm:"primaryKey"`
	OrderId          int64   `json:"order_id,string" gorm:"type:bigint;not null;uniqueIndex:idx_inv_refund_request,priority:1;index:idx_inv_refund_hold,priority:1"`
	OperatorId       int64   `json:"-" gorm:"type:bigint;not null"`
	AmountMinor      int64   `json:"amount_minor,string" gorm:"type:bigint;not null"`
	RequestId        string  `json:"-" gorm:"type:varchar(64);not null;uniqueIndex:idx_inv_refund_request,priority:2"`
	Status           string  `json:"status" gorm:"type:varchar(16);not null;index:idx_inv_refund_hold,priority:2"`
	Provider         string  `json:"-" gorm:"type:varchar(32);not null;uniqueIndex:idx_inv_refund_provider,priority:1"`
	ProviderRefundId *string `json:"-" gorm:"type:varchar(128);uniqueIndex:idx_inv_refund_provider,priority:2"`
	PreparedAt       int64   `json:"-" gorm:"type:bigint;not null"`
	CompletedAt      *int64  `json:"-" gorm:"type:bigint"`
	CancelledAt      *int64  `json:"-" gorm:"type:bigint"`
}

type InvitationRewardReversal struct {
	Id         int64  `gorm:"primaryKey"`
	RewardId   int64  `gorm:"type:bigint;not null;uniqueIndex:idx_inv_reversal_request,priority:1"`
	OperatorId int64  `gorm:"type:bigint;not null"`
	Points     int64  `gorm:"type:bigint;not null"`
	RequestId  string `gorm:"type:varchar(64);not null;uniqueIndex:idx_inv_reversal_request,priority:2"`
	Reason     string `gorm:"type:varchar(512);not null"`
	CreatedAt  int64  `gorm:"type:bigint;autoCreateTime:milli"`
}

func migrateInvitationFinance(db *gorm.DB) error {
	return db.AutoMigrate(&InvitationReward{}, &InvitationRewardEvent{}, &InvitationRefundOperation{}, &InvitationRewardReversal{})
}

func invitationRewardPoints(amount int64, rate int) (int64, error) {
	if amount < 0 || rate < 0 || rate > 10000 {
		return 0, ErrInvitationInvalid
	}
	n := new(big.Int).Mul(big.NewInt(amount), big.NewInt(int64(rate)))
	n.Quo(n, big.NewInt(1000))
	if !n.IsInt64() {
		return 0, ErrInvitationInvalid
	}
	return n.Int64(), nil
}

func captureInvitationReward(tx *gorm.DB, order *CustomSubscriptionOrder, now int64) error {
	if order.InvitationCaptureVersion != nil {
		return nil
	}
	marker := int64(1)
	result := "excluded"
	if order.Currency == "CNY" && (order.OrderType == "purchase" || order.OrderType == "renewal") {
		if err := reconcileInvitationQualifications(tx, now); err != nil {
			return err
		}
		var binding InvitationBinding
		found := tx.Where("invitee_id = ?", order.UserId).Limit(1).Find(&binding)
		if found.Error != nil {
			return found.Error
		}
		result = "no_inviter"
		valid := false
		if found.RowsAffected > 0 {
			var err error
			valid, err = validInvitationRewardBinding(tx, order.UserId, now)
			if err != nil {
				return err
			}
			if !valid {
				result = "excluded_invalid_binding"
			}
		}
		if valid {
			if err := captureInvitationQualification(tx, order, now); err != nil {
				return err
			}
			campaign, err := activeInvitationVersion(tx, now)
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if errors.Is(err, gorm.ErrRecordNotFound) {
				campaign = nil
			}
			result = "no_campaign"
			if campaign != nil {
				count, err := invitationEffectiveCount(tx, binding.InviterId)
				if err != nil {
					return err
				}
				rate, err := invitationRate(tx, campaign.Id, count)
				if err != nil {
					return err
				}
				points, err := invitationRewardPoints(order.AmountPaidMinor, rate)
				if err != nil {
					return err
				}
				var pt PointType
				if err := tx.First(&pt, campaign.RewardPointTypeId).Error; err != nil {
					return err
				}
				release := big.NewInt(now)
				release.Add(release, new(big.Int).Mul(big.NewInt(int64(campaign.FreezeDays)), big.NewInt(86400000)))
				if !release.IsInt64() {
					return ErrInvitationInvalid
				}
				reward := InvitationReward{OrderId: order.Id, InviterId: binding.InviterId, InviteeId: order.UserId, CampaignId: campaign.CampaignId, CampaignVersion: campaign.Version, CampaignName: campaign.Name, PointTypeId: pt.Id, PointTypeCode: pt.Code, PointTypeName: pt.Name, PaidAmountMinor: order.AmountPaidMinor, NetPaidAmountMinor: order.AmountPaidMinor, RateBps: rate, EffectiveCount: count, FreezeDays: campaign.FreezeDays, PaidAt: now, ReleaseAt: release.Int64(), OriginalPoints: points, ProcessingPoints: points, Status: InvitationRewardCaptured, CreatedAt: now, UpdatedAt: now}
				if err := tx.Create(&reward).Error; err != nil {
					return err
				}
				event := InvitationRewardEvent{RewardId: reward.Id, Status: "PENDING", NextAttemptAt: now, CreatedAt: now, UpdatedAt: now}
				if err := tx.Create(&event).Error; err != nil {
					return err
				}
				result = "captured"
			}
		}
	}
	order.InvitationCaptureVersion = &marker
	order.InvitationCaptureResult = &result
	return tx.Model(order).Updates(map[string]any{"invitation_capture_version": marker, "invitation_capture_result": result}).Error
}

func invitationEventKey(id int64, action string) string {
	return fmt.Sprintf("invite:%d:%s", id, action)
}
