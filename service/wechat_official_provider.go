package service

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

var ErrWeChatOfficialFailed = errors.New("WeChat authorization failed. Please start again.")
var weChatOfficialHTTPClient = &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}

type WeChatOfficialIdentity struct {
	OpenID    string `json:"openid"`
	Nickname  string `json:"nickname,omitempty"`
	AvatarURL string `json:"avatar_url,omitempty"`
}

type weChatOfficialProviderResponse struct {
	ErrorCode   int    `json:"errcode"`
	AccessToken string `json:"access_token"`
	OpenID      string `json:"openid"`
	Scope       string `json:"scope"`
	Nickname    string `json:"nickname"`
	HeadImgURL  string `json:"headimgurl"`
}

func WeChatOfficialAuthorizationURL(cfg model.WeChatOfficialConfig, state string) string {
	q := url.Values{"appid": {cfg.AppID}, "redirect_uri": {cfg.CallbackURL}, "response_type": {"code"}, "scope": {"snsapi_userinfo"}, "state": {state}}
	return "https://open.weixin.qq.com/connect/oauth2/authorize?" + q.Encode() + "#wechat_redirect"
}

func weChatOfficialRequest(ctx context.Context, path string, query url.Values) (weChatOfficialProviderResponse, error) {
	var result weChatOfficialProviderResponse
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.weixin.qq.com/"+path+"?"+query.Encode(), nil)
	if err != nil {
		return result, ErrWeChatOfficialFailed
	}
	response, err := weChatOfficialHTTPClient.Do(request)
	// net/http errors include the full URL, containing credentials. Never return them.
	if err != nil {
		return result, ErrWeChatOfficialFailed
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return result, ErrWeChatOfficialFailed
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil || len(body) > 65536 {
		return result, ErrWeChatOfficialFailed
	}
	if common.Unmarshal(body, &result) != nil || result.ErrorCode != 0 {
		return result, ErrWeChatOfficialFailed
	}
	return result, nil
}

func exchangeWeChatOfficial(ctx context.Context, cfg model.WeChatOfficialConfig, code string) (WeChatOfficialIdentity, error) {
	if code == "" || len(code) > 512 {
		return WeChatOfficialIdentity{}, ErrWeChatOfficialFailed
	}
	token, err := weChatOfficialRequest(ctx, "sns/oauth2/access_token", url.Values{"appid": {cfg.AppID}, "secret": {cfg.AppSecret}, "code": {code}, "grant_type": {"authorization_code"}})
	if err != nil || token.OpenID == "" || len(token.OpenID) > 128 || token.AccessToken == "" {
		return WeChatOfficialIdentity{}, ErrWeChatOfficialFailed
	}
	hasScope := false
	for scope := range strings.SplitSeq(token.Scope, ",") {
		if scope == "snsapi_userinfo" {
			hasScope = true
		}
	}
	if !hasScope {
		return WeChatOfficialIdentity{}, ErrWeChatOfficialFailed
	}
	identity := WeChatOfficialIdentity{OpenID: token.OpenID}
	profile, err := weChatOfficialRequest(ctx, "sns/userinfo", url.Values{"access_token": {token.AccessToken}, "openid": {token.OpenID}, "lang": {"zh_CN"}})
	// Optional profile failure never invalidates an already verified OpenID.
	if err != nil {
		return identity, nil
	}
	if profile.OpenID == "" {
		return identity, nil
	}
	if profile.OpenID != token.OpenID {
		return WeChatOfficialIdentity{}, ErrWeChatOfficialFailed
	}
	identity.Nickname = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, profile.Nickname))
	if runes := []rune(identity.Nickname); len(runes) > 20 {
		identity.Nickname = string(runes[:20])
	}
	avatar, err := url.Parse(profile.HeadImgURL)
	if err == nil && avatar.Scheme == "https" && avatar.Hostname() != "" && avatar.User == nil && len(profile.HeadImgURL) <= 2048 {
		identity.AvatarURL = profile.HeadImgURL
	}
	return identity, nil
}
