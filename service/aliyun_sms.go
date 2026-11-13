package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

func PhoneSMSConfigured() bool {
	s := system_setting.GetPhoneSettings()
	return s.Enabled && PhoneSMSConfigurationReady()
}

// Aliyun RPC signing requires RFC3986 escaping, not form '+' space encoding.
func aliyunEscape(value string) string { return strings.ReplaceAll(url.QueryEscape(value), "+", "%20") }

func SendAliyunSMS(phone, code string) error {
	if !PhoneSMSConfigured() {
		return common.NewMessage("Phone login is not configured. Please contact your administrator.")
	}
	settings := system_setting.GetPhoneSettings()
	nonce, err := randomPhoneDigits(32)
	if err != nil {
		return err
	}
	template, err := common.Marshal(map[string]string{"code": code})
	if err != nil {
		return err
	}
	params := url.Values{"AccessKeyId": {os.Getenv("ALIYUN_SMS_ACCESS_KEY_ID")}, "Action": {"SendSms"}, "Format": {"JSON"}, "Version": {"2017-05-25"}, "RegionId": {settings.Region}, "SignatureMethod": {"HMAC-SHA1"}, "SignatureVersion": {"1.0"}, "SignatureNonce": {nonce}, "Timestamp": {time.Now().UTC().Format("2006-01-02T15:04:05Z")}, "PhoneNumbers": {phone}, "SignName": {settings.SignName}, "TemplateCode": {settings.TemplateCode}, "TemplateParam": {string(template)}}
	if securityToken := os.Getenv("ALIYUN_SMS_SECURITY_TOKEN"); securityToken != "" {
		params.Set("SecurityToken", securityToken)
	}
	params.Set("Signature", aliyunSMSRequestSignature(params, os.Getenv("ALIYUN_SMS_ACCESS_KEY_SECRET")))
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://dysmsapi.aliyuncs.com/", strings.NewReader(params.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return common.NewMessage("SMS delivery failed. Please try again later.")
	}
	defer res.Body.Close()
	var result struct {
		Code string `json:"Code"`
	}
	if res.StatusCode != http.StatusOK || common.DecodeJson(io.LimitReader(res.Body, 64*1024), &result) != nil || result.Code != "OK" {
		return common.NewMessage("SMS delivery failed. Please try again later.")
	}
	return nil
}

func aliyunSMSRequestSignature(params url.Values, secret string) string {
	canonical := strings.ReplaceAll(params.Encode(), "+", "%20")
	mac := hmac.New(sha1.New, []byte(secret+"&"))
	_, _ = mac.Write([]byte("POST&%2F&" + aliyunEscape(canonical)))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func PhoneSMSConfigurationReady() bool {
	s := system_setting.GetPhoneSettings()
	return s.SignName != "" && s.TemplateCode != "" && s.Region != "" && os.Getenv("ALIYUN_SMS_ACCESS_KEY_ID") != "" && os.Getenv("ALIYUN_SMS_ACCESS_KEY_SECRET") != ""
}
