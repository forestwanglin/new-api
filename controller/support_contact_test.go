package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStatusPublishesSupportContacts(t *testing.T) {
	settings := operation_setting.GetGeneralSetting()
	previous := *settings
	t.Cleanup(func() { *settings = previous })
	for _, tc := range []struct{ name, wecom, email string }{
		{name: "empty"}, {name: "configured", wecom: "company-support", email: "ops@example.com"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			require.NoError(t, config.UpdateConfigFromMap(settings, map[string]string{"support_wecom": tc.wecom, "operations_email": tc.email}))
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)
			GetStatus(context)
			var payload struct {
				Success bool           `json:"success"`
				Data    map[string]any `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
			require.True(t, payload.Success)
			assert.Equal(t, tc.wecom, payload.Data["support_wecom"])
			assert.Equal(t, tc.email, payload.Data["operations_email"])
		})
	}
}

func TestUpdateOptionRejectsInvalidOperationsEmail(t *testing.T) {
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodPut, "/api/option/", strings.NewReader(`{"key":"general_setting.operations_email","value":"not-an-email"}`))
	UpdateOption(context)
	var payload struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	assert.False(t, payload.Success)
	assert.Equal(t, "Enter a valid operations email address", payload.Message)
}
