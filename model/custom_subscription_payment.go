package model

import (
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrCustomSubscriptionCheckoutInvalid  = errors.New("Invalid custom subscription checkout")
	ErrCustomSubscriptionCheckoutConflict = errors.New("Custom subscription checkout request conflict")
	ErrCustomSubscriptionPaymentMismatch  = errors.New("Custom subscription payment does not match order")
	ErrCustomSubscriptionPointsInvalid    = errors.New("Invalid custom subscription points settlement")
)

type CustomSubscriptionCheckoutInput struct {
	UserID, PlanID, PlanVersion int64
	RequestID, PaymentMethod    string
}
type CustomSubscriptionPaymentInput struct {
	TradeNo, ProviderTradeNo, PaymentMethod, ProviderPayload, CallerIP string
	AmountMinor                                                        int64
}

func CreateCustomSubscriptionCheckout(input CustomSubscriptionCheckoutInput) (*CustomSubscriptionOrder, error) {
	if input.UserID <= 0 || input.UserID > math.MaxInt || input.PlanID <= 0 || input.PlanVersion <= 0 || len(input.RequestID) < 8 || len(input.RequestID) > 64 || strings.TrimSpace(input.RequestID) != input.RequestID || (input.PaymentMethod != "alipay" && input.PaymentMethod != "wxpay") {
		return nil, ErrCustomSubscriptionCheckoutInvalid
	}
	var order CustomSubscriptionOrder
	err := customSubscriptionTransaction(input.UserID, func() int64 { return time.Now().UnixMilli() }, func(s *customSubscriptionSchedule) error {
		existing := s.tx.Where("user_id = ? AND checkout_request_id = ?", input.UserID, input.RequestID).Limit(1).Find(&order)
		if existing.Error != nil {
			return existing.Error
		}
		if existing.RowsAffected > 0 {
			if order.PlanId != input.PlanID || order.PlanVersion != input.PlanVersion || order.PaymentMethod != input.PaymentMethod {
				return ErrCustomSubscriptionCheckoutConflict
			}
			return nil
		}
		var plan CustomSubscriptionPlan
		if err := lockForUpdate(s.tx).First(&plan, input.PlanID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrCustomSubscriptionNotFound
			}
			return err
		}
		if !plan.Enabled {
			return ErrCustomSubscriptionNotFound
		}
		if plan.Version != input.PlanVersion {
			return ErrCustomSubscriptionConflict
		}
		if plan.Priority < 0 || plan.Priority > math.MaxInt32 || plan.Currency != "CNY" || plan.PriceAmountMinor <= 0 || plan.PaidPoints <= 0 || plan.BonusPoints < 0 || plan.PaidPoints > math.MaxInt64-plan.BonusPoints {
			return ErrCustomSubscriptionCheckoutInvalid
		}
		if _, err := customSubscriptionDurationMs(plan.BillingCycle, plan.DurationMonths); err != nil {
			return err
		}
		var user User
		if err := s.tx.Select("id", "group", "quota").First(&user, input.UserID).Error; err != nil {
			return err
		}
		price, ratio := operation_setting.Price, common.GetTopupGroupRatio(user.Group)
		if ratio == 0 {
			ratio = 1
		}
		if price <= 0 || ratio <= 0 || common.QuotaPerUnit <= 0 || math.IsNaN(price) || math.IsInf(price, 0) || math.IsNaN(ratio) || math.IsInf(ratio, 0) || math.IsNaN(common.QuotaPerUnit) || math.IsInf(common.QuotaPerUnit, 0) {
			return ErrInvalidTopUpQuota
		}
		money := decimal.NewFromInt(plan.PriceAmountMinor).Div(decimal.NewFromInt(100))
		quota, err := common.WalletQuotaFromDecimalStrict(money.Mul(decimal.NewFromFloat(common.QuotaPerUnit)).Div(decimal.NewFromFloat(price).Mul(decimal.NewFromFloat(ratio))))
		if err != nil || quota <= 0 {
			return ErrInvalidTopUpQuota
		}
		if user.Quota > common.MaxWalletQuota-quota {
			return ErrTopUpQuotaLimitExceeded
		}
		ids := []int64{plan.PaidPointTypeId}
		if plan.BonusPoints > 0 {
			if plan.BonusPointTypeId == nil {
				return ErrPointTypeNotFound
			}
			ids = append(ids, *plan.BonusPointTypeId)
		}
		for _, id := range ids {
			var count int64
			if err := s.tx.Model(&PointType{}).Where("id = ?", id).Count(&count).Error; err != nil {
				return err
			}
			if count != 1 {
				return ErrPointTypeNotFound
			}
		}
		snapshot, err := common.Marshal(plan)
		if err != nil {
			return err
		}
		if s.now > math.MaxInt64-30*60*1000 {
			return ErrCustomSubscriptionTimeInvalid
		}
		tradeNo := fmt.Sprintf("CS%d%s", input.UserID, common.GetRandomString(24))
		topup := TopUp{BusinessType: "custom_subscription", UserId: int(input.UserID), Amount: 0, Money: money.InexactFloat64(), TradeNo: tradeNo, PaymentMethod: input.PaymentMethod, PaymentProvider: PaymentProviderEpay, CreateTime: s.now / 1000, Status: common.TopUpStatusPending}
		if err := s.tx.Create(&topup).Error; err != nil {
			return err
		}
		expires := s.now + 30*60*1000
		order = CustomSubscriptionOrder{TopUpId: &topup.Id, CheckoutRequestId: &input.RequestID, QuotaToCredit: int64(quota), TradeNo: tradeNo, UserId: input.UserID, PlanId: plan.Id, PlanVersion: plan.Version, PlanSnapshot: string(snapshot), TierCode: plan.TierCode, TierRank: plan.TierRank, Priority: plan.Priority, BillingCycle: plan.BillingCycle, DurationMonths: plan.DurationMonths, Currency: plan.Currency, PaidPoints: plan.PaidPoints, PaidPointTypeId: plan.PaidPointTypeId, BonusPoints: plan.BonusPoints, BonusPointTypeId: plan.BonusPointTypeId, AutoRenewBonusBps: plan.AutoRenewBonusBps, AutoBonusPointTypeId: plan.AutoBonusPointTypeId, OrderType: "purchase", AmountDueMinor: plan.PriceAmountMinor, PaymentMethod: input.PaymentMethod, PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusPending, FulfillmentStatus: "pending", RefundStatus: "none", ExpiresAt: &expires, CreatedAt: s.now, UpdatedAt: s.now}
		return s.tx.Create(&order).Error
	})
	return &order, err
}

func GetCustomSubscriptionOrderForUser(userID int64, tradeNo string) (*CustomSubscriptionOrder, error) {
	var order CustomSubscriptionOrder
	if userID <= 0 || tradeNo == "" {
		return nil, ErrCustomSubscriptionOrderNotFound
	}
	err := DB.Where("user_id = ? AND trade_no = ?", userID, tradeNo).First(&order).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = ErrCustomSubscriptionOrderNotFound
	}
	return &order, err
}

func SettleCustomSubscriptionPayment(input CustomSubscriptionPaymentInput) (bool, error) {
	var owner CustomSubscriptionOrder
	if input.TradeNo == "" || input.ProviderTradeNo == "" || len(input.ProviderTradeNo) > 128 || input.AmountMinor <= 0 {
		return false, ErrCustomSubscriptionPaymentMismatch
	}
	// Locate the payment first; its unique association owns the subscription order.
	// These reads take no locks: the transaction retains schedule -> order -> payment locking.
	var payment TopUp
	if err := DB.Select("id", "user_id", "business_type", "payment_provider").Where("trade_no = ?", input.TradeNo).First(&payment).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, ErrCustomSubscriptionOrderNotFound
		}
		return false, err
	}
	if payment.BusinessType != "custom_subscription" || payment.PaymentProvider != PaymentProviderEpay {
		return false, ErrCustomSubscriptionPaymentMismatch
	}
	if err := DB.Select("id", "user_id").Where("top_up_id = ?", payment.Id).First(&owner).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, ErrCustomSubscriptionOrderNotFound
		}
		return false, err
	}
	if owner.UserId != int64(payment.UserId) {
		return false, ErrCustomSubscriptionPaymentMismatch
	}
	already := false
	var order CustomSubscriptionOrder
	err := customSubscriptionTransaction(owner.UserId, func() int64 { return time.Now().UnixMilli() }, func(s *customSubscriptionSchedule) error {
		if err := lockForUpdate(s.tx).First(&order, owner.Id).Error; err != nil {
			return err
		}
		if order.UserId != owner.UserId || order.TradeNo != input.TradeNo || order.PaymentProvider != PaymentProviderEpay || order.PaymentMethod != input.PaymentMethod || order.Currency != "CNY" || order.AmountDueMinor != input.AmountMinor || order.TopUpId == nil || *order.TopUpId != payment.Id || order.QuotaToCredit <= 0 || order.QuotaToCredit > common.MaxWalletQuota {
			return ErrCustomSubscriptionPaymentMismatch
		}
		var topup TopUp
		if err := lockForUpdate(s.tx).First(&topup, *order.TopUpId).Error; err != nil {
			return err
		}
		if topup.BusinessType != "custom_subscription" || topup.TradeNo != order.TradeNo || int64(topup.UserId) != order.UserId || topup.PaymentProvider != PaymentProviderEpay || topup.PaymentMethod != order.PaymentMethod {
			return ErrCustomSubscriptionPaymentMismatch
		}
		if order.Status == common.TopUpStatusSuccess {
			if topup.Status != common.TopUpStatusSuccess || order.ProviderTradeNo == nil || *order.ProviderTradeNo != input.ProviderTradeNo || order.PointTransactionId == nil || order.FulfillmentStatus != CustomSubscriptionFulfillmentComplete {
				return ErrCustomSubscriptionStateInvalid
			}
			already = true
			return nil
		}
		if (order.Status != common.TopUpStatusPending && order.Status != common.TopUpStatusExpired) || (topup.Status != common.TopUpStatusPending && topup.Status != common.TopUpStatusExpired) || order.PointTransactionId != nil || order.FulfilledAt != nil {
			return ErrCustomSubscriptionOrderInvalid
		}
		if err := creditTopUpQuota(s.tx, topup.UserId, int(order.QuotaToCredit), nil); err != nil {
			return err
		}
		transactionID, err := creditCustomSubscriptionPoints(s.tx, &order, s.now)
		if err != nil {
			return err
		}
		if err := s.tx.Model(&TopUp{}).Where("id = ?", topup.Id).Updates(map[string]any{"status": common.TopUpStatusSuccess, "complete_time": s.now / 1000}).Error; err != nil {
			return err
		}
		if err := s.tx.Model(&CustomSubscriptionOrder{}).Where("id = ?", order.Id).Updates(map[string]any{"status": common.TopUpStatusSuccess, "amount_paid_minor": input.AmountMinor, "paid_at": s.now, "provider_trade_no": input.ProviderTradeNo, "provider_payload": input.ProviderPayload, "point_transaction_id": transactionID, "updated_at": s.now}).Error; err != nil {
			return err
		}
		_, err = s.fulfillOrder(order.Id)
		return err
	})
	if err == nil && !already {
		syncCreditUserQuotaCache(int(order.UserId), int(order.QuotaToCredit), common.LogText("epay topup"))
		if LOG_DB != nil {
			RecordTopupLog(int(order.UserId), common.NewMessage("Online top-up succeeded, amount added: {{quota}}, payment amount: {{amount}}", map[string]any{"quota": logger.FormatQuota(int(order.QuotaToCredit)), "amount": decimal.NewFromInt(order.AmountDueMinor).Div(decimal.NewFromInt(100)).StringFixed(2)}), input.CallerIP, order.PaymentMethod, PaymentProviderEpay)
		}
	}
	return already, err
}

func creditCustomSubscriptionPoints(tx *gorm.DB, order *CustomSubscriptionOrder, now int64) (int64, error) {
	if order.PaidPoints <= 0 || order.BonusPoints < 0 || order.PaidPoints > math.MaxInt64-order.BonusPoints || order.PaidPointTypeId <= 0 {
		return 0, ErrCustomSubscriptionPointsInvalid
	}
	amounts := map[int64]int64{order.PaidPointTypeId: order.PaidPoints}
	if order.BonusPoints > 0 {
		if order.BonusPointTypeId == nil || *order.BonusPointTypeId <= 0 {
			return 0, ErrCustomSubscriptionPointsInvalid
		}
		amounts[*order.BonusPointTypeId] += order.BonusPoints
	}
	transaction := PointTransaction{UserId: order.UserId, EventKey: fmt.Sprintf("custom-subscription:%d:credit", order.Id), Action: PointActionCredit, BizType: "CUSTOM_SUBSCRIPTION", BizId: fmt.Sprint(order.Id), Points: order.PaidPoints + order.BonusPoints, OperatorType: PointOperatorSystem, Remark: "Custom subscription purchase", BillingSnapshot: &order.PlanSnapshot, CreatedAt: now}
	if err := tx.Create(&transaction).Error; err != nil {
		return 0, err
	}
	ids := make([]int64, 0, len(amounts))
	for id := range amounts {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	for _, id := range ids {
		var count int64
		if err := tx.Model(&PointType{}).Where("id = ?", id).Count(&count).Error; err != nil {
			return 0, err
		}
		if count != 1 {
			return 0, ErrPointTypeNotFound
		}
		account := PointAccount{UserId: order.UserId, PointTypeId: id}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
			return 0, err
		}
		if err := lockForUpdate(tx).Where("user_id = ? AND point_type_id = ?", order.UserId, id).First(&account).Error; err != nil {
			return 0, err
		}
		amount := amounts[id]
		if account.FrozenPoints < 0 || account.AvailablePoints > math.MaxInt64-amount || account.Version < 0 || account.Version == math.MaxInt64 {
			return 0, ErrCustomSubscriptionPointsInvalid
		}
		after := account.AvailablePoints + amount
		version := account.Version + 1
		result := tx.Model(&PointAccount{}).Where("id = ? AND version = ?", account.Id, account.Version).Updates(map[string]any{"available_points": after, "version": version, "updated_at": now})
		if result.Error != nil {
			return 0, result.Error
		}
		if result.RowsAffected != 1 {
			return 0, ErrCustomSubscriptionPointsInvalid
		}
		ledger := PointLedger{TransactionId: transaction.Id, AccountId: account.Id, AccountVersion: version, AvailableDelta: amount, AvailableBefore: account.AvailablePoints, AvailableAfter: after, FrozenBefore: account.FrozenPoints, FrozenAfter: account.FrozenPoints, CreatedAt: now}
		if err := tx.Create(&ledger).Error; err != nil {
			return 0, err
		}
	}
	return transaction.Id, nil
}

// ExpirePendingCustomSubscriptionOrders closes stale local checkouts; a later
// verified provider success can still settle them without losing a real payment.
func ExpirePendingCustomSubscriptionOrders(limit int) (int, error) {
	if limit < 1 || limit > 10000 {
		return 0, ErrCustomSubscriptionCheckoutInvalid
	}
	var orders []CustomSubscriptionOrder
	now := time.Now().UnixMilli()
	if err := DB.Where("status = ? AND expires_at <= ? AND top_up_id IS NOT NULL", common.TopUpStatusPending, now).Order("expires_at ASC").Limit(limit).Find(&orders).Error; err != nil {
		return 0, err
	}
	count := 0
	for _, candidate := range orders {
		changed := false
		err := customSubscriptionTransaction(candidate.UserId, func() int64 { return time.Now().UnixMilli() }, func(s *customSubscriptionSchedule) error {
			var order CustomSubscriptionOrder
			if err := lockForUpdate(s.tx).First(&order, candidate.Id).Error; err != nil {
				return err
			}
			if order.Status != common.TopUpStatusPending || order.ExpiresAt == nil || *order.ExpiresAt > s.now {
				return nil
			}
			if order.TopUpId == nil {
				return ErrCustomSubscriptionStateInvalid
			}
			var topup TopUp
			if err := lockForUpdate(s.tx).First(&topup, *order.TopUpId).Error; err != nil {
				return err
			}
			if topup.BusinessType != "custom_subscription" || int64(topup.UserId) != order.UserId || topup.TradeNo != order.TradeNo || topup.PaymentProvider != PaymentProviderEpay || order.PaymentProvider != PaymentProviderEpay || topup.PaymentMethod != order.PaymentMethod || topup.Status != common.TopUpStatusPending {
				return ErrCustomSubscriptionStateInvalid
			}
			if err := s.tx.Model(&topup).Update("status", common.TopUpStatusExpired).Error; err != nil {
				return err
			}
			if err := s.tx.Model(&order).Updates(map[string]any{"status": common.TopUpStatusExpired, "updated_at": s.now}).Error; err != nil {
				return err
			}
			changed = true
			return nil
		})
		if err != nil {
			return count, err
		}
		if changed {
			count++
		}
	}
	return count, nil
}
