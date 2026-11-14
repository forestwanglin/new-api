package service

import (
	"context"
	"math"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/tidwall/gjson"
)

// Ark Seedance video tasks (doubao-seedance-*) are priced by the upstream
// billing tokens the poll already stores on the task. When the terminal poll is
// served without those tokens — for example by an instance that still runs the
// previous plugin during a rolling deploy — the reservation is never settled and
// the task keeps the pre-consumed quota. This pass re-settles such tasks from the
// persisted usage block, so a missed settlement is corrected instead of
// over-charging the caller forever.
const arkSeedanceModelPrefix = "doubao-seedance-"

// arkSeedanceDurationRatioKey is the sora plugin's per-second ratio. Ark
// Seedance prices already cover the whole video, so the ratio was removed from
// the plugin's billing view; tasks submitted before that change still carry it
// in their frozen billing context and must not have it re-applied.
const arkSeedanceDurationRatioKey = "seconds"

// Reconciliation window bounds. The lookback keeps each pass cheap; the grace
// period avoids racing the poller that owns the terminal transition, and the
// batch caps how many tasks one run settles.
const (
	arkSeedanceReconcileLookbackSeconds = 24 * 60 * 60
	arkSeedanceReconcileGraceSeconds    = 10 * 60
	arkSeedanceReconcileBatchSize       = 200
)

// TaskBillingReconcileSummary is recorded on the system task row so operators
// can see what one pass examined and changed.
type TaskBillingReconcileSummary struct {
	Scanned       int   `json:"scanned"`
	Eligible      int   `json:"eligible"`
	Settled       int   `json:"settled"`
	AdjustedQuota int64 `json:"adjusted_quota"`
	Failed        int   `json:"failed"`
	Skipped       int   `json:"skipped"`
}

// ReconcileArkSeedanceTaskBillingOnce runs one reconciliation pass. It is safe
// to run repeatedly: RecalculateTaskQuota only moves the difference, so a task
// that already holds the settled quota is skipped without any side effect.
func ReconcileArkSeedanceTaskBillingOnce(ctx context.Context) (TaskBillingReconcileSummary, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	return reconcileArkSeedanceTaskBilling(ctx, time.Now().Unix())
}

func reconcileArkSeedanceTaskBilling(ctx context.Context, now int64) (TaskBillingReconcileSummary, error) {
	summary := TaskBillingReconcileSummary{}
	tasks, err := model.GetSettledTasksForBillingReconcile(now-arkSeedanceReconcileLookbackSeconds, arkSeedanceReconcileBatchSize)
	if err != nil {
		return summary, err
	}
	summary.Scanned = len(tasks)
	settleBefore := now - arkSeedanceReconcileGraceSeconds
	for _, task := range tasks {
		if ctx.Err() != nil {
			// The system task runner cancels the context when the lease is lost.
			return summary, ctx.Err()
		}
		if task.FinishTime == 0 || task.FinishTime > settleBefore {
			summary.Skipped++
			continue
		}
		if task.PrivateData.PointsBillingID != "" {
			if !strings.HasPrefix(strings.ToLower(taskModelName(task)), arkSeedanceModelPrefix) {
				summary.Skipped++
				continue
			}
			summary.Eligible++
			before := task.Quota
			if err := refreshPointsTaskOutcome(ctx, task); err != nil {
				summary.Failed++
				logger.LogWarn(ctx, common.LogText("failed to refresh points task billing outcome %s: %v", task.TaskID, err))
				continue
			}
			current, err := model.GetPointsTaskOutcome(ctx, task.ID)
			if err != nil || current.AppliedOutcomeVersion < current.OutcomeVersion {
				summary.Failed++
				continue
			}
			summary.Settled++
			summary.AdjustedQuota += int64(current.Quota - before)
			continue
		}
		actualQuota, ok := arkSeedanceActualQuota(task)
		if !ok || actualQuota == task.Quota {
			summary.Skipped++
			continue
		}
		summary.Eligible++
		preConsumedQuota := task.Quota
		RecalculateTaskQuota(ctx, task, actualQuota, common.NewMessage("Reconciled Ark Seedance billing from the stored upstream usage"))
		if task.Quota != actualQuota {
			summary.Failed++
			logger.LogWarn(ctx, common.LogText(
				"task billing reconcile could not settle the difference, task %s: actual=%d pre-consumed=%d",
				task.TaskID, actualQuota, preConsumedQuota,
			))
			continue
		}
		summary.Settled++
		summary.AdjustedQuota += int64(task.Quota - preConsumedQuota)
	}
	return summary, nil
}

// arkSeedanceActualQuota prices one finished Ark Seedance task from the usage
// the poll recorded. It mirrors RecalculateTaskQuotaByTokens for models whose
// carrier plugin reports upstream billing tokens, and deliberately excludes the
// duration ratio that only the pre-fix plugin produced.
func arkSeedanceActualQuota(task *model.Task) (int, bool) {
	if task == nil || task.UserId <= 0 {
		return 0, false
	}
	modelName := taskModelName(task)
	if !strings.HasPrefix(strings.ToLower(modelName), arkSeedanceModelPrefix) {
		return 0, false
	}
	billingContext := task.PrivateData.BillingContext
	if billingContext == nil {
		return 0, false
	}
	// Per-call prices settle at reservation time, and expression tasks settle
	// from their frozen snapshot; neither is re-priced here.
	if billingContext.PerCallBilling || billingContext.TieredSnapshot != nil {
		return 0, false
	}
	tokens := arkSeedanceBillingTokens(task)
	if tokens <= 0 {
		return 0, false
	}
	modelRatio, configured, _ := ratio_setting.GetModelRatio(modelName)
	if !configured || modelRatio <= 0 {
		return 0, false
	}
	group := task.Group
	if group == "" {
		if user, userErr := model.GetUserById(task.UserId, false); userErr == nil {
			group = user.Group
		}
	}
	if group == "" {
		return 0, false
	}
	groupRatio := ratio_setting.GetGroupRatio(group)
	if userGroupRatio, hasUserGroupRatio := ratio_setting.GetGroupGroupRatio(group, group); hasUserGroupRatio {
		groupRatio = userGroupRatio
	}
	actualQuota, _ := common.QuotaFromFloatChecked(float64(tokens) * modelRatio * groupRatio * arkSeedanceOtherMultiplier(billingContext))
	return actualQuota, true
}

// arkSeedanceBillingTokens reads the billing tokens the upstream usage block
// reports. Video output tokens are the billed quantity; total tokens is the
// fallback for gateways that only publish the total.
func arkSeedanceBillingTokens(task *model.Task) int {
	if task == nil || len(task.Data) == 0 {
		return 0
	}
	tokens := gjson.GetBytes(task.Data, "usage.completion_tokens").Int()
	if tokens <= 0 {
		tokens = gjson.GetBytes(task.Data, "usage.total_tokens").Int()
	}
	return clampReconcileTokens(tokens)
}

func clampReconcileTokens(value int64) int {
	if value <= 0 {
		return 0
	}
	if value > math.MaxInt32 {
		return math.MaxInt32
	}
	return int(value)
}

// arkSeedanceOtherMultiplier keeps the valid extra ratios a task froze at
// submit time, minus the duration ratio the plugin no longer returns.
func arkSeedanceOtherMultiplier(billingContext *model.TaskBillingContext) float64 {
	if billingContext == nil {
		return 1
	}
	multiplier := 1.0
	for key, ratio := range billingContext.OtherRatios {
		if key == arkSeedanceDurationRatioKey {
			continue
		}
		if math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio <= 0 {
			continue
		}
		multiplier *= ratio
	}
	return multiplier
}

// recoverPointsTaskSettlements replays accepted durable outcomes after a
// financial failure or process restart. It never fabricates a new outcome
// version from a stale scan, and remains part of the bounded async system task.
func recoverPointsTaskSettlements(ctx context.Context) {
	tasks, err := model.GetPointsTasksPendingSettlement(ctx, 200)
	if err != nil {
		logger.LogWarn(ctx, common.LogText("failed to read pending points task settlements: %v", err))
		return
	}
	for _, scanned := range tasks {
		if ctx.Err() != nil {
			return
		}
		task, reloadErr := model.GetPointsTaskOutcome(ctx, scanned.ID)
		if reloadErr != nil {
			logger.LogWarn(ctx, common.LogText("failed to reload points task %d: %v", scanned.ID, reloadErr))
			continue
		}
		if task.PrivateData.PointsBillingID == "" || task.AppliedOutcomeVersion >= task.OutcomeVersion {
			continue
		}
		settleAcceptedPointsTask(ctx, task)
	}
}

func settleAcceptedPointsTask(ctx context.Context, task *model.Task) {
	if task.Status == model.TaskStatusFailure {
		RefundTaskQuota(ctx, task, task.FailReason)
		return
	}
	if task.Status != model.TaskStatusSuccess {
		return
	}
	result := task.PrivateData.PointsOutcome
	if result == nil {
		// An immediate result with no measured facts retains its committed
		// estimate, matching the original missing-usage policy.
		RecalculateTaskQuota(ctx, task, task.Quota, common.NewMessage("Confirmed the task billing outcome"))
		return
	}
	var adaptor TaskPollingAdaptor
	if GetTaskAdaptorFunc != nil {
		adaptor = GetTaskAdaptorFunc(task.Platform)
	}
	if !settleTaskBillingOnComplete(ctx, adaptor, task, result) {
		RecalculateTaskQuota(ctx, task, task.Quota, common.NewMessage("Confirmed the task billing outcome"))
	}
}

// refreshPointsTaskOutcome performs a fresh, exclusively fenced upstream read
// for an explicit reconciliation correction. Stored scan data is never treated
// as newer authoritative evidence. Failed/refunded tasks are not reopened.
func refreshPointsTaskOutcome(ctx context.Context, scanned *model.Task) error {
	task, err := model.GetPointsTaskOutcome(ctx, scanned.ID)
	if err != nil {
		return err
	}
	if task.PrivateData.PointsBillingID == "" || task.Status != model.TaskStatusSuccess {
		return nil
	}
	if task.AppliedOutcomeVersion < task.OutcomeVersion {
		settleAcceptedPointsTask(ctx, task)
		return nil
	}
	if GetTaskAdaptorFunc == nil {
		return nil
	}
	adaptor := GetTaskAdaptorFunc(task.Platform)
	if adaptor == nil {
		return nil
	}
	ch, err := model.CacheGetChannel(task.ChannelId)
	if err != nil {
		return err
	}
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
		ChannelType: ch.Type, ChannelId: ch.Id, ChannelBaseUrl: ch.GetBaseURL(),
		ChannelSetting: ch.GetSetting(), HeadersOverride: ch.GetHeaderOverride(), ApiKey: ch.Key,
	}}
	adaptor.Init(info)
	upstreamID := task.GetUpstreamTaskID()
	if upstreamID == "" {
		return nil
	}
	return updatePointsAwareVideoTask(ctx, adaptor, ch, upstreamID, map[string]*model.Task{upstreamID: task}, true)
}
