package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const reconcileTestModel = "doubao-seedance-2-0-mini-260615"

// withArkSeedanceRatios pins the model and group ratios the reconciliation
// prices against, restoring the previous tables afterwards.
func withArkSeedanceRatios(t *testing.T) {
	t.Helper()
	previousModelRatios := ratio_setting.ModelRatio2JSONString()
	previousGroupRatios := ratio_setting.GroupRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"`+reconcileTestModel+`":11.5}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"Seedance mini 企业":0.5}`))
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(previousModelRatios))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousGroupRatios))
	})
}

func seedReconcileTask(t *testing.T, userID, tokenID, channelID, preConsumed int, group string, data string) *model.Task {
	t.Helper()
	now := time.Now().Unix()
	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.TaskID = fmt.Sprintf("task_reconcile_%d", time.Now().UnixNano())
	task.Properties.OriginModelName = reconcileTestModel
	task.Group = group
	task.Status = model.TaskStatusSuccess
	task.Progress = "100%"
	task.SubmitTime = now - 3600
	task.FinishTime = now - 1800
	task.Data = json.RawMessage(data)
	// The frozen billing context of a task submitted before the duration ratio
	// was removed from the sora plugin.
	task.PrivateData.BillingContext = &model.TaskBillingContext{
		ModelPrice:      -1,
		GroupRatio:      0.5,
		ModelRatio:      11.5,
		OriginModelName: reconcileTestModel,
		OtherRatios:     map[string]float64{"seconds": 5},
	}
	require.NoError(t, model.DB.Create(task).Error)
	return task
}

func reloadTask(t *testing.T, id int64) *model.Task {
	t.Helper()
	var task model.Task
	require.NoError(t, model.DB.First(&task, id).Error)
	return &task
}

func TestReconcileArkSeedanceTaskBillingSettlesStaleReservation(t *testing.T) {
	truncate(t)
	withArkSeedanceRatios(t)

	const userID, tokenID, channelID = 41, 41, 41
	const initialQuota, preConsumed = 10_000_000, 7_187_500
	seedUser(t, userID, initialQuota)
	seedToken(t, tokenID, userID, "sk-reconcile", initialQuota)
	seedChannel(t, channelID)

	task := seedReconcileTask(t, userID, tokenID, channelID, preConsumed, "Seedance mini 企业",
		`{"usage":{"completion_tokens":108900,"total_tokens":108900,"billed_amount":1.25235}}`)

	summary, err := ReconcileArkSeedanceTaskBillingOnce(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1, summary.Scanned)
	assert.Equal(t, 1, summary.Eligible)
	assert.Equal(t, 1, summary.Settled)
	assert.Equal(t, 0, summary.Failed)
	assert.Equal(t, int64(-6_561_325), summary.AdjustedQuota)

	// 108900 tokens * 11.5 ratio * 0.5 group ratio; the stale `seconds: 5`
	// ratio must not multiply it again.
	assert.Equal(t, 626_175, reloadTask(t, task.ID).Quota)

	var user model.User
	require.NoError(t, model.DB.First(&user, userID).Error)
	assert.Equal(t, initialQuota+6_561_325, user.Quota)

	var refundLog model.Log
	require.NoError(t, model.LOG_DB.Where("type = ? AND model_name = ?", model.LogTypeRefund, reconcileTestModel).
		Order("id desc").First(&refundLog).Error)
	assert.Equal(t, 6_561_325, refundLog.Quota)
	assert.Equal(t, reconcileTestModel, refundLog.ModelName)
}

func TestReconcileArkSeedanceTaskBillingIsIdempotentAndTwoWay(t *testing.T) {
	truncate(t)
	withArkSeedanceRatios(t)

	const userID, tokenID, channelID = 42, 42, 42
	const lowReservation = 100
	seedUser(t, userID, 10_000)
	seedToken(t, tokenID, userID, "sk-reconcile-idem", 10_000)
	seedChannel(t, channelID)

	task := seedReconcileTask(t, userID, tokenID, channelID, lowReservation, "Seedance mini 企业",
		`{"usage":{"total_tokens":108900}}`)

	summary, err := ReconcileArkSeedanceTaskBillingOnce(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1, summary.Settled)
	// A below-cost reservation is topped up, not clamped.
	assert.Equal(t, int64(626_175-lowReservation), summary.AdjustedQuota)
	assert.Equal(t, 626_175, reloadTask(t, task.ID).Quota)

	// A second pass finds nothing to move.
	summary, err = ReconcileArkSeedanceTaskBillingOnce(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 0, summary.Scanned)
	assert.Equal(t, 0, summary.Eligible)
	assert.Equal(t, 0, summary.Settled)
	assert.Equal(t, 626_175, reloadTask(t, task.ID).Quota)
}

func TestReconcileArkSeedanceTaskBillingSkipsIneligibleTasks(t *testing.T) {
	truncate(t)
	withArkSeedanceRatios(t)

	const userID, tokenID, channelID = 43, 43, 43
	seedUser(t, userID, 10_000)
	seedToken(t, tokenID, userID, "sk-reconcile-skip", 10_000)
	seedChannel(t, channelID)

	const usage = `{"usage":{"completion_tokens":108900}}`
	// Already settled at the token-priced quota: nothing to move.
	alreadySettled := seedReconcileTask(t, userID, tokenID, channelID, 626_175, "Seedance mini 企业", usage)
	otherModel := seedReconcileTask(t, userID, tokenID, channelID, 7_187_500, "Seedance mini 企业", usage)
	otherModel.Properties.OriginModelName = "sora-2-pro"
	otherModel.PrivateData.BillingContext.OriginModelName = "sora-2-pro"
	require.NoError(t, model.DB.Save(otherModel).Error)
	perCall := seedReconcileTask(t, userID, tokenID, channelID, 7_187_500, "Seedance mini 企业", usage)
	perCall.PrivateData.BillingContext.PerCallBilling = true
	require.NoError(t, model.DB.Save(perCall).Error)
	noUsage := seedReconcileTask(t, userID, tokenID, channelID, 7_187_500, "Seedance mini 企业", `{"id":"task"}`)
	// Still inside the settlement grace period: the poller may be settling it.
	withinGrace := seedReconcileTask(t, userID, tokenID, channelID, 7_187_500, "Seedance mini 企业", usage)
	withinGrace.FinishTime = time.Now().Unix()
	require.NoError(t, model.DB.Save(withinGrace).Error)

	summary, err := ReconcileArkSeedanceTaskBillingOnce(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 0, summary.Settled)
	assert.Equal(t, 0, summary.Eligible)
	assert.Equal(t, 4, summary.Scanned)
	assert.Equal(t, 4, summary.Skipped)
	for _, testCase := range []struct {
		task       *model.Task
		wantQuota  int
		taskReason string
	}{
		{alreadySettled, 626_175, "already settled"},
		{otherModel, 7_187_500, "other model"},
		{perCall, 7_187_500, "per-call billing"},
		{noUsage, 7_187_500, "no upstream usage"},
		{withinGrace, 7_187_500, "inside the grace period"},
	} {
		assert.Equal(t, testCase.wantQuota, reloadTask(t, testCase.task.ID).Quota, testCase.taskReason)
	}
}

func TestPointsTaskRecoveryReplaysAcceptedFailureWithoutStaleRecharge(t *testing.T) {
	truncate(t)
	pointsModels := []any{&model.PointType{}, &model.PointModelRule{}, &model.PointAccount{}, &model.PointTransaction{}, &model.PointLedger{}, &model.PointFreeze{}, &model.PointCallBilling{}, &model.PointCallEvent{}, &model.PointCallOperation{}}
	require.NoError(t, model.DB.AutoMigrate(pointsModels...))
	t.Cleanup(func() {
		for i := len(pointsModels) - 1; i >= 0; i-- {
			require.NoError(t, model.DB.Migrator().DropTable(pointsModels[i]))
		}
	})
	seedUser(t, 801, 100)
	seedToken(t, 801, 801, "points-recovery-token", 1000)
	typ := model.PointType{Code: "RECOVERY", Name: "Recovery points", ConsumePriority: 100}
	require.NoError(t, model.DB.Create(&typ).Error)
	require.NoError(t, model.DB.Create(&model.PointModelRule{PointTypeId: typ.Id, MatchType: model.PointMatchExact, MatchValue: "points-recovery", Enabled: true}).Error)
	account := model.PointAccount{UserId: 801, PointTypeId: typ.Id, AvailablePoints: 100}
	require.NoError(t, model.DB.Create(&account).Error)
	require.NoError(t, model.CreatePointCall("call-recovery", 801, 801, "points-recovery", "1", "1000"))
	require.NoError(t, model.ReservePointCall("call-recovery", "call-recovery:reserve", 20, false))
	task := &model.Task{TaskID: "points-recovery-task", Status: model.TaskStatusInProgress, Quota: 20, UserId: 801,
		PrivateData: model.TaskPrivateData{PointsBillingID: "call-recovery", TokenId: 801}}
	require.NoError(t, model.DB.Create(task).Error)
	_, err := settlePointsTask(task, 20, "call-recovery:submit")
	require.NoError(t, err)
	assert.Equal(t, 80, getUserQuota(t, 801))

	// Local expiry and repeated inability to observe accepted upstream work
	// are not authoritative failures and must never trigger a refund.
	previousTimeout, previousFailures := constant.TaskTimeoutMinutes, constant.TaskPollMaxFailures
	constant.TaskTimeoutMinutes, constant.TaskPollMaxFailures = 1, 1
	t.Cleanup(func() {
		constant.TaskTimeoutMinutes, constant.TaskPollMaxFailures = previousTimeout, previousFailures
	})
	task.SubmitTime = time.Now().Add(-2 * time.Minute).Unix()
	task.PrivateData.UpstreamTaskID = "accepted-upstream-recovery-task"
	require.NoError(t, model.DB.Model(task).Updates(map[string]any{"submit_time": task.SubmitTime, "private_data": task.PrivateData}).Error)
	sweepTimedOutTasks(context.Background())
	task = reloadTask(t, task.ID)
	assert.EqualValues(t, model.TaskStatusInProgress, task.Status)
	assert.Equal(t, 20, task.Quota)
	for _, class := range []string{pollClassTransport, pollClassAuth, pollClassHookError, pollClassUnrecognized, pollClassTransient, pollClassNotFound} {
		now := time.Now().UnixMilli()
		won, claimErr := model.TryClaimPointsTaskPoll(task, now, now+60000)
		require.NoError(t, claimErr)
		require.True(t, won)
		require.NoError(t, recordPollFailure(context.Background(), nil, task, model.TaskStatusInProgress, class, 503, "unverified outcome"))
		task = reloadTask(t, task.ID)
		assert.EqualValues(t, model.TaskStatusInProgress, task.Status, class)
		assert.Equal(t, 20, task.Quota, class)
		assert.Nil(t, task.PrivateData.PointsOutcome, "lookup errors cannot manufacture an upstream failure")
	}
	// The shared not-found/gone shortcut must preserve funds as well.
	nowMissing := time.Now().UnixMilli()
	wonMissing, err := model.TryClaimPointsTaskPoll(task, nowMissing, nowMissing+60000)
	require.NoError(t, err)
	require.True(t, wonMissing)
	require.NoError(t, failTaskFromPoll(context.Background(), nil, task, model.TaskStatusInProgress, "Upstream task not found"))
	task = reloadTask(t, task.ID)
	assert.EqualValues(t, model.TaskStatusInProgress, task.Status)
	assert.Equal(t, 7, task.PrivateData.PollFailures)
	assert.Equal(t, 80, getUserQuota(t, 801))
	assert.Equal(t, 980, getTokenRemainQuota(t, 801))
	require.NoError(t, model.DB.First(&account, account.Id).Error)
	assert.EqualValues(t, 80, account.AvailablePoints)
	assert.Zero(t, account.FrozenPoints)

	now := time.Now().UnixMilli()
	won, err := model.TryClaimPointsTaskPoll(task, now, now+60000)
	require.NoError(t, err)
	require.True(t, won)
	stale := *task
	task.Status = model.TaskStatusFailure
	task.Progress = "100%"
	task.PrivateData.PointsOutcome = relaycommon.FailTaskInfo("Upstream task not found")
	won, err = task.UpdateWithStatus(model.TaskStatusInProgress)
	require.NoError(t, err)
	require.True(t, won)

	// Publishing the accepted outcome succeeds while finance fails. The task
	// must remain durably pending rather than losing the refund after restart.
	t.Cleanup(func() { model.DB.Exec("DROP TRIGGER IF EXISTS fail_points_task_refund") })
	require.NoError(t, model.DB.Exec(`CREATE TRIGGER fail_points_task_refund BEFORE UPDATE OF quota ON users BEGIN SELECT RAISE(ABORT, 'forced points refund failure'); END`).Error)
	assert.False(t, RefundTaskQuota(context.Background(), task, "failed"))
	require.NoError(t, model.DB.Exec("DROP TRIGGER fail_points_task_refund").Error)
	pending := reloadTask(t, task.ID)
	assert.Greater(t, pending.OutcomeVersion, pending.AppliedOutcomeVersion)
	assert.Equal(t, 20, pending.Quota, "task marker rolls back with failed financial transaction")
	assert.True(t, model.HasUnfinishedSyncTasks(), "accepted terminal finance wakes recovery")

	_, err = ReconcileArkSeedanceTaskBillingOnce(context.Background())
	require.NoError(t, err)
	settled := reloadTask(t, task.ID)
	assert.Zero(t, settled.Quota)
	assert.Equal(t, settled.OutcomeVersion, settled.AppliedOutcomeVersion)
	assert.Equal(t, 100, getUserQuota(t, 801))
	assert.Equal(t, 1000, getTokenRemainQuota(t, 801))
	require.NoError(t, model.DB.First(&account, account.Id).Error)
	assert.EqualValues(t, 100, account.AvailablePoints)
	assert.Zero(t, account.FrozenPoints)

	stale.Status = model.TaskStatusSuccess
	stale.PrivateData.PointsOutcome = &relaycommon.TaskInfo{Status: string(model.TaskStatusSuccess), TotalTokens: 10}
	won, err = stale.UpdateWithStatus(model.TaskStatusInProgress)
	require.NoError(t, err)
	assert.False(t, won)
	assert.False(t, adjustPointsTask(context.Background(), &stale, 10, "stale correction"))
	recoverPointsTaskSettlements(context.Background())
	assert.Equal(t, 100, getUserQuota(t, 801), "old success and duplicate recovery cannot recharge")
}

func TestReconcileArkSeedancePointsAlreadyAppliedNeverFetches(t *testing.T) {
	truncate(t)
	seedUser(t, 871, 1000)
	seedToken(t, 871, 871, "points-reconcile-no-fetch", 1000)
	seedChannel(t, 871)
	task := seedReconcileTask(t, 871, 871, 871, 20, "default", `{"usage":{"completion_tokens":20}}`)
	task.PrivateData.PointsBillingID = "already-applied-call"
	task.PrivateData.UpstreamTaskID = "already-applied-upstream"
	task.OutcomeVersion, task.AppliedOutcomeVersion = 1, 1
	require.NoError(t, model.DB.Save(task).Error)
	adaptor := &taskPollingFetchAdaptor{}
	previousFactory := GetTaskAdaptorFunc
	GetTaskAdaptorFunc = func(constant.TaskPlatform) TaskPollingAdaptor { return adaptor }
	t.Cleanup(func() { GetTaskAdaptorFunc = previousFactory })
	for range 2 {
		_, err := ReconcileArkSeedanceTaskBillingOnce(context.Background())
		require.NoError(t, err)
	}
	assert.Zero(t, adaptor.fetchCount(), "periodic recovery must not ask upstream for new facts")
	current := reloadTask(t, task.ID)
	assert.EqualValues(t, 1, current.OutcomeVersion)
	assert.EqualValues(t, 1, current.AppliedOutcomeVersion)
	assert.Equal(t, 20, current.Quota)
}

func TestReconcileArkSeedanceVisitsOlderCandidatesBeyondBatch(t *testing.T) {
	truncate(t)
	withArkSeedanceRatios(t)
	seedUser(t, 872, 10_000_000)
	seedToken(t, 872, 872, "reconcile-past-first-batch", 10_000_000)
	seedChannel(t, 872)
	task := seedReconcileTask(t, 872, 872, 872, 100, "Seedance mini 企业", `{"usage":{"completion_tokens":108900}}`)
	newer := make([]model.Task, arkSeedanceReconcileBatchSize+1)
	for i := range newer {
		newer[i] = model.Task{TaskID: fmt.Sprintf("other-reconcile-%d", i), UserId: 872, Quota: 1,
			Status: model.TaskStatusSuccess, SubmitTime: task.SubmitTime, FinishTime: task.FinishTime,
			Properties: model.Properties{OriginModelName: "other-model"}}
	}
	require.NoError(t, model.DB.Create(&newer).Error)
	for range 2 {
		_, err := ReconcileArkSeedanceTaskBillingOnce(context.Background())
		require.NoError(t, err)
	}
	assert.Equal(t, 626_175, reloadTask(t, task.ID).Quota)
}

func TestRefreshPointsTaskOutcomeReportsBusyCorrection(t *testing.T) {
	truncate(t)
	seedUser(t, 873, 1000)
	seedToken(t, 873, 873, "reconcile-busy", 1000)
	seedChannel(t, 873)
	task := seedReconcileTask(t, 873, 873, 873, 20, "default", `{}`)
	task.PrivateData.PointsBillingID = "busy-correction-call"
	task.PrivateData.UpstreamTaskID = "busy-correction-upstream"
	task.OutcomeVersion, task.AppliedOutcomeVersion = 1, 1
	require.NoError(t, model.DB.Save(task).Error)
	now := time.Now().UnixMilli()
	won, err := model.TryClaimPointsTaskCorrection(task, now, now+60000)
	require.NoError(t, err)
	require.True(t, won)
	adaptor := &taskPollingFetchAdaptor{}
	previousFactory := GetTaskAdaptorFunc
	GetTaskAdaptorFunc = func(constant.TaskPlatform) TaskPollingAdaptor { return adaptor }
	t.Cleanup(func() { GetTaskAdaptorFunc = previousFactory })
	assert.ErrorIs(t, refreshPointsTaskOutcome(context.Background(), task), model.ErrStaleTaskOutcome)
	assert.Zero(t, adaptor.fetchCount())
}

type reconcileCorrectionAdaptor struct {
	scriptedPollingAdaptor
	fetches     int
	quota       int
	beforeFetch func(*model.Task)
}

func (a *reconcileCorrectionAdaptor) FetchTask(baseURL, key string, task *model.Task, proxy string) (*http.Response, error) {
	a.fetches++
	if a.beforeFetch != nil {
		a.beforeFetch(task)
	}
	return a.scriptedPollingAdaptor.FetchTask(baseURL, key, task, proxy)
}
func (a *reconcileCorrectionAdaptor) AdjustBillingOnComplete(*model.Task, *relaycommon.TaskInfo) int {
	return a.quota
}

func TestCorrectArkSeedanceTaskBillingPreservesDifferenceSettlementAndReplay(t *testing.T) {
	truncate(t)
	pointsModels := []any{&model.PointType{}, &model.PointModelRule{}, &model.PointAccount{}, &model.PointTransaction{}, &model.PointLedger{}, &model.PointFreeze{}, &model.PointCallBilling{}, &model.PointCallEvent{}, &model.PointCallOperation{}}
	require.NoError(t, model.DB.AutoMigrate(pointsModels...))
	t.Cleanup(func() {
		for i := len(pointsModels) - 1; i >= 0; i-- {
			require.NoError(t, model.DB.Migrator().DropTable(pointsModels[i]))
		}
	})
	seedUser(t, 874, 100)
	seedToken(t, 874, 874, "manual-correction-token", 1000)
	seedChannel(t, 874)
	typ := model.PointType{Code: "CORRECTION", Name: "Correction points", ConsumePriority: 100}
	require.NoError(t, model.DB.Create(&typ).Error)
	require.NoError(t, model.DB.Create(&model.PointModelRule{PointTypeId: typ.Id, MatchType: model.PointMatchExact, MatchValue: reconcileTestModel, Enabled: true}).Error)
	account := model.PointAccount{UserId: 874, PointTypeId: typ.Id, AvailablePoints: 100}
	require.NoError(t, model.DB.Create(&account).Error)
	require.NoError(t, model.CreatePointCall("manual-correction-call", 874, 874, reconcileTestModel, "1", "1000"))
	require.NoError(t, model.ReservePointCall("manual-correction-call", "manual-correction:reserve", 20, false))
	task := seedReconcileTask(t, 874, 874, 874, 20, "default", `{}`)
	task.PrivateData.PointsBillingID = "manual-correction-call"
	task.PrivateData.UpstreamTaskID = "manual-correction-upstream"
	task.PrivateData.PointsOutcome = &relaycommon.TaskInfo{Status: string(model.TaskStatusSuccess), TotalTokens: 20}
	task.OutcomeVersion = 1
	require.NoError(t, model.DB.Save(task).Error)
	_, err := settlePointsTask(task, 20, "manual-correction:initial")
	require.NoError(t, err)
	assert.Equal(t, 80, getUserQuota(t, 874))

	adaptor := &reconcileCorrectionAdaptor{quota: 10, scriptedPollingAdaptor: scriptedPollingAdaptor{
		parse: &relaycommon.TaskInfo{Status: string(model.TaskStatusSuccess), TotalTokens: 10, Url: "https://example.com/corrected.mp4"},
	}}
	previousFactory := GetTaskAdaptorFunc
	GetTaskAdaptorFunc = func(constant.TaskPlatform) TaskPollingAdaptor { return adaptor }
	t.Cleanup(func() { GetTaskAdaptorFunc = previousFactory })
	first, err := CorrectArkSeedanceTaskBilling(context.Background(), task.ID)
	require.NoError(t, err)
	assert.Equal(t, 1, first.Settled)
	assert.EqualValues(t, -10, first.AdjustedQuota)
	corrected := reloadTask(t, task.ID)
	assert.EqualValues(t, 2, corrected.OutcomeVersion)
	assert.Equal(t, corrected.OutcomeVersion, corrected.AppliedOutcomeVersion)
	assert.Equal(t, 10, corrected.Quota)
	assert.Equal(t, 90, getUserQuota(t, 874))
	require.NoError(t, model.DB.First(&account, account.Id).Error)
	assert.EqualValues(t, 90, account.AvailablePoints)

	second, err := CorrectArkSeedanceTaskBilling(context.Background(), task.ID)
	require.NoError(t, err)
	assert.Zero(t, second.AdjustedQuota)
	assert.Equal(t, 2, adaptor.fetches, "each explicit operation can fetch once")
	assert.EqualValues(t, 2, reloadTask(t, task.ID).OutcomeVersion)
	assert.Equal(t, 90, getUserQuota(t, 874))
	_, err = ReconcileArkSeedanceTaskBillingOnce(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 2, adaptor.fetches, "periodic reconciliation never performs a third correction")

	require.NoError(t, model.DB.Model(task).Update("status", model.TaskStatusFailure).Error)
	_, err = CorrectArkSeedanceTaskBilling(context.Background(), task.ID)
	assert.ErrorIs(t, err, ErrTaskBillingCorrectionIneligible)
	assert.Equal(t, 2, adaptor.fetches, "manual correction cannot reopen failed/refunded tasks")
}

func TestCorrectArkSeedanceTaskBillingRejectsLostCorrectionLease(t *testing.T) {
	for _, tc := range []struct {
		name    string
		updates map[string]any
	}{
		{"expired", map[string]any{"poll_lease_until": time.Now().Add(-time.Second).UnixMilli()}},
		{"fenced", map[string]any{"poll_fence": 100}},
		{"terminal_changed", map[string]any{"status": model.TaskStatusFailure}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			truncate(t)
			seedUser(t, 875, 1000)
			seedToken(t, 875, 875, "correction-lost-lease", 1000)
			seedChannel(t, 875)
			task := seedReconcileTask(t, 875, 875, 875, 20, "default", `{}`)
			task.PrivateData.PointsBillingID = "lost-lease-call"
			task.PrivateData.UpstreamTaskID = "lost-lease-upstream"
			task.OutcomeVersion, task.AppliedOutcomeVersion = 1, 1
			require.NoError(t, model.DB.Save(task).Error)
			adaptor := &reconcileCorrectionAdaptor{quota: 10, scriptedPollingAdaptor: scriptedPollingAdaptor{
				parse: &relaycommon.TaskInfo{Status: string(model.TaskStatusSuccess), TotalTokens: 10},
			}, beforeFetch: func(current *model.Task) {
				require.NoError(t, model.DB.Model(&model.Task{}).Where("id = ?", current.ID).Updates(tc.updates).Error)
			}}
			previousFactory := GetTaskAdaptorFunc
			GetTaskAdaptorFunc = func(constant.TaskPlatform) TaskPollingAdaptor { return adaptor }
			t.Cleanup(func() { GetTaskAdaptorFunc = previousFactory })
			summary, err := CorrectArkSeedanceTaskBilling(context.Background(), task.ID)
			require.ErrorIs(t, err, model.ErrStaleTaskOutcome)
			assert.Zero(t, summary.Settled)
			assert.Equal(t, 1, summary.Failed)
			assert.Zero(t, summary.AdjustedQuota)
			current := reloadTask(t, task.ID)
			assert.EqualValues(t, 1, current.OutcomeVersion)
			assert.Equal(t, 20, current.Quota)
		})
	}
}

func TestRefreshPointsTaskOutcomeRejectsChangedEligibility(t *testing.T) {
	truncate(t)
	seedUser(t, 876, 1000)
	seedToken(t, 876, 876, "correction-changed-eligibility", 1000)
	seedChannel(t, 876)
	task := seedReconcileTask(t, 876, 876, 876, 20, "default", `{}`)
	task.PrivateData.PointsBillingID = "changed-eligibility-call"
	task.OutcomeVersion, task.AppliedOutcomeVersion = 1, 1
	require.NoError(t, model.DB.Save(task).Error)
	require.NoError(t, model.DB.Model(task).Update("status", model.TaskStatusFailure).Error)
	assert.ErrorIs(t, refreshPointsTaskOutcome(context.Background(), task), ErrTaskBillingCorrectionIneligible)
}
