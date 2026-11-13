package model

import (
	"errors"
	"math"
	"strings"

	"gorm.io/gorm"
)

type CustomSubscriptionPlan struct {
	Id                   int64  `gorm:"primaryKey"`
	Code                 string `gorm:"type:varchar(64);not null;uniqueIndex:idx_csp_code"`
	Title                string `gorm:"type:varchar(128);not null"`
	Subtitle             string `gorm:"type:varchar(255);not null"`
	TierCode             string `gorm:"type:varchar(32);not null;index:idx_csp_tier"`
	TierRank             int    `gorm:"not null"`
	BillingCycle         string `gorm:"type:varchar(16);not null"`
	DurationMonths       int    `gorm:"not null"`
	Currency             string `gorm:"type:varchar(8);not null"`
	PriceAmountMinor     int64  `gorm:"type:bigint;not null"`
	PaidPoints           int64  `gorm:"type:bigint;not null"`
	PaidPointTypeId      int64  `gorm:"type:bigint;not null"`
	BonusPoints          int64  `gorm:"type:bigint;not null"`
	BonusPointTypeId     *int64 `gorm:"type:bigint"`
	AutoRenewEnabled     bool   `gorm:"not null"`
	AutoRenewBonusBps    int    `gorm:"not null"`
	AutoBonusPointTypeId *int64 `gorm:"type:bigint"`
	BenefitsJson         string `gorm:"type:text;not null"`
	Enabled              bool   `gorm:"not null"`
	SortOrder            int    `gorm:"not null"`
	Version              int64  `gorm:"type:bigint;not null"`
	CreatedAt            int64  `gorm:"type:bigint;autoCreateTime:milli"`
	UpdatedAt            int64  `gorm:"type:bigint;autoUpdateTime:milli"`
}
type CustomSubscriptionOrder struct {
	Id                   int64   `gorm:"primaryKey"`
	TradeNo              string  `gorm:"type:varchar(64);not null;uniqueIndex:idx_cso_trade"`
	UserId               int64   `gorm:"type:bigint;not null;index:idx_cso_user_time,priority:1"`
	PlanId               int64   `gorm:"type:bigint;not null;index:idx_cso_plan"`
	PlanVersion          int64   `gorm:"type:bigint;not null"`
	PlanSnapshot         string  `gorm:"type:text;not null"`
	TierCode             string  `gorm:"type:varchar(32);not null"`
	TierRank             int     `gorm:"not null"`
	BillingCycle         string  `gorm:"type:varchar(16);not null"`
	DurationMonths       int     `gorm:"not null"`
	Currency             string  `gorm:"type:varchar(8);not null"`
	PaidPoints           int64   `gorm:"type:bigint;not null;default:0"`
	PaidPointTypeId      int64   `gorm:"type:bigint;not null"`
	BonusPoints          int64   `gorm:"type:bigint;not null;default:0"`
	BonusPointTypeId     *int64  `gorm:"type:bigint"`
	AutoRenewBonusBps    int     `gorm:"not null"`
	AutoBonusPointTypeId *int64  `gorm:"type:bigint"`
	OrderType            string  `gorm:"type:varchar(32);not null"`
	AmountDueMinor       int64   `gorm:"type:bigint;not null;default:0"`
	AmountPaidMinor      int64   `gorm:"type:bigint;not null;default:0"`
	AutoBonusPoints      int64   `gorm:"type:bigint;not null;default:0"`
	PaymentMethod        string  `gorm:"type:varchar(32);not null"`
	PaymentProvider      string  `gorm:"type:varchar(32);not null;uniqueIndex:idx_cso_provider,priority:1"`
	ProviderTradeNo      *string `gorm:"type:varchar(128);uniqueIndex:idx_cso_provider,priority:2"`
	RenewalAgreementId   *int64  `gorm:"type:bigint;uniqueIndex:idx_cso_renewal,priority:1"`
	RenewalDueAt         *int64  `gorm:"type:bigint;uniqueIndex:idx_cso_renewal,priority:2"`
	Status               string  `gorm:"type:varchar(32);not null;index:idx_cso_status_expiry,priority:1"`
	FulfillmentStatus    string  `gorm:"type:varchar(32);not null;index:idx_cso_fulfill_time,priority:1"`
	PointTransactionId   *int64  `gorm:"type:bigint;uniqueIndex:idx_cso_transaction"`
	RefundedAmountMinor  int64   `gorm:"type:bigint;not null;default:0"`
	RefundStatus         string  `gorm:"type:varchar(32);not null"`
	ProviderPayload      string  `gorm:"type:text"`
	ExpiresAt            *int64  `gorm:"type:bigint;index:idx_cso_status_expiry,priority:2"`
	PaidAt               *int64  `gorm:"type:bigint"`
	FulfilledAt          *int64  `gorm:"type:bigint"`
	CreatedAt            int64   `gorm:"type:bigint;autoCreateTime:milli;index:idx_cso_user_time,priority:2"`
	UpdatedAt            int64   `gorm:"type:bigint;autoUpdateTime:milli;index:idx_cso_fulfill_time,priority:2"`
}

var (
	ErrCustomSubscriptionNotFound  = errors.New("Custom subscription plan not found")
	ErrCustomSubscriptionDuplicate = errors.New("Custom subscription plan code already exists")
	ErrCustomSubscriptionConflict  = errors.New("Custom subscription plan version conflict")
	ErrCustomSubscriptionHasOrders = errors.New("Plan has orders; disable it instead")
)

func migrateCustomSubscriptions(db *gorm.DB) error {
	return db.AutoMigrate(&CustomSubscriptionPlan{}, &CustomSubscriptionOrder{}, &CustomSubscriptionRule{})
}

// This input contains only editable configuration, never identity or metadata.
type CustomSubscriptionPlanInput struct {
	Code                 string
	Title                string
	Subtitle             string
	TierCode             string
	TierRank             int
	BillingCycle         string
	DurationMonths       int
	Currency             string
	PriceAmountMinor     int64
	PaidPoints           int64
	PaidPointTypeId      int64
	BonusPoints          int64
	BonusPointTypeId     *int64
	AutoRenewEnabled     bool
	AutoRenewBonusBps    int
	AutoBonusPointTypeId *int64
	BenefitsJson         string
	Enabled              bool
	SortOrder            int
}
type CustomSubscriptionPlanFilter struct {
	Page, PageSize        int
	Keyword, BillingCycle string
	Enabled               *bool
}

func ListCustomSubscriptionPlans(filter CustomSubscriptionPlanFilter) ([]CustomSubscriptionPlan, int64, error) {
	q := DB.Model(&CustomSubscriptionPlan{})
	if filter.Keyword != "" {
		pattern := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(filter.Keyword) + "%"
		q = q.Where("(title LIKE ? ESCAPE '!' OR code LIKE ? ESCAPE '!')", pattern, pattern)
	}
	if filter.Enabled != nil {
		q = q.Where("enabled = ?", *filter.Enabled)
	}
	if filter.BillingCycle != "" {
		q = q.Where("billing_cycle = ?", filter.BillingCycle)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := make([]CustomSubscriptionPlan, 0)
	err := q.Order("sort_order DESC").Order("id DESC").Offset((filter.Page - 1) * filter.PageSize).Limit(filter.PageSize).Find(&items).Error
	return items, total, err
}
func GetCustomSubscriptionPlan(id int64) (*CustomSubscriptionPlan, error) {
	var p CustomSubscriptionPlan
	err := DB.First(&p, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = ErrCustomSubscriptionNotFound
	}
	return &p, err
}
func customSubscriptionWriteError(err error) error {
	if errors.Is(pointRuleWriteError(err), ErrPointModelRuleDuplicate) {
		return ErrCustomSubscriptionDuplicate
	}
	return err
}
func validateCustomSubscriptionTypes(tx *gorm.DB, input CustomSubscriptionPlanInput) error {
	ids := []int64{input.PaidPointTypeId}
	if input.BonusPointTypeId != nil {
		ids = append(ids, *input.BonusPointTypeId)
	}
	if input.AutoBonusPointTypeId != nil {
		ids = append(ids, *input.AutoBonusPointTypeId)
	}
	for _, id := range ids {
		var count int64
		if err := tx.Model(&PointType{}).Where("id = ?", id).Count(&count).Error; err != nil {
			return err
		}
		if count != 1 {
			return ErrPointTypeNotFound
		}
	}
	return nil
}
func CreateCustomSubscriptionPlan(input CustomSubscriptionPlanInput) (*CustomSubscriptionPlan, error) {
	p := customSubscriptionPlanFromInput(input)
	p.Version = 1
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := validateCustomSubscriptionTypes(tx, input); err != nil {
			return err
		}
		return tx.Create(&p).Error
	})
	return &p, customSubscriptionWriteError(err)
}
func UpdateCustomSubscriptionPlan(id, version int64, input CustomSubscriptionPlanInput) (*CustomSubscriptionPlan, error) {
	var p CustomSubscriptionPlan
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).First(&p, id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrCustomSubscriptionNotFound
			}
			return err
		}
		if p.Version != version || version == math.MaxInt64 {
			return ErrCustomSubscriptionConflict
		}
		if err := validateCustomSubscriptionTypes(tx, input); err != nil {
			return err
		}
		values := customSubscriptionPlanUpdates(input)
		values["version"] = version + 1
		result := tx.Model(&CustomSubscriptionPlan{}).Where("id = ? AND version = ?", id, version).Updates(values)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrCustomSubscriptionConflict
		}
		return tx.First(&p, id).Error
	})
	return &p, customSubscriptionWriteError(err)
}
func DeleteCustomSubscriptionPlan(id int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var p CustomSubscriptionPlan
		if err := lockForUpdate(tx).First(&p, id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrCustomSubscriptionNotFound
			}
			return err
		}
		var count int64
		if err := tx.Model(&CustomSubscriptionOrder{}).Where("plan_id = ?", id).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrCustomSubscriptionHasOrders
		}
		if err := tx.Model(&CustomSubscriptionRule{}).Where("plan_id = ?", id).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrCustomSubscriptionHasRules
		}
		return tx.Delete(&p).Error
	})
}
func customSubscriptionPlanFromInput(input CustomSubscriptionPlanInput) CustomSubscriptionPlan {
	return CustomSubscriptionPlan{Code: input.Code, Title: input.Title, Subtitle: input.Subtitle, TierCode: input.TierCode, TierRank: input.TierRank, BillingCycle: input.BillingCycle, DurationMonths: input.DurationMonths, Currency: input.Currency, PriceAmountMinor: input.PriceAmountMinor, PaidPoints: input.PaidPoints, PaidPointTypeId: input.PaidPointTypeId, BonusPoints: input.BonusPoints, BonusPointTypeId: input.BonusPointTypeId, AutoRenewEnabled: input.AutoRenewEnabled, AutoRenewBonusBps: input.AutoRenewBonusBps, AutoBonusPointTypeId: input.AutoBonusPointTypeId, BenefitsJson: input.BenefitsJson, Enabled: input.Enabled, SortOrder: input.SortOrder}
}
func customSubscriptionPlanUpdates(input CustomSubscriptionPlanInput) map[string]any {
	return map[string]any{"code": input.Code, "title": input.Title, "subtitle": input.Subtitle, "tier_code": input.TierCode, "tier_rank": input.TierRank, "billing_cycle": input.BillingCycle, "duration_months": input.DurationMonths, "currency": input.Currency, "price_amount_minor": input.PriceAmountMinor, "paid_points": input.PaidPoints, "paid_point_type_id": input.PaidPointTypeId, "bonus_points": input.BonusPoints, "bonus_point_type_id": input.BonusPointTypeId, "auto_renew_enabled": input.AutoRenewEnabled, "auto_renew_bonus_bps": input.AutoRenewBonusBps, "auto_bonus_point_type_id": input.AutoBonusPointTypeId, "benefits_json": input.BenefitsJson, "enabled": input.Enabled, "sort_order": input.SortOrder}
}
