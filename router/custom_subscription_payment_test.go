package router

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestCustomSubscriptionPayment(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.CustomSubscriptionPlan{}, &model.CustomSubscriptionOrder{}, &model.CustomUserSubscription{}, &model.CustomUserSubscriptionState{}, &model.CustomSubscriptionEvent{}, &model.TopUp{}, &model.PointType{}, &model.PointAccount{}, &model.PointTransaction{}, &model.PointLedger{}, &model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}, &model.Option{}))
	oldDB, oldLogDB, oldType, oldRedis, oldSecret := model.DB, model.LOG_DB, common.MainDatabaseType(), common.RedisEnabled, common.SessionSecret
	oldPayAddress, oldID, oldKey, oldCallback, oldServer, oldPrice := operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey, operation_setting.CustomCallbackAddress, system_setting.ServerAddress, operation_setting.Price
	oldMethods := operation_setting.PayMethods
	oldSettings := *operation_setting.GetPaymentSetting()
	oldSecure, oldCritical := common.SessionCookieSecure, common.CriticalRateLimitEnable
	oldQuota := common.QuotaPerUnit
	model.DB, model.LOG_DB = db, db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	common.SessionSecret = "custom-payment-test"
	common.SessionCookieSecure = false
	common.CriticalRateLimitEnable = false
	operation_setting.PayAddress = "https://payment.example.com"
	operation_setting.EpayId = "merchant-test"
	operation_setting.EpayKey = "test-key"
	operation_setting.CustomCallbackAddress = "https://merchant.example.com"
	system_setting.ServerAddress = "https://merchant.example.com"
	operation_setting.Price = 1
	common.QuotaPerUnit = 100
	operation_setting.PayMethods = []map[string]string{{"type": "wxpay", "name": "WeChat Pay"}, {"type": "alipay", "name": "Alipay"}, {"type": "stripe", "name": "Stripe"}}
	*operation_setting.GetPaymentSetting() = operation_setting.PaymentSetting{ComplianceConfirmed: true, ComplianceTermsVersion: operation_setting.CurrentComplianceTermsVersion}
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.SetMainDatabaseType(oldType)
		common.RedisEnabled = oldRedis
		common.SessionSecret = oldSecret
		operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey, operation_setting.CustomCallbackAddress, system_setting.ServerAddress, operation_setting.Price = oldPayAddress, oldID, oldKey, oldCallback, oldServer, oldPrice
		operation_setting.PayMethods = oldMethods
		*operation_setting.GetPaymentSetting() = oldSettings
		common.SessionCookieSecure = oldSecure
		common.CriticalRateLimitEnable = oldCritical
		common.QuotaPerUnit = oldQuota
		require.NoError(t, sqlDB.Close())
	})
	user := model.User{Id: 1, Username: "custom-pay", Password: "placeholder", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "custom-pay"}
	require.NoError(t, db.Create(&user).Error)
	bundle, err := service.CreateLoginSession(1, "password", "127.0.0.1", "test")
	require.NoError(t, err)
	pat := model.AccessTokenPrefix + strings.Repeat("p", 43)
	access := &model.UserAccessToken{Name: "payment PAT", TokenHash: model.AccessTokenFingerprint(pat), TokenHint: model.AccessTokenHint(pat)}
	require.NoError(t, access.SetScopes([]string{"wallet:read", "wallet:write"}))
	require.NoError(t, model.CreateUserAccessToken(1, access, service.AccessTokenMaxPerUser))
	pointType := model.PointType{Code: "GENERAL", Name: "General points"}
	require.NoError(t, db.Create(&pointType).Error)
	plan := model.CustomSubscriptionPlan{Code: "payment", Title: "Configured", Subtitle: "Configured", BillingCycle: "month", DurationMonths: 1, Currency: "CNY", PriceAmountMinor: 2900, PaidPoints: 29000, PaidPointTypeId: pointType.Id, BonusPoints: 1000, BonusPointTypeId: &pointType.Id, Priority: 2, BenefitsJson: "[]", Enabled: true, Version: 1}
	require.NoError(t, db.Create(&plan).Error)
	engine := gin.New()
	SetApiRouter(engine)
	request := func(method, path, body, token, origin string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, req)
		return w
	}
	parse := func(w *httptest.ResponseRecorder) pointAdminResponse {
		t.Helper()
		require.Equal(t, 200, w.Code, w.Body.String())
		var result pointAdminResponse
		require.NoError(t, common.Unmarshal(w.Body.Bytes(), &result))
		return result
	}
	body := fmt.Sprintf(`{"plan_id":"%d","plan_version":"1","payment_method":"alipay","request_id":"request-0001"}`, plan.Id)
	const checkout = "/api/custom_subscription/orders"
	assert.Equal(t, 401, request("POST", checkout, body, "", "").Code)
	assert.Equal(t, 403, request("POST", checkout, body, pat, "").Code)
	common.SessionCookieSecure = true
	assert.Equal(t, 403, request("POST", checkout, body, bundle.AccessToken, "https://evil.example").Code)
	common.SessionCookieSecure = false
	for _, invalid := range []string{strings.Replace(body, `"alipay"`, `"wechat"`, 1), strings.Replace(body, `"plan_version":"1"`, `"plan_version":"2"`, 1), strings.Replace(body, `"request_id":"request-0001"`, `"user_id":"2"`, 1), body + `{}`, strings.Replace(body, `"plan_id":"1"`, `"plan_id":null`, 1)} {
		assert.False(t, parse(request("POST", checkout, invalid, bundle.AccessToken, "")).Success)
	}
	options := parse(request("GET", "/api/custom_subscription/payment_methods", "", "", ""))
	assert.True(t, options.Success)
	assert.NotContains(t, string(options.Data), "stripe")
	assert.Contains(t, string(options.Data), "wxpay")
	operation_setting.GetPaymentSetting().ComplianceConfirmed = false
	disabled := parse(request("GET", "/api/custom_subscription/payment_methods", "", "", ""))
	assert.JSONEq(t, `{"items":[]}`, string(disabled.Data))
	assert.False(t, parse(request("POST", checkout, body, bundle.AccessToken, "")).Success)
	operation_setting.GetPaymentSetting().ComplianceConfirmed = true
	created := parse(request("POST", checkout, body, bundle.AccessToken, ""))
	require.True(t, created.Success, created.Message)
	var payment struct {
		TradeNo string            `json:"trade_no"`
		URL     string            `json:"url"`
		Params  map[string]string `json:"params"`
	}
	require.NoError(t, common.Unmarshal(created.Data, &payment))
	assert.Equal(t, "https://payment.example.com/submit.php", payment.URL)
	assert.Equal(t, "29.00", payment.Params["money"])
	assert.Equal(t, "alipay", payment.Params["type"])
	assert.Equal(t, "https://merchant.example.com/api/custom_subscription/epay/notify", payment.Params["notify_url"])
	replay := parse(request("POST", checkout, body, bundle.AccessToken, ""))
	require.True(t, replay.Success, replay.Message)
	var replayData map[string]any
	require.NoError(t, common.Unmarshal(replay.Data, &replayData))
	assert.Equal(t, payment.TradeNo, replayData["trade_no"])
	assert.False(t, parse(request("POST", checkout, strings.Replace(body, `"alipay"`, `"wxpay"`, 1), bundle.AccessToken, "")).Success)
	var count int64
	require.NoError(t, db.Model(&model.CustomSubscriptionOrder{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
	statusPath := checkout + "/" + payment.TradeNo
	assert.Equal(t, 401, request("GET", statusPath, "", "", "").Code)
	assert.Equal(t, 403, request("GET", statusPath, "", pat, "").Code)
	assert.False(t, parse(request("GET", statusPath+"?user_id=2", "", bundle.AccessToken, "")).Success)
	require.NoError(t, db.Model(&model.CustomSubscriptionOrder{}).Where("trade_no = ?", payment.TradeNo).Update("user_id", 2).Error)
	assert.False(t, parse(request("GET", statusPath, "", bundle.AccessToken, "")).Success)
	require.NoError(t, db.Model(&model.CustomSubscriptionOrder{}).Where("trade_no = ?", payment.TradeNo).Update("user_id", 1).Error)
	callback := map[string]string{"pid": "merchant-test", "out_trade_no": payment.TradeNo, "trade_no": "provider-trade-1", "money": "29.00", "type": "alipay", "trade_status": epay.StatusTradeSuccess}
	notify := func(p map[string]string, duplicate bool) *httptest.ResponseRecorder {
		t.Helper()
		signed, err := epay.GenerateParamsWithError(p, "test-key")
		require.NoError(t, err)
		v := url.Values{}
		for k, value := range signed {
			v.Set(k, value)
		}
		if duplicate {
			v.Add("money", "29.00")
		}
		return request("GET", "/api/custom_subscription/epay/notify?"+v.Encode(), "", "", "")
	}
	// Every malformed or semantically mismatched notification must leave all value untouched.
	for key, value := range map[string]string{"pid": "other-merchant", "money": "28.99", "type": "wxpay", "trade_status": "TRADE_PENDING"} {
		p := map[string]string{}
		for k, v := range callback {
			p[k] = v
		}
		p[key] = value
		assert.Equal(t, "fail", notify(p, false).Body.String())
	}
	assert.Equal(t, "fail", notify(callback, true).Body.String())
	assert.Equal(t, "fail", request("GET", "/api/custom_subscription/epay/notify?pid=merchant-test&out_trade_no="+payment.TradeNo+"&sign=forged", "", "", "").Body.String())
	postValues := url.Values{}
	signedPost, err := epay.GenerateParamsWithError(callback, "test-key")
	require.NoError(t, err)
	for key, value := range signedPost {
		postValues.Set(key, value)
	}
	postValues.Add("money", "29.00")
	postReq := httptest.NewRequest("POST", "/api/custom_subscription/epay/notify", strings.NewReader(postValues.Encode()))
	postReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	postRecorder := httptest.NewRecorder()
	engine.ServeHTTP(postRecorder, postReq)
	assert.Equal(t, "fail", postRecorder.Body.String())

	var unchanged model.User
	require.NoError(t, db.First(&unchanged, 1).Error)
	assert.Zero(t, unchanged.Quota)
	require.NoError(t, db.Model(&model.PointTransaction{}).Count(&count).Error)
	assert.Zero(t, count)
	// Outstanding paid callbacks remain settleable after checkout/compliance is disabled.
	operation_setting.GetPaymentSetting().ComplianceConfirmed = false
	postValues.Del("money")
	postValues.Set("money", "29.00")
	postReq = httptest.NewRequest("POST", "/api/custom_subscription/epay/notify", strings.NewReader(postValues.Encode()))
	postReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	postRecorder = httptest.NewRecorder()
	engine.ServeHTTP(postRecorder, postReq)
	assert.Equal(t, "success", postRecorder.Body.String())
	assert.Equal(t, "success", notify(callback, false).Body.String())
	assert.Equal(t, "success", notify(callback, false).Body.String())
	require.NoError(t, db.First(&unchanged, 1).Error)
	assert.Equal(t, 2900, unchanged.Quota)
	var account model.PointAccount
	require.NoError(t, db.First(&account).Error)
	assert.EqualValues(t, 30000, account.AvailablePoints)
	require.NoError(t, db.Model(&model.PointTransaction{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
	require.NoError(t, db.Model(&model.CustomUserSubscription{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
	status := parse(request("GET", statusPath, "", bundle.AccessToken, ""))
	require.True(t, status.Success, status.Message)
	assert.Contains(t, string(status.Data), `"status":"success"`)
	assert.Contains(t, string(status.Data), `"fulfillment_status":"fulfilled"`)
	assert.NotContains(t, string(status.Data), "provider_payload")
	assert.NotContains(t, string(status.Data), "plan_snapshot")
	retSigned, err := epay.GenerateParamsWithError(callback, "test-key")
	require.NoError(t, err)
	v := url.Values{}
	for k, value := range retSigned {
		v.Set(k, value)
	}
	returned := request("GET", "/api/custom_subscription/epay/return?"+v.Encode(), "", "", "")
	assert.Equal(t, http.StatusFound, returned.Code)
	assert.Equal(t, "https://merchant.example.com/subscription?trade_no="+payment.TradeNo, returned.Header().Get("Location"))
	invalidReturn := request("GET", "/api/custom_subscription/epay/return?out_trade_no=forged&trade_status=TRADE_SUCCESS", "", "", "")
	assert.Equal(t, "https://merchant.example.com/subscription", invalidReturn.Header().Get("Location"))
	// Gateway callbacks may sign only the downstream provider-reference alias.
	require.NoError(t, db.Model(&plan).Updates(map[string]any{"price_amount_minor": 1, "version": 2}).Error)
	for _, tc := range []struct {
		name, canonical, alias string
		returnFirst            bool
	}{
		{name: "alias_notify", alias: "downstream-alias-notify"},
		{name: "alias_return", alias: "downstream-alias-return", returnFirst: true},
		{name: "canonical_precedence", canonical: "canonical-provider", alias: "different-downstream-provider"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var before model.User
			require.NoError(t, db.First(&before, 1).Error)
			var beforeAccount model.PointAccount
			require.NoError(t, db.First(&beforeAccount, account.Id).Error)
			order, err := model.CreateCustomSubscriptionCheckout(model.CustomSubscriptionCheckoutInput{UserID: 1, PlanID: plan.Id, PlanVersion: 2, RequestID: "request-" + tc.name, PaymentMethod: "wxpay"})
			require.NoError(t, err)
			params := map[string]string{"pid": "merchant-test", "out_trade_no": order.TradeNo, "money": "0.01", "type": "wxpay", "trade_status": epay.StatusTradeSuccess, "third_party_trade_no": tc.alias}
			if tc.canonical != "" {
				params["trade_no"] = tc.canonical
			}
			if tc.name == "alias_notify" {
				for _, invalid := range []string{"", strings.Repeat("x", 129)} {
					params["third_party_trade_no"] = invalid
					assert.Equal(t, "fail", notify(params, false).Body.String())
				}
				params["third_party_trade_no"] = tc.alias
				tampered, err := epay.GenerateParamsWithError(params, "test-key")
				require.NoError(t, err)
				values := url.Values{}
				for key, value := range tampered {
					values.Set(key, value)
				}
				values.Set("third_party_trade_no", "tampered-provider")
				assert.Equal(t, "fail", request("GET", "/api/custom_subscription/epay/notify?"+values.Encode(), "", "", "").Body.String())
				var unchangedOrder model.CustomSubscriptionOrder
				require.NoError(t, db.First(&unchangedOrder, order.Id).Error)
				assert.Equal(t, common.TopUpStatusPending, unchangedOrder.Status)
				var stillUnchanged model.User
				require.NoError(t, db.First(&stillUnchanged, 1).Error)
				assert.Equal(t, before.Quota, stillUnchanged.Quota)
			}
			signed, err := epay.GenerateParamsWithError(params, "test-key")
			require.NoError(t, err)
			values := url.Values{}
			for key, value := range signed {
				values.Set(key, value)
			}
			if tc.returnFirst {
				returned := request("GET", "/api/custom_subscription/epay/return?"+values.Encode(), "", "", "")
				assert.Equal(t, http.StatusFound, returned.Code)
				assert.Equal(t, "https://merchant.example.com/subscription?trade_no="+order.TradeNo, returned.Header().Get("Location"))
			} else {
				req := httptest.NewRequest("POST", "/api/custom_subscription/epay/notify", strings.NewReader(values.Encode()))
				req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
				w := httptest.NewRecorder()
				engine.ServeHTTP(w, req)
				assert.Equal(t, "success", w.Body.String())
			}
			assert.Equal(t, "success", notify(params, false).Body.String())
			assert.Equal(t, "success", notify(params, false).Body.String())
			var settled model.CustomSubscriptionOrder
			require.NoError(t, db.First(&settled, order.Id).Error)
			assert.Equal(t, common.TopUpStatusSuccess, settled.Status)
			assert.Equal(t, model.CustomSubscriptionFulfillmentComplete, settled.FulfillmentStatus)
			provider := tc.canonical
			if provider == "" {
				provider = tc.alias
			}
			require.NotNil(t, settled.ProviderTradeNo)
			assert.Equal(t, provider, *settled.ProviderTradeNo)
			var safe epay.VerifyRes
			require.NoError(t, common.UnmarshalJsonStr(settled.ProviderPayload, &safe))
			assert.Equal(t, provider, safe.TradeNo)
			assert.NotContains(t, settled.ProviderPayload, "sign")
			var credited model.User
			require.NoError(t, db.First(&credited, 1).Error)
			assert.EqualValues(t, before.Quota+int(order.QuotaToCredit), credited.Quota)
			var creditedAccount model.PointAccount
			require.NoError(t, db.First(&creditedAccount, account.Id).Error)
			assert.EqualValues(t, beforeAccount.AvailablePoints+30000, creditedAccount.AvailablePoints)
			var transaction model.PointTransaction
			require.NoError(t, db.Where("event_key = ?", fmt.Sprintf("custom-subscription:%d:credit", order.Id)).First(&transaction).Error)
			assert.EqualValues(t, 30000, transaction.Points)
			var rows int64
			require.NoError(t, db.Model(&model.PointLedger{}).Where("transaction_id = ?", transaction.Id).Count(&rows).Error)
			assert.EqualValues(t, 1, rows)
			require.NoError(t, db.Model(&model.CustomUserSubscription{}).Where("order_id = ?", order.Id).Count(&rows).Error)
			assert.EqualValues(t, 1, rows)
			var payment model.TopUp
			require.NoError(t, db.First(&payment, *order.TopUpId).Error)
			assert.Equal(t, common.TopUpStatusSuccess, payment.Status)
		})
	}

}
