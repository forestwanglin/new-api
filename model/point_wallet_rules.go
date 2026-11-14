package model

import (
	_ "embed"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

//go:embed point_wallet_rules_seed.json
var pointWalletRuleSeed []byte

const pointWalletRuleSeedKey = "internal.point_wallet_rules_seed_v1"

// InitializePointWalletRules runs after InitializeCustomSubscriptionRules so
// wallet rows cannot suppress the legacy subscription explanation seed. A
// separate transactional claim preserves later operator edits and deletions.
func InitializePointWalletRules(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		claim := common.GetUUID()
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&Option{Key: pointWalletRuleSeedKey, Value: claim}).Error; err != nil {
			return err
		}
		var marker Option
		if err := tx.Where(map[string]any{"key": pointWalletRuleSeedKey}).First(&marker).Error; err != nil {
			return err
		}
		if marker.Value != claim {
			return nil
		}
		var count int64
		if err := tx.Model(&CustomSubscriptionRule{}).Where("rule_key LIKE ?", "wallet-%").Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return nil
		}
		var seeds []struct {
			RuleKey string `json:"rule_key"`
			Title   string `json:"title"`
			Body    []struct {
				Text     string `json:"text"`
				Emphasis bool   `json:"emphasis"`
			} `json:"body"`
		}
		if err := common.Unmarshal(pointWalletRuleSeed, &seeds); err != nil {
			return err
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
			if _, err := ParseSubscriptionRuleContent(content); err != nil {
				return err
			}
			if err := tx.Create(&CustomSubscriptionRule{RuleKey: seed.RuleKey, Title: seed.Title, ContentJson: string(content), Enabled: true, SortOrder: len(seeds) - i, Version: 1}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// ReadPointWalletRules reads only enabled global wallet explanations. Model
// eligibility rules and plan-scoped content are independent configuration.
func ReadPointWalletRules() ([]CustomSubscriptionRule, error) {
	items := make([]CustomSubscriptionRule, 0)
	err := DB.Where("enabled = ? AND plan_id IS NULL", true).
		Where("rule_key LIKE ?", "wallet-%").
		Order("sort_order DESC").Order("id ASC").Find(&items).Error
	return items, err
}
