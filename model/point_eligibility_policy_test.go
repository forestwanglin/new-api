package model

import (
	"fmt"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPointEligibilityGroupedEvaluation(t *testing.T) {
	policy, err := ParsePointEligibilityPolicy([]byte(`{"version":1,"operator":"AND","groups":[{"operator":"OR","enabled":true,"conditions":[{"kind":"MODEL","match_type":"EXACT","match_value":"model-a","enabled":true},{"kind":"MODEL","match_type":"PATTERN","match_value":"model-b-*","enabled":true}]},{"operator":"OR","enabled":true,"conditions":[{"kind":"CHANNEL","channel_id":"12","enabled":true},{"kind":"CHANNEL","channel_id":"34","enabled":true}]}]}`))
	require.NoError(t, err)
	for _, tc := range []struct {
		model   string
		channel int
		want    bool
	}{
		{"model-a", 12, true}, {"model-a", 34, true}, {"model-b-1", 12, true}, {"model-c", 12, false}, {"model-a", 99, false}, {"Model-a", 12, false}, {"model-a", 0, false},
	} {
		assert.Equal(t, tc.want, policy.Matches(tc.model, tc.channel), "%s channel %d", tc.model, tc.channel)
	}
	alternative, err := ParsePointEligibilityPolicy([]byte(`{"version":1,"operator":"OR","groups":[{"operator":"AND","enabled":true,"conditions":[{"kind":"MODEL","match_type":"EXACT","match_value":"a","enabled":true},{"kind":"CHANNEL","channel_id":"12","enabled":true}]},{"operator":"AND","enabled":true,"conditions":[{"kind":"MODEL","match_type":"EXACT","match_value":"b","enabled":true},{"kind":"CHANNEL","channel_id":"34","enabled":true}]}]}`))
	require.NoError(t, err)
	assert.True(t, alternative.Matches("a", 12))
	assert.True(t, alternative.Matches("b", 34))
	assert.False(t, alternative.Matches("a", 34))
	assert.False(t, alternative.Matches("b", 12))
	alternative.Groups[0].Enabled = false
	assert.False(t, alternative.Matches("a", 12))
	alternative.Groups[1].Conditions[1].Enabled = false
	assert.True(t, alternative.Matches("b", 12), "disabled leaves do not participate")
	alternative.Groups[1].Conditions[0].Enabled = false
	assert.False(t, alternative.Matches("b", 12), "empty AND groups cannot grant access")
	alternative.Operator = "AND"
	assert.False(t, alternative.Matches("b", 12))
}

func TestPointEligibilityStrictDocument(t *testing.T) {
	valid := `{"version":1,"operator":"OR","groups":[{"operator":"OR","enabled":true,"conditions":[{"kind":"MODEL","match_type":"PATTERN","match_value":"Vendor/[x].*?","enabled":true}]}]}`
	for _, body := range []string{
		`null`, `{}`, `{"version":1,"operator":"OR","groups":null}`, `{"version":2,"operator":"OR","groups":[]}`, `{"version":1,"operator":"XOR","groups":[]}`,
		valid + ` {}`, strings.Replace(valid, `"version":1`, `"Version":1`, 1), strings.Replace(valid, `"version":1`, `"version":1,"id":1`, 1),
		strings.Replace(valid, `"enabled":true`, `"enabled":null`, 1), strings.Replace(valid, `"enabled":true,`, "", 1),
		strings.Replace(valid, `"kind":"MODEL"`, `"kind":"MODEL","channel_id":"1"`, 1), strings.Replace(valid, `"kind":"MODEL"`, `"kind":"NOT"`, 1),
		strings.Replace(valid, `"match_value":"Vendor/[x].*?"`, `"match_value":" bad"`, 1), strings.Replace(valid, `"match_value":"Vendor/[x].*?"`, `"match_value":"bad\nvalue"`, 1),
		`{"version":1,"operator":"OR","groups":[{"operator":"OR","enabled":true,"conditions":[]}]}`,
		`{"version":1,"operator":"OR","groups":[{"operator":"AND","enabled":true,"conditions":[{"kind":"MODEL","match_type":"EXACT","match_value":"a","enabled":false}]}]}`,
		`{"version":1,"operator":"OR","groups":[{"operator":"OR","enabled":true,"conditions":[{"kind":"CHANNEL","channel_id":"01","enabled":true}]}]}`,
		`{"version":1,"operator":"OR","groups":[{"operator":"OR","enabled":true,"conditions":[{"kind":"CHANNEL","channel_id":"0","enabled":true}]}]}`,
		`{"version":1,"operator":"OR","groups":[{"operator":"OR","enabled":true,"conditions":[{"kind":"CHANNEL","channel_id":12,"enabled":true}]}]}`,
		`{"version":1,"operator":"OR","groups":[{"operator":"OR","enabled":true,"conditions":[{"kind":"CHANNEL","channel_id":"12","match_value":"a","enabled":true}]}]}`,
	} {
		_, err := ParsePointEligibilityPolicy([]byte(body))
		assert.Error(t, err, body)
	}
	for _, operator := range []string{"OR", "AND"} {
		policy, err := ParsePointEligibilityPolicy([]byte(`{"version":1,"operator":"` + operator + `","groups":[]}`))
		require.NoError(t, err)
		assert.False(t, policy.Matches("any", 12))
	}
	policy, err := ParsePointEligibilityPolicy([]byte(valid))
	require.NoError(t, err)
	assert.True(t, policy.Matches("Vendor/[x].AB", 0))
	assert.False(t, policy.Matches("Vendor/x.AB", 0), "glob metacharacters other than * and ? are literal")
	policy.Groups = make([]PointEligibilityGroup, 33)
	assert.Error(t, ValidatePointEligibilityPolicy(policy))
	policy.Groups = []PointEligibilityGroup{{Operator: "OR", Enabled: false, Conditions: make([]PointEligibilityCondition, 65)}}
	assert.Error(t, ValidatePointEligibilityPolicy(policy))
}

func TestPointEligibilityLegacyFallbackAndExplicitDeny(t *testing.T) {
	typ := PointType{Id: 7}
	policy, err := ResolvePointEligibilityPolicy(typ, []PointModelRule{{PointTypeId: 7, MatchType: PointMatchExact, MatchValue: "a", Enabled: true}, {PointTypeId: 7, MatchType: PointMatchExact, MatchValue: "b", Enabled: false}, {PointTypeId: 8, MatchType: PointMatchPattern, MatchValue: "*", Enabled: true}})
	require.NoError(t, err)
	assert.True(t, policy.Matches("a", 0))
	assert.False(t, policy.Matches("b", 0))
	assert.False(t, policy.Matches("other", 0))
	encoded, err := common.Marshal(&PointEligibilityPolicy{Version: 1, Operator: "OR", Groups: []PointEligibilityGroup{}})
	require.NoError(t, err)
	text := string(encoded)
	typ.EligibilityPolicy = &text
	policy, err = ResolvePointEligibilityPolicy(typ, []PointModelRule{{PointTypeId: 7, MatchType: PointMatchPattern, MatchValue: "*", Enabled: true}})
	require.NoError(t, err)
	assert.False(t, policy.Matches("a", 12), "explicit empty policy does not fall back to old rules")
	text = `{"version":1,"operator":"OR","groups":null}`
	_, err = ResolvePointEligibilityPolicy(typ, nil)
	assert.Error(t, err, "corrupt canonical policy must fail closed")
}

func TestPointEligibilityLegacyRulesDoNotAcquireEditorLimits(t *testing.T) {
	rules := make([]PointModelRule, 600)
	for i := range rules {
		rules[i] = PointModelRule{PointTypeId: 7, MatchType: PointMatchExact, MatchValue: PointModelMatchValue(fmt.Sprintf("model-%d", i)), Enabled: true}
	}
	policy, err := ResolvePointEligibilityPolicy(PointType{Id: 7}, rules)
	require.NoError(t, err)
	require.NoError(t, ValidatePointEligibilitySnapshotPolicy(policy))
	assert.True(t, policy.Matches("model-599", 0))
	assert.False(t, policy.Matches("model-600", 0))
	assert.Error(t, ValidatePointEligibilityPolicy(policy), "new editor saves remain bounded")
}
