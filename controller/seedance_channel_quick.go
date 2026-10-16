package controller

import (
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

// This manual check only performs a read-only GET. It never invokes RelayTask,
// creates a task, or updates billing/automatic channel availability.
func testSeedanceQuick(c *gin.Context, channel *model.Channel, requested string) {
	started := time.Now()
	fail := func(message, code string) {
		c.JSON(http.StatusOK, gin.H{"success": false, "stage": "failed", "check_mode": "quick", "generation_checked": false, "upstream_generation_checked": false, "task_created": false, "message": message, "error_code": code, "time": time.Since(started).Seconds()})
	}
	name, err := seedanceTestModel(channel, requested)
	if err != nil {
		fail(err.Error(), "seedance_quick_model")
		return
	}
	if channel.Status != common.ChannelStatusEnabled {
		fail("Channel is disabled", "seedance_channel_disabled")
		return
	}
	base, err := url.Parse(strings.TrimRight(channel.GetBaseURL(), "/"))
	if err != nil || base.Host == "" || (base.Scheme != "https" && base.Scheme != "http") || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		fail("Invalid channel base URL", "seedance_quick_url")
		return
	}
	adapterHealth := strings.HasSuffix(base.Path, "/seedance-internal")
	nativeTaskList := (channel.Type == constant.ChannelTypeDoubaoVideo || channel.Type == constant.ChannelTypeVolcEngine) && strings.HasPrefix(name, "doubao-seedance-") && !adapterHealth
	path := "/v1/models"
	if adapterHealth {
		path = "/health"
	} else if nativeTaskList {
		path = "/api/v3/contents/generations/tasks?page_num=1&page_size=1"
		if strings.HasSuffix(base.Path, "/api/v3") {
			path = "/contents/generations/tasks?page_num=1&page_size=1"
		}
	} else if strings.HasSuffix(base.Path, "/v1") {
		path = "/models"
	}
	key, keyErr := seedanceQuickKey(channel)
	if keyErr != nil {
		fail("No enabled channel key", "seedance_quick_key")
		return
	}
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, base.String()+path, nil)
	if err != nil {
		fail("Cannot build health request", "seedance_quick_request")
		return
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")
	client := &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		fail("Health endpoint unreachable or timed out (8 seconds)", "seedance_quick_network")
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		message := fmt.Sprintf("Health endpoint returned HTTP %d", response.StatusCode)
		if response.StatusCode == 401 || response.StatusCode == 403 {
			message = "Health endpoint rejected channel authentication"
		}
		if response.StatusCode == 404 || response.StatusCode == 405 {
			message = "This channel has no supported read-only health endpoint; use the full video test"
		}
		fail(message, "seedance_quick_http")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1024*1024+1))
	if err != nil || len(raw) > 1024*1024 || !gjson.ValidBytes(raw) {
		fail("Health endpoint did not return valid JSON", "seedance_quick_response")
		return
	}
	scope := "adapter_auth_and_local_model_config"
	if adapterHealth {
		ok := gjson.GetBytes(raw, "ok")
		if ok.Type != gjson.True {
			fail("Adapter health check failed", "seedance_quick_response")
			return
		}
	} else if nativeTaskList {
		// Empty task lists are valid for new accounts. Never create a task to probe.
		items := gjson.GetBytes(raw, "items")
		total := gjson.GetBytes(raw, "total")
		if !items.IsArray() || total.Type != gjson.Number || total.Float() < 0 || gjson.GetBytes(raw, "error").Exists() {
			fail("Video task query returned an unexpected response", "seedance_quick_response")
			return
		}
		scope = "video_task_list_auth_and_local_model_config"
	} else {
		mapped := name
		if mapping := channel.GetModelMapping(); mapping != "" {
			if v := gjson.Parse(mapping).Map()[name]; v.Type == gjson.String && v.String() != "" {
				mapped = v.String()
			}
		}
		found := false
		for _, item := range gjson.GetBytes(raw, "data").Array() {
			if item.Get("id").String() == mapped {
				found = true
				break
			}
		}
		if !found {
			fail("Selected model was not listed by the authenticated models endpoint; use the full video test", "seedance_quick_model_unlisted")
			return
		}
		scope = "models_endpoint_auth_and_model_listing"
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "stage": "checked", "check_mode": "quick", "model": name, "check_scope": scope, "upstream_auth_checked": nativeTaskList, "model_generation_permission_checked": false, "generation_checked": false, "upstream_generation_checked": false, "task_created": false, "message": "Interface check passed; video generation was not tested", "time": time.Since(started).Seconds()})
}

// seedanceQuickKey picks one enabled channel key for the read-only quick check.
// It deliberately avoids Channel.GetNextEnabledKey, which advances the persisted
// polling index on multi-key polling channels: a manual test must never change
// which key the live traffic uses next.
func seedanceQuickKey(channel *model.Channel) (string, error) {
	if channel == nil || strings.TrimSpace(channel.Key) == "" {
		return "", fmt.Errorf("channel has no key")
	}
	if !channel.ChannelInfo.IsMultiKey {
		return channel.Key, nil
	}
	keys := channel.GetKeys()
	enabled := make([]int, 0, len(keys))
	for idx := range keys {
		status, ok := channel.ChannelInfo.MultiKeyStatusList[idx]
		if !ok {
			status = common.ChannelStatusEnabled
		}
		if status == common.ChannelStatusEnabled {
			enabled = append(enabled, idx)
		}
	}
	if len(enabled) == 0 {
		return "", fmt.Errorf("no enabled channel key")
	}
	return keys[enabled[rand.Intn(len(enabled))]], nil
}
