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

//go:embed custom_subscription_rules_seed.json
var customSubscriptionRuleSeed []byte

const customSubscriptionRuleSeedKey = "internal.custom_subscription_rules_seed_v1"

var (
	ErrSubscriptionRuleNotFound   = errors.New("Subscription rule not found")
	ErrSubscriptionRuleDuplicate  = errors.New("Subscription rule key already exists")
	ErrSubscriptionRuleConflict   = errors.New("Subscription rule version conflict")
	ErrSubscriptionRuleKeyChanged = errors.New("Subscription rule key cannot be changed")
	ErrSubscriptionRuleFields     = errors.New("Invalid subscription rule fields")
	ErrSubscriptionRulePlan       = errors.New("Subscription plan is unavailable")
	ErrCustomSubscriptionHasRules = errors.New("Plan has subscription rules; remove or reassign them first")
	ruleColor                     = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
)

type SubscriptionRuleStyle struct {
	FontWeight      *int   `json:"fontWeight,omitempty"`
	Color           string `json:"color,omitempty"`
	BackgroundColor string `json:"backgroundColor,omitempty"`
}
type SubscriptionRuleFragment struct {
	Text  string                 `json:"text"`
	Style *SubscriptionRuleStyle `json:"style,omitempty"`
}
type SubscriptionRuleBlock struct {
	Type     string                     `json:"type"`
	Children []SubscriptionRuleFragment `json:"children"`
}
type SubscriptionRuleContent struct {
	Blocks []SubscriptionRuleBlock `json:"blocks"`
}

type CustomSubscriptionRule struct {
	Id          int64  `gorm:"primaryKey"`
	PlanId      *int64 `gorm:"type:bigint;index:idx_csr_plan"`
	RuleKey     string `gorm:"type:varchar(64);not null;uniqueIndex:idx_csr_key"`
	Title       string `gorm:"type:varchar(128);not null"`
	ContentJson string `gorm:"type:text;not null"`
	Enabled     bool   `gorm:"not null"`
	SortOrder   int    `gorm:"not null"`
	Version     int64  `gorm:"type:bigint;not null"`
	CreatedAt   int64  `gorm:"type:bigint;autoCreateTime:milli"`
	UpdatedAt   int64  `gorm:"type:bigint;autoUpdateTime:milli"`
}
type CustomSubscriptionRuleFilter struct {
	Page, PageSize int
	Keyword, Scope string
	PlanId         *int64
	Enabled        *bool
}

// ParseSubscriptionRuleContent validates the closed presentation schema before
// storing or rendering it. Unknown keys are rejected at every fixed-depth node.
func ParseSubscriptionRuleContent(raw []byte) (SubscriptionRuleContent, error) {
	var content SubscriptionRuleContent
	var doc map[string]any
	if !utf8.Valid(raw) || len(raw) > 64*1024 || common.Unmarshal(raw, &doc) != nil || len(doc) != 1 || doc["blocks"] == nil || common.Unmarshal(raw, &content) != nil {
		return content, ErrSubscriptionRuleFields
	}
	blocks, ok := doc["blocks"].([]any)
	if !ok || len(blocks) < 1 || len(blocks) > 20 {
		return content, ErrSubscriptionRuleFields
	}
	total, nonblank := 0, false
	for _, entry := range blocks {
		block, ok := entry.(map[string]any)
		if !ok || len(block) != 2 || block["type"] != "paragraph" {
			return content, ErrSubscriptionRuleFields
		}
		children, ok := block["children"].([]any)
		if !ok || len(children) < 1 || len(children) > 50 {
			return content, ErrSubscriptionRuleFields
		}
		for _, entry := range children {
			fragment, ok := entry.(map[string]any)
			if !ok || len(fragment) < 1 || len(fragment) > 2 {
				return content, ErrSubscriptionRuleFields
			}
			text, ok := fragment["text"].(string)
			if !ok {
				return content, ErrSubscriptionRuleFields
			}
			for key := range fragment {
				if key != "text" && key != "style" {
					return content, ErrSubscriptionRuleFields
				}
			}
			total += utf8.RuneCountInString(text)
			nonblank = nonblank || strings.TrimSpace(text) != ""
			if styleRaw, exists := fragment["style"]; exists {
				style, ok := styleRaw.(map[string]any)
				if !ok {
					return content, ErrSubscriptionRuleFields
				}
				for key, value := range style {
					switch key {
					case "fontWeight":
						if value != float64(400) && value != float64(700) {
							return content, ErrSubscriptionRuleFields
						}
					case "color", "backgroundColor":
						color, ok := value.(string)
						if !ok || !ruleColor.MatchString(color) {
							return content, ErrSubscriptionRuleFields
						}
					default:
						return content, ErrSubscriptionRuleFields
					}
				}
			}
		}
	}
	if total > 10000 || !nonblank {
		return content, ErrSubscriptionRuleFields
	}
	return content, nil
}

// InitializeCustomSubscriptionRules imports the previous public explanation
// once. Claiming the unique marker and inserting rows share one transaction so
// restarts and concurrent startups cannot restore deleted administrator content.
func InitializeCustomSubscriptionRules(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		claim := common.GetUUID()
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&Option{Key: customSubscriptionRuleSeedKey, Value: claim})
		if result.Error != nil {
			return result.Error
		}
		var marker Option
		if err := tx.Where(map[string]any{"key": customSubscriptionRuleSeedKey}).First(&marker).Error; err != nil {
			return err
		}
		if marker.Value != claim {
			return nil
		}
		var count int64
		if err := tx.Model(&CustomSubscriptionRule{}).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return nil
		}
		var seeds []struct {
			Title string `json:"title"`
			Body  []struct {
				Text     string `json:"text"`
				Emphasis bool   `json:"emphasis"`
			} `json:"body"`
		}
		if err := common.Unmarshal(customSubscriptionRuleSeed, &seeds); err != nil {
			return err
		}
		keys := []string{"monthly_price", "yearly_price", "purchase_mode", "auto_renew", "auto_renew_bonus", "cancel_auto_renew", "auto_renew_setting", "same_tier_renewal", "upgrade", "downgrade", "cycle_switch"}
		if len(seeds) != len(keys) {
			return ErrSubscriptionRuleFields
		}
		for i, seed := range seeds {
			fragments := make([]SubscriptionRuleFragment, 0, len(seed.Body))
			for _, part := range seed.Body {
				fragment := SubscriptionRuleFragment{Text: part.Text}
				if part.Emphasis {
					weight := 700
					fragment.Style = &SubscriptionRuleStyle{FontWeight: &weight, Color: "#0052d9"}
				}
				fragments = append(fragments, fragment)
			}
			content, err := common.Marshal(SubscriptionRuleContent{Blocks: []SubscriptionRuleBlock{{Type: "paragraph", Children: fragments}}})
			if err != nil {
				return err
			}
			if err := tx.Create(&CustomSubscriptionRule{RuleKey: keys[i], Title: seed.Title, ContentJson: string(content), Enabled: true, SortOrder: len(seeds) - i, Version: 1}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func ListCustomSubscriptionRules(filter CustomSubscriptionRuleFilter) ([]CustomSubscriptionRule, int64, error) {
	q := DB.Model(&CustomSubscriptionRule{})
	if filter.Keyword != "" {
		pattern := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(filter.Keyword) + "%"
		q = q.Where("(title LIKE ? ESCAPE '!' OR rule_key LIKE ? ESCAPE '!')", pattern, pattern)
	}
	if filter.Enabled != nil {
		q = q.Where("enabled = ?", *filter.Enabled)
	}
	if filter.Scope == "global" {
		q = q.Where("plan_id IS NULL")
	}
	if filter.Scope == "plan" {
		q = q.Where("plan_id IS NOT NULL")
	}
	if filter.PlanId != nil {
		q = q.Where("plan_id = ?", *filter.PlanId)
	}
	var count int64
	if err := q.Count(&count).Error; err != nil {
		return nil, 0, err
	}
	items := make([]CustomSubscriptionRule, 0)
	err := q.Order("sort_order DESC").Order("id ASC").Offset((filter.Page - 1) * filter.PageSize).Limit(filter.PageSize).Find(&items).Error
	return items, count, err
}
func GetCustomSubscriptionRule(id int64) (*CustomSubscriptionRule, error) {
	var rule CustomSubscriptionRule
	err := DB.First(&rule, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = ErrSubscriptionRuleNotFound
	}
	return &rule, err
}
func ReadCustomSubscriptionRules(planID *int64) ([]CustomSubscriptionRule, error) {
	q := DB.Where("enabled = ?", true)
	if planID != nil {
		var count int64
		if err := DB.Model(&CustomSubscriptionPlan{}).Where("id = ? AND enabled = ?", *planID, true).Count(&count).Error; err != nil {
			return nil, err
		}
		if count != 1 {
			return nil, ErrSubscriptionRulePlan
		}
		q = q.Where("(plan_id IS NULL OR plan_id = ?)", *planID)
	} else {
		q = q.Where("plan_id IS NULL")
	}
	items := make([]CustomSubscriptionRule, 0)
	err := q.Order("sort_order DESC").Order("id ASC").Find(&items).Error
	return items, err
}
func SaveCustomSubscriptionRule(id, version int64, input CustomSubscriptionRule) (*CustomSubscriptionRule, error) {
	var saved CustomSubscriptionRule
	err := DB.Transaction(func(tx *gorm.DB) error {
		if input.PlanId != nil {
			var plan CustomSubscriptionPlan
			if err := lockForUpdate(tx).First(&plan, *input.PlanId).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrSubscriptionRulePlan
				}
				return err
			}
		}
		if id == 0 {
			saved = CustomSubscriptionRule{PlanId: input.PlanId, RuleKey: input.RuleKey, Title: input.Title, ContentJson: input.ContentJson, Enabled: input.Enabled, SortOrder: input.SortOrder, Version: 1}
			return tx.Create(&saved).Error
		}
		if err := lockForUpdate(tx).First(&saved, id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrSubscriptionRuleNotFound
			}
			return err
		}
		if saved.RuleKey != input.RuleKey {
			return ErrSubscriptionRuleKeyChanged
		}
		if saved.Version != version || version == math.MaxInt64 {
			return ErrSubscriptionRuleConflict
		}
		result := tx.Model(&CustomSubscriptionRule{}).Where("id = ? AND version = ?", id, version).Updates(map[string]any{"plan_id": input.PlanId, "title": input.Title, "content_json": input.ContentJson, "enabled": input.Enabled, "sort_order": input.SortOrder, "version": version + 1})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrSubscriptionRuleConflict
		}
		return tx.First(&saved, id).Error
	})
	if errors.Is(pointRuleWriteError(err), ErrPointModelRuleDuplicate) {
		err = ErrSubscriptionRuleDuplicate
	}
	return &saved, err
}
func DeleteCustomSubscriptionRule(id int64) error {
	result := DB.Delete(&CustomSubscriptionRule{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrSubscriptionRuleNotFound
	}
	return nil
}
