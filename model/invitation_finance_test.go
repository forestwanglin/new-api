package model

import (
	"errors"
	"fmt"
	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"math"
	"testing"
	"time"
)

func TestInvitationRewardArithmetic(t *testing.T) {
	for _, tc := range []struct {
		paid int64
		rate int
		want int64
	}{{10000, 500, 5000}, {10000, 700, 7000}, {10000, 1000, 10000}, {7000, 700, 4900}, {1, 1, 0}, {9007199254740993, 1000, 9007199254740993}} {
		got, err := invitationRewardPoints(tc.paid, tc.rate)
		require.NoError(t, err)
		require.Equal(t, tc.want, got)
	}
	_, err := invitationRewardPoints(math.MaxInt64, 10000)
	require.Error(t, err)
	_, err = invitationRewardPoints(-1, 500)
	require.Error(t, err)
}

func TestInvitationRefundAfterZeroRewardDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := invitationDomainTestDB(t, dialect)
			require.NoError(t, migratePoints(db))
			require.NoError(t, migrateInvitations(db))
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&PointLedger{}, &PointFreeze{}, &PointTransaction{}, &PointAccount{}))
			})
			var pointType PointType
			require.NoError(t, db.First(&pointType).Error)
			inviter := User{Id: 901, Username: "zero-reward-inviter", AffCode: "zero-reward", Status: common.UserStatusEnabled}
			require.NoError(t, db.Create(&inviter).Error)
			now := time.Now().UnixMilli()
			for i, original := range []int64{1, 0, 1} {
				t.Run([]string{"frozen_then_zero", "initial_zero_acknowledged", "refund_before_acknowledgment"}[i], func(t *testing.T) {
					order := CustomSubscriptionOrder{TradeNo: fmt.Sprintf("zero-reward-%d", i), UserId: 902, Status: common.TopUpStatusSuccess, AmountPaidMinor: 2, RefundStatus: "none"}
					require.NoError(t, db.Create(&order).Error)
					rate := 500
					if original == 0 {
						rate = 1
					}
					reward := InvitationReward{OrderId: order.Id, InviterId: 901, InviteeId: 902, PointTypeId: pointType.Id, OriginalPoints: original, ProcessingPoints: original, PaidAmountMinor: 2, NetPaidAmountMinor: 2, RateBps: rate, Status: InvitationRewardCaptured, ReleaseAt: now + 86400000}
					require.NoError(t, db.Create(&reward).Error)
					event := InvitationRewardEvent{RewardId: reward.Id, Status: "PENDING"}
					require.NoError(t, db.Create(&event).Error)
					if i != 2 {
						_, err := processInvitationRewardsAt(100, now)
						require.NoError(t, err)
					}
					for part := range 2 {
						op, err := PrepareInvitationRefund(order.Id, 1, 1, fmt.Sprintf("zero-part-%d", part))
						require.NoError(t, err)
						_, err = CompleteInvitationRefund(order.Id, op.Id, 1, 1, "epay", fmt.Sprintf("zero-%d-%d", i, part))
						require.NoError(t, err)
						require.NoError(t, db.First(&reward, reward.Id).Error)
						if i == 2 && part == 0 {
							require.Equal(t, InvitationRewardCaptured, reward.Status)
						} else {
							require.Equal(t, InvitationRewardCancelled, reward.Status)
						}
						require.Zero(t, reward.ProcessingPoints)
						require.Zero(t, reward.FrozenPoints)
						_, err = processInvitationRewardsAt(100, now+1)
						require.NoError(t, err)
					}
					require.NoError(t, db.First(&order, order.Id).Error)
					require.EqualValues(t, 2, order.RefundedAmountMinor)
					var ledgers int64
					require.NoError(t, db.Model(&PointLedger{}).Joins("JOIN point_transactions ON point_transactions.id = point_ledger.transaction_id").Where("point_transactions.biz_type = ? AND point_transactions.biz_id = ?", "INVITATION_REWARD", fmt.Sprint(reward.Id)).Count(&ledgers).Error)
					expectedLedgers := int64(0)
					if i == 0 {
						expectedLedgers = 2
					}
					require.EqualValues(t, expectedLedgers, ledgers)
					require.NoError(t, db.First(&event, event.Id).Error)
					require.Equal(t, "DONE", event.Status)
				})
			}
		})
	}
}

func TestInvitationAdminListsDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := invitationDomainTestDB(t, dialect)
			require.NoError(t, migrateInvitations(db))
			for i := int64(1); i <= 3; i++ {
				require.NoError(t, db.Create(&InvitationReward{Id: i, OrderId: i, InviterId: 11, InviteeId: 12, CampaignId: i%2 + 1, CampaignName: fmt.Sprintf("Campaign %d", i%2+1), Status: InvitationRewardFrozen}).Error)
			}
			// Same order may have multiple operations; history without a reward must survive.
			done := int64(200)
			evidence := "provider-evidence"
			for i, status := range []string{"PREPARED", "SUCCEEDED", "CANCELLED"} {
				orderID := int64(1)
				if i == 2 {
					orderID = 999
				}
				require.NoError(t, db.Create(&InvitationRefundOperation{Id: int64(i + 1), OrderId: orderID, AmountMinor: 9007199254740993, RequestId: fmt.Sprint(i), Status: status, PreparedAt: 100, CompletedAt: &done, Provider: "manual", ProviderRefundId: &[]string{evidence + fmt.Sprint(i)}[0]}).Error)
			}
			rewards, err := ListInvitationRewards(1, true, 1, 1, 2)
			require.NoError(t, err)
			require.Equal(t, "2", rewards.Total)
			require.Equal(t, "3", rewards.Items[0].Id)
			require.Equal(t, "2", rewards.Items[0].CampaignId)
			refunds, err := ListInvitationRefunds(1, 2)
			require.NoError(t, err)
			require.Equal(t, "3", refunds.Total)
			require.Equal(t, "3", refunds.Items[0].Id)
			require.Empty(t, refunds.Items[0].CampaignName)
			require.Equal(t, "9007199254740993", refunds.Items[1].AmountMinor)
			require.Equal(t, "Campaign 2", refunds.Items[1].CampaignName)
			require.Equal(t, "200", *refunds.Items[1].CompletedAt)
			second, err := ListInvitationRefunds(2, 2)
			require.NoError(t, err)
			require.Len(t, second.Items, 1)
			require.Equal(t, "1", second.Items[0].Id)
		})
	}
}

func TestInvitationRewardAdminIdentityDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := invitationDomainTestDB(t, dialect)
			require.NoError(t, migrateInvitations(db))
			users := []User{
				{Id: 41, AffCode: "identity-41", Username: "payer-account", DisplayName: "支付昵称", Email: "payer-private@example.test", Password: "private-password"},
				{Id: 42, AffCode: "identity-42", Username: "inviter-account"},
				{Id: 43, AffCode: "identity-43", Username: "deleted-account", DisplayName: "Deleted name"},
				{Id: 44, AffCode: "identity-44", Username: "unrelated-account", DisplayName: "Unrelated"},
			}
			require.NoError(t, db.Create(&users).Error)
			require.NoError(t, db.Delete(&users[2]).Error)
			for _, reward := range []InvitationReward{
				{Id: 1, OrderId: 1, InviteeId: 41, InviterId: 42, CampaignId: 1, PaidAt: 1794000000001, ReleaseAt: 1794604800001, Status: InvitationRewardFrozen},
				{Id: 2, OrderId: 2, InviteeId: 43, InviterId: 999, CampaignId: 1, PaidAt: 1794000000002, ReleaseAt: 1794604800002, Status: InvitationRewardCancelled},
				{Id: 3, OrderId: 3, InviteeId: 44, InviterId: 42, CampaignId: 2, PaidAt: 1794000000003, ReleaseAt: 1794604800003, Status: InvitationRewardReleased},
			} {
				require.NoError(t, db.Create(&reward).Error)
			}

			first, err := ListInvitationRewards(1, true, 1, 1, 1)
			require.NoError(t, err)
			require.Equal(t, "2", first.Total)
			require.Len(t, first.Items, 1)
			require.Equal(t, "2", first.Items[0].Id)
			payload, err := common.Marshal(first.Items[0])
			require.NoError(t, err)
			var row map[string]any
			require.NoError(t, common.Unmarshal(payload, &row))
			require.Equal(t, map[string]any{"id": "43", "name": ""}, row["payer"], "deleted payer retains only its stable ID")
			require.Equal(t, map[string]any{"id": "999", "name": ""}, row["inviter"], "missing inviter does not remove historical reward")
			require.Equal(t, "1794000000002", row["paid_at"])
			require.Equal(t, "1794604800002", row["release_at"])

			second, err := ListInvitationRewards(1, true, 2, 1, 1)
			require.NoError(t, err)
			require.Equal(t, "2", second.Total)
			require.Len(t, second.Items, 1)
			require.Equal(t, "1", second.Items[0].Id)
			payload, err = common.Marshal(second.Items[0])
			require.NoError(t, err)
			require.NoError(t, common.Unmarshal(payload, &row))
			require.Equal(t, map[string]any{"id": "41", "name": "支付昵称"}, row["payer"])
			require.Equal(t, map[string]any{"id": "42", "name": "inviter-account"}, row["inviter"])
			require.Equal(t, "1794000000001", row["paid_at"])
			require.Equal(t, "1794604800001", row["release_at"])
			require.NotContains(t, string(payload), "payer-private")
			require.NotContains(t, string(payload), "private-password")
			require.NotContains(t, string(payload), "payer-account", "display name takes precedence over username")

			self, err := ListInvitationRewards(42, false, 1, 20)
			require.NoError(t, err)
			require.Equal(t, "2", self.Total)
			require.Len(t, self.Items, 2)
			require.Equal(t, "3", self.Items[0].Id)
			require.Equal(t, "1", self.Items[1].Id)
			payload, err = common.Marshal(self)
			require.NoError(t, err)
			require.NotContains(t, string(payload), "\"payer\"")
			require.NotContains(t, string(payload), "\"inviter\"")
			require.NotContains(t, string(payload), "支付昵称")
			require.NotContains(t, string(payload), "inviter-account")
			require.Equal(t, "Friend #41", self.Items[1].InviteeLabel)

			lookupErr := errors.New("account lookup unavailable")
			require.NoError(t, db.Callback().Query().Before("gorm:query").Register("test:invitation_identity_lookup_failure", func(tx *gorm.DB) {
				if tx.Statement.Table == "users" {
					_ = tx.AddError(lookupErr)
				}
			}))
			t.Cleanup(func() { require.NoError(t, db.Callback().Query().Remove("test:invitation_identity_lookup_failure")) })
			_, err = ListInvitationRewards(1, true, 1, 1, 1)
			require.ErrorIs(t, err, lookupErr, "database errors cannot masquerade as deleted users")
			self, err = ListInvitationRewards(42, false, 1, 20)
			require.NoError(t, err, "self listing never looks up account identities")
			require.Equal(t, "2", self.Total)

		})
	}
}
