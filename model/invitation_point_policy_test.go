package model

import (
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestInvitationCampaignPointPolicyDatabaseMatrix(t *testing.T) {
	cases := []struct {
		name, policy                                     string
		legacyCount                                      int
		canonical, legacy, disabled, missing, wantReject bool
	}{
		{name: "canonical_model", canonical: true, policy: `{"version":1,"operator":"OR","groups":[{"operator":"OR","enabled":true,"conditions":[{"kind":"MODEL","match_type":"EXACT","match_value":"research-model","enabled":true}]}]}`},
		{name: "canonical_channel_only", canonical: true, policy: `{"version":1,"operator":"OR","groups":[{"operator":"OR","enabled":true,"conditions":[{"kind":"CHANNEL","channel_id":"12","enabled":true}]}]}`},
		{name: "canonical_and_groups", canonical: true, policy: `{"version":1,"operator":"AND","groups":[{"operator":"OR","enabled":true,"conditions":[{"kind":"MODEL","match_type":"PATTERN","match_value":"research-*","enabled":true}]},{"operator":"AND","enabled":true,"conditions":[{"kind":"CHANNEL","channel_id":"12","enabled":true}]}]}`},
		{name: "canonical_or_groups", canonical: true, policy: `{"version":1,"operator":"OR","groups":[{"operator":"AND","enabled":true,"conditions":[{"kind":"MODEL","match_type":"EXACT","match_value":"research-model","enabled":true},{"kind":"CHANNEL","channel_id":"12","enabled":true}]},{"operator":"OR","enabled":false,"conditions":[]}]}`},
		{name: "canonical_empty_overrides_legacy", canonical: true, policy: `{"version":1,"operator":"OR","groups":[]}`, legacy: true, wantReject: true},
		{name: "canonical_disabled_overrides_legacy", canonical: true, policy: `{"version":1,"operator":"AND","groups":[{"operator":"OR","enabled":false,"conditions":[{"kind":"MODEL","match_type":"PATTERN","match_value":"*","enabled":true}]}]}`, legacy: true, wantReject: true},
		{name: "canonical_disabled_conditions", canonical: true, policy: `{"version":1,"operator":"OR","groups":[{"operator":"OR","enabled":true,"conditions":[{"kind":"MODEL","match_type":"PATTERN","match_value":"*","enabled":false}]}]}`, legacy: true, wantReject: true},
		{name: "canonical_corrupt_overrides_legacy", canonical: true, policy: `{"version":1`, legacy: true, wantReject: true},
		{name: "legacy_enabled", legacy: true},
		{name: "legacy_above_editor_limit", legacy: true, legacyCount: 513},
		{name: "legacy_empty_storage", canonical: true, legacy: true},
		{name: "legacy_disabled", legacy: true, disabled: true, wantReject: true},
		{name: "legacy_absent", wantReject: true},
		{name: "missing_type", legacy: true, missing: true, wantReject: true},
	}
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			for _, tc := range cases {
				t.Run(tc.name, func(t *testing.T) {
					db := invitationDomainTestDB(t, dialect)
					require.NoError(t, migrateInvitations(db))
					typ, err := CreatePointType("RESEARCH", "Research points", 100)
					require.NoError(t, err)
					if tc.canonical && !tc.wantReject && tc.policy != "" {
						// Exercise the same type creation and grouped editor writes as the console.
						require.NoError(t, db.AutoMigrate(&Channel{}))
						t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(&Channel{})) })
						require.NoError(t, db.Create(&Channel{Id: 12, Name: "Research channel"}).Error)
						policy, err := ParsePointEligibilityPolicy([]byte(tc.policy))
						require.NoError(t, err)
						_, err = UpdatePointEligibilityPolicy(typ.Id, typ.ConfigVersion, policy)
						require.NoError(t, err)
					} else {
						// Legacy storage and corrupt historical documents cannot be produced by the editor.
						var policy *string
						if tc.canonical {
							policy = &tc.policy
						}
						require.NoError(t, db.Model(typ).Update("eligibility_policy", policy).Error)
					}
					if tc.legacy {
						for i := range max(1, tc.legacyCount) {
							require.NoError(t, db.Create(&PointModelRule{PointTypeId: typ.Id, MatchType: PointMatchExact, MatchValue: PointModelMatchValue("model-" + strconv.Itoa(i)), Enabled: !tc.disabled}).Error)
						}
					}
					now := time.Now().UnixMilli()
					draft, err := CreateInvitationCampaign(InvitationCampaignInput{
						Code: "research-invitation", Period: 1, Name: "Research invitation",
						StartsAt: now + 60000, EndsAt: now + 3600000,
						RewardPointTypeId: typ.Id, Visible: true,
						Tiers: []InvitationTierInput{{MinEffectiveFriends: 0, RateBps: 500}},
					}, 1)
					require.NoError(t, err, "drafts only require an existing point type")
					if tc.missing {
						require.NoError(t, db.Delete(typ).Error)
					}
					published, err := PublishInvitationCampaign(draft.Id, draft.Version, 1)
					var campaign InvitationCampaign
					require.NoError(t, db.First(&campaign, draft.Id).Error)
					var activations int64
					require.NoError(t, db.Model(&InvitationCampaignActivation{}).Count(&activations).Error)
					if tc.wantReject {
						require.ErrorIs(t, err, ErrInvitationPointType)
						require.Nil(t, campaign.CurrentVersionId)
						require.Zero(t, activations, "failed publication must not activate the draft")
						return
					}
					require.NoError(t, err)
					require.Equal(t, "upcoming", published.Status)
					require.Equal(t, typ.Id, published.RewardPointTypeId)
					require.Equal(t, "Research points", published.RewardPointType.Name)
					require.NotNil(t, campaign.CurrentVersionId)
					require.EqualValues(t, 1, activations)
				})
			}
		})
	}
}
