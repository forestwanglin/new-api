package model

import (
	"errors"
	"math"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var (
	ErrPointConfigConflict        = errors.New("point configuration changed")
	ErrPointPolicyManaged         = errors.New("point type uses grouped eligibility policy")
	ErrPointPolicyChannelNotFound = errors.New("point eligibility channel not found")
	ErrInvalidPointTypeName       = errors.New("invalid point type name")
)

type PointEligibilityConfiguration struct {
	Policy        *PointEligibilityPolicy `json:"policy"`
	ConfigVersion int64                   `json:"config_version"`
}

type PointCatalogEntry struct {
	ID   string `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
}

func GetPointCatalog() ([]PointCatalogEntry, error) {
	var types []PointType
	if err := DB.Select("id", "code", "name").Order("id ASC").Find(&types).Error; err != nil {
		return nil, err
	}
	entries := make([]PointCatalogEntry, 0, len(types))
	for _, typ := range types {
		entries = append(entries, PointCatalogEntry{ID: strconv.FormatInt(typ.Id, 10), Code: typ.Code, Name: typ.Name})
	}
	return entries, nil
}

func GetPointEligibilityPolicy(typeID int64) (*PointEligibilityConfiguration, error) {
	var result *PointEligibilityConfiguration
	err := DB.Transaction(func(tx *gorm.DB) error {
		var typ PointType
		if err := lockForUpdate(tx).First(&typ, typeID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrPointTypeNotFound
			}
			return err
		}
		var rules []PointModelRule
		if typ.EligibilityPolicy == nil || *typ.EligibilityPolicy == "" {
			if err := tx.Where("point_type_id = ?", typeID).Order("id ASC").Find(&rules).Error; err != nil {
				return err
			}
		}
		policy, err := ResolvePointEligibilityPolicy(typ, rules)
		if err != nil {
			return err
		}
		result = &PointEligibilityConfiguration{Policy: policy, ConfigVersion: typ.ConfigVersion}
		return nil
	})
	return result, err
}

// pointTypeConfigForUpdate takes SQLite's writer lock before reading, matching
// FOR UPDATE on the other engines. Every writer also compares config_version.
func pointTypeConfigForUpdate(tx *gorm.DB, typeID int64) (*PointType, error) {
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		if err := tx.Model(&PointType{}).Where("id = ?", typeID).UpdateColumn("config_version", gorm.Expr("config_version")).Error; err != nil {
			return nil, err
		}
	}
	var typ PointType
	if err := lockForUpdate(tx).First(&typ, typeID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPointTypeNotFound
		}
		return nil, err
	}
	return &typ, nil
}

func updatePointTypeConfiguration(tx *gorm.DB, typ *PointType, fields map[string]any) error {
	if typ.ConfigVersion < 1 || typ.ConfigVersion == math.MaxInt64 {
		return ErrPointConfigConflict
	}
	fields["config_version"] = typ.ConfigVersion + 1
	result := tx.Model(&PointType{}).Where("id = ? AND config_version = ?", typ.Id, typ.ConfigVersion).Updates(fields)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrPointConfigConflict
	}
	return tx.First(typ, typ.Id).Error
}

func RenamePointType(typeID, expectedVersion int64, name string) (*PointType, error) {
	if !pointConfigurationText(name, 64) {
		return nil, ErrInvalidPointTypeName
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
		if err := updatePointTypeConfiguration(tx, typ, map[string]any{"name": name}); err != nil {
			return err
		}
		saved = typ
		return nil
	})
	return saved, err
}

func UpdatePointEligibilityPolicy(typeID, expectedVersion int64, policy *PointEligibilityPolicy) (*PointEligibilityConfiguration, error) {
	if err := ValidatePointEligibilityPolicy(policy); err != nil {
		return nil, err
	}
	encoded, err := common.Marshal(policy)
	if err != nil {
		return nil, err
	}
	if len(encoded) > 64*1024 {
		return nil, ErrInvalidPointEligibilityPolicy
	}
	channelIDs := make(map[int]bool)
	for _, group := range policy.Groups {
		for _, condition := range group.Conditions {
			if condition.Kind == PointEligibilityChannel {
				id, _ := strconv.Atoi(condition.ChannelID)
				channelIDs[id] = true
			}
		}
	}
	var saved *PointEligibilityConfiguration
	err = DB.Transaction(func(tx *gorm.DB) error {
		typ, err := pointTypeConfigForUpdate(tx, typeID)
		if err != nil {
			return err
		}
		if expectedVersion != typ.ConfigVersion {
			return ErrPointConfigConflict
		}
		if len(channelIDs) > 0 {
			ids := make([]int, 0, len(channelIDs))
			for id := range channelIDs {
				ids = append(ids, id)
			}
			var count int64
			if err := tx.Model(&Channel{}).Where("id IN ?", ids).Count(&count).Error; err != nil {
				return err
			}
			if count != int64(len(channelIDs)) {
				return ErrPointPolicyChannelNotFound
			}
		}
		text := string(encoded)
		if err := updatePointTypeConfiguration(tx, typ, map[string]any{"eligibility_policy": text}); err != nil {
			return err
		}
		// Parse the stored readback, not the caller's mutable pointer.
		persisted, err := ParsePointEligibilityPolicy([]byte(*typ.EligibilityPolicy))
		if err != nil {
			return err
		}
		saved = &PointEligibilityConfiguration{Policy: persisted, ConfigVersion: typ.ConfigVersion}
		return nil
	})
	return saved, err
}
