package model

import (
	"fmt"
	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
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
