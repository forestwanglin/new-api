package service

import (
	"context"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func settlePointsTask(task *model.Task, target int, event string) (*model.PointBillingResult, error) {
	result, err := model.SetPointCallTarget(task.PrivateData.PointsBillingID, event, target, true, false, func(tx *gorm.DB, call *model.PointCallBilling) error {
		locked, err := model.LockPointsTaskBilling(tx, task.ID, task.OutcomeVersion)
		if err != nil {
			return err
		}
		if locked.PrivateData.PointsBillingID != call.ID || locked.UserId != call.UserID {
			return model.ErrPointCallConflict
		}
		return model.CommitPointsTaskBilling(tx, locked, target)
	})
	if err == nil {
		task.Quota = int(result.Call.BookedQuota)
		task.AppliedOutcomeVersion = task.OutcomeVersion
		model.SyncPointCallCaches(result.Call.UserID, result.Call.TokenID)
	}
	return result, err
}

// Submission quota and its financial marker commit together. A durable task
// remains recoverable if the transaction fails after upstream acceptance.
func SettleTaskSubmissionBilling(c *gin.Context, info *relaycommon.RelayInfo, task *model.Task, quota int) error {
	if task.PrivateData.PointsBillingID == "" {
		return SettleBilling(c, info, quota)
	}
	result, err := settlePointsTask(task, quota, fmt.Sprintf("%s:submit", task.PrivateData.PointsBillingID))
	if err != nil {
		return err
	}
	info.PointsBillingMetadata = &result.Metadata
	c.Set("points_billing", &result.Metadata)
	if s, ok := info.Billing.(*BillingSession); ok {
		s.mu.Lock()
		s.settled = true
		s.fundingSettled = true
		s.mu.Unlock()
	}
	return model.MarkPointCallDispatch(task.PrivateData.PointsBillingID, "submitted")
}
func adjustPointsTask(ctx context.Context, task *model.Task, target int, reason string) bool {
	result, err := settlePointsTask(task, target, fmt.Sprintf("%s:outcome:%d:%d", task.PrivateData.PointsBillingID, task.OutcomeVersion, target))
	if err != nil {
		logger.LogError(ctx, common.LogText("task points settlement pending, task %s: %s", task.TaskID, err.Error()))
		return false
	}
	if result.Replayed {
		return true
	}
	delta := int(result.QuotaDelta)
	if delta == 0 && result.Metadata.TotalPoints == "0" {
		return true
	}
	model.UpdateUserUsedQuota(task.UserId, delta)
	model.UpdateChannelUsedQuota(task.ChannelId, delta)
	logType, quota := model.LogTypeConsume, delta
	if delta < 0 {
		logType = model.LogTypeRefund
		quota = -delta
	}
	other := taskBillingOther(task)
	other.SetPublic("task_id", task.TaskID)
	other.SetPublic("reason", reason)
	other.SetPublic("points_billing", &result.Metadata)
	model.RecordTaskBillingLog(model.RecordTaskBillingLogParams{UserId: task.UserId, LogType: logType, ChannelId: task.ChannelId, ModelName: taskModelName(task), Quota: quota, TokenId: task.PrivateData.TokenId, Group: task.Group, Other: other, NodeName: task.PrivateData.NodeName})
	return true
}

func refundPointsMidjourney(ctx context.Context, task *model.Midjourney, reason string) bool {
	result, err := model.SetPointCallTarget(task.PointsBillingID, fmt.Sprintf("%s:mj-refund:%d", task.PointsBillingID, task.OutcomeVersion), 0, true, false, func(tx *gorm.DB, call *model.PointCallBilling) error {
		current, err := model.LockPointsMidjourneyBilling(tx, task.Id, task.OutcomeVersion)
		if err != nil {
			return err
		}
		if current.PointsBillingID != call.ID || current.UserId != call.UserID {
			return model.ErrPointCallConflict
		}
		return model.CommitPointsMidjourneyBilling(tx, current, 0)
	})
	if err != nil {
		logger.LogError(ctx, common.LogText("Midjourney points refund pending: %s", err.Error()))
		return false
	}
	task.Quota = 0
	task.AppliedOutcomeVersion = task.OutcomeVersion
	model.SyncPointCallCaches(result.Call.UserID, result.Call.TokenID)
	if result.Replayed {
		return true
	}
	delta := int(result.QuotaDelta)
	model.UpdateUserUsedQuota(task.UserId, delta)
	model.UpdateChannelUsedQuota(task.GetBillingChannelId(), delta)
	other := model.NewLogOther()
	other.SetPublic("points_billing", &result.Metadata)
	other.SetPublic("task_id", task.MjId)
	other.SetPublic("reason", reason)
	model.RecordTaskBillingLog(model.RecordTaskBillingLogParams{UserId: task.UserId, LogType: model.LogTypeRefund, ChannelId: task.GetBillingChannelId(), ModelName: CovertMjpActionToModelName(task.Action), Quota: -delta, TokenId: task.TokenId, Other: other})
	return true
}

// SettlePointsMidjourneyOutcome acknowledges the persisted, fenced outcome.
// Midjourney success retains its fixed submit price; failure reverses it once.
func SettlePointsMidjourneyOutcome(ctx context.Context, task *model.Midjourney) bool {
	if task.PointsBillingID == "" {
		return true
	}
	if task.Status == "FAILURE" || task.FailReason != "" {
		return refundPointsMidjourney(ctx, task, task.FailReason)
	}
	result, err := model.SetPointCallTarget(task.PointsBillingID, fmt.Sprintf("%s:mj-outcome:%d", task.PointsBillingID, task.OutcomeVersion), task.Quota, true, false, func(tx *gorm.DB, call *model.PointCallBilling) error {
		current, err := model.LockPointsMidjourneyBilling(tx, task.Id, task.OutcomeVersion)
		if err != nil {
			return err
		}
		if current.PointsBillingID != call.ID || current.UserId != call.UserID {
			return model.ErrPointCallConflict
		}
		return model.CommitPointsMidjourneyBilling(tx, current, task.Quota)
	})
	if err != nil {
		logger.LogError(ctx, common.LogText("Midjourney outcome points pending: %s", err.Error()))
		return false
	}
	model.SyncPointCallCaches(result.Call.UserID, result.Call.TokenID)
	task.AppliedOutcomeVersion = task.OutcomeVersion
	return true
}
