package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
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
