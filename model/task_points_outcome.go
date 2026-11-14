package model

import (
	"bytes"
	"context"
	"errors"
	"math"
	"reflect"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var (
	ErrStaleTaskOutcome                   = errors.New("task billing outcome has changed")
	ErrPointsTaskConditionalWriteRequired = errors.New("points task requires a conditional outcome or transactional billing update")
)

// BeforeCreate marks only newly submitted points tasks. Existing tasks remain
// version zero and retain their original funding and status transition rules.
func (t *Task) BeforeCreate(_ *gorm.DB) error {
	if t.PrivateData.PointsBillingID != "" && t.OutcomeVersion == 0 {
		t.OutcomeVersion = 1
	}
	return nil
}

// TryClaimPointsTaskPoll fences every upstream read that can publish a points
// task outcome. Times are Unix milliseconds. Legacy tasks keep their old path.
func TryClaimPointsTaskPoll(t *Task, now, leaseUntil int64) (bool, error) {
	return claimPointsTaskPoll(t, now, leaseUntil, false)
}

// TryClaimPointsTaskCorrection is reserved for a fresh authoritative re-fetch
// of a successful terminal task. A failed/refunded task cannot be reopened.
func TryClaimPointsTaskCorrection(t *Task, now, leaseUntil int64) (bool, error) {
	return claimPointsTaskPoll(t, now, leaseUntil, true)
}

func claimPointsTaskPoll(t *Task, now, leaseUntil int64, correction bool) (bool, error) {
	if t.PrivateData.PointsBillingID == "" {
		return true, nil
	}
	if now < 0 || leaseUntil <= now || t.PollFence == math.MaxInt64 {
		return false, errors.New("invalid task poll lease")
	}
	query := DB.Model(&Task{}).Where("id = ? AND outcome_version = ? AND poll_fence = ? AND poll_lease_until <= ?",
		t.ID, t.OutcomeVersion, t.PollFence, now)
	if correction {
		query = query.Where("status = ?", TaskStatusSuccess)
	} else {
		query = query.Where("status NOT IN ?", []TaskStatus{TaskStatusSuccess, TaskStatusFailure})
	}
	result := query.Updates(map[string]any{"poll_fence": t.PollFence + 1, "poll_lease_until": leaseUntil})
	if result.Error != nil || result.RowsAffected != 1 {
		return false, result.Error
	}
	t.PollFence++
	t.PollLeaseUntil = leaseUntil
	return true, nil
}

// ReleasePointsTaskPoll cannot release another process's newer lease.
func ReleasePointsTaskPoll(t *Task) error {
	if t.PrivateData.PointsBillingID == "" {
		return nil
	}
	return DB.Model(&Task{}).Where("id = ? AND poll_fence = ? AND outcome_version = ?", t.ID, t.PollFence, t.OutcomeVersion).
		Update("poll_lease_until", 0).Error
}

// AcceptPointsTaskCorrection publishes only the result of a fresh, fenced
// correction fetch. The caller must not construct corrections from a scanned
// or cached task snapshot. Ordinary polling never calls this entry point.
func (t *Task) AcceptPointsTaskCorrection() (bool, error) {
	return updatePointsTaskOutcome(t, TaskStatusSuccess, true)
}

func updatePointsTaskOutcome(t *Task, fromStatus TaskStatus, correction bool) (bool, error) {
	won := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		var current Task
		if err := lockForUpdate(tx).First(&current, t.ID).Error; err != nil {
			return err
		}
		if current.PrivateData.PointsBillingID != t.PrivateData.PointsBillingID ||
			current.Status != fromStatus || current.OutcomeVersion != t.OutcomeVersion || current.PollFence != t.PollFence {
			return nil
		}
		terminal := current.Status == TaskStatusSuccess || current.Status == TaskStatusFailure
		if terminal && (!correction || current.Status != TaskStatusSuccess || t.Status != TaskStatusSuccess) {
			return nil
		}
		if correction && (!terminal || t.PollLeaseUntil == 0 || t.PrivateData.PointsOutcome == nil) {
			return nil
		}
		if t.PollLeaseUntil != 0 && (current.PollLeaseUntil != t.PollLeaseUntil || current.PollLeaseUntil <= time.Now().UnixMilli()) {
			return nil
		}
		if current.OutcomeVersion == math.MaxInt64 || current.PollFence == math.MaxInt64 {
			return errors.New("task outcome version overflow")
		}
		if correction {
			before, err := common.Marshal(current.PrivateData.PointsOutcome)
			if err != nil {
				return err
			}
			after, err := common.Marshal(t.PrivateData.PointsOutcome)
			if err != nil {
				return err
			}
			var beforeData, afterData any
			dataEqual := bytes.Equal(current.Data, t.Data)
			if !dataEqual && common.Unmarshal(current.Data, &beforeData) == nil && common.Unmarshal(t.Data, &afterData) == nil {
				dataEqual = reflect.DeepEqual(beforeData, afterData)
			}
			if bytes.Equal(before, after) && dataEqual {
				// A repeated fresh response does not create a new financial event.
				return nil
			}
		}
		// Preserve immutable billing provenance and the latest financial marker.
		private := current.PrivateData
		private.ResultURL = t.PrivateData.ResultURL
		private.PluginState = t.PrivateData.PluginState
		private.PollFailures = t.PrivateData.PollFailures
		private.PointsOutcome = t.PrivateData.PointsOutcome
		var data any
		if len(t.Data) != 0 {
			data = string(t.Data)
			if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
				data = []byte(t.Data)
			}
		}
		updates := map[string]any{
			"status": t.Status, "progress": t.Progress, "fail_reason": t.FailReason,
			"submit_time": t.SubmitTime, "start_time": t.StartTime, "finish_time": t.FinishTime,
			"data": data, "private_data": private,
			"outcome_version": current.OutcomeVersion + 1, "poll_fence": current.PollFence + 1,
			"poll_lease_until": 0, "settlement_retry_at": 0, "updated_at": time.Now().Unix(),
		}
		result := tx.Model(&Task{}).Where("id = ? AND outcome_version = ? AND poll_fence = ?",
			t.ID, current.OutcomeVersion, current.PollFence).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrStaleTaskOutcome
		}
		t.PrivateData = private
		t.Quota = current.Quota
		t.AppliedOutcomeVersion = current.AppliedOutcomeVersion
		t.OutcomeVersion = current.OutcomeVersion + 1
		t.PollFence = current.PollFence + 1
		t.PollLeaseUntil = 0
		won = true
		return nil
	})
	return won, err
}

// LockPointsTaskBilling runs inside the primary financial transaction, after
// locking user/call and before token/accounts. No task-lock holder may call
// the financial service while retaining its own transaction.
func LockPointsTaskBilling(tx *gorm.DB, taskID, expectedOutcomeVersion int64) (*Task, error) {
	var task Task
	if err := lockForUpdate(tx).First(&task, taskID).Error; err != nil {
		return nil, err
	}
	if task.PrivateData.PointsBillingID == "" || task.OutcomeVersion != expectedOutcomeVersion {
		return nil, ErrStaleTaskOutcome
	}
	return &task, nil
}

// CommitPointsTaskBilling advances the financial marker in the same tx as
// money, token and points; it never overwrites accepted outcome facts.
func CommitPointsTaskBilling(tx *gorm.DB, task *Task, quota int) error {
	if quota < 0 || task.PrivateData.PointsBillingID == "" {
		return errors.New("invalid points task billing target")
	}
	result := tx.Model(&Task{}).Where("id = ? AND outcome_version = ?", task.ID, task.OutcomeVersion).
		Updates(map[string]any{"quota": quota, "applied_outcome_version": task.OutcomeVersion})
	if result.Error != nil {
		return result.Error
	}
	// MySQL may report zero changed rows for an acknowledged equal target.
	if result.RowsAffected == 0 {
		var current Task
		if err := tx.First(&current, task.ID).Error; err != nil {
			return err
		}
		if current.OutcomeVersion != task.OutcomeVersion || current.Quota != quota || current.AppliedOutcomeVersion != task.OutcomeVersion {
			return ErrStaleTaskOutcome
		}
	}
	task.Quota = quota
	task.AppliedOutcomeVersion = task.OutcomeVersion
	return nil
}

// A durable retry lease gives later known outcomes a turn even when an earlier
// batch cannot settle, and prevents concurrent recovery workers claiming the
// same outcome. Uncertain nonterminal dispatches are deliberately excluded.
func GetPointsTasksPendingSettlement(ctx context.Context, limit int) ([]*Task, error) {
	return claimPointsTaskSettlements(ctx, limit, time.Now().UnixMilli())
}

func claimPointsTaskSettlements(ctx context.Context, limit int, now int64) ([]*Task, error) {
	var tasks []*Task
	if limit <= 0 {
		return tasks, nil
	}
	if now < 0 || now > math.MaxInt64-60000 {
		return nil, errors.New("invalid task settlement lease")
	}
	err := DB.WithContext(ctx).Where("outcome_version > applied_outcome_version AND status IN ? AND settlement_retry_at <= ?", []TaskStatus{TaskStatusSuccess, TaskStatusFailure}, now).
		Order("settlement_retry_at ASC, id ASC").Limit(min(limit, 200)).Find(&tasks).Error
	if err != nil {
		return nil, err
	}
	claimed := make([]*Task, 0, len(tasks))
	for _, task := range tasks {
		result := DB.WithContext(ctx).Model(&Task{}).
			Where("id = ? AND outcome_version = ? AND applied_outcome_version < outcome_version AND settlement_retry_at <= ?", task.ID, task.OutcomeVersion, now).
			Update("settlement_retry_at", now+60000)
		if result.Error != nil {
			return nil, result.Error
		}
		if result.RowsAffected == 1 {
			task.SettlementRetryAt = now + 60000
			claimed = append(claimed, task)
		}
	}
	return claimed, nil
}

// GetPointsTaskOutcome reloads accepted facts for restart recovery or an
// optimistic target calculation subsequently checked in the financial tx.
func GetPointsTaskOutcome(ctx context.Context, id int64) (*Task, error) {
	var task Task
	if err := DB.WithContext(ctx).First(&task, id).Error; err != nil {
		return nil, err
	}
	return &task, nil
}

func enrichPointsTasks(tasks []*Task) error {
	ids := make([]string, 0, len(tasks))
	for _, task := range tasks {
		if task.PrivateData.PointsBillingID != "" {
			ids = append(ids, task.PrivateData.PointsBillingID)
		}
	}
	data, err := PointCallSummaries(ids)
	if err != nil {
		return err
	}
	for _, task := range tasks {
		task.PointsBilling = data[task.PrivateData.PointsBillingID]
		if task.PointsBilling != nil && (task.Status == TaskStatusSuccess || task.Status == TaskStatusFailure) && task.OutcomeVersion > task.AppliedOutcomeVersion {
			pending := *task.PointsBilling
			pending.Status = "pending"
			task.PointsBilling = &pending
		}
	}
	return nil
}

// SetTaskResponsesBackground merges the presentation flag into the latest
// private state, so a delayed submit response cannot erase accepted usage.
func SetTaskResponsesBackground(ctx context.Context, taskID int64) error {
	return DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var task Task
		if err := lockForUpdate(tx).First(&task, taskID).Error; err != nil {
			return err
		}
		if task.PrivateData.ResponsesBackground {
			return nil
		}
		task.PrivateData.ResponsesBackground = true
		return tx.Model(&Task{}).Where("id = ?", taskID).Update("private_data", task.PrivateData).Error
	})
}
