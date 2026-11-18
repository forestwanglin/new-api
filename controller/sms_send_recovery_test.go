package controller

import (
	"encoding/json"
	"fmt"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"testing"
)

func TestSMSDeliveryRecoveryMetadata(t *testing.T) {
	for _, retry := range []string{"", "bounded-client-retry"} {
		t.Run(retry, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			writeSecurityOperationError(c, fmt.Errorf("private wrapper: %w", &service.SMSDeliveryError{RetryToken: retry, RetryAfter: 90, RetryExpiresAt: 1234567890}))
			require.Equal(t, 200, recorder.Code)
			var body struct {
				Code string `json:"code"`
				Data struct {
					Code           string `json:"code"`
					RetryToken     string `json:"retry_token"`
					RetryAfter     int    `json:"retry_after"`
					RetryExpiresAt int64  `json:"retry_expires_at"`
				} `json:"data"`
			}
			require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
			require.Equal(t, "PHONE_SMS_DELIVERY_FAILED", body.Code)
			require.Equal(t, "SMS_DELIVERY_FAILED", body.Data.Code)
			require.Equal(t, retry, body.Data.RetryToken)
			require.Equal(t, 90, body.Data.RetryAfter)
			if retry != "" {
				require.EqualValues(t, 1234567890, body.Data.RetryExpiresAt)
			}
			require.Contains(t, recorder.Body.String(), `"code":"SMS_DELIVERY_FAILED"`)
			require.Contains(t, recorder.Body.String(), `"retry_after":90`)
			require.NotContains(t, recorder.Body.String(), "private wrapper")
			if retry != "" {
				require.Contains(t, recorder.Body.String(), `"retry_token":"bounded-client-retry"`)
				require.Contains(t, recorder.Body.String(), `"retry_expires_at":1234567890`)
			} else {
				require.NotContains(t, recorder.Body.String(), "retry_token")
				require.NotContains(t, recorder.Body.String(), "retry_expires_at")
			}
		})
	}
}
