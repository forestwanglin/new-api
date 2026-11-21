package model

import (
	"errors"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
)

const (
	PointEligibilityOR      = "OR"
	PointEligibilityAND     = "AND"
	PointEligibilityModel   = "MODEL"
	PointEligibilityChannel = "CHANNEL"
)

var ErrInvalidPointEligibilityPolicy = errors.New("invalid point eligibility policy")

// PointEligibilityPolicy is bounded data, never an executable expression.
// A missing stored policy alone selects legacy model-rule compatibility.
type PointEligibilityPolicy struct {
	Version  int                     `json:"version"`
	Operator string                  `json:"operator"`
	Groups   []PointEligibilityGroup `json:"groups"`
}

type PointEligibilityGroup struct {
	Operator   string                      `json:"operator"`
	Enabled    bool                        `json:"enabled"`
	Conditions []PointEligibilityCondition `json:"conditions"`
}

type PointEligibilityCondition struct {
	Kind       string `json:"kind"`
	MatchType  string `json:"match_type,omitempty"`
	MatchValue string `json:"match_value,omitempty"`
	ChannelID  string `json:"channel_id,omitempty"`
	Enabled    bool   `json:"enabled"`
}

// ParsePointEligibilityPolicy enforces exact fields, explicit booleans and
// non-null arrays before decoding the same shape used by call snapshots.
func ParsePointEligibilityPolicy(data []byte) (*PointEligibilityPolicy, error) {
	if len(data) > 64*1024 || !utf8.Valid(data) {
		return nil, ErrInvalidPointEligibilityPolicy
	}
	fields, err := pointPolicyFields(data, "version", "operator", "groups")
	if err != nil {
		return nil, err
	}
	var groups []common.RawMessage
	if common.Unmarshal(fields["groups"], &groups) != nil || groups == nil || len(groups) > 32 {
		return nil, ErrInvalidPointEligibilityPolicy
	}
	total := 0
	for _, group := range groups {
		groupFields, err := pointPolicyFields(group, "operator", "enabled", "conditions")
		if err != nil {
			return nil, err
		}
		var conditions []common.RawMessage
		if common.Unmarshal(groupFields["conditions"], &conditions) != nil || conditions == nil || len(conditions) > 64 {
			return nil, ErrInvalidPointEligibilityPolicy
		}
		total += len(conditions)
		if total > 512 {
			return nil, ErrInvalidPointEligibilityPolicy
		}
		for _, condition := range conditions {
			var leaf map[string]common.RawMessage
			if common.Unmarshal(condition, &leaf) != nil || leaf == nil {
				return nil, ErrInvalidPointEligibilityPolicy
			}
			var kind string
			if common.Unmarshal(leaf["kind"], &kind) != nil {
				return nil, ErrInvalidPointEligibilityPolicy
			}
			switch kind {
			case PointEligibilityModel:
				_, err = pointPolicyFields(condition, "kind", "match_type", "match_value", "enabled")
			case PointEligibilityChannel:
				_, err = pointPolicyFields(condition, "kind", "channel_id", "enabled")
			default:
				return nil, ErrInvalidPointEligibilityPolicy
			}
			if err != nil {
				return nil, err
			}
		}
	}
	var policy PointEligibilityPolicy
	if common.Unmarshal(data, &policy) != nil {
		return nil, ErrInvalidPointEligibilityPolicy
	}
	if err := ValidatePointEligibilityPolicy(&policy); err != nil {
		return nil, err
	}
	return &policy, nil
}

// pointPolicyFields rejects unknown/case-aliased keys and missing or null data.
func pointPolicyFields(data []byte, keys ...string) (map[string]common.RawMessage, error) {
	var fields map[string]common.RawMessage
	if common.Unmarshal(data, &fields) != nil || len(fields) != len(keys) {
		return nil, ErrInvalidPointEligibilityPolicy
	}
	for _, key := range keys {
		value, exists := fields[key]
		if !exists || strings.TrimSpace(string(value)) == "null" {
			return nil, ErrInvalidPointEligibilityPolicy
		}
	}
	return fields, nil
}

func ValidatePointEligibilityPolicy(policy *PointEligibilityPolicy) error {
	return validatePointEligibilityPolicy(policy, true)
}

// ValidatePointEligibilitySnapshotPolicy validates owned call snapshots without
// imposing new editor limits on historical flat configurations.
func ValidatePointEligibilitySnapshotPolicy(policy *PointEligibilityPolicy) error {
	return validatePointEligibilityPolicy(policy, false)
}

func validatePointEligibilityPolicy(policy *PointEligibilityPolicy, bounded bool) error {
	if policy == nil || policy.Version != 1 || (policy.Operator != PointEligibilityOR && policy.Operator != PointEligibilityAND) || policy.Groups == nil || (bounded && len(policy.Groups) > 32) {
		return ErrInvalidPointEligibilityPolicy
	}
	total := 0
	for _, group := range policy.Groups {
		if (group.Operator != PointEligibilityOR && group.Operator != PointEligibilityAND) || group.Conditions == nil || (bounded && len(group.Conditions) > 64) {
			return ErrInvalidPointEligibilityPolicy
		}
		total += len(group.Conditions)
		if bounded && total > 512 {
			return ErrInvalidPointEligibilityPolicy
		}
		active := 0
		for _, condition := range group.Conditions {
			if condition.Enabled {
				active++
			}
			switch condition.Kind {
			case PointEligibilityModel:
				if condition.ChannelID != "" || (condition.MatchType != PointMatchExact && condition.MatchType != PointMatchPattern) || !pointConfigurationText(condition.MatchValue, 255) {
					return ErrInvalidPointEligibilityPolicy
				}
			case PointEligibilityChannel:
				channelID, err := strconv.Atoi(condition.ChannelID)
				if err != nil || channelID <= 0 || strconv.Itoa(channelID) != condition.ChannelID || condition.MatchType != "" || condition.MatchValue != "" {
					return ErrInvalidPointEligibilityPolicy
				}
			default:
				return ErrInvalidPointEligibilityPolicy
			}
		}
		if group.Enabled && active == 0 {
			return ErrInvalidPointEligibilityPolicy
		}
	}
	return nil
}

func pointConfigurationText(value string, limit int) bool {
	return value != "" && utf8.ValidString(value) && utf8.RuneCountInString(value) <= limit && strings.TrimSpace(value) == value && !strings.ContainsFunc(value, unicode.IsControl)
}

func ResolvePointEligibilityPolicy(typ PointType, rules []PointModelRule) (*PointEligibilityPolicy, error) {
	if typ.EligibilityPolicy != nil && *typ.EligibilityPolicy != "" {
		return ParsePointEligibilityPolicy([]byte(*typ.EligibilityPolicy))
	}
	group := PointEligibilityGroup{Operator: PointEligibilityOR, Conditions: make([]PointEligibilityCondition, 0)}
	for _, rule := range rules {
		if rule.PointTypeId != typ.Id {
			continue
		}
		group.Conditions = append(group.Conditions, PointEligibilityCondition{Kind: PointEligibilityModel, MatchType: rule.MatchType, MatchValue: string(rule.MatchValue), Enabled: rule.Enabled})
		group.Enabled = group.Enabled || rule.Enabled
	}
	return &PointEligibilityPolicy{Version: 1, Operator: PointEligibilityOR, Groups: []PointEligibilityGroup{group}}, nil
}

func (policy *PointEligibilityPolicy) Matches(model string, channelID int) bool {
	if validatePointEligibilityPolicy(policy, false) != nil {
		return false
	}
	activeGroups := 0
	for _, group := range policy.Groups {
		if !group.Enabled {
			continue
		}
		activeGroups++
		matched := group.Operator == PointEligibilityAND
		for _, condition := range group.Conditions {
			if !condition.Enabled {
				continue
			}
			leafMatch := false
			if condition.Kind == PointEligibilityModel {
				leafMatch = PointModelMatches(condition.MatchType, condition.MatchValue, model)
			} else if channelID > 0 {
				leafMatch = condition.ChannelID == strconv.Itoa(channelID)
			}
			if group.Operator == PointEligibilityOR && leafMatch {
				matched = true
				break
			}
			if group.Operator == PointEligibilityAND && !leafMatch {
				matched = false
				break
			}
		}
		if policy.Operator == PointEligibilityOR && matched {
			return true
		}
		if policy.Operator == PointEligibilityAND && !matched {
			return false
		}
	}
	return activeGroups > 0 && policy.Operator == PointEligibilityAND
}
