package service

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
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
	assert.Equal(t, 1, summary.Scanned)
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
	assert.Equal(t, 5, summary.Scanned)
	assert.Equal(t, 5, summary.Skipped)
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
