package model

import (
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func invitationDomainTestDB(t *testing.T, dialect string) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("TEST_" + strings.ToUpper(dialect) + "_DSN")
	if dialect == "sqlite" {
		dsn = "local"
		old := common.SQLitePath
		common.SQLitePath = filepath.Join(t.TempDir(), "invitation.db")
		t.Cleanup(func() { common.SQLitePath = old })
	}
	if dsn == "" {
		t.Skip("isolated test database DSN is not configured")
	}
	t.Setenv("INVITATION_TEST_DSN", dsn)
	db, typ, err := chooseDB("INVITATION_TEST_DSN", false)
	require.NoError(t, err)
	oldDB, oldType := DB, common.MainDatabaseType()
	DB = db
	common.SetMainDatabaseType(typ)
	t.Cleanup(func() { DB = oldDB; common.SetMainDatabaseType(oldType) })
	require.False(t, db.Migrator().HasTable(&InvitationCampaign{}))
	require.NoError(t, db.AutoMigrate(&User{}, &PointType{}, &PointModelRule{}, &CustomSubscriptionOrder{}))
	var version string
	query := "SELECT version()"
	if dialect == "sqlite" {
		query = "SELECT sqlite_version()"
	}
	require.NoError(t, db.Raw(query).Scan(&version).Error)
	t.Logf("%s: %s", dialect, version)
	t.Cleanup(func() {
		require.NoError(t, db.Migrator().DropTable(&InvitationRewardReversal{}, &InvitationRefundOperation{}, &InvitationRewardEvent{}, &InvitationReward{}, &InvitationAuditLog{}, &InvitationQualification{}, &InvitationBinding{}, &InvitationCampaignTier{}, &InvitationCampaignActivation{}, &InvitationCampaignVersion{}, &InvitationCampaign{}, &InvitationControl{}, &CustomSubscriptionOrder{}, &PointModelRule{}, &PointType{}, &User{}))
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	return db
}

func TestInvitationDomainDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			for _, scenario := range []string{"fresh", "legacy_upgrade"} {
				t.Run(scenario, func(t *testing.T) {
					db := invitationDomainTestDB(t, dialect)
					if scenario == "legacy_upgrade" {
						require.NoError(t, db.Create(&User{Id: 11, Username: "legacy", AffCode: "legacy", InviterId: 12}).Error)
						paid := int64(1)
						require.NoError(t, db.Create(&CustomSubscriptionOrder{Id: 100, TradeNo: "legacy", UserId: 11, PaidAt: &paid, AmountPaidMinor: 100, Status: "paid", Currency: "CNY", OrderType: "purchase"}).Error)
					}
					require.NoError(t, migrateInvitations(db))
					recorder := &migrationSQLRecorder{}
					require.NoError(t, migrateInvitations(db.Session(&gorm.Session{Logger: recorder})))
					assert.Empty(t, recorder.schemaMutations())
					if scenario == "legacy_upgrade" {
						var b InvitationBinding
						require.NoError(t, db.Where("invitee_id = ?", 11).First(&b).Error)
						assert.Nil(t, b.BoundAt)
						var n int64
						require.NoError(t, db.Model(&InvitationReward{}).Count(&n).Error)
						assert.Zero(t, n)
						require.NoError(t, db.Model(&InvitationQualification{}).Count(&n).Error)
						assert.Zero(t, n)
					}
					invitationDomainCampaignCases(t, db)
					invitationDomainBindingCases(t, db)
					invitationDomainQualificationCases(t, db)
				})
			}
		})
	}
}

func TestInvitationCampaignTimeValidation(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := invitationDomainTestDB(t, dialect)
			require.NoError(t, migrateInvitations(db))
			pt := PointType{Code: "TIME_TEST", Name: "Time test"}
			require.NoError(t, db.Create(&pt).Error)
			require.NoError(t, db.Create(&PointModelRule{PointTypeId: pt.Id, MatchType: PointMatchPattern, MatchValue: "*", Enabled: true}).Error)
			now := time.Now().UnixMilli()
			in := InvitationCampaignInput{Code: "past-start", Period: 1, Name: "Past start", StartsAt: now - 7200000, EndsAt: now + 3600000, RewardPointTypeId: pt.Id, Visible: true, Tiers: []InvitationTierInput{{MinEffectiveFriends: 0, RateBps: 500}}}
			draft, err := CreateInvitationCampaign(in, 1)
			require.NoError(t, err)
			published, err := PublishInvitationCampaign(draft.Id, draft.Version, 1)
			require.NoError(t, err)
			require.Equal(t, "active", published.Status)
			require.Equal(t, in.StartsAt, published.StartsAt)
			var publishedVersion InvitationCampaignVersion
			require.NoError(t, db.Where("campaign_id = ? AND version = ?", draft.Id, draft.Version).First(&publishedVersion).Error)
			var activation InvitationCampaignActivation
			require.NoError(t, db.Where("version_id = ?", publishedVersion.Id).First(&activation).Error)
			require.GreaterOrEqual(t, activation.EffectiveFrom, now)
			active, err := activeInvitationVersion(db, now-1)
			require.NoError(t, err)
			require.Nil(t, active, "publication must not retroactively activate the campaign")

			// Past configured dates do not bypass an active campaign's overlap.
			next := in
			next.Code = "next-past-start"
			nextDraft, err := CreateInvitationCampaign(next, 1)
			require.NoError(t, err)
			_, err = PublishInvitationCampaign(nextDraft.Id, nextDraft.Version, 1)
			require.ErrorIs(t, err, ErrInvitationOverlap)
			_, err = EndInvitationCampaign(draft.Id, draft.Version, 1)
			require.NoError(t, err)
			// The same configured dates are valid once the prior activation ends.
			published, err = PublishInvitationCampaign(nextDraft.Id, nextDraft.Version, 1)
			require.NoError(t, err)
			require.Equal(t, "active", published.Status)

			expired := in
			expired.Code = "expired"
			expired.EndsAt = now
			_, err = CreateInvitationCampaign(expired, 1)
			require.EqualError(t, err, "invitation campaign end time has passed")
			_, err = UpdateInvitationCampaign(nextDraft.Id, nextDraft.Version, 1, expired)
			require.EqualError(t, err, "invitation campaign end time has passed")
			stored, err := GetInvitationCampaign(nextDraft.Id)
			require.NoError(t, err)
			require.Equal(t, nextDraft.Version, stored.Version)
			require.Equal(t, in.EndsAt, stored.EndsAt)

			// A valid saved draft can expire before the operator publishes it.
			in.Code = "expires-before-publish"
			stale, err := CreateInvitationCampaign(in, 1)
			require.NoError(t, err)
			require.NoError(t, db.Model(&InvitationCampaignVersion{}).Where("campaign_id = ?", stale.Id).Update("ends_at", now).Error)
			var auditsBefore, auditsAfter, activations int64
			require.NoError(t, db.Model(&InvitationAuditLog{}).Count(&auditsBefore).Error)
			_, err = PublishInvitationCampaign(stale.Id, stale.Version, 1)
			require.EqualError(t, err, "invitation campaign end time has passed")
			require.NoError(t, db.Model(&InvitationCampaignActivation{}).Count(&activations).Error)
			require.EqualValues(t, 2, activations)
			require.NoError(t, db.Model(&InvitationAuditLog{}).Count(&auditsAfter).Error)
			require.Equal(t, auditsBefore, auditsAfter)
		})
	}
}

func invitationDomainCampaignCases(t *testing.T, db *gorm.DB) {
	t.Helper()
	pt := PointType{Code: "INV_TEST", Name: "Test"}
	require.NoError(t, db.Create(&pt).Error)
	require.NoError(t, db.Create(&PointModelRule{PointTypeId: pt.Id, MatchType: PointMatchPattern, MatchValue: "*", Enabled: true}).Error)
	now := time.Now().UnixMilli()
	in := InvitationCampaignInput{Code: "summer", Period: 1, Name: "Summer", StartsAt: now + 3600000, EndsAt: now + 7200000, RewardPointTypeId: pt.Id, Visible: true, Tiers: []InvitationTierInput{{MinEffectiveFriends: 0, RateBps: 500}, {MinEffectiveFriends: 3, RateBps: 700}}}
	for _, invalid := range []InvitationCampaignInput{{Code: "bad"}, {Code: "bad", Period: 1, Name: "Bad", StartsAt: in.StartsAt, EndsAt: in.EndsAt, RewardPointTypeId: pt.Id, FreezeDays: 366, Tiers: in.Tiers}} {
		_, err := CreateInvitationCampaign(invalid, 1)
		require.ErrorIs(t, err, ErrInvitationInvalid)
	}
	invalid := in
	invalid.Tiers = []InvitationTierInput{{MinEffectiveFriends: 1, RateBps: 500}}
	_, err := CreateInvitationCampaign(invalid, 1)
	require.ErrorIs(t, err, ErrInvitationInvalid)
	invalid.Tiers = []InvitationTierInput{{MinEffectiveFriends: 0, RateBps: 700}, {MinEffectiveFriends: 3, RateBps: 500}}
	_, err = CreateInvitationCampaign(invalid, 1)
	require.ErrorIs(t, err, ErrInvitationInvalid)
	invalid = in
	invalid.RewardPointTypeId = math.MaxInt64
	_, err = CreateInvitationCampaign(invalid, 1)
	require.ErrorIs(t, err, ErrInvitationPointType)
	c, err := CreateInvitationCampaign(in, 1)
	require.NoError(t, err)
	assert.Equal(t, 7, c.FreezeDays)
	assert.Equal(t, "draft", c.Status)
	public, err := ListInvitationCampaigns(false, 1, 20)
	require.NoError(t, err)
	assert.Empty(t, public.Items)
	_, err = UpdateInvitationCampaign(c.Id, 2, 1, in)
	require.ErrorIs(t, err, ErrInvitationConflict)
	c, err = PublishInvitationCampaign(c.Id, 1, 1)
	require.NoError(t, err)
	assert.Equal(t, "upcoming", c.Status)
	at, err := activeInvitationVersion(db, in.StartsAt)
	require.NoError(t, err)
	require.NotNil(t, at)
	assert.Equal(t, c.Id, at.CampaignId)
	at, err = activeInvitationVersion(db, in.EndsAt)
	require.NoError(t, err)
	assert.Nil(t, at)
	duplicate := in
	duplicate.Code = "overlap"
	second, err := CreateInvitationCampaign(duplicate, 1)
	require.NoError(t, err)
	_, err = PublishInvitationCampaign(second.Id, 1, 1)
	require.ErrorIs(t, err, ErrInvitationOverlap)
	duplicate.StartsAt = in.EndsAt
	duplicate.EndsAt = in.EndsAt + 3600000
	second, err = UpdateInvitationCampaign(second.Id, 1, 1, duplicate)
	require.NoError(t, err)
	_, err = PublishInvitationCampaign(second.Id, second.Version, 1)
	require.NoError(t, err)
	edited := in
	edited.Tiers = []InvitationTierInput{{MinEffectiveFriends: 0, RateBps: 1000}}
	latest, err := UpdateInvitationCampaign(c.Id, c.Version, 1, edited)
	require.NoError(t, err)
	assert.EqualValues(t, 2, latest.Version)
	require.NotNil(t, latest.PublishedVersion)
	assert.Equal(t, "1", *latest.PublishedVersion)
	public, err = ListInvitationCampaigns(false, 1, 20)
	require.NoError(t, err)
	for _, v := range public.Items {
		if v.Id == c.Id {
			assert.EqualValues(t, 1, v.Version)
			assert.Equal(t, 500, v.Tiers[0].RateBps)
		}
	}
	var original InvitationCampaignVersion
	require.NoError(t, db.Where("campaign_id = ? AND version = ?", c.Id, 1).First(&original).Error)
	rate, err := invitationRate(db, original.Id, 3)
	require.NoError(t, err)
	assert.Equal(t, 700, rate)
	encoded, err := common.Marshal(c)
	require.NoError(t, err)
	assert.Contains(t, string(encoded), `"id":"`)
	assert.Contains(t, string(encoded), `"reward_point_type":`)
	// Saving a new draft must not make the published version impossible to end.
	_, err = EndInvitationCampaign(c.Id, c.Version, 1)
	require.ErrorIs(t, err, ErrInvitationConflict)
	ended, err := EndInvitationCampaign(c.Id, latest.Version, 1)
	require.NoError(t, err)
	assert.Equal(t, latest.Version, ended.Version)
	assert.Equal(t, "draft", ended.Status)
	assert.Nil(t, ended.PublishedVersion)
	var activation InvitationCampaignActivation
	require.NoError(t, db.Where("version_id = ?", original.Id).First(&activation).Error)
	require.NotNil(t, activation.EndedAt)
	assert.Less(t, *activation.EndedAt, in.StartsAt)
	at, err = activeInvitationVersion(db, in.StartsAt)
	require.NoError(t, err)
	assert.Nil(t, at)
	storedDraft, err := GetInvitationCampaign(c.Id)
	require.NoError(t, err)
	assert.Equal(t, latest.Version, storedDraft.Version)
	assert.Equal(t, edited.Tiers[0].RateBps, storedDraft.Tiers[0].RateBps)
}

func invitationDomainBindingCases(t *testing.T, db *gorm.DB) {
	t.Helper()
	for _, u := range []User{{Id: 21, Username: "a", AffCode: "AAAA", Status: common.UserStatusEnabled}, {Id: 22, Username: "b", AffCode: "BBBB", Status: common.UserStatusEnabled}, {Id: 23, Username: "c", AffCode: "CCCC", Status: common.UserStatusEnabled}, {Id: 24, Username: "d", AffCode: "DDDD", Status: common.UserStatusEnabled}} {
		require.NoError(t, db.Create(&u).Error)
	}
	_, err := BindInvitation(21, "AAAA", "self")
	require.ErrorIs(t, err, ErrInvitationSelf)
	_, err = BindInvitation(22, "AAAA", "bind")
	require.NoError(t, err)
	_, err = BindInvitation(22, "AAAA", "again")
	require.ErrorIs(t, err, ErrInvitationAlreadyBound)
	_, err = BindInvitation(23, "BBBB", "bind")
	require.NoError(t, err)
	_, err = BindInvitation(24, "CCCC", "bind")
	require.NoError(t, err)
	_, err = BindInvitation(21, "DDDD", "cycle")
	require.ErrorIs(t, err, ErrInvitationCycle)
	disabled := User{Id: 25, Username: "disabled", AffCode: "DISABLED", Status: common.UserStatusDisabled}
	require.NoError(t, db.Create(&disabled).Error)
	require.NoError(t, db.Create(&User{Id: 26, Username: "unbound", AffCode: "UNBOUND", Status: common.UserStatusEnabled}).Error)
	_, err = BindInvitation(26, "DISABLED", "disabled-inviter")
	require.ErrorIs(t, err, ErrInvitationNotFound)
	// A dangling historical chain fails closed rather than being truncated.
	require.NoError(t, db.Model(&User{}).Where("id = ?", 21).Update("inviter_id", 999999).Error)
	_, err = BindInvitation(26, "AAAA", "dangling-cycle")
	require.ErrorIs(t, err, ErrInvitationNotFound)
	require.NoError(t, db.Model(&User{}).Where("id = ?", 21).Update("inviter_id", 0).Error)
	forged := User{Id: 22, InviterId: 24, AffCode: "forged"}
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return forged.UpdateWithTx(tx, false) }))
	assert.Equal(t, 21, forged.InviterId)
	assert.Equal(t, "BBBB", forged.AffCode)
	registered := User{Username: "registered", InviterId: 21}
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return registered.InsertWithTx(tx, 21) }))
	var relation InvitationBinding
	require.NoError(t, db.Where("invitee_id = ?", registered.Id).First(&relation).Error)
	assert.NotNil(t, relation.BoundAt)
	assert.EqualValues(t, 21, relation.InviterId)
	binding, err := GetInvitationBinding(22)
	require.NoError(t, err)
	encoded, err := common.Marshal(binding)
	require.NoError(t, err)
	assert.Contains(t, string(encoded), `"bound_at":"`)
	friends, err := ListInvitationFriends(21, 1, 20)
	require.NoError(t, err)
	assert.EqualValues(t, 2, friends.Total)
	now := time.Now().UnixMilli()
	for _, u := range []User{{Id: 31, Username: "chain-root", AffCode: "ROOT", Status: common.UserStatusEnabled}, {Id: 32, Username: "chain-inviter", AffCode: "CHAIN", Status: common.UserStatusEnabled, InviterId: 31}, {Id: 33, Username: "chain-invitee", AffCode: "CHILD", Status: common.UserStatusEnabled, InviterId: 32}} {
		require.NoError(t, db.Create(&u).Error)
	}
	require.NoError(t, db.Create(&InvitationBinding{InviteeId: 33, InviterId: 32, BoundAt: &now}).Error)
	valid, err := validInvitationRewardBinding(db, 33, now)
	require.NoError(t, err)
	assert.True(t, valid, "legacy ancestor projection remains usable")
	require.NoError(t, db.Model(&User{}).Where("id = ?", 31).Update("status", common.UserStatusDisabled).Error)
	valid, err = validInvitationRewardBinding(db, 33, now)
	require.NoError(t, err)
	assert.False(t, valid, "disabled legacy ancestor blocks new rewards")
	require.NoError(t, db.Model(&User{}).Where("id = ?", 31).Update("status", common.UserStatusEnabled).Error)
	require.NoError(t, db.Model(&User{}).Where("id = ?", 31).Update("inviter_id", 33).Error)
	valid, err = validInvitationRewardBinding(db, 33, now)
	require.NoError(t, err)
	assert.False(t, valid, "multi-hop legacy cycle blocks new rewards")
	require.NoError(t, db.Model(&User{}).Where("id = ?", 31).Update("inviter_id", 999999).Error)
	valid, err = validInvitationRewardBinding(db, 33, now)
	require.NoError(t, err)
	assert.False(t, valid, "missing legacy ancestor blocks new rewards")
	require.NoError(t, db.Model(&User{}).Where("id = ?", 31).Update("inviter_id", 0).Error)
	require.NoError(t, db.Model(&InvitationBinding{}).Where("invitee_id = ?", 33).Update("bound_at", now+1).Error)
	valid, err = validInvitationRewardBinding(db, 33, now)
	require.NoError(t, err)
	assert.False(t, valid, "future binding cannot create new rewards")
}

func invitationDomainQualificationCases(t *testing.T, db *gorm.DB) {
	t.Helper()
	start := time.Now().UnixMilli() + 1000
	mature := start + invitationQualificationPeriod
	var existing int64
	require.NoError(t, db.Model(&InvitationQualification{}).Count(&existing).Error)
	assert.Zero(t, existing)
	captured := "no_campaign"
	marker := int64(1)
	order := CustomSubscriptionOrder{Id: 200, TradeNo: "qual-first", UserId: 22, AmountPaidMinor: 10000, PaidAt: &start, Currency: "CNY", OrderType: "purchase", InvitationCaptureVersion: &marker, InvitationCaptureResult: &captured}
	require.NoError(t, db.Create(&order).Error)
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return captureInvitationQualification(tx, &order, start) }))
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return reconcileInvitationQualifications(tx, mature-1) }))
	n, err := invitationEffectiveCount(db, 21)
	require.NoError(t, err)
	assert.Zero(t, n)
	prepared := InvitationRefundOperation{OrderId: order.Id, Status: "PREPARED", PreparedAt: mature - 1, RequestId: "hold", AmountMinor: 100}
	require.NoError(t, db.Create(&prepared).Error)
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return reconcileInvitationQualifications(tx, mature+1) }))
	n, err = invitationEffectiveCount(db, 21)
	require.NoError(t, err)
	assert.Zero(t, n)
	cancelled := mature + 100
	require.NoError(t, db.Model(&prepared).Updates(map[string]any{"status": "CANCELLED", "cancelled_at": cancelled}).Error)
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return reconcileInvitationQualifications(tx, cancelled) }))
	var q InvitationQualification
	require.NoError(t, db.Where("invitee_id = ?", 22).First(&q).Error)
	require.NotNil(t, q.QualifiedAt)
	assert.Equal(t, cancelled, *q.QualifiedAt)
	require.NoError(t, db.Model(&order).Update("refunded_amount_minor", order.AmountPaidMinor).Error)
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return reconcileInvitationQualifications(tx, cancelled+100) }))
	n, err = invitationEffectiveCount(db, 21)
	require.NoError(t, err)
	assert.EqualValues(t, 1, n)
	// First order fully refunded before maturity switches to next positive order.
	first := order
	first.Id = 201
	first.TradeNo = "qual-refunded"
	first.UserId = 23
	first.RefundedAmountMinor = first.AmountPaidMinor
	require.NoError(t, db.Create(&first).Error)
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return captureInvitationQualification(tx, &first, start) }))
	later := start + 100
	next := first
	next.Id = 202
	next.TradeNo = "qual-next"
	next.PaidAt = &later
	next.RefundedAmountMinor = 0
	require.NoError(t, db.Create(&next).Error)
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return reconcileInvitationQualifications(tx, mature+100) }))
	require.NoError(t, db.Where("invitee_id = ?", 23).First(&InvitationQualification{}).Error)
	var switched InvitationQualification
	require.NoError(t, db.Where("invitee_id = ?", 23).First(&switched).Error)
	assert.EqualValues(t, 202, switched.CandidateOrderId)
	require.NotNil(t, switched.QualifiedAt)
	assert.Equal(t, later+invitationQualificationPeriod, *switched.QualifiedAt)
}
