package model

import (
	_ "embed"
	"errors"
	"math"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

//go:embed config_tutorial_seed.json
var configTutorialSeed []byte

const configTutorialSeedKey = "internal.config_tutorial_seed_v1"

var (
	ErrConfigTutorialFields        = errors.New("Invalid tutorial fields")
	ErrConfigTutorialNotFound      = errors.New("Tutorial chapter not found")
	ErrConfigTutorialGroupNotFound = errors.New("Tutorial group not found")
	ErrConfigTutorialGroupNotEmpty = errors.New("Tutorial group has chapters; move or delete them first")
	ErrConfigTutorialDuplicate     = errors.New("Tutorial key or anchor already exists")
	ErrConfigTutorialConflict      = errors.New("Tutorial was modified; reload before saving")
	configTutorialKey              = regexp.MustCompile(`^[a-z0-9_-]{1,64}$`)
)

type ConfigTutorialGroup struct {
	Id        int64  `gorm:"primaryKey"`
	GroupKey  string `gorm:"type:varchar(64);not null;uniqueIndex:idx_ctg_key"`
	Title     string `gorm:"type:varchar(128);not null"`
	SortOrder int    `gorm:"not null"`
	Enabled   bool   `gorm:"not null"`
	Version   int64  `gorm:"type:bigint;not null"`
	CreatedAt int64  `gorm:"type:bigint;autoCreateTime:milli"`
	UpdatedAt int64  `gorm:"type:bigint;autoUpdateTime:milli"`
}

type ConfigTutorialChapter struct {
	Id              int64    `gorm:"primaryKey"`
	GroupId         int64    `gorm:"type:bigint;not null;index:idx_ctc_group"`
	Anchor          string   `gorm:"type:varchar(64);not null;uniqueIndex:idx_ctc_anchor"`
	Title           string   `gorm:"type:varchar(128);not null"`
	ContentMarkdown LongText `gorm:"not null"`
	SortOrder       int      `gorm:"not null"`
	Enabled         bool     `gorm:"not null"`
	Version         int64    `gorm:"type:bigint;not null"`
	CreatedAt       int64    `gorm:"type:bigint;autoCreateTime:milli"`
	UpdatedAt       int64    `gorm:"type:bigint;autoUpdateTime:milli"`
}

type ConfigTutorialFilter struct {
	Page, PageSize int
	Keyword        string
	GroupId        *int64
	Enabled        *bool
}

type ConfigTutorialPublicGroup struct {
	Group    ConfigTutorialGroup
	Chapters []ConfigTutorialChapter
}

func migrateConfigTutorials(db *gorm.DB) error {
	return db.AutoMigrate(&ConfigTutorialGroup{}, &ConfigTutorialChapter{})
}

func ValidConfigTutorialTitle(title string) bool {
	return utf8.ValidString(title) && utf8.RuneCountInString(title) <= 128 && strings.TrimSpace(title) != ""
}

// InitializeConfigTutorials imports the public demo once. The unique marker and
// all rows commit together; a deleted chapter is never restored at restart.
func InitializeConfigTutorials(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		claim := common.GetUUID()
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&Option{Key: configTutorialSeedKey, Value: claim}).Error; err != nil {
			return err
		}
		var marker Option
		if err := tx.Where(map[string]any{"key": configTutorialSeedKey}).First(&marker).Error; err != nil {
			return err
		}
		if marker.Value != claim {
			return nil
		}
		var groups, chapters int64
		if err := tx.Model(&ConfigTutorialGroup{}).Count(&groups).Error; err != nil {
			return err
		}
		if err := tx.Model(&ConfigTutorialChapter{}).Count(&chapters).Error; err != nil {
			return err
		}
		if groups > 0 || chapters > 0 {
			return nil
		}
		var seeds []struct {
			GroupKey string `json:"group_key"`
			Title    string `json:"title"`
			Chapters []struct {
				Anchor          string `json:"anchor"`
				Title           string `json:"title"`
				ContentMarkdown string `json:"content_markdown"`
			} `json:"chapters"`
		}
		if err := common.Unmarshal(configTutorialSeed, &seeds); err != nil {
			return err
		}
		for i, seed := range seeds {
			group := ConfigTutorialGroup{GroupKey: seed.GroupKey, Title: seed.Title, SortOrder: i, Enabled: true, Version: 1}
			if !configTutorialKey.MatchString(group.GroupKey) || !ValidConfigTutorialTitle(group.Title) {
				return ErrConfigTutorialFields
			}
			if err := tx.Create(&group).Error; err != nil {
				return err
			}
			for j, ch := range seed.Chapters {
				chapter := ConfigTutorialChapter{GroupId: group.Id, Anchor: ch.Anchor, Title: ch.Title, ContentMarkdown: LongText(ch.ContentMarkdown), SortOrder: j, Enabled: true, Version: 1}
				if !validConfigTutorialChapter(chapter) {
					return ErrConfigTutorialFields
				}
				if err := tx.Create(&chapter).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
}

// Tutorial edits are infrequent. Serialize them on the existing seed marker,
// acquiring a database write lock BEFORE any reads. This also protects SQLite,
// which cannot use FOR UPDATE and must not upgrade a stale read transaction.
func configTutorialWrite(fn func(*gorm.DB) error) error {
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&Option{}).Where(map[string]any{"key": configTutorialSeedKey}).UpdateColumn("value", gorm.Expr("value")).Error; err != nil {
			return err
		}
		var marker Option
		if err := tx.Where(map[string]any{"key": configTutorialSeedKey}).First(&marker).Error; err != nil {
			return err
		}
		return fn(tx)
	})
	if errors.Is(pointRuleWriteError(err), ErrPointModelRuleDuplicate) {
		return ErrConfigTutorialDuplicate
	}
	return err
}

func ListConfigTutorialGroups(filter ConfigTutorialFilter) ([]ConfigTutorialGroup, int64, error) {
	q := DB.Model(&ConfigTutorialGroup{})
	if filter.Keyword != "" {
		pattern := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(filter.Keyword) + "%"
		q = q.Where("(title LIKE ? ESCAPE '!' OR group_key LIKE ? ESCAPE '!')", pattern, pattern)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := make([]ConfigTutorialGroup, 0)
	err := q.Order("sort_order ASC").Order("id ASC").Limit(filter.PageSize).Offset((filter.Page - 1) * filter.PageSize).Find(&items).Error
	return items, total, err
}

func GetConfigTutorialGroup(id int64) (*ConfigTutorialGroup, error) {
	var group ConfigTutorialGroup
	err := DB.First(&group, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = ErrConfigTutorialGroupNotFound
	}
	return &group, err
}

func SaveConfigTutorialGroup(id, version int64, input ConfigTutorialGroup) (*ConfigTutorialGroup, error) {
	if !ValidConfigTutorialTitle(input.Title) || input.SortOrder < 0 || input.SortOrder > math.MaxInt32 || id == 0 && !configTutorialKey.MatchString(input.GroupKey) {
		return nil, ErrConfigTutorialFields
	}
	var saved ConfigTutorialGroup
	err := configTutorialWrite(func(tx *gorm.DB) error {
		if id == 0 {
			saved = ConfigTutorialGroup{GroupKey: input.GroupKey, Title: input.Title, SortOrder: input.SortOrder, Enabled: input.Enabled, Version: 1}
			return tx.Create(&saved).Error
		}
		if err := tx.First(&saved, id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrConfigTutorialGroupNotFound
			}
			return err
		}
		if version <= 0 || version == math.MaxInt64 || saved.Version != version {
			return ErrConfigTutorialConflict
		}
		result := tx.Model(&ConfigTutorialGroup{}).Where("id = ? AND version = ?", id, version).Updates(map[string]any{"title": input.Title, "sort_order": input.SortOrder, "enabled": input.Enabled, "version": version + 1})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrConfigTutorialConflict
		}
		return tx.First(&saved, id).Error
	})
	return &saved, err
}

func DeleteConfigTutorialGroup(id int64) error {
	return configTutorialWrite(func(tx *gorm.DB) error {
		var group ConfigTutorialGroup
		if err := tx.First(&group, id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrConfigTutorialGroupNotFound
			}
			return err
		}
		var count int64
		if err := tx.Model(&ConfigTutorialChapter{}).Where("group_id = ?", id).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return ErrConfigTutorialGroupNotEmpty
		}
		return tx.Delete(&group).Error
	})
}

func validConfigTutorialChapter(input ConfigTutorialChapter) bool {
	return configTutorialKey.MatchString(input.Anchor) && ValidConfigTutorialTitle(input.Title) && utf8.ValidString(string(input.ContentMarkdown)) && strings.TrimSpace(string(input.ContentMarkdown)) != "" && len(input.ContentMarkdown) <= 65536 && input.SortOrder >= 0 && input.SortOrder <= math.MaxInt32 && input.GroupId > 0
}

func ListConfigTutorialChapters(filter ConfigTutorialFilter) ([]ConfigTutorialChapter, int64, error) {
	q := DB.Model(&ConfigTutorialChapter{})
	if filter.Keyword != "" {
		pattern := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(filter.Keyword) + "%"
		q = q.Where("(title LIKE ? ESCAPE '!' OR anchor LIKE ? ESCAPE '!')", pattern, pattern)
	}
	if filter.GroupId != nil {
		q = q.Where("group_id = ?", *filter.GroupId)
	}
	if filter.Enabled != nil {
		q = q.Where("enabled = ?", *filter.Enabled)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := make([]ConfigTutorialChapter, 0)
	err := q.Omit("content_markdown").Order("sort_order ASC").Order("id ASC").Limit(filter.PageSize).Offset((filter.Page - 1) * filter.PageSize).Find(&items).Error
	return items, total, err
}

func GetConfigTutorialChapter(id int64) (*ConfigTutorialChapter, error) {
	var chapter ConfigTutorialChapter
	err := DB.First(&chapter, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = ErrConfigTutorialNotFound
	}
	return &chapter, err
}

func SaveConfigTutorialChapter(id, version int64, input ConfigTutorialChapter) (*ConfigTutorialChapter, error) {
	// Update requests omit the immutable anchor; validate the remaining fields
	// before locking, then preserve the stored anchor in the transaction.
	candidate := input
	if id != 0 {
		candidate.Anchor = "update"
	}
	if !validConfigTutorialChapter(candidate) {
		return nil, ErrConfigTutorialFields
	}
	var saved ConfigTutorialChapter
	err := configTutorialWrite(func(tx *gorm.DB) error {
		var group ConfigTutorialGroup
		if err := tx.First(&group, input.GroupId).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrConfigTutorialGroupNotFound
			}
			return err
		}
		if id == 0 {
			saved = ConfigTutorialChapter{GroupId: input.GroupId, Anchor: input.Anchor, Title: input.Title, ContentMarkdown: input.ContentMarkdown, SortOrder: input.SortOrder, Enabled: input.Enabled, Version: 1}
			return tx.Create(&saved).Error
		}
		if err := tx.First(&saved, id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrConfigTutorialNotFound
			}
			return err
		}
		if version <= 0 || version == math.MaxInt64 || saved.Version != version {
			return ErrConfigTutorialConflict
		}
		result := tx.Model(&ConfigTutorialChapter{}).Where("id = ? AND version = ?", id, version).Updates(map[string]any{"group_id": input.GroupId, "title": input.Title, "content_markdown": input.ContentMarkdown, "sort_order": input.SortOrder, "enabled": input.Enabled, "version": version + 1})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrConfigTutorialConflict
		}
		return tx.First(&saved, id).Error
	})
	return &saved, err
}

func DeleteConfigTutorialChapter(id int64) error {
	return configTutorialWrite(func(tx *gorm.DB) error {
		result := tx.Delete(&ConfigTutorialChapter{}, id)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrConfigTutorialNotFound
		}
		return nil
	})
}

func ReadConfigTutorial() ([]ConfigTutorialPublicGroup, error) {
	result := make([]ConfigTutorialPublicGroup, 0)
	err := DB.Transaction(func(tx *gorm.DB) error {
		var groups []ConfigTutorialGroup
		if err := tx.Where("enabled = ?", true).Order("sort_order ASC").Order("id ASC").Find(&groups).Error; err != nil {
			return err
		}
		if len(groups) == 0 {
			return nil
		}
		ids := make([]int64, 0, len(groups))
		for _, group := range groups {
			ids = append(ids, group.Id)
		}
		chapters := make([]ConfigTutorialChapter, 0)
		if err := tx.Where("enabled = ? AND group_id IN ?", true, ids).Order("sort_order ASC").Order("id ASC").Find(&chapters).Error; err != nil {
			return err
		}
		grouped := make(map[int64][]ConfigTutorialChapter, len(groups))
		for _, chapter := range chapters {
			grouped[chapter.GroupId] = append(grouped[chapter.GroupId], chapter)
		}
		for _, group := range groups {
			if len(grouped[group.Id]) > 0 {
				result = append(result, ConfigTutorialPublicGroup{Group: group, Chapters: grouped[group.Id]})
			}
		}
		return nil
	})
	return result, err
}
