package model

import (
	"errors"
	"math"
	"regexp"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var (
	ErrInvalidPointTypeCode  = errors.New("invalid point type code")
	ErrInvalidPointPriority  = errors.New("invalid point consumption priority")
	ErrPointTypeDuplicate    = errors.New("point type code already exists")
	ErrPointTypeProtected    = errors.New("system point type cannot be deleted")
	ErrPointTypeHasAccounts  = errors.New("point type is used by user accounts")
	ErrPointTypeHasPlans     = errors.New("point type is used by subscription plans")
	ErrPointTypeHasOrders    = errors.New("point type is used by subscription orders")
	ErrPointTypeHasCampaigns = errors.New("point type is used by invitation campaigns")
	ErrPointTypeHasRewards   = errors.New("point type is used by invitation rewards")
	ErrPointTypeHasCalls     = errors.New("point type is used by model billing history")
	pointTypeCodePattern     = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,31}$`)
)

func CreatePointType(code, name string, priority int) (*PointType, error) {
	if !pointTypeCodePattern.MatchString(code) {
		return nil, ErrInvalidPointTypeCode
	}
	if !pointConfigurationText(name, 64) {
		return nil, ErrInvalidPointTypeName
	}
	if priority < math.MinInt32 || priority > math.MaxInt32 {
		return nil, ErrInvalidPointPriority
	}
	emptyPolicy := `{"version":1,"operator":"OR","groups":[]}`
	typ := PointType{Code: code, Name: name, ConsumePriority: priority, ConfigVersion: 1, EligibilityPolicy: &emptyPolicy}
	err := DB.Create(&typ).Error
	if errors.Is(pointRuleWriteError(err), ErrPointModelRuleDuplicate) {
		return nil, ErrPointTypeDuplicate
	}
	return &typ, err
}

// UpdatePointType shares its CAS version with eligibility edits. A nil priority
// retains the original name-only PATCH contract.
func UpdatePointType(typeID, expectedVersion int64, name string, priority *int) (*PointType, error) {
	if !pointConfigurationText(name, 64) {
		return nil, ErrInvalidPointTypeName
	}
	if priority != nil && (*priority < math.MinInt32 || *priority > math.MaxInt32) {
		return nil, ErrInvalidPointPriority
	}
	var saved *PointType
	err := DB.Transaction(func(tx *gorm.DB) error {
		typ, err := pointTypeConfigForUpdate(tx, typeID)
		if err != nil {
			return err
		}
		if expectedVersion != typ.ConfigVersion {
			return ErrPointConfigConflict
		}
		values := map[string]any{"name": name}
		if priority != nil {
			values["consume_priority"] = *priority
		}
		if err := updatePointTypeConfiguration(tx, typ, values); err != nil {
			return err
		}
		saved = typ
		return nil
	})
	return saved, err
}

// DeletePointType never removes assets or business history. Reference creation
// holds a shared type lock until commit; deletion holds the exclusive lock first,
// so the reference queries below observe the winner even under MySQL RR.
func DeletePointType(typeID, expectedVersion int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		typ, err := pointTypeConfigForUpdate(tx, typeID)
		if err != nil {
			return err
		}
		if typ.Code == PointTypeGeneral {
			return ErrPointTypeProtected
		}
		if expectedVersion != typ.ConfigVersion {
			return ErrPointConfigConflict
		}
		checks := []struct {
			model     any
			predicate string
			args      []any
			used      error
		}{
			{&PointAccount{}, "point_type_id = ?", []any{typeID}, ErrPointTypeHasAccounts},
			{&CustomSubscriptionPlan{}, "paid_point_type_id = ? OR bonus_point_type_id = ? OR auto_bonus_point_type_id = ?", []any{typeID, typeID, typeID}, ErrPointTypeHasPlans},
			{&CustomSubscriptionOrder{}, "paid_point_type_id = ? OR bonus_point_type_id = ? OR auto_bonus_point_type_id = ?", []any{typeID, typeID, typeID}, ErrPointTypeHasOrders},
			{&InvitationCampaignVersion{}, "reward_point_type_id = ?", []any{typeID}, ErrPointTypeHasCampaigns},
			{&InvitationReward{}, "point_type_id = ?", []any{typeID}, ErrPointTypeHasRewards},
		}
		for _, check := range checks {
			var count int64
			if err := tx.Model(check.model).Where(check.predicate, check.args...).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return check.used
			}
		}
		if err := pointTypeBillingReferences(tx, typeID); err != nil {
			return err
		}
		if err := tx.Where("point_type_id = ?", typeID).Delete(&PointModelRule{}).Error; err != nil {
			return err
		}
		result := tx.Where("id = ? AND config_version = ?", typeID, expectedVersion).Delete(&PointType{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrPointConfigConflict
		}
		return nil
	})
}

// Historical candidates matter too: a retry can fund a different candidate from
// its immutable snapshot. Decode IDs exactly, never LIKE-match JSON text. The
// keyset scan bounds memory and deliberately fails closed on malformed history.
func pointTypeBillingReferences(tx *gorm.DB, typeID int64) error {
	var after string
	for {
		var calls []PointCallBilling
		query := tx.Select("id", "allocations", "eligibility_snapshot").Order("id ASC").Limit(200)
		if after != "" {
			query = query.Where("id > ?", after)
		}
		if err := query.Find(&calls).Error; err != nil {
			return err
		}
		for _, call := range calls {
			var allocations []pointCallAllocation
			if err := common.UnmarshalJsonStr(call.Allocations, &allocations); err != nil {
				return err
			}
			if allocations == nil {
				return ErrPointCallInvalid
			}
			for _, allocation := range allocations {
				if allocation.TypeID <= 0 {
					return ErrPointCallInvalid
				}
				if allocation.TypeID == typeID {
					return ErrPointTypeHasCalls
				}
			}
			if call.EligibilitySnapshot != nil {
				var snapshot pointCallEligibilitySnapshot
				if err := common.UnmarshalJsonStr(*call.EligibilitySnapshot, &snapshot); err != nil {
					return err
				}
				if snapshot.Version != 1 || snapshot.Types == nil {
					return ErrPointCallInvalid
				}
				for _, candidate := range snapshot.Types {
					if candidate.TypeID <= 0 {
						return ErrPointCallInvalid
					}
					if candidate.TypeID == typeID {
						return ErrPointTypeHasCalls
					}
				}
			}
		}
		if len(calls) < 200 {
			return nil
		}
		after = calls[len(calls)-1].ID
	}
}
