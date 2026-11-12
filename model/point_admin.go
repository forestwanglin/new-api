package model

import (
	"errors"

	sqlitedriver "github.com/glebarez/go-sqlite"
	"github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
)

var (
	ErrPointTypeNotFound       = errors.New("point type not found")
	ErrPointModelRuleNotFound  = errors.New("point model rule not found")
	ErrPointModelRuleDuplicate = errors.New("point model rule already exists")
)

func GetPointTypes() ([]PointType, error) {
	types := make([]PointType, 0)
	err := DB.Order("consume_priority ASC").Order("id ASC").Find(&types).Error
	return types, err
}

func GetPointModelRules(typeID int64) ([]PointModelRule, error) {
	var pointType PointType
	if err := DB.First(&pointType, typeID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPointTypeNotFound
		}
		return nil, err
	}
	rules := make([]PointModelRule, 0)
	err := DB.Where("point_type_id = ?", typeID).Order("id ASC").Find(&rules).Error
	return rules, err
}

func CreatePointModelRule(typeID int64, rule *PointModelRule) error {
	// Construct the persisted row explicitly; callers cannot set ownership or metadata.
	created := PointModelRule{PointTypeId: typeID, MatchType: rule.MatchType, MatchValue: rule.MatchValue, Enabled: rule.Enabled}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var pointType PointType
		if err := lockForUpdate(tx).First(&pointType, typeID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrPointTypeNotFound
			}
			return err
		}
		return tx.Create(&created).Error
	})
	if err != nil {
		return pointRuleWriteError(err)
	}
	*rule = created
	return nil
}

func UpdatePointModelRule(typeID, ruleID int64, input *PointModelRule) (*PointModelRule, error) {
	var rule PointModelRule
	err := DB.Transaction(func(tx *gorm.DB) error {
		var pointType PointType
		if err := lockForUpdate(tx).First(&pointType, typeID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrPointTypeNotFound
			}
			return err
		}
		scope := tx.Where("point_type_id = ? AND id = ?", typeID, ruleID)
		if err := lockForUpdate(scope).First(&rule).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrPointModelRuleNotFound
			}
			return err
		}
		// A map preserves false. MySQL may report zero affected rows for a no-op;
		// the locked lookup above and readback below distinguish that from not found.
		if err := tx.Model(&PointModelRule{}).Where("point_type_id = ? AND id = ?", typeID, ruleID).Updates(map[string]any{
			"match_type": input.MatchType, "match_value": input.MatchValue, "enabled": input.Enabled,
		}).Error; err != nil {
			return err
		}
		return tx.Where("point_type_id = ? AND id = ?", typeID, ruleID).First(&rule).Error
	})
	if err != nil {
		return nil, pointRuleWriteError(err)
	}
	return &rule, nil
}

func DeletePointModelRule(typeID, ruleID int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var pointType PointType
		if err := lockForUpdate(tx).First(&pointType, typeID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrPointTypeNotFound
			}
			return err
		}
		result := tx.Where("point_type_id = ? AND id = ?", typeID, ruleID).Delete(&PointModelRule{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrPointModelRuleNotFound
		}
		return nil
	})
}

// Translate the database's unique constraint violation, including concurrent
// writers. Never depend on a racy SELECT-before-INSERT duplicate check.
func pointRuleWriteError(err error) error {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return ErrPointModelRuleDuplicate
	}
	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) && mysqlErr.Number == 1062 {
		return ErrPointModelRuleDuplicate
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return ErrPointModelRuleDuplicate
	}
	var sqliteErr *sqlitedriver.Error
	if errors.As(err, &sqliteErr) && (sqliteErr.Code() == 2067 || sqliteErr.Code() == 1555) {
		return ErrPointModelRuleDuplicate
	}
	return err
}
