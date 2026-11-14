package service

import (
	"context"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
)

type pointsBillingRecoveryHandler struct{}

func (pointsBillingRecoveryHandler) Type() string { return "model_points_recovery" }
func (pointsBillingRecoveryHandler) Enabled() bool {
	return model.DB != nil && model.DB.Migrator().HasTable(&model.PointCallBilling{})
}
func (pointsBillingRecoveryHandler) Interval() time.Duration { return time.Minute }
func (pointsBillingRecoveryHandler) NewPayload() any         { return nil }
func (pointsBillingRecoveryHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	count, err := model.ReconcilePointCallEffects(ctx, 100)
	status, message := model.SystemTaskStatusSucceeded, ""
	if err != nil {
		status = model.SystemTaskStatusFailed
		message = err.Error()
	}
	var uncertain int64
	// Ambiguous upstream dispatch must never be treated as proof of no usage.
	// This diagnostic is actionable via existing system task results and SQL audit.
	if err == nil {
		err = model.DB.WithContext(ctx).Model(&model.PointCallBilling{}).Where("state = ? AND dispatch = ? AND updated_at < ?", "reserved", "dispatching", time.Now().Add(-10*time.Minute).UnixMilli()).Count(&uncertain).Error
		if err != nil {
			status = model.SystemTaskStatusFailed
			message = err.Error()
		}
	}
	if err := model.FinishSystemTask(task.TaskID, runnerID, status, map[string]any{"effects_processed": count, "uncertain_dispatches": uncertain}, message); err != nil {
		logger.LogError(ctx, common.LogText("points recovery task finalization failed: %s", err.Error()))
	}
}
func init() { RegisterSystemTaskHandler(pointsBillingRecoveryHandler{}) }
