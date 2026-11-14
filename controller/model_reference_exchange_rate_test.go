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

func TestModelReferenceExchangeRateOptionRejectsInvalidValues(t *testing.T) {
	for _, value := range []string{"0", "-1", "NaN", "+Inf", "-Inf", "", "abc", "1e999"} {
		t.Run(value, func(t *testing.T) {
			body, err := common.Marshal(OptionUpdateRequest{Key: "general_setting.model_reference_exchange_rate", Value: value})
			require.NoError(t, err)
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			context.Request = httptest.NewRequest(http.MethodPut, "/api/option/", strings.NewReader(string(body)))
			UpdateOption(context)
			var payload struct {
				Success bool   `json:"success"`
				Message string `json:"message"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
			assert.False(t, payload.Success)
			assert.Contains(t, payload.Message, "Exchange rate must be greater than 0")
		})
	}
}

func TestModelReferenceExchangeRateConfigurationAndPublicStatus(t *testing.T) {
	settings := operation_setting.GetGeneralSetting()
	original := *settings
	originalMap := common.OptionMap
	originalPaymentRate := operation_setting.USDExchangeRate
	t.Cleanup(func() { *settings = original; common.OptionMap = originalMap })
	common.OptionMap = map[string]string{}
	require.Equal(t, 7.0, settings.ModelReferenceExchangeRate)
	for _, rate := range []string{"8.25", "0.00001"} {
		require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{"general_setting.model_reference_exchange_rate": rate}))
		saved := map[string]string{}
		require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error { saved[key] = value; return nil }))
		assert.Equal(t, rate, saved["general_setting.model_reference_exchange_rate"])
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
		assert.Equal(t, settings.ModelReferenceExchangeRate, payload.Data["model_reference_exchange_rate"])
		assert.Equal(t, originalPaymentRate, operation_setting.USDExchangeRate)
	}
}
