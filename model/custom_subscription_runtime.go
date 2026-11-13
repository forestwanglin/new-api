package model

import (
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// CustomUserSubscription is one purchased service duration. RemainingDurationMs
// is an anchor while active; the live balance is ActiveUntilAt minus now.
type CustomUserSubscription struct {
	Id                  int64  `gorm:"primaryKey;index:idx_cus_queue,priority:5"`
	UserId              int64  `gorm:"type:bigint;not null;index:idx_cus_queue,priority:1"`
	OrderId             int64  `gorm:"type:bigint;not null;uniqueIndex:idx_cus_order"`
	PlanId              int64  `gorm:"type:bigint;not null;index:idx_cus_plan"`
	PlanVersion         int64  `gorm:"type:bigint;not null"`
	PlanSnapshot        string `gorm:"type:text;not null"`
	Priority            int    `gorm:"not null;index:idx_cus_queue,priority:3"`
	BillingCycle        string `gorm:"type:varchar(16);not null"`
	DurationMonths      int    `gorm:"not null"`
	TotalDurationMs     int64  `gorm:"type:bigint;not null"`
	RemainingDurationMs int64  `gorm:"type:bigint;not null"`
	Status              string `gorm:"type:varchar(32);not null;index:idx_cus_queue,priority:2;index:idx_cus_expiry,priority:1"`
	PurchasedAt         int64  `gorm:"type:bigint;not null;index:idx_cus_queue,priority:4"`
	FirstActivatedAt    *int64 `gorm:"type:bigint"`
	ActiveSinceAt       *int64 `gorm:"type:bigint"`
	ActiveUntilAt       *int64 `gorm:"type:bigint;index:idx_cus_expiry,priority:2"`
	EndedAt             *int64 `gorm:"type:bigint"`
	CreatedAt           int64  `gorm:"type:bigint;autoCreateTime:milli"`
	UpdatedAt           int64  `gorm:"type:bigint;autoUpdateTime:milli"`
}

type CustomUserSubscriptionState struct {
	UserId               int64  `gorm:"type:bigint;primaryKey;autoIncrement:false"`
	ActiveSubscriptionId *int64 `gorm:"type:bigint"`
	ReconciledAt         int64  `gorm:"type:bigint;not null"`
	Version              int64  `gorm:"type:bigint;not null"`
	UpdatedAt            int64  `gorm:"type:bigint;autoUpdateTime:milli"`
}

type CustomSubscriptionEvent struct {
	Id                    int64  `gorm:"primaryKey;index:idx_cse_subscription_time,priority:3"`
	UserId                int64  `gorm:"type:bigint;not null;index:idx_cse_user"`
	SubscriptionId        int64  `gorm:"type:bigint;not null;index:idx_cse_subscription_time,priority:1"`
	EventType             string `gorm:"type:varchar(32);not null"`
	FromStatus            string `gorm:"type:varchar(32);not null"`
	ToStatus              string `gorm:"type:varchar(32);not null"`
	EffectiveAt           int64  `gorm:"type:bigint;not null;index:idx_cse_subscription_time,priority:2"`
	RecordedAt            int64  `gorm:"type:bigint;not null"`
	RemainingBeforeMs     int64  `gorm:"type:bigint;not null"`
	RemainingAfterMs      int64  `gorm:"type:bigint;not null"`
	RelatedSubscriptionId *int64 `gorm:"type:bigint"`
	OperationKey          string `gorm:"type:varchar(96);not null;uniqueIndex:idx_cse_operation"`
}

type CustomUserSubscriptionView struct {
	ActiveSubscriptionID *int64
	ObservedAt           int64
	Subscriptions        []CustomUserSubscription
}

var (
	ErrCustomSubscriptionOrderNotFound = errors.New("Custom subscription order not found")
	ErrCustomSubscriptionOrderInvalid  = errors.New("Custom subscription order cannot be fulfilled")
	ErrCustomUserSubscriptionNotFound  = errors.New("User subscription not found")
	ErrCustomSubscriptionStateInvalid  = errors.New("Custom subscription state is inconsistent")
	ErrCustomSubscriptionTimeInvalid   = errors.New("Custom subscription time is invalid")
)

const CustomSubscriptionFulfillmentComplete = "fulfilled"

// A cycle is fixed elapsed time, not calendar arithmetic. In particular a year
// is 365 days, never the 360 days obtained by multiplying twelve monthly cycles.
func customSubscriptionDurationMs(cycle string, months int) (int64, error) {
	switch {
	case cycle == "month" && months == 1:
		return int64(30 * 24 * time.Hour / time.Millisecond), nil
	case cycle == "year" && months == 12:
		return int64(365 * 24 * time.Hour / time.Millisecond), nil
	default:
		return 0, ErrCustomSubscriptionOrderInvalid
	}
}

type customSubscriptionSchedule struct {
	tx            *gorm.DB
	state         CustomUserSubscriptionState
	subscriptions []CustomUserSubscription
	now           int64
	eventSequence int
}

// The first SQL statements write the user anchor before reading any schedule.
// This obtains SQLite's writer lock as well as serializing MySQL/PostgreSQL
// callers, including two concurrent first purchases for the same user.
func customSubscriptionTransaction(userID int64, clock func() int64, action func(*customSubscriptionSchedule) error) error {
	if userID <= 0 {
		return ErrCustomSubscriptionStateInvalid
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		state := CustomUserSubscriptionState{UserId: userID}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&state).Error; err != nil {
			return err
		}
		result := tx.Model(&CustomUserSubscriptionState{}).Where("user_id = ? AND version < ?", userID, int64(math.MaxInt64)).UpdateColumn("version", gorm.Expr("version + 1"))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrCustomSubscriptionStateInvalid
		}
		if err := lockForUpdate(tx).Where("user_id = ?", userID).First(&state).Error; err != nil {
			return err
		}
		now := max(clock(), state.ReconciledAt)
		if now <= 0 {
			return ErrCustomSubscriptionTimeInvalid
		}
		schedule := customSubscriptionSchedule{tx: tx, state: state, now: now}
		if err := tx.Where("user_id = ? AND status IN ?", userID, []string{"active", "paused"}).Order("priority DESC, purchased_at ASC, id ASC").Find(&schedule.subscriptions).Error; err != nil {
			return err
		}
		if err := schedule.reconcile(); err != nil {
			return err
		}
		if action != nil {
			if err := action(&schedule); err != nil {
				return err
			}
		}
		return tx.Model(&CustomUserSubscriptionState{}).Where("user_id = ?", userID).Updates(map[string]any{"active_subscription_id": schedule.state.ActiveSubscriptionId, "reconciled_at": now, "updated_at": now}).Error
	})
}

func (s *customSubscriptionSchedule) activeIndex() (int, error) {
	index := -1
	for i := range s.subscriptions {
		sub := &s.subscriptions[i]
		if sub.Status == "expired" || sub.Status == "cancelled" {
			continue
		}
		if sub.RemainingDurationMs <= 0 || sub.RemainingDurationMs > sub.TotalDurationMs {
			return -1, ErrCustomSubscriptionStateInvalid
		}
		switch sub.Status {
		case "active":
			if index != -1 || s.state.ActiveSubscriptionId == nil || *s.state.ActiveSubscriptionId != sub.Id || sub.ActiveSinceAt == nil || sub.ActiveUntilAt == nil || *sub.ActiveSinceAt <= 0 || *sub.ActiveUntilAt <= *sub.ActiveSinceAt || *sub.ActiveUntilAt-*sub.ActiveSinceAt != sub.RemainingDurationMs || sub.FirstActivatedAt == nil {
				return -1, ErrCustomSubscriptionStateInvalid
			}
			index = i
		case "paused":
			if sub.ActiveSinceAt != nil || sub.ActiveUntilAt != nil {
				return -1, ErrCustomSubscriptionStateInvalid
			}
		default:
			return -1, ErrCustomSubscriptionStateInvalid
		}
	}
	if index == -1 && s.state.ActiveSubscriptionId != nil {
		return -1, ErrCustomSubscriptionStateInvalid
	}
	return index, nil
}

func (s *customSubscriptionSchedule) bestIndex() int {
	best := -1
	for i := range s.subscriptions {
		sub := &s.subscriptions[i]
		if sub.Status != "paused" && sub.Status != "active" {
			continue
		}
		if best == -1 {
			best = i
			continue
		}
		other := &s.subscriptions[best]
		if sub.Priority > other.Priority || sub.Priority == other.Priority && (sub.PurchasedAt < other.PurchasedAt || sub.PurchasedAt == other.PurchasedAt && sub.Id < other.Id) {
			best = i
		}
	}
	return best
}

func (s *customSubscriptionSchedule) transition(index int, event, to string, effective int64, related *int64) error {
	sub := &s.subscriptions[index]
	from := sub.Status
	before := sub.RemainingDurationMs
	switch to {
	case "active":
		if sub.Status != "paused" || sub.RemainingDurationMs <= 0 {
			return ErrCustomSubscriptionStateInvalid
		}
		if effective <= 0 || effective > math.MaxInt64-sub.RemainingDurationMs {
			return ErrCustomSubscriptionTimeInvalid
		}
		end := effective + sub.RemainingDurationMs
		sub.ActiveSinceAt = &effective
		sub.ActiveUntilAt = &end
		if sub.FirstActivatedAt == nil {
			sub.FirstActivatedAt = &effective
		}
		s.state.ActiveSubscriptionId = &sub.Id
	case "paused":
		if sub.ActiveUntilAt == nil || *sub.ActiveUntilAt <= effective {
			return ErrCustomSubscriptionStateInvalid
		}
		sub.RemainingDurationMs = *sub.ActiveUntilAt - effective
		sub.ActiveSinceAt = nil
		sub.ActiveUntilAt = nil
		s.state.ActiveSubscriptionId = nil
	case "expired", "cancelled":
		if sub.Status == "active" {
			if sub.ActiveUntilAt == nil {
				return ErrCustomSubscriptionStateInvalid
			}
			before = max(0, *sub.ActiveUntilAt-effective)
			s.state.ActiveSubscriptionId = nil
		}
		sub.RemainingDurationMs = 0
		sub.ActiveSinceAt = nil
		sub.ActiveUntilAt = nil
		sub.EndedAt = &effective
	default:
		return ErrCustomSubscriptionStateInvalid
	}
	sub.Status = to
	sub.UpdatedAt = s.now
	if err := s.tx.Model(&CustomUserSubscription{}).Where("id = ? AND user_id = ?", sub.Id, sub.UserId).Updates(map[string]any{"status": sub.Status, "remaining_duration_ms": sub.RemainingDurationMs, "first_activated_at": sub.FirstActivatedAt, "active_since_at": sub.ActiveSinceAt, "active_until_at": sub.ActiveUntilAt, "ended_at": sub.EndedAt, "updated_at": s.now}).Error; err != nil {
		return err
	}
	s.eventSequence++
	record := CustomSubscriptionEvent{UserId: sub.UserId, SubscriptionId: sub.Id, EventType: event, FromStatus: from, ToStatus: to, EffectiveAt: effective, RecordedAt: s.now, RemainingBeforeMs: before, RemainingAfterMs: sub.RemainingDurationMs, RelatedSubscriptionId: related, OperationKey: fmt.Sprintf("%d:%d:%d", sub.UserId, s.state.Version, s.eventSequence)}
	return s.tx.Create(&record).Error
}

func (s *customSubscriptionSchedule) activate(index int, at int64) error {
	event := "resume"
	if s.subscriptions[index].FirstActivatedAt == nil {
		event = "activate"
	}
	return s.transition(index, event, "active", at, nil)
}

func (s *customSubscriptionSchedule) reconcile() error {
	active, err := s.activeIndex()
	if err != nil {
		return err
	}
	if active == -1 {
		if s.bestIndex() != -1 {
			return ErrCustomSubscriptionStateInvalid
		}
		return nil
	}
	for *s.subscriptions[active].ActiveUntilAt <= s.now {
		boundary := *s.subscriptions[active].ActiveUntilAt
		if err := s.transition(active, "expire", "expired", boundary, nil); err != nil {
			return err
		}
		next := s.bestIndex()
		if next == -1 {
			return nil
		}
		if err := s.activate(next, boundary); err != nil {
			return err
		}
		active = next
	}
	return nil
}

func (s *customSubscriptionSchedule) selectCurrent() error {
	active, err := s.activeIndex()
	if err != nil {
		return err
	}
	best := s.bestIndex()
	if best == active {
		return nil
	}
	if active != -1 {
		if err := s.transition(active, "pause", "paused", s.now, &s.subscriptions[best].Id); err != nil {
			return err
		}
	}
	if best != -1 {
		return s.activate(best, s.now)
	}
	return nil
}

// FulfillCustomSubscriptionOrder grants service time for an already verified
// successful order. It never marks an unpaid order successful or credits points.
func FulfillCustomSubscriptionOrder(orderID int64) (*CustomUserSubscription, error) {
	return fulfillCustomSubscriptionOrder(orderID, func() int64 { return time.Now().UnixMilli() })
}

func fulfillCustomSubscriptionOrderAt(orderID, now int64) (*CustomUserSubscription, error) {
	return fulfillCustomSubscriptionOrder(orderID, func() int64 { return now })
}

func fulfillCustomSubscriptionOrder(orderID int64, clock func() int64) (*CustomUserSubscription, error) {
	if orderID <= 0 {
		return nil, ErrCustomSubscriptionOrderNotFound
	}
	var owner CustomSubscriptionOrder
	if err := DB.Select("id", "user_id").First(&owner, orderID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCustomSubscriptionOrderNotFound
		}
		return nil, err
	}
	var result *CustomUserSubscription
	err := customSubscriptionTransaction(owner.UserId, clock, func(s *customSubscriptionSchedule) error {
		var err error
		result, err = s.fulfillOrder(orderID)
		return err
	})
	return result, err
}

// fulfillOrder shares the schedule transaction with payment and point credits.
func (s *customSubscriptionSchedule) fulfillOrder(orderID int64) (*CustomUserSubscription, error) {
	var result CustomUserSubscription
	var order CustomSubscriptionOrder
	if err := lockForUpdate(s.tx).First(&order, orderID).Error; err != nil {
		return nil, err
	}
	if order.UserId != s.state.UserId {
		return nil, ErrCustomSubscriptionOrderInvalid
	}
	existing := s.tx.Where("order_id = ?", orderID).Limit(1).Find(&result)
	if existing.Error != nil {
		return nil, existing.Error
	}
	if existing.RowsAffected > 0 {
		if order.FulfillmentStatus != CustomSubscriptionFulfillmentComplete || order.FulfilledAt == nil || result.UserId != s.state.UserId {
			return nil, ErrCustomSubscriptionStateInvalid
		}
		return &result, nil
	}
	duration, err := customSubscriptionDurationMs(order.BillingCycle, order.DurationMonths)
	if err != nil {
		return nil, err
	}
	if order.Status != common.TopUpStatusSuccess || order.PaidAt == nil || *order.PaidAt <= 0 || *order.PaidAt > s.now || order.PlanId <= 0 || order.PlanVersion <= 0 || order.Priority < 0 || order.Priority > math.MaxInt32 || order.AmountDueMinor <= 0 || order.AmountPaidMinor < order.AmountDueMinor || order.RefundedAmountMinor != 0 || order.FulfilledAt != nil || order.FulfillmentStatus == CustomSubscriptionFulfillmentComplete {
		return nil, ErrCustomSubscriptionOrderInvalid
	}
	var snapshot map[string]common.RawMessage
	if common.UnmarshalJsonStr(order.PlanSnapshot, &snapshot) != nil || snapshot == nil {
		return nil, ErrCustomSubscriptionOrderInvalid
	}
	result = CustomUserSubscription{UserId: order.UserId, OrderId: order.Id, PlanId: order.PlanId, PlanVersion: order.PlanVersion, PlanSnapshot: order.PlanSnapshot, Priority: order.Priority, BillingCycle: order.BillingCycle, DurationMonths: order.DurationMonths, TotalDurationMs: duration, RemainingDurationMs: duration, Status: "paused", PurchasedAt: *order.PaidAt, CreatedAt: s.now, UpdatedAt: s.now}
	if err := s.tx.Create(&result).Error; err != nil {
		return nil, err
	}
	s.subscriptions = append(s.subscriptions, result)
	if err := s.selectCurrent(); err != nil {
		return nil, err
	}
	if err := s.tx.Model(&CustomSubscriptionOrder{}).Where("id = ?", orderID).Updates(map[string]any{"fulfillment_status": CustomSubscriptionFulfillmentComplete, "fulfilled_at": s.now, "updated_at": s.now}).Error; err != nil {
		return nil, err
	}
	return &result, s.tx.First(&result, result.Id).Error
}

func ReconcileCustomUserSubscriptions(userID int64) error {
	return customSubscriptionTransaction(userID, func() int64 { return time.Now().UnixMilli() }, nil)
}

func reconcileCustomUserSubscriptionsAt(userID, now int64) error {
	return customSubscriptionTransaction(userID, func() int64 { return now }, nil)
}

func GetCustomUserSubscriptions(userID int64) (*CustomUserSubscriptionView, error) {
	return getCustomUserSubscriptions(userID, func() int64 { return time.Now().UnixMilli() })
}

func getCustomUserSubscriptionsAt(userID, now int64) (*CustomUserSubscriptionView, error) {
	return getCustomUserSubscriptions(userID, func() int64 { return now })
}

func getCustomUserSubscriptions(userID int64, clock func() int64) (*CustomUserSubscriptionView, error) {
	view := CustomUserSubscriptionView{Subscriptions: []CustomUserSubscription{}}
	err := customSubscriptionTransaction(userID, clock, func(s *customSubscriptionSchedule) error {
		view.ActiveSubscriptionID = s.state.ActiveSubscriptionId
		view.ObservedAt = s.now
		if err := s.tx.Where("user_id = ?", userID).Order("priority DESC, purchased_at ASC, id ASC").Find(&view.Subscriptions).Error; err != nil {
			return err
		}
		for i := range view.Subscriptions {
			sub := &view.Subscriptions[i]
			if sub.Status == "active" {
				sub.RemainingDurationMs = *sub.ActiveUntilAt - s.now
			}
		}
		return nil
	})
	return &view, err
}

func ExpireDueCustomSubscriptions(limit int) (int, error) {
	return expireDueCustomSubscriptions(limit, func() int64 { return time.Now().UnixMilli() })
}

func expireDueCustomSubscriptionsAt(limit int, now int64) (int, error) {
	return expireDueCustomSubscriptions(limit, func() int64 { return now })
}

func expireDueCustomSubscriptions(limit int, clock func() int64) (int, error) {
	if limit <= 0 || limit > 10000 {
		return 0, ErrCustomSubscriptionStateInvalid
	}
	var due []CustomUserSubscription
	if err := DB.Select("user_id").Where("status = ? AND active_until_at <= ?", "active", clock()).Order("active_until_at ASC, id ASC").Limit(limit).Find(&due).Error; err != nil {
		return 0, err
	}
	processed := 0
	for _, sub := range due {
		if err := customSubscriptionTransaction(sub.UserId, clock, nil); err != nil {
			return processed, err
		}
		processed++
	}
	return processed, nil
}

func CancelCustomUserSubscription(userID, subscriptionID int64) error {
	return cancelCustomUserSubscription(userID, subscriptionID, func() int64 { return time.Now().UnixMilli() })
}

func cancelCustomUserSubscriptionAt(userID, subscriptionID, now int64) error {
	return cancelCustomUserSubscription(userID, subscriptionID, func() int64 { return now })
}

func cancelCustomUserSubscription(userID, subscriptionID int64, clock func() int64) error {
	return customSubscriptionTransaction(userID, clock, func(s *customSubscriptionSchedule) error {
		for i := range s.subscriptions {
			if s.subscriptions[i].Id != subscriptionID {
				continue
			}
			if s.subscriptions[i].Status == "expired" || s.subscriptions[i].Status == "cancelled" {
				return nil
			}
			if err := s.transition(i, "cancel", "cancelled", s.now, nil); err != nil {
				return err
			}
			return s.selectCurrent()
		}
		var count int64
		if err := s.tx.Model(&CustomUserSubscription{}).Where("id = ? AND user_id = ? AND status IN ?", subscriptionID, userID, []string{"expired", "cancelled"}).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			return ErrCustomUserSubscriptionNotFound
		}
		return nil
	})
}
