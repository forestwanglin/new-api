package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type customUserSubscriptionDTO struct {
	ID                  string  `json:"id"`
	OrderID             string  `json:"order_id"`
	PlanID              string  `json:"plan_id"`
	PlanVersion         string  `json:"plan_version"`
	Priority            int     `json:"priority"`
	BillingCycle        string  `json:"billing_cycle"`
	DurationMonths      int     `json:"duration_months"`
	TotalDurationMS     string  `json:"total_duration_ms"`
	RemainingDurationMS string  `json:"remaining_duration_ms"`
	Status              string  `json:"status"`
	PurchasedAt         string  `json:"purchased_at"`
	FirstActivatedAt    *string `json:"first_activated_at"`
	ActiveSinceAt       *string `json:"active_since_at"`
	ActiveUntilAt       *string `json:"active_until_at"`
	EndedAt             *string `json:"ended_at"`
}

func customSubscriptionOptionalInt(value *int64) *string {
	if value == nil {
		return nil
	}
	formatted := strconv.FormatInt(*value, 10)
	return &formatted
}

// GetCustomSubscriptionSelf reconciles expiry before reporting this session's
// subscriptions. Payment payloads and internal plan snapshots are never returned.
func GetCustomSubscriptionSelf(c *gin.Context) {
	if len(c.Request.URL.Query()) != 0 {
		common.ApiErrorT(c, "Invalid custom subscription plan filters")
		return
	}
	view, err := model.GetCustomUserSubscriptions(int64(c.GetInt("id")))
	if err != nil {
		common.ApiErrorT(c, "Failed to load custom subscriptions")
		return
	}
	items := make([]customUserSubscriptionDTO, 0, len(view.Subscriptions))
	for _, sub := range view.Subscriptions {
		items = append(items, customUserSubscriptionDTO{
			ID: strconv.FormatInt(sub.Id, 10), OrderID: strconv.FormatInt(sub.OrderId, 10),
			PlanID: strconv.FormatInt(sub.PlanId, 10), PlanVersion: strconv.FormatInt(sub.PlanVersion, 10),
			Priority: sub.Priority, BillingCycle: sub.BillingCycle, DurationMonths: sub.DurationMonths,
			TotalDurationMS: strconv.FormatInt(sub.TotalDurationMs, 10), RemainingDurationMS: strconv.FormatInt(sub.RemainingDurationMs, 10),
			Status: sub.Status, PurchasedAt: strconv.FormatInt(sub.PurchasedAt, 10),
			FirstActivatedAt: customSubscriptionOptionalInt(sub.FirstActivatedAt),
			ActiveSinceAt:    customSubscriptionOptionalInt(sub.ActiveSinceAt),
			ActiveUntilAt:    customSubscriptionOptionalInt(sub.ActiveUntilAt),
			EndedAt:          customSubscriptionOptionalInt(sub.EndedAt),
		})
	}
	common.ApiSuccess(c, gin.H{
		"active_subscription_id": customSubscriptionOptionalInt(view.ActiveSubscriptionID),
		"observed_at":            strconv.FormatInt(view.ObservedAt, 10), "items": items,
	})
}
