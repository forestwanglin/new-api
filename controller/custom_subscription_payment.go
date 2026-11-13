package controller

import (
	"errors"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

var (
	errCustomSubscriptionCallbackParameters = errors.New("invalid callback parameters")
	errCustomSubscriptionCallbackSignature  = errors.New("invalid callback signature")
	errCustomSubscriptionCallbackAmount     = errors.New("invalid callback amount")
	errCustomSubscriptionCallbackPayment    = errors.New("invalid callback payment")
	errCustomSubscriptionCallbackSettlement = errors.New("callback settlement failed")
)

var customSubscriptionRequestID = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)
var customSubscriptionMoney = regexp.MustCompile(`^[0-9]+(\.[0-9]{1,2})?$`)

func GetCustomSubscriptionPaymentMethods(c *gin.Context) {
	if len(c.Request.URL.Query()) != 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	items := []map[string]string{}
	if operation_setting.IsPaymentComplianceConfirmed() && GetEpayClient() != nil {
		seen := map[string]bool{}
		for _, method := range operation_setting.PayMethods {
			typ := method["type"]
			if (typ == "alipay" || typ == "wxpay") && !seen[typ] {
				items = append(items, map[string]string{"type": typ, "name": method["name"]})
				seen[typ] = true
			}
		}
	}
	common.ApiSuccess(c, gin.H{"items": items})
}

func CreateCustomSubscriptionOrder(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	if len(c.Request.URL.Query()) != 0 || strings.ToLower(c.ContentType()) != "application/json" {
		common.ApiErrorT(c, "Invalid custom subscription checkout")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 4096))
	var fields map[string]common.RawMessage
	if err != nil || !utf8.Valid(body) || common.Unmarshal(body, &fields) != nil || len(fields) != 4 {
		common.ApiErrorT(c, "Invalid custom subscription checkout")
		return
	}
	var req struct {
		PlanID        string `json:"plan_id"`
		PlanVersion   string `json:"plan_version"`
		PaymentMethod string `json:"payment_method"`
		RequestID     string `json:"request_id"`
	}
	if common.Unmarshal(body, &req) != nil {
		common.ApiErrorT(c, "Invalid custom subscription checkout")
		return
	}
	for _, key := range []string{"plan_id", "plan_version", "payment_method", "request_id"} {
		if raw, ok := fields[key]; !ok || string(raw) == "null" {
			common.ApiErrorT(c, "Invalid custom subscription checkout")
			return
		}
	}
	planID, idOK := customSubscriptionInt(req.PlanID, true)
	version, versionOK := customSubscriptionInt(req.PlanVersion, true)
	if !idOK || !versionOK || !customSubscriptionRequestID.MatchString(req.RequestID) {
		common.ApiErrorT(c, "Invalid custom subscription checkout")
		return
	}
	if (req.PaymentMethod != "alipay" && req.PaymentMethod != "wxpay") || !operation_setting.ContainsPayMethod(req.PaymentMethod) {
		common.ApiErrorT(c, "Payment method does not exist")
		return
	}
	client := GetEpayClient()
	if client == nil {
		common.ApiErrorT(c, "Payment information has not been configured by administrator")
		return
	}
	callback := service.GetCallbackAddress()
	notifyURL, notifyErr := url.Parse(callback + "/api/custom_subscription/epay/notify")
	returnURL, returnErr := url.Parse(callback + "/api/custom_subscription/epay/return")
	if notifyErr != nil || returnErr != nil || notifyURL.Host == "" || (notifyURL.Scheme != "http" && notifyURL.Scheme != "https") || notifyURL.User != nil {
		common.ApiErrorT(c, "Callback URL configuration error")
		return
	}
	order, err := model.CreateCustomSubscriptionCheckout(model.CustomSubscriptionCheckoutInput{UserID: int64(c.GetInt("id")), PlanID: planID, PlanVersion: version, PaymentMethod: req.PaymentMethod, RequestID: req.RequestID})
	if err != nil {
		customSubscriptionPaymentError(c, err)
		return
	}
	// A successful request-key replay returns the existing status rather than a new payment intent.
	if order.Status != common.TopUpStatusPending {
		common.ApiSuccess(c, gin.H{"trade_no": order.TradeNo, "status": order.Status})
		return
	}
	uri, params, err := client.Purchase(&epay.PurchaseArgs{Type: order.PaymentMethod, ServiceTradeNo: order.TradeNo, Name: "Custom subscription", Money: decimal.NewFromInt(order.AmountDueMinor).Div(decimal.NewFromInt(100)).StringFixed(2), Device: epay.PC, NotifyUrl: notifyURL, ReturnUrl: returnURL})
	if err != nil {
		common.ApiErrorT(c, "Failed to start payment")
		return
	}
	common.ApiSuccess(c, gin.H{"trade_no": order.TradeNo, "url": uri, "params": params})
}

func customSubscriptionPaymentError(c *gin.Context, err error) {
	for _, safe := range []error{model.ErrCustomSubscriptionCheckoutInvalid, model.ErrCustomSubscriptionCheckoutConflict, model.ErrCustomSubscriptionConflict, model.ErrCustomSubscriptionNotFound, model.ErrCustomSubscriptionOrderNotFound, model.ErrInvalidTopUpQuota, model.ErrTopUpQuotaLimitExceeded, model.ErrPointTypeNotFound} {
		if errors.Is(err, safe) {
			common.ApiErrorT(c, safe.Error())
			return
		}
	}
	common.ApiErrorT(c, "Failed to process custom subscription payment")
}

func GetCustomSubscriptionOrder(c *gin.Context) {
	if len(c.Request.URL.Query()) != 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	order, err := model.GetCustomSubscriptionOrderForUser(int64(c.GetInt("id")), c.Param("trade_no"))
	if err != nil {
		customSubscriptionPaymentError(c, err)
		return
	}
	var paidAt, fulfilledAt *string
	if order.PaidAt != nil {
		v := strconv.FormatInt(*order.PaidAt, 10)
		paidAt = &v
	}
	if order.FulfilledAt != nil {
		v := strconv.FormatInt(*order.FulfilledAt, 10)
		fulfilledAt = &v
	}
	common.ApiSuccess(c, gin.H{"trade_no": order.TradeNo, "status": order.Status, "fulfillment_status": order.FulfillmentStatus, "amount_due_minor": strconv.FormatInt(order.AmountDueMinor, 10), "currency": order.Currency, "plan_id": strconv.FormatInt(order.PlanId, 10), "paid_at": paidAt, "fulfilled_at": fulfilledAt})
}

// Both notification and browser return require the exact same signed settlement.
// No browser-supplied success flag or unsigned redirect can grant value.
func settleCustomSubscriptionEpay(c *gin.Context) (string, error) {
	client := GetEpayClient()
	if client == nil {
		return "", errors.New("epay unavailable")
	}
	var values url.Values
	if c.Request.Method == http.MethodPost {
		if c.Request.URL.RawQuery != "" {
			return "", errCustomSubscriptionCallbackParameters
		}
		if err := c.Request.ParseForm(); err != nil {
			return "", errCustomSubscriptionCallbackParameters
		}
		values = c.Request.PostForm
	} else {
		var err error
		values, err = url.ParseQuery(c.Request.URL.RawQuery)
		if err != nil {
			return "", errCustomSubscriptionCallbackParameters
		}
	}
	if len(values) == 0 || len(values) > 40 {
		return "", errCustomSubscriptionCallbackParameters
	}
	params := make(map[string]string, len(values))
	for key, items := range values {
		if len(items) != 1 || len(key) > 64 || len(items[0]) > 4096 {
			return "", errCustomSubscriptionCallbackParameters
		}
		params[key] = items[0]
	}
	verified, err := client.Verify(params)
	if err != nil || !verified.VerifyStatus {
		return "", errCustomSubscriptionCallbackSignature
	}
	if params["pid"] != client.Config.PartnerID || verified.TradeStatus != epay.StatusTradeSuccess || len(verified.ServiceTradeNo) > 64 || len(verified.TradeNo) > 128 || (verified.Type != "alipay" && verified.Type != "wxpay") || len(verified.Money) > 22 || !customSubscriptionMoney.MatchString(verified.Money) {
		return "", errCustomSubscriptionCallbackPayment
	}
	money, err := decimal.NewFromString(verified.Money)
	amount := money.Mul(decimal.NewFromInt(100))
	if err != nil || !amount.IsInteger() || !amount.IsPositive() || amount.GreaterThan(decimal.NewFromInt(math.MaxInt64)) {
		return "", errCustomSubscriptionCallbackAmount
	}
	// Do not persist signatures or any arbitrary provider fields (which may include credentials).
	payload, err := common.Marshal(verified)
	if err != nil {
		return "", err
	}
	_, err = model.SettleCustomSubscriptionPayment(model.CustomSubscriptionPaymentInput{TradeNo: verified.ServiceTradeNo, ProviderTradeNo: verified.TradeNo, PaymentMethod: verified.Type, AmountMinor: amount.IntPart(), ProviderPayload: string(payload), CallerIP: c.ClientIP()})
	if err != nil {
		return verified.ServiceTradeNo, errors.Join(errCustomSubscriptionCallbackSettlement, err)
	}
	return verified.ServiceTradeNo, nil
}

func CustomSubscriptionEpayNotify(c *gin.Context) {
	tradeNo, err := settleCustomSubscriptionEpay(c)
	if err != nil {
		logCustomSubscriptionCallbackRejection(c, tradeNo, err)
		c.String(http.StatusOK, "fail")
		return
	}
	c.String(http.StatusOK, "success")
}

func CustomSubscriptionEpayReturn(c *gin.Context) {
	tradeNo, err := settleCustomSubscriptionEpay(c)
	path := "/subscription"
	if tradeNo != "" {
		path += "?trade_no=" + url.QueryEscape(tradeNo)
	}
	if err != nil {
		logCustomSubscriptionCallbackRejection(c, tradeNo, err)
	}
	c.Redirect(http.StatusFound, paymentReturnPath(path))
}

func logCustomSubscriptionCallbackRejection(c *gin.Context, tradeNo string, err error) {
	reason := "configuration"
	for _, candidate := range []struct {
		err    error
		reason string
	}{
		{errCustomSubscriptionCallbackParameters, "parameters"},
		{errCustomSubscriptionCallbackSignature, "signature"},
		{errCustomSubscriptionCallbackAmount, "amount"},
		{errCustomSubscriptionCallbackPayment, "payment_fields"},
		{errCustomSubscriptionCallbackSettlement, "settlement"},
	} {
		if errors.Is(err, candidate.err) {
			reason = candidate.reason
			break
		}
	}
	logger.LogWarn(c.Request.Context(), common.LogText("custom subscription payment callback rejected trade_no=%q reason=%s", tradeNo, reason))
}
