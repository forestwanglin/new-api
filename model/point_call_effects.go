package model

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// A synchronous outcome is durably staged before its financial transaction.
// Task outcomes use their existing persisted/versioned task state instead.
// A newer cumulative target supersedes older pending targets of the same kind.
// Fee/base are separate so failure refund cannot discard a due surcharge.
type PointCallOperation struct {
	ID        string `gorm:"primaryKey;type:varchar(128)"`
	CallID    string `gorm:"type:varchar(64);not null;index"`
	Target    int
	Final     bool
	Fee       bool
	State     string `gorm:"type:varchar(16);index"`
	RetryAt   int64  `gorm:"not null;default:0;index"`
	CreatedAt int64  `gorm:"autoCreateTime:milli;index"`
}

func stagePointCallTarget(id, event string, target int, final, fee bool) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		call, err := pointCallLock(tx, id)
		if err != nil {
			return err
		}
		var existing PointCallOperation
		err = tx.First(&existing, "id = ?", event).Error
		if err == nil {
			if existing.CallID != id || existing.Target != target || existing.Final != final || existing.Fee != fee {
				return ErrPointCallConflict
			}
			return nil
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}
		// Financial event replay wins even if an older binary created it without an intent.
		var count int64
		if err := tx.Model(&PointCallEvent{}).Where("id = ?", event).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return nil
		}
		if err := tx.Model(&PointCallOperation{}).Where("call_id = ? AND fee = ? AND state = ?", id, fee, "pending").Update("state", "superseded").Error; err != nil {
			return err
		}
		return tx.Create(&PointCallOperation{ID: event, CallID: call.ID, Target: target, Final: final, Fee: fee, State: "pending"}).Error
	})
}
func pointCallLogPayload(c *PointCallBilling, meta *PointBillingMetadata, quota int64) string {
	other := NewLogOther()
	other.SetPublic("points_billing", meta)
	other.SetPublic("model_call_request_id", c.ID)
	kind := LogTypeConsume
	if quota < 0 {
		kind = LogTypeRefund
		quota = -quota
	}
	log := Log{UserId: c.UserID, CreatedAt: time.Now().Unix(), Type: kind, ModelName: c.Model, Quota: int(quota), TokenId: c.TokenID, ChannelId: c.ChannelID, Group: c.Group, RequestId: pointEventRequestID(meta.EventID), Other: other.JSONString()}
	b, _ := common.Marshal(&log)
	return string(b)
}
func pointEventRequestID(event string) string {
	return fmt.Sprintf("%x", sha256.Sum256([]byte("model-points:"+event)))
}

// publishPointBillingLog serializes writers on the primary event row, gives
// the log a stable identity and verifies an existing insertion before replay.
// The log database never owns or rolls back the financial transaction.
func publishPointBillingLog(log *Log, meta *PointBillingMetadata) error {
	if meta == nil || meta.Status != "committed" || meta.EventID == "" || strings.HasSuffix(meta.EventID, ":free") {
		return LOG_DB.Create(log).Error
	}
	if log.RequestId != "" {
		var other map[string]any
		if common.UnmarshalJsonStr(log.Other, &other) == nil && other != nil {
			other["model_call_request_id"] = meta.CallID
			if payload, err := common.Marshal(other); err == nil {
				log.Other = string(payload)
			}
		}
	}
	log.RequestId = pointEventRequestID(meta.EventID)
	return DB.Transaction(func(tx *gorm.DB) error {
		if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
			if err := tx.Model(&PointCallEvent{}).Where("id = ?", meta.EventID).UpdateColumn("retry_at", gorm.Expr("retry_at")).Error; err != nil {
				return err
			}
		}
		var event PointCallEvent
		if err := lockForUpdate(tx).First(&event, "id = ? AND call_id = ?", meta.EventID, meta.CallID).Error; err != nil {
			return err
		}
		if event.LogState == "done" || event.LogState == "disabled" || event.LogState == "none" {
			return nil
		}
		// The log row contributes only this event's delta; Realtime final logs
		// must not repeat the cumulative charge already projected from segments.
		log.Quota = int(event.QuotaDelta)
		log.Type = LogTypeConsume
		if log.Quota < 0 {
			log.Type = LogTypeRefund
			log.Quota = -log.Quota
		}
		payload, err := common.Marshal(log)
		if err != nil {
			return err
		}
		if err := tx.Model(&PointCallEvent{}).Where("id = ?", event.ID).Update("log_payload", string(payload)).Error; err != nil {
			return err
		}
		if LOG_DB == nil {
			return nil
		}
		logDB := LOG_DB
		if logDB == DB {
			logDB = tx
		}
		var count int64
		if err := logDB.Model(&Log{}).Where("request_id = ? AND user_id = ?", log.RequestId, log.UserId).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			if err := logDB.Create(log).Error; err != nil {
				return err
			}
		}
		return tx.Model(&PointCallEvent{}).Where("id = ?", event.ID).Update("log_state", "done").Error
	})
}
func pointMetadataFromLog(log *Log) *PointBillingMetadata {
	if log == nil || !strings.Contains(log.Other, "points_billing") {
		return nil
	}
	var envelope struct {
		Points *PointBillingMetadata `json:"points_billing"`
	}
	if common.UnmarshalJsonStr(log.Other, &envelope) != nil {
		return nil
	}
	return envelope.Points
}

// ReconcilePointCallEffects is bounded and restart-safe. Uncertain dispatch
// reservations are reported, never released by elapsed time alone.
func ReconcilePointCallEffects(ctx context.Context, limit int) (int, error) {
	limit = min(max(limit, 1), 200)
	var operations []PointCallOperation
	if err := DB.WithContext(ctx).Where("state = ? AND retry_at <= ?", "pending", time.Now().UnixMilli()).Order("retry_at ASC, id ASC").Limit(limit).Find(&operations).Error; err != nil {
		return 0, err
	}
	done := 0
	for _, op := range operations {
		if ctx.Err() != nil {
			return done, ctx.Err()
		}
		claim := DB.WithContext(ctx).Model(&PointCallOperation{}).Where("id = ? AND state = ? AND retry_at = ?", op.ID, "pending", op.RetryAt).Update("retry_at", time.Now().Add(time.Minute).UnixMilli())
		if claim.Error != nil {
			return done, claim.Error
		}
		if claim.RowsAffected != 1 {
			continue
		}
		_, err := SetPointCallTarget(op.CallID, op.ID, op.Target, op.Final, op.Fee, nil)
		if err != nil {
			common.SysError(common.LogText("point call target remains pending (%s): %s", op.ID, err.Error()))
			continue
		}
		done++
	}
	var events []PointCallEvent
	if err := DB.WithContext(ctx).Where("(log_state = ? OR cache_state = ?) AND retry_at <= ?", "pending", "pending", time.Now().UnixMilli()).Order("retry_at ASC, id ASC").Limit(limit).Find(&events).Error; err != nil {
		return done, err
	}
	for _, event := range events {
		if ctx.Err() != nil {
			return done, ctx.Err()
		}
		claim := DB.WithContext(ctx).Model(&PointCallEvent{}).Where("id = ? AND retry_at = ? AND (log_state = ? OR cache_state = ?)", event.ID, event.RetryAt, "pending", "pending").Update("retry_at", time.Now().Add(time.Minute).UnixMilli())
		if claim.Error != nil {
			return done, claim.Error
		}
		if claim.RowsAffected != 1 {
			continue
		}
		call, err := GetPointCall(event.CallID)
		if err != nil {
			continue
		}
		if err := SyncPointCallCaches(call.UserID, call.TokenID); err == nil {
			if err := DB.WithContext(ctx).Model(&PointCallEvent{}).Where("id = ?", event.ID).Update("cache_state", "done").Error; err != nil {
				return done, err
			}
		}
		if event.LogState != "pending" {
			continue
		}
		if !common.LogConsumeEnabled {
			if err := DB.Model(&PointCallEvent{}).Where("id = ? AND log_state = ?", event.ID, "pending").Update("log_state", "disabled").Error; err != nil {
				return done, err
			}
			continue
		}
		var log Log
		if event.LogPayload == "" || common.UnmarshalJsonStr(event.LogPayload, &log) != nil {
			continue
		}
		meta := pointMetadataFromLog(&log)
		if err := publishPointBillingLog(&log, meta); err != nil {
			common.SysError(common.LogText("point call log remains pending (%s): %s", event.ID, err.Error()))
			continue
		}
		done++
	}
	return done, nil
}

// PointCallSummaries batches safe cumulative projections for task/drawing lists.
// It never exposes conversion, eligibility, account or frozen-state snapshots.
func PointCallSummaries(ids []string) (map[string]*PointBillingMetadata, error) {
	out := map[string]*PointBillingMetadata{}
	if len(ids) == 0 {
		return out, nil
	}
	var calls []PointCallBilling
	if err := DB.Where("id IN ?", ids).Find(&calls).Error; err != nil {
		return nil, err
	}
	for _, call := range calls {
		a, err := pointCallDecode(&call)
		if err != nil {
			return nil, err
		}
		m := &PointBillingMetadata{Version: 1, CallID: call.ID, EventID: call.ID + ":summary", Status: "committed", TotalPoints: fmt.Sprint(call.Points), Items: []PointBillingItem{}}
		if call.State == "reserved" {
			m.Status = "pending"
		}
		for _, v := range a {
			if v.Charged != 0 {
				m.Items = append(m.Items, PointBillingItem{PointTypeID: fmt.Sprint(v.TypeID), Code: v.Code, Name: v.Name, Points: fmt.Sprint(v.Charged)})
			}
		}
		out[call.ID] = m
	}
	return out, nil
}

func EnrichPointsMidjourney(tasks []*Midjourney) error {
	ids := make([]string, 0, len(tasks))
	for _, task := range tasks {
		if task.PointsBillingID != "" {
			ids = append(ids, task.PointsBillingID)
		}
	}
	data, err := PointCallSummaries(ids)
	if err != nil {
		return err
	}
	for _, task := range tasks {
		task.PointsBilling = data[task.PointsBillingID]
		if task.PointsBilling != nil && (task.Status == "SUCCESS" || task.Status == "FAILURE") && task.OutcomeVersion > task.AppliedOutcomeVersion {
			pending := *task.PointsBilling
			pending.Status = "pending"
			task.PointsBilling = &pending
		}
	}
	return nil
}
