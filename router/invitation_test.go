package router

import (
	"fmt"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestInvitationRouteAuthorization(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}, &model.Option{}, &model.InvitationBinding{}, &model.InvitationControl{}, &model.InvitationAuditLog{}))
	require.NoError(t, db.Create(&model.InvitationControl{Id: 1}).Error)
	oldDB, oldLog, oldKind, oldRedis, oldSecret, oldSecure := model.DB, model.LOG_DB, common.MainDatabaseType(), common.RedisEnabled, common.SessionSecret, common.SessionCookieSecure
	model.DB, model.LOG_DB = db, db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	common.SessionSecret = "invitation-route-test"
	common.SessionCookieSecure = false
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLog
		common.SetMainDatabaseType(oldKind)
		common.RedisEnabled, common.SessionSecret, common.SessionCookieSecure = oldRedis, oldSecret, oldSecure
		require.NoError(t, sqlDB.Close())
	})
	tokens := map[int]string{}
	var pat string
	for _, role := range []int{common.RoleCommonUser, common.RoleAdminUser} {
		u := model.User{Username: fmt.Sprintf("invitation-%d", role), AffCode: fmt.Sprintf("code%d", role), Role: role, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1}
		require.NoError(t, db.Create(&u).Error)
		b, err := service.CreateLoginSession(u.Id, "password", "127.0.0.1", "invitation-test")
		require.NoError(t, err)
		tokens[role] = b.AccessToken
		if role == common.RoleAdminUser {
			pat = model.AccessTokenPrefix + strings.Repeat("i", 43)
			access := &model.UserAccessToken{Name: "invitation PAT", TokenHash: model.AccessTokenFingerprint(pat), TokenHint: model.AccessTokenHint(pat)}
			require.NoError(t, access.SetScopes([]string{"wallet:read", "group:write"}))
			require.NoError(t, model.CreateUserAccessToken(u.Id, access, service.AccessTokenMaxPerUser))
		}
	}
	engine := gin.New()
	SetApiRouter(engine)
	request := func(method, path, body, token string, want int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, r)
		require.Equal(t, want, w.Code, w.Body.String())
		return w
	}
	for _, route := range []struct{ method, path string }{
		{"GET", "/self/summary"}, {"GET", "/self/link"}, {"GET", "/self/binding"}, {"GET", "/self/friends"}, {"GET", "/self/rewards"}, {"POST", "/self/binding"},
		{"GET", "/admin/campaigns"}, {"POST", "/admin/campaigns"}, {"GET", "/admin/campaigns/1"}, {"PUT", "/admin/campaigns/1"}, {"POST", "/admin/campaigns/1/publish"}, {"POST", "/admin/campaigns/1/end"}, {"GET", "/admin/rewards"}, {"POST", "/admin/orders/1/refunds"}, {"POST", "/admin/orders/1/refunds/1/complete"}, {"POST", "/admin/orders/1/refunds/1/cancel"}, {"POST", "/admin/rewards/1/reversal"},
	} {
		path := "/api/invitation" + route.path
		request(route.method, path, "{}", "", http.StatusUnauthorized)
		request(route.method, path, "{}", pat, http.StatusForbidden)
		if strings.Contains(route.path, "/admin/") {
			request(route.method, path, "{}", tokens[common.RoleCommonUser], http.StatusForbidden)
		}
	}
	w := request("POST", "/api/invitation/self/binding", `{"invitation":"code10","request_id":"bindrequest1"}`, tokens[common.RoleCommonUser], 200)
	require.Contains(t, w.Body.String(), `"success":true`, w.Body.String())
	w = request("POST", "/api/invitation/self/binding", `{"invitation":"code10","request_id":"bindrequest2"}`, tokens[common.RoleCommonUser], 200)
	require.Contains(t, w.Body.String(), `"code":"ALREADY_BOUND"`)
	// Legacy referral API must persist its generated code even though ordinary
	// user updates can no longer overwrite referral attribution fields.
	require.NoError(t, db.Model(&model.User{}).Where("username = ?", "invitation-1").Update("aff_code", "").Error)
	first := request("GET", "/api/user/aff", "", tokens[common.RoleCommonUser], 200)
	second := request("GET", "/api/user/aff", "", tokens[common.RoleCommonUser], 200)
	require.Equal(t, first.Body.String(), second.Body.String())
	// The same router that enforces roles also preserves exact admin DTOs.
	require.NoError(t, db.AutoMigrate(&model.PointType{}, &model.PointModelRule{}, &model.InvitationCampaign{}, &model.InvitationCampaignVersion{}, &model.InvitationCampaignActivation{}, &model.InvitationCampaignTier{}))
	pt := model.PointType{Code: "GENERAL", Name: "General points"}
	require.NoError(t, db.Create(&pt).Error)
	require.NoError(t, db.Create(&model.PointModelRule{PointTypeId: pt.Id, MatchType: model.PointMatchPattern, MatchValue: "*", Enabled: true}).Error)
	payment := operation_setting.GetPaymentSetting()
	oldPayment := *payment
	payment.ComplianceConfirmed, payment.ComplianceTermsVersion = true, operation_setting.CurrentComplianceTermsVersion
	t.Cleanup(func() { *payment = oldPayment })
	payload := fmt.Sprintf(`{"code":"api-campaign","period":1,"name":"API campaign","description":"","starts_at":"2000000000000","ends_at":"2000100000000","reward_point_type_id":"%d","tiers":[{"min_effective_friends":0,"rate_bps":500}],"rules_text":"","visible":true}`, pt.Id)
	created := request("POST", "/api/invitation/admin/campaigns", payload, tokens[common.RoleAdminUser], 200)
	var response struct {
		Success bool                         `json:"success"`
		Data    model.InvitationCampaignView `json:"data"`
	}
	require.NoError(t, common.Unmarshal(created.Body.Bytes(), &response))
	require.True(t, response.Success, created.Body.String())
	require.Equal(t, 7, response.Data.FreezeDays)
	require.Contains(t, created.Body.String(), `"version":"1"`)
	require.Contains(t, created.Body.String(), `"starts_at":"2000000000000"`)
	public := request("GET", "/api/invitation/campaigns", "", "", 200)
	require.Contains(t, public.Body.String(), `"total":"0"`)
	path := fmt.Sprintf("/api/invitation/admin/campaigns/%d", response.Data.Id)
	invalid := request("PUT", path, strings.TrimSuffix(payload, "}")+`,"version":"2"}`, tokens[common.RoleAdminUser], 200)
	require.Contains(t, invalid.Body.String(), `"code":"INVITATION_CONFLICT"`)
	published := request("POST", path+"/publish", `{"version":"1"}`, tokens[common.RoleAdminUser], 200)
	require.Contains(t, published.Body.String(), `"success":true`, published.Body.String())
	public = request("GET", "/api/invitation/campaigns", "", "", 200)
	require.Contains(t, public.Body.String(), `"total":"1"`)
	request("GET", "/api/invitation/campaigns?p=1&p=2", "", "", 200)
	common.SessionCookieSecure = true
	request("POST", "/api/invitation/self/binding", `{}`, tokens[common.RoleCommonUser], http.StatusForbidden)
}
