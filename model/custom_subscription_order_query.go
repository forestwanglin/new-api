package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
)

// CustomSubscriptionOrderItem is deliberately limited to a buyer's display
// fields. Provider payloads, checkout request IDs and snapshots stay internal.
type CustomSubscriptionOrderItem struct {
	ID                int64  `json:"id,string"`
	PlanID            int64  `json:"plan_id,string"`
	PlanVersion       int64  `json:"plan_version,string"`
	PlanTitle         string `json:"plan_title"`
	TradeNo           string `json:"trade_no"`
	BillingCycle      string `json:"billing_cycle"`
	Currency          string `json:"currency"`
	AmountDueMinor    int64  `json:"amount_due_minor,string"`
	AmountPaidMinor   int64  `json:"amount_paid_minor,string"`
	PaidPoints        int64  `json:"paid_points,string"`
	BonusPoints       int64  `json:"bonus_points,string"`
	AutoBonusPoints   int64  `json:"auto_bonus_points,string"`
	PaymentMethod     string `json:"payment_method"`
	Status            string `json:"status"`
	FulfillmentStatus string `json:"fulfillment_status"`
	CreatedAt         int64  `json:"created_at,string"`
	PaidAt            *int64 `json:"paid_at,string"`
}

type CustomSubscriptionOrderPage struct {
	Page     int                           `json:"page"`
	PageSize int                           `json:"page_size"`
	Total    int64                         `json:"total"`
	Items    []CustomSubscriptionOrderItem `json:"items"`
}

// CustomSubscriptionSnapshotTitle also handles historical lowercase title keys.
// A malformed/absent historical snapshot uses the caller's plan-ID fallback.
func CustomSubscriptionSnapshotTitle(snapshot string) string {
	var plan struct {
		Title string `json:"title"`
	}
	if common.UnmarshalJsonStr(snapshot, &plan) != nil {
		return ""
	}
	return plan.Title
}

func ListCustomSubscriptionOrdersForUser(userID int64, page, pageSize int) (*CustomSubscriptionOrderPage, error) {
	if userID <= 0 || page < 1 || pageSize < 1 || pageSize > 100 || page-1 > int(^uint(0)>>1)/pageSize {
		return nil, errors.New("invalid custom subscription order pagination or owner")
	}
	result := &CustomSubscriptionOrderPage{Page: page, PageSize: pageSize, Items: []CustomSubscriptionOrderItem{}}
	query := DB.Model(&CustomSubscriptionOrder{}).Where("user_id = ?", userID)
	if err := query.Count(&result.Total).Error; err != nil {
		return nil, err
	}
	var orders []CustomSubscriptionOrder
	if err := query.Select("id, plan_id, plan_version, plan_snapshot, trade_no, billing_cycle, currency, amount_due_minor, amount_paid_minor, paid_points, bonus_points, auto_bonus_points, payment_method, status, fulfillment_status, created_at, paid_at").
		Order("created_at DESC, id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&orders).Error; err != nil {
		return nil, err
	}
	for _, order := range orders {
		result.Items = append(result.Items, CustomSubscriptionOrderItem{
			ID: order.Id, PlanID: order.PlanId, PlanVersion: order.PlanVersion, PlanTitle: CustomSubscriptionSnapshotTitle(order.PlanSnapshot),
			TradeNo: order.TradeNo, BillingCycle: order.BillingCycle, Currency: order.Currency,
			AmountDueMinor: order.AmountDueMinor, AmountPaidMinor: order.AmountPaidMinor,
			PaidPoints: order.PaidPoints, BonusPoints: order.BonusPoints, AutoBonusPoints: order.AutoBonusPoints,
			PaymentMethod: order.PaymentMethod, Status: order.Status, FulfillmentStatus: order.FulfillmentStatus,
			CreatedAt: order.CreatedAt, PaidAt: order.PaidAt,
		})
	}
	return result, nil
}
