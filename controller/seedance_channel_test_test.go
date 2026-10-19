package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"net/http/httptest"
	"testing"
)

func TestSeedanceChannelTestContract(t *testing.T) {
	channel := &model.Channel{Id: 58, Models: "sd2.0-480P,doubao-seedance-2-0-mini-260615", Status: common.ChannelStatusEnabled}
	name, err := seedanceTestModel(channel, "sd2.0-480P")
	require.NoError(t, err)
	assert.Equal(t, "sd2.0-480P", name)
	for _, name := range []string{"", "gpt-4o", "sd2.0-1080P"} {
		_, err := seedanceTestModel(channel, name)
		require.Error(t, err)
	}
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest("GET", "/api/channel/test/58?model=sd2.0-480P", nil)
	testSeedanceChannel(ctx, channel, 1, "sd2.0-480P")
	assert.False(t, gjson.GetBytes(recorder.Body.Bytes(), "success").Bool())
	assert.Equal(t, "seedance_test_ack_required", gjson.GetBytes(recorder.Body.Bytes(), "error_code").String())
	for _, tc := range []struct {
		status  model.TaskStatus
		stage   string
		success bool
	}{{model.TaskStatusQueued, "queued", false}, {model.TaskStatusInProgress, "in_progress", false}, {model.TaskStatusSuccess, "completed", true}, {model.TaskStatusFailure, "failed", false}} {
		task := &model.Task{TaskID: "task_public", Status: tc.status, PrivateData: model.TaskPrivateData{Key: "secret-upstream-key"}}
		response := seedanceTestTaskResult(task)
		assert.Equal(t, tc.stage, response["stage"])
		assert.Equal(t, tc.success, response["generation_success"])
		raw, err := common.Marshal(response)
		require.NoError(t, err)
		assert.NotContains(t, string(raw), "secret-upstream-key")
	}
}

// A channel that serves exactly one group must bill its test in that group, not
// in the operator's own group, otherwise the test reports a cost the channel
// never incurs. billing_group overrides the default and must be configured.
func TestSeedanceTestBillingGroup(t *testing.T) {
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(
		`{"default":1,"business":1,"Seedance mini 企业":0.5}`,
	))
	singleGroup := &model.Channel{Id: 22, Group: "Seedance mini 企业"}
	multiGroup := &model.Channel{Id: 23, Group: "Seedance mini 企业, Seedance 2.0 企业"}

	group, err := seedanceTestBillingGroup(singleGroup, 1, "")
	require.NoError(t, err)
	assert.Equal(t, "Seedance mini 企业", group)

	group, err = seedanceTestBillingGroup(multiGroup, 1, "")
	require.NoError(t, err)
	assert.Equal(t, "Seedance mini 企业", group)

	group, err = seedanceTestBillingGroup(singleGroup, 1, "business")
	require.NoError(t, err)
	assert.Equal(t, "business", group)

	_, err = seedanceTestBillingGroup(singleGroup, 1, "no-such-group")
	require.Error(t, err)
}

func TestSeedanceTestTaskResultReportsBillingGroup(t *testing.T) {
	task := &model.Task{TaskID: "task_public", Status: model.TaskStatusSuccess, Group: "Seedance mini 企业"}
	response := seedanceTestTaskResult(task)
	assert.Equal(t, "Seedance mini 企业", response["billing_group"])

	// Tasks persisted before the group was recorded stay addressable.
	response = seedanceTestTaskResult(&model.Task{TaskID: "task_legacy", Status: model.TaskStatusQueued})
	assert.NotContains(t, response, "billing_group")
}
