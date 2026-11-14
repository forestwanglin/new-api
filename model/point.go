package model

import (
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

const (
	PointsPerRMB        int64 = 1000
	PointTypeGeneral          = "GENERAL"
	PointTypeGPT              = "GPT"
	PointMatchExact           = "EXACT"
	PointMatchPattern         = "PATTERN"
	PointActionCredit         = "CREDIT"
	PointActionConsume        = "CONSUME"
	PointActionFreeze         = "FREEZE"
	PointActionUnfreeze       = "UNFREEZE"
	PointActionRefund         = "REFUND"
	PointActionRevoke         = "REVOKE"
	PointOperatorSystem       = "SYSTEM"
	PointOperatorUser         = "USER"
	PointOperatorAdmin        = "ADMIN"
	PointFreezeActive         = "ACTIVE"
	PointFreezeClosed         = "CLOSED"
)

// PointModelMatchValue preserves distinct case-sensitive rules even when the
// MySQL database's default collation is case-insensitive. Matching itself is a
// service responsibility; PATTERN denotes a full-string glob with * and ?.
type PointModelMatchValue string

func (PointModelMatchValue) GormDataType() string { return "string" }

func (PointModelMatchValue) GormDBDataType(db *gorm.DB, _ *schema.Field) string {
	if db.Dialector.Name() == "mysql" {
		return "varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"
	}
	return "varchar(255)"
}

type PointType struct {
	Id              int64  `json:"id" gorm:"primaryKey"`
	Code            string `json:"code" gorm:"type:varchar(32);not null;uniqueIndex:idx_point_types_code"`
	Name            string `json:"name" gorm:"type:varchar(64);not null"`
	ConsumePriority int    `json:"consume_priority" gorm:"not null"`
	CreatedAt       int64  `json:"created_at" gorm:"autoCreateTime:milli"`
	UpdatedAt       int64  `json:"updated_at" gorm:"autoUpdateTime:milli"`
}

type PointModelRule struct {
	Id          int64                `json:"id" gorm:"primaryKey"`
	PointTypeId int64                `json:"point_type_id" gorm:"not null;uniqueIndex:idx_point_model_rules_match,priority:1"`
	MatchType   string               `json:"match_type" gorm:"type:varchar(16);not null;uniqueIndex:idx_point_model_rules_match,priority:2"`
	MatchValue  PointModelMatchValue `json:"match_value" gorm:"not null;uniqueIndex:idx_point_model_rules_match,priority:3"`
	Enabled     bool                 `json:"enabled" gorm:"not null"`
	CreatedAt   int64                `json:"created_at" gorm:"autoCreateTime:milli"`
	UpdatedAt   int64                `json:"updated_at" gorm:"autoUpdateTime:milli"`
}

// PointAccount holds integer points, not the legacy users.quota currency.
// Future mutations must update balances and the ledger in one transaction;
// frozen points must never participate in ordinary consumption.
type PointAccount struct {
	Id              int64 `json:"id" gorm:"primaryKey"`
	UserId          int64 `json:"user_id" gorm:"not null;uniqueIndex:idx_point_accounts_user_type,priority:1"`
	PointTypeId     int64 `json:"point_type_id" gorm:"not null;uniqueIndex:idx_point_accounts_user_type,priority:2"`
	AvailablePoints int64 `json:"available_points" gorm:"not null;default:0"`
	FrozenPoints    int64 `json:"frozen_points" gorm:"not null;default:0"`
	Version         int64 `json:"version" gorm:"not null;default:0"`
	CreatedAt       int64 `json:"created_at" gorm:"autoCreateTime:milli"`
	UpdatedAt       int64 `json:"updated_at" gorm:"autoUpdateTime:milli"`
}

// PointTransaction represents one successful business event, potentially split
// across several point accounts. BillingSnapshot must preserve exact decimal
// source amounts and the applied conversion/rounding policy, not float values.
type PointTransaction struct {
	Id                   int64   `json:"id" gorm:"primaryKey"`
	UserId               int64   `json:"user_id" gorm:"not null;uniqueIndex:idx_point_transactions_event,priority:1;index:idx_point_transactions_user_time,priority:1"`
	EventKey             string  `json:"event_key" gorm:"type:varchar(128);not null;uniqueIndex:idx_point_transactions_event,priority:2"`
	Action               string  `json:"action" gorm:"type:varchar(32);not null"`
	BizType              string  `json:"biz_type" gorm:"type:varchar(32);not null;index:idx_point_transactions_business,priority:1"`
	BizId                string  `json:"biz_id" gorm:"type:varchar(128);not null;index:idx_point_transactions_business,priority:2"`
	RelatedTransactionId *int64  `json:"related_transaction_id"`
	Points               int64   `json:"points" gorm:"not null"`
	BillingSnapshot      *string `json:"billing_snapshot" gorm:"type:text"`
	OperatorType         string  `json:"operator_type" gorm:"type:varchar(16);not null"`
	OperatorId           *int64  `json:"operator_id"`
	Remark               string  `json:"remark" gorm:"type:varchar(512);not null"`
	CreatedAt            int64   `json:"created_at" gorm:"autoCreateTime:milli;index:idx_point_transactions_user_time,priority:2"`
}

// PointLedger is the audit entry for an account version. Persistence alone does
// not enforce immutability or balance invariants; future write services must.
type PointLedger struct {
	Id              int64  `json:"id" gorm:"primaryKey"`
	TransactionId   int64  `json:"transaction_id" gorm:"not null;index:idx_point_ledger_transaction"`
	AccountId       int64  `json:"account_id" gorm:"not null;uniqueIndex:idx_point_ledger_account_version,priority:1"`
	AccountVersion  int64  `json:"account_version" gorm:"not null;uniqueIndex:idx_point_ledger_account_version,priority:2"`
	FreezeId        *int64 `json:"freeze_id" gorm:"index:idx_point_ledger_freeze"`
	AvailableDelta  int64  `json:"available_delta" gorm:"not null"`
	FrozenDelta     int64  `json:"frozen_delta" gorm:"not null"`
	AvailableBefore int64  `json:"available_before" gorm:"not null"`
	AvailableAfter  int64  `json:"available_after" gorm:"not null"`
	FrozenBefore    int64  `json:"frozen_before" gorm:"not null"`
	FrozenAfter     int64  `json:"frozen_after" gorm:"not null"`
	CreatedAt       int64  `json:"created_at" gorm:"autoCreateTime:milli"`
}

func (PointLedger) TableName() string { return "point_ledger" }

type PointFreeze struct {
	Id              int64  `json:"id" gorm:"primaryKey"`
	AccountId       int64  `json:"account_id" gorm:"not null;index:idx_point_freezes_account_status,priority:1"`
	TransactionId   int64  `json:"transaction_id" gorm:"not null;index:idx_point_freezes_transaction"`
	OriginalPoints  int64  `json:"original_points" gorm:"not null"`
	RemainingPoints int64  `json:"remaining_points" gorm:"not null"`
	ReasonCode      string `json:"reason_code" gorm:"type:varchar(32);not null"`
	Reason          string `json:"reason" gorm:"type:varchar(512);not null"`
	Status          string `json:"status" gorm:"type:varchar(16);not null;index:idx_point_freezes_account_status,priority:2"`
	CreatedAt       int64  `json:"created_at" gorm:"autoCreateTime:milli"`
	UpdatedAt       int64  `json:"updated_at" gorm:"autoUpdateTime:milli"`
	ClosedAt        *int64 `json:"closed_at"`
}

// migratePoints is called only by the primary database migration. It is also
// exercised directly against isolated databases by the migration tests.
func migratePoints(db *gorm.DB) error {
	if err := db.AutoMigrate(&PointType{}, &PointModelRule{}, &PointAccount{}, &PointTransaction{}, &PointLedger{}, &PointFreeze{}); err != nil {
		return fmt.Errorf("migrate points schema: %w", err)
	}
	if err := migratePointCallBilling(db); err != nil {
		return err
	}
	return initializePointTypes(db)
}

func initializePointTypes(db *gorm.DB) error {
	for _, initial := range []struct {
		pointType PointType
		pattern   PointModelMatchValue
	}{
		{PointType{Code: PointTypeGeneral, Name: "通用积分", ConsumePriority: 100}, "*"},
		{PointType{Code: PointTypeGPT, Name: "GPT 专用积分", ConsumePriority: 10}, "gpt-*"},
	} {
		err := db.Transaction(func(tx *gorm.DB) error {
			var existing PointType
			err := tx.Where("code = ?", initial.pointType.Code).First(&existing).Error
			if err == nil {
				return nil
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if err := tx.Create(&initial.pointType).Error; err != nil {
				return err
			}
			return tx.Create(&PointModelRule{PointTypeId: initial.pointType.Id, MatchType: PointMatchPattern, MatchValue: initial.pattern, Enabled: true}).Error
		})
		if err != nil {
			// Fully roll back before reading a concurrent winner. Reusing the
			// failed transaction retains MySQL duplicate-key locks and its old
			// snapshot; a lock upgrade can deadlock. The winner commits the type
			// and rule together. RowsAffected is not used (clientFoundRows varies).
			var existing PointType
			if lookupErr := db.Where("code = ?", initial.pointType.Code).First(&existing).Error; lookupErr != nil {
				return fmt.Errorf("initialize point type %s: %w", initial.pointType.Code, err)
			}
		}
	}
	return nil
}
