package model

import (
	"fmt"
	"math"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestCustomSubscriptionPaymentDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := customSubscriptionSchedulingDB(t, dialect)
			for _, table := range []any{&TopUp{}, &User{}, &PointAccount{}, &PointTransaction{}, &PointLedger{}, &PointFreeze{}, &PointModelRule{}, &PointType{}} {
				require.False(t, db.Migrator().HasTable(table))
			}
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&InvitationRewardReversal{}, &InvitationRefundOperation{}, &InvitationRewardEvent{}, &InvitationReward{}, &InvitationAuditLog{}, &InvitationQualification{}, &InvitationBinding{}, &InvitationCampaignTier{}, &InvitationCampaignActivation{}, &InvitationCampaignVersion{}, &InvitationCampaign{}, &InvitationControl{}, &PointLedger{}, &PointFreeze{}, &PointTransaction{}, &PointAccount{}, &PointModelRule{}, &PointType{}, &TopUp{}, &User{}))
			})
			require.NoError(t, db.AutoMigrate(&User{}, &TopUp{}))
			require.NoError(t, migratePoints(db))
			// Payment split/merge cases require a second currency; startup only seeds GENERAL.
			gpt := PointType{Code: PointTypeGPT, Name: "GPT 专用积分", ConsumePriority: 10}
			require.NoError(t, db.Create(&gpt).Error)
			require.NoError(t, db.Create(&PointModelRule{PointTypeId: gpt.Id, MatchType: PointMatchPattern, MatchValue: "gpt-*", Enabled: true}).Error)
			require.NoError(t, migrateInvitations(db))
			require.NoError(t, migrateCustomSubscriptions(db))
			require.NoError(t, migrateCustomSubscriptions(db))

			t.Run("representative_pre_payment_upgrade", func(t *testing.T) {
				require.NoError(t, db.Migrator().DropIndex(&CustomSubscriptionOrder{}, "idx_cso_topup"))
				require.NoError(t, db.Migrator().DropIndex(&CustomSubscriptionOrder{}, "idx_cso_checkout"))
				for _, column := range []string{"top_up_id", "checkout_request_id", "quota_to_credit"} {
					require.NoError(t, db.Migrator().DropColumn(&CustomSubscriptionOrder{}, column))
				}
				require.NoError(t, db.Migrator().DropColumn(&TopUp{}, "business_type"))
				oldTopup := TopUp{TradeNo: "historical-wallet", UserId: 900, Amount: 5, Money: 10, Status: common.TopUpStatusPending}
				require.NoError(t, db.Omit("BusinessType").Create(&oldTopup).Error)
				oldOrder := CustomSubscriptionOrder{TradeNo: "historical-custom", UserId: 900, PlanId: 1, PlanVersion: 1, PlanSnapshot: "{}", Status: common.TopUpStatusSuccess}
				require.NoError(t, db.Omit("TopUpId", "CheckoutRequestId", "QuotaToCredit").Create(&oldOrder).Error)
				for range 2 {
					require.NoError(t, db.AutoMigrate(&TopUp{}))
					require.NoError(t, migrateCustomSubscriptions(db))
				}
				var savedTopup TopUp
				require.NoError(t, db.First(&savedTopup, oldTopup.Id).Error)
				assert.Empty(t, savedTopup.BusinessType)
				assert.EqualValues(t, 5, savedTopup.Amount)
				var savedOrder CustomSubscriptionOrder
				require.NoError(t, db.First(&savedOrder, oldOrder.Id).Error)
				assert.Nil(t, savedOrder.TopUpId)
				assert.Nil(t, savedOrder.CheckoutRequestId)
				assert.Zero(t, savedOrder.QuotaToCredit)
				assert.Equal(t, common.TopUpStatusSuccess, savedOrder.Status)
				assert.True(t, db.Migrator().HasIndex(&CustomSubscriptionOrder{}, "idx_cso_topup"))
				assert.True(t, db.Migrator().HasIndex(&CustomSubscriptionOrder{}, "idx_cso_checkout"))
			})
			oldPrice, oldUnit := operation_setting.Price, common.QuotaPerUnit
			operation_setting.Price = 2
			common.QuotaPerUnit = 100
			t.Cleanup(func() { operation_setting.Price = oldPrice; common.QuotaPerUnit = oldUnit })
			var types []PointType
			require.NoError(t, db.Order("id ASC").Find(&types).Error)
			require.Len(t, types, 2)
			plan := CustomSubscriptionPlan{Code: "checkout", Title: "Checkout", Currency: "CNY", PriceAmountMinor: 2999, PaidPoints: 29000, PaidPointTypeId: types[0].Id, BonusPoints: 1000, BonusPointTypeId: &types[1].Id, BillingCycle: "month", DurationMonths: 1, Enabled: true, Version: 1, BenefitsJson: "[]", Priority: 1}
			require.NoError(t, db.Create(&plan).Error)
			newCheckout := func(userID int64, key string) *CustomSubscriptionOrder {
				t.Helper()
				user := User{Id: int(userID), Username: fmt.Sprintf("buyer-%d", userID), AffCode: fmt.Sprintf("aff-%d", userID), Group: "default", Quota: 7}
				require.NoError(t, db.Create(&user).Error)
				order, err := CreateCustomSubscriptionCheckout(CustomSubscriptionCheckoutInput{UserID: userID, PlanID: plan.Id, PlanVersion: 1, RequestID: key, PaymentMethod: "alipay"})
				require.NoError(t, err)
				return order
			}
			inputFor := func(order *CustomSubscriptionOrder) CustomSubscriptionPaymentInput {
				return CustomSubscriptionPaymentInput{TradeNo: order.TradeNo, ProviderTradeNo: "provider-" + order.TradeNo, PaymentMethod: "alipay", AmountMinor: 2999}
			}
			t.Run("checkout_expiry_overflow_creates_no_orders", func(t *testing.T) {
				user := User{Id: 110, Username: "buyer-110", AffCode: "aff-110", Group: "default"}
				require.NoError(t, db.Create(&user).Error)
				state := CustomUserSubscriptionState{UserId: 110, ReconciledAt: math.MaxInt64 - 1}
				require.NoError(t, db.Create(&state).Error)
				_, err := CreateCustomSubscriptionCheckout(CustomSubscriptionCheckoutInput{UserID: 110, PlanID: plan.Id, PlanVersion: 1, RequestID: "request-110", PaymentMethod: "alipay"})
				require.ErrorIs(t, err, ErrCustomSubscriptionTimeInvalid)
				var count int64
				require.NoError(t, db.Model(&CustomSubscriptionOrder{}).Where("user_id = ?", 110).Count(&count).Error)
				assert.Zero(t, count)
				require.NoError(t, db.Model(&TopUp{}).Where("user_id = ?", 110).Count(&count).Error)
				assert.Zero(t, count)
			})
			t.Run("snapshot_idempotency_atomic_replay", func(t *testing.T) {
				order := newCheckout(100, "request-100")
				require.EqualValues(t, 1500, order.QuotaToCredit)
				same, err := CreateCustomSubscriptionCheckout(CustomSubscriptionCheckoutInput{UserID: 100, PlanID: plan.Id, PlanVersion: 1, RequestID: "request-100", PaymentMethod: "alipay"})
				require.NoError(t, err)
				assert.Equal(t, order.Id, same.Id)
				_, err = CreateCustomSubscriptionCheckout(CustomSubscriptionCheckoutInput{UserID: 100, PlanID: plan.Id, PlanVersion: 1, RequestID: "request-100", PaymentMethod: "wxpay"})
				require.ErrorIs(t, err, ErrCustomSubscriptionCheckoutConflict)
				_, err = GetCustomSubscriptionOrderForUser(101, order.TradeNo)
				require.ErrorIs(t, err, ErrCustomSubscriptionOrderNotFound)
				_, err = RechargeEpay(order.TradeNo, "alipay", "")
				require.ErrorIs(t, err, ErrPaymentMethodMismatch)
				require.ErrorIs(t, ManualCompleteTopUp(order.TradeNo, ""), ErrPaymentMethodMismatch)
				wrong := inputFor(order)
				wrong.AmountMinor++
				_, err = SettleCustomSubscriptionPayment(wrong)
				require.ErrorIs(t, err, ErrCustomSubscriptionPaymentMismatch)
				operation_setting.Price = 99
				already, err := SettleCustomSubscriptionPayment(inputFor(order))
				require.NoError(t, err)
				assert.False(t, already)
				already, err = SettleCustomSubscriptionPayment(inputFor(order))
				require.NoError(t, err)
				assert.True(t, already)
				operation_setting.Price = 2
				var user User
				require.NoError(t, db.First(&user, 100).Error)
				assert.EqualValues(t, 1507, user.Quota)
				var accounts []PointAccount
				require.NoError(t, db.Where("user_id = ?", 100).Order("point_type_id ASC").Find(&accounts).Error)
				require.Len(t, accounts, 2)
				assert.EqualValues(t, 29000, accounts[0].AvailablePoints)
				assert.EqualValues(t, 1000, accounts[1].AvailablePoints)
				var transaction PointTransaction
				require.NoError(t, db.Where("user_id = ?", 100).First(&transaction).Error)
				assert.EqualValues(t, 30000, transaction.Points)
				var count int64
				require.NoError(t, db.Model(&PointLedger{}).Where("transaction_id = ?", transaction.Id).Count(&count).Error)
				assert.EqualValues(t, 2, count)
				require.NoError(t, db.Model(&CustomUserSubscription{}).Where("order_id = ?", order.Id).Count(&count).Error)
				assert.EqualValues(t, 1, count)
			})
			t.Run("payment_order_resolves_linked_subscription", func(t *testing.T) {
				order := newCheckout(122, "request-122")
				input := inputFor(order)
				paymentID := *order.TopUpId
				missing := input
				missing.TradeNo = "missing-payment-order"
				_, err := SettleCustomSubscriptionPayment(missing)
				require.ErrorIs(t, err, ErrCustomSubscriptionOrderNotFound)
				for _, invalid := range []struct {
					column  string
					value   any
					restore any
				}{
					{"business_type", "wallet", "custom_subscription"},
					{"payment_provider", "other-provider", PaymentProviderEpay},
					{"user_id", 999, 122},
				} {
					require.NoError(t, db.Model(&TopUp{}).Where("id = ?", paymentID).Update(invalid.column, invalid.value).Error)
					_, err = SettleCustomSubscriptionPayment(input)
					require.ErrorIs(t, err, ErrCustomSubscriptionPaymentMismatch)
					require.NoError(t, db.Model(&TopUp{}).Where("id = ?", paymentID).Update(invalid.column, invalid.restore).Error)
				}
				require.NoError(t, db.Model(&CustomSubscriptionOrder{}).Where("id = ?", order.Id).Update("top_up_id", nil).Error)
				_, err = SettleCustomSubscriptionPayment(input)
				require.ErrorIs(t, err, ErrCustomSubscriptionOrderNotFound)
				require.NoError(t, db.Model(&CustomSubscriptionOrder{}).Where("id = ?", order.Id).Update("top_up_id", paymentID).Error)
				// The payment ID owns the association; mismatched custom trade numbers must fail safely.
				require.NoError(t, db.Model(order).Update("trade_no", "mismatched-custom-trade").Error)
				_, err = SettleCustomSubscriptionPayment(input)
				require.ErrorIs(t, err, ErrCustomSubscriptionPaymentMismatch)
				var user User
				require.NoError(t, db.First(&user, 122).Error)
				assert.EqualValues(t, 7, user.Quota)
				var saved CustomSubscriptionOrder
				require.NoError(t, db.First(&saved, order.Id).Error)
				assert.Equal(t, common.TopUpStatusPending, saved.Status)
				assert.Nil(t, saved.PointTransactionId)
				var topup TopUp
				require.NoError(t, db.First(&topup, *order.TopUpId).Error)
				assert.Equal(t, common.TopUpStatusPending, topup.Status)
				var count int64
				require.NoError(t, db.Model(&PointTransaction{}).Where("user_id = ?", 122).Count(&count).Error)
				assert.Zero(t, count)
				require.NoError(t, db.Model(&CustomUserSubscription{}).Where("order_id = ?", order.Id).Count(&count).Error)
				assert.Zero(t, count)
				require.NoError(t, db.Model(order).Update("trade_no", input.TradeNo).Error)
				_, err = SettleCustomSubscriptionPayment(input)
				require.NoError(t, err)
			})
			t.Run("point_overflow_rolls_back_quota_and_orders", func(t *testing.T) {
				order := newCheckout(101, "request-101")
				account := PointAccount{UserId: 101, PointTypeId: types[1].Id, AvailablePoints: math.MaxInt64}
				require.NoError(t, db.Create(&account).Error)
				_, err := SettleCustomSubscriptionPayment(inputFor(order))
				require.ErrorIs(t, err, ErrCustomSubscriptionPointsInvalid)
				var user User
				require.NoError(t, db.First(&user, 101).Error)
				assert.EqualValues(t, 7, user.Quota)
				var saved CustomSubscriptionOrder
				require.NoError(t, db.First(&saved, order.Id).Error)
				assert.Equal(t, common.TopUpStatusPending, saved.Status)
				assert.Nil(t, saved.PointTransactionId)
				var count int64
				require.NoError(t, db.Model(&PointTransaction{}).Where("user_id = ?", 101).Count(&count).Error)
				assert.Zero(t, count)
				require.NoError(t, db.Model(&PointAccount{}).Where("user_id = ? AND point_type_id = ?", 101, types[0].Id).Count(&count).Error)
				assert.Zero(t, count)
			})
			t.Run("late_verified_payment_and_concurrency", func(t *testing.T) {
				order := newCheckout(102, "request-102")
				require.NoError(t, db.Model(order).Update("expires_at", int64(1)).Error)
				legacyExpiry := int64(0)
				legacy := CustomSubscriptionOrder{TradeNo: "legacy-pending-without-payment", UserId: 900, PlanId: plan.Id, PlanVersion: 1, PlanSnapshot: "{}", Status: common.TopUpStatusPending, ExpiresAt: &legacyExpiry}
				require.NoError(t, db.Create(&legacy).Error)
				count, err := ExpirePendingCustomSubscriptionOrders(1)
				require.NoError(t, err)
				assert.Equal(t, 1, count)
				var untouched CustomSubscriptionOrder
				require.NoError(t, db.First(&untouched, legacy.Id).Error)
				assert.Equal(t, common.TopUpStatusPending, untouched.Status)
				assert.Nil(t, untouched.TopUpId)
				var expiredPayment TopUp
				require.NoError(t, db.First(&expiredPayment, *order.TopUpId).Error)
				assert.Equal(t, common.TopUpStatusExpired, expiredPayment.Status)
				var wg sync.WaitGroup
				errs := make(chan error, 2)
				for range 2 {
					wg.Go(func() { _, err := SettleCustomSubscriptionPayment(inputFor(order)); errs <- err })
				}
				wg.Wait()
				close(errs)
				for err := range errs {
					require.NoError(t, err)
				}
				var user User
				require.NoError(t, db.First(&user, 102).Error)
				assert.EqualValues(t, 1507, user.Quota)
				var transactions int64
				require.NoError(t, db.Model(&PointTransaction{}).Where("user_id = ?", 102).Count(&transactions).Error)
				assert.EqualValues(t, 1, transactions)
			})

			t.Run("expiry_rejects_inconsistent_payment_association", func(t *testing.T) {
				order := newCheckout(120, "request-120")
				require.NoError(t, db.Model(order).Update("expires_at", int64(1)).Error)
				require.NoError(t, db.Model(&TopUp{}).Where("id = ?", *order.TopUpId).Update("user_id", 121).Error)
				count, err := ExpirePendingCustomSubscriptionOrders(10)
				require.ErrorIs(t, err, ErrCustomSubscriptionStateInvalid)
				assert.Zero(t, count)
				var topup TopUp
				require.NoError(t, db.First(&topup, *order.TopUpId).Error)
				assert.Equal(t, common.TopUpStatusPending, topup.Status)
				var saved CustomSubscriptionOrder
				require.NoError(t, db.First(&saved, order.Id).Error)
				assert.Equal(t, common.TopUpStatusPending, saved.Status)
				require.NoError(t, db.Model(&topup).Update("user_id", 120).Error)
				count, err = ExpirePendingCustomSubscriptionOrders(10)
				require.NoError(t, err)
				assert.Equal(t, 1, count)
			})
			t.Run("missing_type_rolls_back_and_wallet_capacity_rechecked", func(t *testing.T) {
				order := newCheckout(107, "request-107")
				require.NoError(t, db.Model(order).Update("paid_point_type_id", int64(99999999)).Error)
				_, err := SettleCustomSubscriptionPayment(inputFor(order))
				require.ErrorIs(t, err, ErrPointTypeNotFound)
				var user User
				require.NoError(t, db.First(&user, 107).Error)
				assert.EqualValues(t, 7, user.Quota)
				other := newCheckout(108, "request-108")
				require.NoError(t, db.Model(&User{}).Where("id = ?", 108).Update("quota", common.MaxWalletQuota).Error)
				_, err = SettleCustomSubscriptionPayment(inputFor(other))
				require.ErrorIs(t, err, ErrTopUpQuotaLimitExceeded)
				var count int64
				require.NoError(t, db.Model(&PointTransaction{}).Where("user_id IN ?", []int64{107, 108}).Count(&count).Error)
				assert.Zero(t, count)
			})
			t.Run("same_type_bonus_and_concurrent_checkout", func(t *testing.T) {
				user := User{Id: 104, Username: "buyer-104", AffCode: "aff-104", Group: "default"}
				require.NoError(t, db.Create(&user).Error)
				samePlan := plan
				samePlan.Id = 0
				samePlan.Code = "same-type"
				samePlan.BonusPointTypeId = &samePlan.PaidPointTypeId
				require.NoError(t, db.Create(&samePlan).Error)
				input := CustomSubscriptionCheckoutInput{UserID: 104, PlanID: samePlan.Id, PlanVersion: 1, RequestID: "request-104", PaymentMethod: "alipay"}
				var wg sync.WaitGroup
				orders := make(chan *CustomSubscriptionOrder, 2)
				errs := make(chan error, 2)
				for range 2 {
					wg.Go(func() { order, err := CreateCustomSubscriptionCheckout(input); orders <- order; errs <- err })
				}
				wg.Wait()
				close(orders)
				close(errs)
				for err := range errs {
					require.NoError(t, err)
				}
				var first *CustomSubscriptionOrder
				for order := range orders {
					if first == nil {
						first = order
					}
					assert.Equal(t, first.Id, order.Id)
				}
				_, err := SettleCustomSubscriptionPayment(inputFor(first))
				require.NoError(t, err)
				var account PointAccount
				require.NoError(t, db.Where("user_id = ?", 104).First(&account).Error)
				assert.EqualValues(t, 30000, account.AvailablePoints)
				assert.EqualValues(t, 1, account.Version)
				var count int64
				require.NoError(t, db.Model(&PointLedger{}).Where("account_id = ?", account.Id).Count(&count).Error)
				assert.EqualValues(t, 1, count)
			})

			t.Run("distinct_orders_same_user_serialize_credits_and_service", func(t *testing.T) {
				first := newCheckout(109, "request-109-a")
				second, err := CreateCustomSubscriptionCheckout(CustomSubscriptionCheckoutInput{UserID: 109, PlanID: plan.Id, PlanVersion: 1, RequestID: "request-109-b", PaymentMethod: "alipay"})
				require.NoError(t, err)
				var wg sync.WaitGroup
				errs := make(chan error, 2)
				for _, order := range []*CustomSubscriptionOrder{first, second} {
					wg.Go(func() { _, err := SettleCustomSubscriptionPayment(inputFor(order)); errs <- err })
				}
				wg.Wait()
				close(errs)
				for err := range errs {
					require.NoError(t, err)
				}
				var user User
				require.NoError(t, db.First(&user, 109).Error)
				assert.EqualValues(t, 3007, user.Quota)
				var account PointAccount
				require.NoError(t, db.Where("user_id = ? AND point_type_id = ?", 109, types[0].Id).First(&account).Error)
				assert.EqualValues(t, 58000, account.AvailablePoints)
				assert.EqualValues(t, 2, account.Version)
				var active, paused int64
				require.NoError(t, db.Model(&CustomUserSubscription{}).Where("user_id = ? AND status = ?", 109, "active").Count(&active).Error)
				require.NoError(t, db.Model(&CustomUserSubscription{}).Where("user_id = ? AND status = ?", 109, "paused").Count(&paused).Error)
				assert.EqualValues(t, 1, active)
				assert.EqualValues(t, 1, paused)
			})
			t.Run("provider_transaction_unique_across_orders", func(t *testing.T) {
				order := newCheckout(105, "request-105")
				input := inputFor(order)
				input.ProviderTradeNo = "provider-reused"
				_, err := SettleCustomSubscriptionPayment(input)
				require.NoError(t, err)
				other := newCheckout(106, "request-106")
				input = inputFor(other)
				input.ProviderTradeNo = "provider-reused"
				_, err = SettleCustomSubscriptionPayment(input)
				require.Error(t, err)
				var user User
				require.NoError(t, db.First(&user, 106).Error)
				assert.EqualValues(t, 7, user.Quota)
				var count int64
				require.NoError(t, db.Model(&PointTransaction{}).Where("user_id = ?", 106).Count(&count).Error)
				assert.Zero(t, count)
			})
			t.Run("service_failure_rolls_back_every_credit", func(t *testing.T) {
				order := newCheckout(103, "request-103")
				require.NoError(t, db.Model(order).Update("plan_snapshot", "malformed").Error)
				_, err := SettleCustomSubscriptionPayment(inputFor(order))
				require.ErrorIs(t, err, ErrCustomSubscriptionOrderInvalid)
				var user User
				require.NoError(t, db.First(&user, 103).Error)
				assert.EqualValues(t, 7, user.Quota)
				var count int64
				require.NoError(t, db.Model(&PointLedger{}).Joins("JOIN point_transactions ON point_transactions.id = point_ledger.transaction_id").Where("point_transactions.user_id = ?", 103).Count(&count).Error)
				assert.Zero(t, count)
				var topup TopUp
				require.NoError(t, db.First(&topup, *order.TopUpId).Error)
				assert.Equal(t, common.TopUpStatusPending, topup.Status)
			})
			t.Run("invalid_legacy_binding_does_not_break_buyer_payment", func(t *testing.T) {
				now := time.Now().UnixMilli()
				version := InvitationCampaignVersion{CampaignId: 3, Version: 1, StartsAt: now - 10000, EndsAt: now + 86400000, RewardPointTypeId: types[0].Id, FreezeDays: 7, Name: "Invalid legacy"}
				require.NoError(t, db.Create(&version).Error)
				activation := InvitationCampaignActivation{VersionId: version.Id, EffectiveFrom: now - 10000}
				require.NoError(t, db.Create(&activation).Error)
				require.NoError(t, db.Create(&InvitationCampaignTier{VersionId: version.Id, RateBps: 500}).Error)
				defer func() { require.NoError(t, db.Delete(&activation).Error) }()
				for i, kind := range []string{"missing_inviter", "disabled_inviter", "multi_hop_cycle"} {
					t.Run(kind, func(t *testing.T) {
						buyerID := int64(610 + i*10)
						inviterID := buyerID + 1
						order := newCheckout(buyerID, fmt.Sprintf("legacy-bad-%d", buyerID))
						bound := now - 1000
						require.NoError(t, db.Model(&User{}).Where("id = ?", buyerID).Updates(map[string]any{"status": common.UserStatusEnabled, "inviter_id": inviterID}).Error)
						if kind != "missing_inviter" {
							status := common.UserStatusEnabled
							if kind == "disabled_inviter" {
								status = common.UserStatusDisabled
							}
							inviter := User{Id: int(inviterID), Username: fmt.Sprintf("legacy-inviter-%d", inviterID), AffCode: fmt.Sprintf("legacy-aff-%d", inviterID), Status: status}
							require.NoError(t, db.Create(&inviter).Error)
							if kind == "multi_hop_cycle" {
								ancestor := User{Id: int(buyerID + 2), Username: fmt.Sprintf("ancestor-%d", buyerID), AffCode: fmt.Sprintf("ancestor-aff-%d", buyerID), Status: common.UserStatusEnabled, Role: common.RoleCommonUser, InviterId: int(buyerID)}
								require.NoError(t, db.Create(&ancestor).Error)
								require.NoError(t, db.Model(&inviter).Update("inviter_id", ancestor.Id).Error)
							}
						}
						require.NoError(t, db.Create(&InvitationBinding{InviteeId: buyerID, InviterId: inviterID, BoundAt: &bound, Source: "legacy"}).Error)
						_, err := SettleCustomSubscriptionPayment(inputFor(order))
						require.NoError(t, err)
						require.NoError(t, db.First(order, order.Id).Error)
						require.Equal(t, common.TopUpStatusSuccess, order.Status)
						require.NotNil(t, order.InvitationCaptureResult)
						require.Equal(t, "excluded_invalid_binding", *order.InvitationCaptureResult)
						var account PointAccount
						require.NoError(t, db.Where("user_id = ? AND point_type_id = ?", buyerID, types[0].Id).First(&account).Error)
						require.EqualValues(t, 29000, account.AvailablePoints)
						var rewards, qualifications int64
						require.NoError(t, db.Model(&InvitationReward{}).Where("order_id = ?", order.Id).Count(&rewards).Error)
						require.Zero(t, rewards)
						require.NoError(t, db.Model(&InvitationQualification{}).Where("invitee_id = ?", buyerID).Count(&qualifications).Error)
						require.Zero(t, qualifications)
						already, err := SettleCustomSubscriptionPayment(inputFor(order))
						require.NoError(t, err)
						require.True(t, already)
					})
				}
			})

			t.Run("invitation_event_failure_rolls_back_buyer_settlement", func(t *testing.T) {
				now := time.Now().UnixMilli()
				inviter := User{Id: 511, Username: "inviter-511", AffCode: "aff-511"}
				require.NoError(t, db.Create(&inviter).Error)
				version := InvitationCampaignVersion{CampaignId: 2, Version: 1, StartsAt: now - 10000, EndsAt: now + 86400000, RewardPointTypeId: types[0].Id, FreezeDays: 7, Name: "Rollback"}
				require.NoError(t, db.Create(&version).Error)
				activation := InvitationCampaignActivation{VersionId: version.Id, EffectiveFrom: now - 10000}
				require.NoError(t, db.Create(&activation).Error)
				require.NoError(t, db.Create(&InvitationCampaignTier{VersionId: version.Id, RateBps: 500}).Error)
				order := newCheckout(510, "invite-order-510")
				bound := now - 1000
				require.NoError(t, db.Create(&InvitationBinding{InviteeId: 510, InviterId: 511, BoundAt: &bound}).Error)
				require.NoError(t, db.Callback().Create().Before("gorm:create").Register("test:invitation_event_failure", func(tx *gorm.DB) {
					if tx.Statement.Table == "invitation_reward_events" {
						tx.AddError(fmt.Errorf("injected durable event failure"))
					}
				}))
				_, err := SettleCustomSubscriptionPayment(inputFor(order))
				require.ErrorContains(t, err, "injected durable event failure")
				require.NoError(t, db.Callback().Create().Remove("test:invitation_event_failure"))
				var user User
				require.NoError(t, db.First(&user, 510).Error)
				require.EqualValues(t, 7, user.Quota)
				require.NoError(t, db.First(order, order.Id).Error)
				require.Equal(t, common.TopUpStatusPending, order.Status)
				require.Nil(t, order.InvitationCaptureVersion)
				for _, table := range []any{&InvitationReward{}, &PointTransaction{}, &CustomUserSubscription{}} {
					var count int64
					q := db.Model(table)
					switch table.(type) {
					case *InvitationReward:
						q = q.Where("order_id = ?", order.Id)
					default:
						q = q.Where("user_id = ?", 510)
					}
					require.NoError(t, q.Count(&count).Error)
					require.Zero(t, count)
				}
				require.NoError(t, db.Delete(&activation).Error)
			})

			t.Run("invitation_capture_refund_freeze_release_and_review", func(t *testing.T) {
				now := time.Now().UnixMilli()
				inviter := User{Id: 501, Username: "inviter-501", AffCode: "aff-501"}
				require.NoError(t, db.Create(&inviter).Error)
				version := InvitationCampaignVersion{CampaignId: 1, Version: 1, StartsAt: now - 10000, EndsAt: now + 86400000, RewardPointTypeId: types[1].Id, FreezeDays: 7, Name: "Campaign snapshot"}
				require.NoError(t, db.Create(&version).Error)
				require.NoError(t, db.Create(&InvitationCampaignActivation{VersionId: version.Id, EffectiveFrom: now - 10000}).Error)
				require.NoError(t, db.Create(&InvitationCampaignTier{VersionId: version.Id, MinEffectiveFriends: 0, RateBps: 700}).Error)
				order := newCheckout(500, "invite-order-500")
				bound := now - 1000
				require.NoError(t, db.Create(&InvitationBinding{InviteeId: 500, InviterId: 501, BoundAt: &bound, Source: "explicit", InviterCode: "aff-501"}).Error)
				_, err := SettleCustomSubscriptionPayment(inputFor(order))
				require.NoError(t, err)
				var reward InvitationReward
				require.NoError(t, db.Where("order_id = ?", order.Id).First(&reward).Error)
				require.EqualValues(t, 2099, reward.ProcessingPoints)
				require.EqualValues(t, 0, reward.FrozenPoints)
				var buyer PointAccount
				require.NoError(t, db.Where("user_id = ? AND point_type_id = ?", 500, types[0].Id).First(&buyer).Error)
				require.EqualValues(t, 29000, buyer.AvailablePoints)
				require.Zero(t, buyer.FrozenPoints)
				// Refund before the capture event is consumed: worker must reread net target.
				refund, err := PrepareInvitationRefund(order.Id, 1, 999, "refund-before-credit")
				require.NoError(t, err)
				_, err = CompleteInvitationRefund(order.Id, refund.Id, 1, 999, "epay", "refund-500-a")
				require.NoError(t, err)
				_, err = processInvitationRewardsAt(100, now+10000)
				require.NoError(t, err)
				require.NoError(t, db.First(&reward, reward.Id).Error)
				require.EqualValues(t, 1400, reward.FrozenPoints)
				require.EqualValues(t, 699, reward.CancelledPoints)
				var account PointAccount
				require.NoError(t, db.Where("user_id = ? AND point_type_id = ?", 501, types[1].Id).First(&account).Error)
				require.Zero(t, account.AvailablePoints)
				require.EqualValues(t, 1400, account.FrozenPoints)
				// Foreign freezes and signed debt must survive reward release.
				require.NoError(t, db.Model(&account).Updates(map[string]any{"available_points": -1500, "frozen_points": 1410}).Error)
				foreign := PointFreeze{AccountId: account.Id, TransactionId: 1, OriginalPoints: 10, RemainingPoints: 10, ReasonCode: "ADMIN", Status: PointFreezeActive}
				require.NoError(t, db.Create(&foreign).Error)
				hold, err := PrepareInvitationRefund(order.Id, 1, 100, "refund-hold")
				require.NoError(t, err)
				_, err = processInvitationRewardsAt(100, reward.ReleaseAt+1)
				require.NoError(t, err)
				require.NoError(t, db.First(&reward, reward.Id).Error)
				require.Equal(t, InvitationRewardFrozen, reward.Status)
				_, err = CancelInvitationRefund(order.Id, hold.Id, 1)
				require.NoError(t, err)
				_, err = processInvitationRewardsAt(100, reward.ReleaseAt+1)
				require.NoError(t, err)
				require.NoError(t, db.First(&account, account.Id).Error)
				require.EqualValues(t, -100, account.AvailablePoints)
				require.EqualValues(t, 10, account.FrozenPoints)
				require.NoError(t, db.First(&foreign, foreign.Id).Error)
				require.EqualValues(t, 10, foreign.RemainingPoints)
				// Replays create no additional ledger; released refund requires explicit reversal.
				_, err = processInvitationRewardsAt(100, reward.ReleaseAt+2)
				require.NoError(t, err)
				refund2, err := PrepareInvitationRefund(order.Id, 1, 1000, "refund-after-release")
				require.NoError(t, err)
				_, err = CompleteInvitationRefund(order.Id, refund2.Id, 1, 1000, "epay", "refund-500-b")
				require.NoError(t, err)
				require.NoError(t, db.First(&reward, reward.Id).Error)
				require.EqualValues(t, 700, reward.ReviewDuePoints)
				require.Equal(t, InvitationRewardReview, reward.Status)
				_, err = ReverseInvitationReward(reward.Id, 1, 700, "reverse-500", "Verified cash refund")
				require.NoError(t, err)
				_, err = ReverseInvitationReward(reward.Id, 1, 700, "reverse-500", "Verified cash refund")
				require.NoError(t, err)
				require.NoError(t, db.First(&account, account.Id).Error)
				require.EqualValues(t, -800, account.AvailablePoints)
				require.EqualValues(t, 10, account.FrozenPoints)
				require.NoError(t, db.First(&reward, reward.Id).Error)
				require.EqualValues(t, 700, reward.ReversedPoints)
				require.Zero(t, reward.ReviewDuePoints)
				summary, err := GetInvitationSummary(501)
				require.NoError(t, err)
				require.Len(t, summary.Balances, 1)
				require.Equal(t, "700", summary.Balances[0].ReversedTotal)
				page, err := ListInvitationRewards(501, false, 1, 20)
				require.NoError(t, err)
				require.Len(t, page.Items, 1)
				require.Equal(t, "Campaign snapshot", page.Items[0].CampaignName)
				var audits []InvitationAuditLog
				require.NoError(t, db.Where("entity_type = ? AND entity_id IN ?", "refund", []int64{refund.Id, hold.Id, refund2.Id}).Order("id ASC").Find(&audits).Error)
				require.Len(t, audits, 6)
				require.Equal(t, "refund_prepare", audits[0].Action)
				require.Equal(t, "refund_complete", audits[1].Action)
				require.Equal(t, "refund_cancel", audits[3].Action)
				for _, audit := range audits {
					require.EqualValues(t, 1, audit.OperatorId)
					require.Positive(t, audit.CreatedAt)
				}

				// A held earliest reward must not starve later due releases in bounded batches.
				orderA := CustomSubscriptionOrder{TradeNo: "held-starvation-a", UserId: 500, Status: common.TopUpStatusSuccess, AmountPaidMinor: 10000, RefundStatus: "none"}
				orderB := CustomSubscriptionOrder{TradeNo: "held-starvation-b", UserId: 500, Status: common.TopUpStatusSuccess, AmountPaidMinor: 10000, RefundStatus: "none"}
				require.NoError(t, db.Create(&orderA).Error)
				require.NoError(t, db.Create(&orderB).Error)
				a := InvitationReward{OrderId: orderA.Id, InviterId: 501, InviteeId: 500, PointTypeId: types[1].Id, OriginalPoints: 100, ProcessingPoints: 100, Status: InvitationRewardCaptured, ReleaseAt: now - 2}
				b := InvitationReward{OrderId: orderB.Id, InviterId: 501, InviteeId: 500, PointTypeId: types[1].Id, OriginalPoints: 100, ProcessingPoints: 100, Status: InvitationRewardCaptured, ReleaseAt: now - 1}
				require.NoError(t, db.Create(&a).Error)
				require.NoError(t, db.Create(&b).Error)
				require.NoError(t, db.Create(&InvitationRewardEvent{RewardId: a.Id, Status: "PENDING"}).Error)
				require.NoError(t, db.Create(&InvitationRewardEvent{RewardId: b.Id, Status: "PENDING"}).Error)
				_, err = PrepareInvitationRefund(orderA.Id, 1, 100, "held-starvation")
				require.NoError(t, err)
				_, err = processInvitationRewardsAt(1, now+10000)
				require.NoError(t, err)
				_, err = processInvitationRewardsAt(1, now+10000)
				require.NoError(t, err)
				require.NoError(t, db.First(&b, b.Id).Error)
				require.Equal(t, InvitationRewardReleased, b.Status)

			})

		})
	}
}
