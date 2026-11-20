package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestUpdateOptionRejectsInvalidWeChatBrandingWithTranslationKey(t *testing.T) {
	body, err := common.Marshal(OptionUpdateRequest{
		Key:   "wechat_official.logo_url",
		Value: "http://image.example/logo.png",
	})
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPut, "/api/option/", bytes.NewReader(body))

	UpdateOption(context)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success    bool   `json:"success"`
		Message    string `json:"message"`
		MessageKey string `json:"message_key"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.False(t, response.Success)
	require.Equal(t, model.ErrWeChatOfficialBranding.Error(), response.Message)
	require.Equal(t, model.ErrWeChatOfficialBranding.Error(), response.MessageKey)
}
