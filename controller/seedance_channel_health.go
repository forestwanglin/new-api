package controller

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

func seedanceTestModel(channel *model.Channel, requested string) (string, error) {
	requested = strings.TrimSpace(requested)
	if requested == "" {
		return "", fmt.Errorf("select a Seedance model before testing")
	}
	supported := requested == "seedance-2.5" || strings.HasPrefix(requested, "sd2.0-") || strings.HasPrefix(requested, "doubao-seedance-")
	if !supported {
		return "", fmt.Errorf("Seedance video testing only accepts Seedance models")
	}
	for _, name := range channel.GetModels() {
		if strings.TrimSpace(name) == requested {
			return requested, nil
		}
	}
	return "", fmt.Errorf("model is not configured on this channel")
}

func seedanceTestTaskResult(task *model.Task) gin.H {
	stage := "in_progress"
	switch task.Status {
	case model.TaskStatusQueued:
		stage = "queued"
	case model.TaskStatusSuccess:
		stage = "completed"
	case model.TaskStatusFailure:
		stage = "failed"
	}
	result := gin.H{"success": stage != "failed", "stage": stage, "task_id": task.TaskID, "model": task.Properties.OriginModelName, "generation_success": stage == "completed"}
	if stage == "failed" {
		result["message"] = "video generation failed; inspect task details"
	}
	if stage == "completed" {
		result["message"] = "video generation completed"
	}
	return result
}

// testSeedanceChannel is invoked only by the existing channel-operate-protected
// manual test route. It uses the ordinary task billing/persistence pipeline.
func testSeedanceChannel(c *gin.Context, channel *model.Channel, userID int, requested string) {
	started := time.Now()
	fail := func(message, code string) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": message, "error_code": code, "stage": "failed"})
	}
	name, err := seedanceTestModel(channel, requested)
	if err != nil {
		fail(err.Error(), "seedance_test_model")
		return
	}
	if taskID := c.Query("seedance_task_id"); taskID != "" {
		if len(taskID) > 128 || !strings.HasPrefix(taskID, "task_") {
			fail("invalid platform task id", "seedance_test_task")
			return
		}
		task, exists, err := model.GetByTaskId(userID, taskID)
		if err != nil || !exists || task.ChannelId != channel.Id || task.Properties.OriginModelName != name {
			fail("test task not found for this account and channel", "seedance_test_task")
			return
		}
		c.JSON(http.StatusOK, seedanceTestTaskResult(task))
		return
	}
	if c.Query("video_test_ack") != "true" {
		fail("video testing creates a paid 4-second task; explicitly acknowledge before submitting", "seedance_test_ack_required")
		return
	}
	if channel.Status != common.ChannelStatusEnabled {
		fail("channel is disabled", "seedance_channel_disabled")
		return
	}
	body := gin.H{"model": name, "prompt": "A white ceramic cup on a wooden table, soft daylight, gentle camera movement, no people, no text.", "seconds": "4", "metadata": gin.H{"resolution": "720p", "ratio": "16:9", "generate_audio": false, "watermark": false}}
	payload, err := common.Marshal(body)
	if err != nil {
		fail("cannot build test payload", "seedance_test_payload")
		return
	}
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequestWithContext(c.Request.Context(), http.MethodPost, "/v1/videos", bytes.NewReader(payload))
	ctx.Request.Header.Set("Content-Type", "application/json")
	cache, err := model.GetUserCache(userID)
	if err != nil {
		fail("cannot load test account", "seedance_test_account")
		return
	}
	cache.WriteContext(ctx)
	ctx.Set("id", userID)
	group, err := model.GetUserGroup(userID, false)
	if err != nil {
		fail("cannot load account group", "seedance_test_account")
		return
	}
	ctx.Set("group", group)
	ctx.Set("token_group", group)
	ctx.Set("token_unlimited_quota", true)
	ctx.Set("token_name", "Seedance video channel test")
	ctx.Set("specific_channel_id", strconv.Itoa(channel.Id))
	ctx.Set("seedance_test_channel", channel)
	if e := middleware.SetupContextForSelectedChannel(ctx, channel, name); e != nil {
		fail("channel setup failed: "+string(e.GetErrorCode()), "seedance_test_setup")
		return
	}
	RelayTask(ctx)
	resultBody := recorder.Body.Bytes()
	taskID := gjson.GetBytes(resultBody, "id").String()
	if taskID == "" {
		taskID = gjson.GetBytes(resultBody, "task_id").String()
	}
	if recorder.Code < 200 || recorder.Code >= 300 || taskID == "" {
		message := gjson.GetBytes(resultBody, "message").String()
		if message == "" {
			message = gjson.GetBytes(resultBody, "error.message").String()
		}
		if message == "" {
			message = "video submission failed; inspect server logs"
		}
		if channel.Key != "" {
			message = strings.ReplaceAll(message, channel.Key, "[REDACTED]")
		}
		if len(message) > 500 {
			message = message[:500]
		}
		fail(message, "seedance_test_submit")
		return
	}
	task, exists, err := model.GetByTaskId(userID, taskID)
	if err != nil || !exists || task.ChannelId != channel.Id {
		fail("submission outcome requires checking task history; do not automatically resubmit", "seedance_test_submit_unknown")
		return
	}
	result := seedanceTestTaskResult(task)
	result["time"] = time.Since(started).Seconds()
	result["message"] = "video task submitted; generation is not completed yet"
	model.RecordLog(userID, model.LogTypeSystem, common.NewMessage(
		"Seedance channel test: channel={{channel}} model={{model}} task={{task}}",
		map[string]any{"channel": channel.Id, "model": name, "task": taskID},
	))
	c.JSON(http.StatusOK, result)
}
