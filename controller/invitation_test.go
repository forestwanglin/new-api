package controller

import (
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestInvitationPublishTimeError(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	invitationError(c, model.ErrInvitationEndPassed)
	require.Contains(t, w.Body.String(), `"code":"CAMPAIGN_END_PASSED"`)
	require.Contains(t, w.Body.String(), "Campaign end time has passed. Set a future end time.")
}

func TestInvitationRequestBoundaries(t *testing.T) {
	for _, query := range []string{"p=0", "p=1&p=2", "page_size=101", "user_id=2", "p=9223372036854775807&page_size=100", "bad=%ZZ", "bad=1;ignored=2"} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("GET", "/?"+query, nil)
		_, _, ok := invitationPagination(c)
		require.False(t, ok, query)
	}
	for _, input := range []string{"https://evil.example/invite?aff=abcd", "https://example.com/invite?aff=a&aff=b", "https://example.com/invite?aff=a&ref=b", "https://user@example.com/invite?aff=abcd", "//example.com/invite?aff=abcd", "https://example.com/invite?aff=abcd#token"} {
		_, err := invitationCode(input, "https://example.com")
		require.Error(t, err, input)
	}
	for _, input := range []string{"abcd", "https://example.com/invite?aff=abcd", "https://example.com/invite?ref=abcd"} {
		code, err := invitationCode(input, "https://example.com")
		require.NoError(t, err)
		require.Equal(t, "abcd", code)
	}
	for _, body := range []string{`{"invitation":"abcd","request_id":"request123","user_id":"2"}`, `{"invitation":null,"request_id":"request123"}`, `{"invitation":"abcd","request_id":"request123"} trailing`} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		var result struct {
			Invitation string `json:"invitation"`
			RequestID  string `json:"request_id"`
		}
		require.False(t, readInvitationBody(c, &result, "invitation request_id", ""))
	}
}

func TestInvitationCampaignTierBoundaries(t *testing.T) {
	for _, tiers := range []string{`[null]`, `[{}]`, `[{"min_effective_friends":0}]`, `[{"rate_bps":500}]`, `[{"min_effective_friends":null,"rate_bps":500}]`, `[{"min_effective_friends":0,"rate_bps":null}]`, `[{"min_effective_friends":0,"rate_bps":500,"extra":true}]`, `[{"min_effective_friends":0.5,"rate_bps":500}]`, `[{"min_effective_friends":0,"rate_bps":10001}]`, `[{"min_effective_friends":0,"rate_bps":500}]`} {
		t.Run(tiers, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			body := `{"code":"campaign","period":1,"name":"Campaign","description":"","starts_at":"1","ends_at":"2","reward_point_type_id":"1","rules_text":"","visible":true,"tiers":` + tiers + `}`
			c.Request = httptest.NewRequest("POST", "/", strings.NewReader(body))
			c.Request.Header.Set("Content-Type", "application/json")
			in, _, ok := readInvitationCampaign(c, false)
			valid := tiers == `[{"min_effective_friends":0,"rate_bps":500}]`
			require.Equal(t, valid, ok)
			if valid {
				require.Equal(t, 7, in.FreezeDays)
				require.Equal(t, 500, in.Tiers[0].RateBps)
			}
		})
	}
}

func TestInvitationAdminCampaignFilterBoundaries(t *testing.T) {
	for _, query := range []string{"campaign_id=0", "campaign_id=-1", "campaign_id=01", "campaign_id=1&campaign_id=2", "campaign_id=9223372036854775808", "campaign_id=", "campaign_id=1&unknown=2"} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("GET", "/?"+query, nil)
		_, _, ok := invitationPagination(c, "campaign_id")
		require.False(t, ok, query)
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/?p=2&page_size=10&campaign_id=3", nil)
	p, size, ok := invitationPagination(c, "campaign_id")
	require.True(t, ok)
	require.Equal(t, 2, p)
	require.Equal(t, 10, size)
	_, _, ok = invitationPagination(c)
	require.False(t, ok, "self and other pagination endpoints reject admin filters")
}
