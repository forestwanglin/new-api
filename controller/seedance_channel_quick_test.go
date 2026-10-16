package controller

import (
	"context"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/tidwall/gjson"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSeedanceQuickContract(t *testing.T) {
	for _, tc := range []struct {
		name, path, body string
		status           int
		success          bool
	}{
		{"adapter", "/seedance-internal", "{\"ok\":true}", 200, true},
		{"adapter false", "/seedance-internal", "{\"ok\":false}", 200, false},
		{"HTML is not healthy", "/seedance-internal", "<!DOCTYPE html>", 200, false},
		{"bad key", "/seedance-internal", "{\"ok\":true}", 401, false},
		{"forbidden", "/seedance-internal", "{}", 403, false},
		{"missing endpoint", "/seedance-internal", "{}", 404, false},
		{"no redirects", "/seedance-internal", "{}", 302, false},
		{"models", "", "{\"data\":[{\"id\":\"sd2.0-480P\"}]}", 200, true},
		{"missing model", "", "{\"data\":[{\"id\":\"other\"}]}", 200, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				assert.Equal(t, http.MethodGet, r.Method)
				assert.Equal(t, "Bearer private-test-key", r.Header.Get("Authorization"))
				if tc.path != "" {
					assert.Equal(t, "/seedance-internal/health", r.URL.Path)
				} else {
					assert.Equal(t, "/v1/models", r.URL.Path)
				}
				w.Header().Set("Location", "/must-not-follow")
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			base := server.URL + tc.path
			channel := &model.Channel{Models: "sd2.0-480P", Status: common.ChannelStatusEnabled, Key: "private-test-key", BaseURL: &base}
			out := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(out)
			ctx.Request = httptest.NewRequest("GET", "/test", nil)
			testSeedanceQuick(ctx, channel, "sd2.0-480P")
			assert.Equal(t, tc.success, gjson.GetBytes(out.Body.Bytes(), "success").Bool())
			assert.Equal(t, 1, calls)
			assert.False(t, gjson.GetBytes(out.Body.Bytes(), "generation_checked").Bool())
			assert.False(t, gjson.GetBytes(out.Body.Bytes(), "task_created").Bool())
			assert.NotContains(t, out.Body.String(), "private-test-key")
			assert.NotContains(t, out.Body.String(), server.URL)
		})
	}
	t.Run("invalid model and disabled channel never request", func(t *testing.T) {
		base := "http://127.0.0.1:1/seedance-internal"
		ch := &model.Channel{Models: "sd2.0-480P", BaseURL: &base, Key: "test"}
		for _, name := range []string{"gpt-4o", "sd2.0-480P"} {
			out := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(out)
			ctx.Request = httptest.NewRequest("GET", "/test", nil)
			testSeedanceQuick(ctx, ch, name)
			assert.False(t, gjson.GetBytes(out.Body.Bytes(), "success").Bool())
			assert.NotEqual(t, "seedance_quick_network", gjson.GetBytes(out.Body.Bytes(), "error_code").String())
		}
	})
	t.Run("cancelled request", func(t *testing.T) {
		base := "http://127.0.0.1:1/seedance-internal"
		ch := &model.Channel{Models: "sd2.0-480P", Status: common.ChannelStatusEnabled, BaseURL: &base, Key: "test"}
		out := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(out)
		cancelled, cancel := context.WithCancel(context.Background())
		cancel()
		ctx.Request = httptest.NewRequest("GET", "/test", nil).WithContext(cancelled)
		testSeedanceQuick(ctx, ch, "sd2.0-480P")
		assert.Equal(t, "seedance_quick_network", gjson.GetBytes(out.Body.Bytes(), "error_code").String())
	})
}

func TestSeedanceQuickNativeContract(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
		success    bool
	}{
		{"empty account", `{"items":[],"total":0}`, 200, true},
		{"existing tasks stay private", `{"items":[{"id":"private-upstream-task","content":{"video_url":"https://private.invalid/output"}}],"total":1}`, 200, true},
		{"rejected key", `{"error":{"code":"Unauthorized"}}`, 401, false},
		{"wrong JSON shape", `{"data":[],"ok":true}`, 200, false},
		{"partial task list", `{"items":[]}`, 200, false},
		{"HTML error", `<!DOCTYPE html>`, 200, false},
		{"error mixed with success", `{"items":[],"total":0,"error":{"code":"bad"}}`, 200, false},
	} {
		for _, modelName := range []string{"doubao-seedance-2-0-mini-260615", "doubao-seedance-2-0-fast-260128"} {
			t.Run(tc.name+modelName, func(t *testing.T) {
				calls := 0
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls++
					assert.Equal(t, http.MethodGet, r.Method)
					assert.Equal(t, "/api/v3/contents/generations/tasks", r.URL.Path)
					assert.Equal(t, "1", r.URL.Query().Get("page_num"))
					assert.Equal(t, "1", r.URL.Query().Get("page_size"))
					assert.Equal(t, "Bearer private-test-key", r.Header.Get("Authorization"))
					w.WriteHeader(tc.status)
					_, _ = w.Write([]byte(tc.body))
				}))
				defer server.Close()
				for _, channelType := range []int{constant.ChannelTypeDoubaoVideo, constant.ChannelTypeVolcEngine} {
					base := server.URL
					channel := &model.Channel{Type: channelType, Models: modelName, Status: common.ChannelStatusEnabled, Key: "private-test-key", BaseURL: &base}
					out := httptest.NewRecorder()
					ctx, _ := gin.CreateTestContext(out)
					ctx.Request = httptest.NewRequest("GET", "/test", nil)
					testSeedanceQuick(ctx, channel, modelName)
					assert.Equal(t, tc.success, gjson.GetBytes(out.Body.Bytes(), "success").Bool())
					assert.False(t, gjson.GetBytes(out.Body.Bytes(), "task_created").Bool())
					assert.False(t, gjson.GetBytes(out.Body.Bytes(), "generation_checked").Bool())
					if tc.success {
						assert.Equal(t, "video_task_list_auth_and_local_model_config", gjson.GetBytes(out.Body.Bytes(), "check_scope").String())
						assert.True(t, gjson.GetBytes(out.Body.Bytes(), "upstream_auth_checked").Bool())
					}
					for _, private := range []string{"private-upstream-task", "private.invalid", "private-test-key"} {
						assert.NotContains(t, out.Body.String(), private)
					}
				}
				assert.Equal(t, 2, calls)
			})
		}
	}
}

// A manual read-only check must never disturb the live key rotation of a
// multi-key channel: it neither advances the persisted polling index nor
// reuses the online selection path.
func TestSeedanceQuickKeyDoesNotAdvancePollingIndex(t *testing.T) {
	newPollingChannel := func(key string) (channel *model.Channel, base *string) {
		channel = &model.Channel{Models: "sd2.0-480P", Status: common.ChannelStatusEnabled, Key: key}
		channel.ChannelInfo.IsMultiKey = true
		channel.ChannelInfo.MultiKeyMode = constant.MultiKeyModePolling
		channel.ChannelInfo.MultiKeyPollingIndex = 1
		return channel, base
	}

	t.Run("helper picks a random enabled key without moving the index", func(t *testing.T) {
		channel, _ := newPollingChannel("key-a\nkey-b\nkey-c")
		seen := map[string]bool{}
		for i := 0; i < 100; i++ {
			key, err := seedanceQuickKey(channel)
			assert.NoError(t, err)
			seen[key] = true
		}
		assert.Equal(t, 1, channel.ChannelInfo.MultiKeyPollingIndex, "polling index must stay untouched")
		assert.Len(t, seen, 3, "every enabled key stays reachable")

		channel.ChannelInfo.MultiKeyStatusList = map[int]int{
			0: common.ChannelStatusAutoDisabled,
			1: common.ChannelStatusAutoDisabled,
		}
		key, err := seedanceQuickKey(channel)
		assert.NoError(t, err)
		assert.Equal(t, "key-c", key, "auto disabled keys are skipped")

		channel.ChannelInfo.MultiKeyStatusList = map[int]int{
			0: common.ChannelStatusAutoDisabled,
			1: common.ChannelStatusAutoDisabled,
			2: common.ChannelStatusAutoDisabled,
		}
		_, err = seedanceQuickKey(channel)
		assert.Error(t, err, "a channel with no enabled key must fail the check")

		single := &model.Channel{Key: "single-key"}
		key, err = seedanceQuickKey(single)
		assert.NoError(t, err)
		assert.Equal(t, "single-key", key)

		_, err = seedanceQuickKey(&model.Channel{})
		assert.Error(t, err, "a channel without a key must fail the check")
	})

	t.Run("quick check leaves the polled channel untouched", func(t *testing.T) {
		auth := ""
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth = r.Header.Get("Authorization")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"data":[{"id":"sd2.0-480P"}]}`))
		}))
		defer server.Close()

		channel, _ := newPollingChannel("key-a\nkey-b\nkey-c")
		base := server.URL
		channel.BaseURL = &base
		out := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(out)
		ctx.Request = httptest.NewRequest("GET", "/test", nil)
		testSeedanceQuick(ctx, channel, "sd2.0-480P")
		assert.True(t, gjson.GetBytes(out.Body.Bytes(), "success").Bool())
		assert.Contains(t, []string{"Bearer key-a", "Bearer key-b", "Bearer key-c"}, auth)
		assert.Equal(t, 1, channel.ChannelInfo.MultiKeyPollingIndex, "the check must not change which key live traffic uses next")
	})
}
