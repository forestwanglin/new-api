package service

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestNewBillingSessionAllowsZeroWalletBalanceForZeroPreConsume(t *testing.T) {
	truncate(t)
	seedUser(t, 1, 0)

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	info := &relaycommon.RelayInfo{
		UserId:       1,
		IsPlayground: true,
		UserSetting:  dto.UserSetting{BillingPreference: "wallet_only"},
	}

	session, apiErr := NewBillingSession(c, info, 0)

	require.Nil(t, apiErr)
	require.NotNil(t, session)
	require.Equal(t, 0, session.GetPreConsumedQuota())
}

func TestNewBillingSessionRejectsZeroWalletBalanceForPaidPreConsume(t *testing.T) {
	truncate(t)
	seedUser(t, 1, 0)

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	info := &relaycommon.RelayInfo{
		UserId:       1,
		IsPlayground: true,
		UserSetting:  dto.UserSetting{BillingPreference: "wallet_only"},
	}

	_, apiErr := NewBillingSession(c, info, 1)

	require.Error(t, apiErr)
	require.Equal(t, "insufficient_user_quota", string(apiErr.GetErrorCode()))
}

func TestNewBillingSessionRejectsNegativeWalletBalanceForFreePreConsume(t *testing.T) {
	truncate(t)
	seedUser(t, 1, -1)

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	info := &relaycommon.RelayInfo{
		UserId:       1,
		IsPlayground: true,
		UserSetting:  dto.UserSetting{BillingPreference: "wallet_only"},
	}

	_, apiErr := NewBillingSession(c, info, 0)

	require.Error(t, apiErr)
	require.Equal(t, "insufficient_user_quota", string(apiErr.GetErrorCode()))
}

func TestNewBillingSessionAllowsFreeSubscriptionWithActiveSubscription(t *testing.T) {
	truncate(t)
	seedUser(t, 1, 0)
	seedSubscription(t, 1, 1, 100, 0)

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	info := &relaycommon.RelayInfo{
		UserId:       1,
		RequestId:    "free-subscription-request",
		IsPlayground: true,
		UserSetting:  dto.UserSetting{BillingPreference: "subscription_only"},
	}

	session, apiErr := NewBillingSession(c, info, 0)

	require.Nil(t, apiErr)
	require.NotNil(t, session)
	require.Equal(t, 0, session.GetPreConsumedQuota())
	require.NoError(t, session.Settle(0))
	var preConsumeCount int64
	require.NoError(t, model.DB.Model(&model.SubscriptionPreConsumeRecord{}).Count(&preConsumeCount).Error)
	require.Zero(t, preConsumeCount)
}

func TestNewBillingSessionRejectsFreeSubscriptionWithoutActiveSubscription(t *testing.T) {
	truncate(t)
	seedUser(t, 1, 0)

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	info := &relaycommon.RelayInfo{
		UserId:       1,
		RequestId:    "free-subscription-request",
		IsPlayground: true,
		UserSetting:  dto.UserSetting{BillingPreference: "subscription_only"},
	}

	_, apiErr := NewBillingSession(c, info, 0)

	require.Error(t, apiErr)
	require.Equal(t, "insufficient_user_quota", string(apiErr.GetErrorCode()))
}
