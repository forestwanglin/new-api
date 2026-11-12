package controller

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type wechatLoginResponse struct {
	Success bool            `json:"success"`
	Message string          `json:"message"`
	Data    string          `json:"data"`
	Profile json.RawMessage `json:"profile"`
}

type wechatProfile struct {
	Nickname  string `json:"nickname"`
	AvatarURL string `json:"avatar_url"`
}

type wechatIdentity struct {
	OpenID  string
	Profile wechatProfile
}

func getWeChatIdentityByCode(code string) (wechatIdentity, error) {
	result, err := getWeChatResponseByCode(code)
	if err != nil {
		return wechatIdentity{}, err
	}
	identity := wechatIdentity{OpenID: result.Data}
	if len(result.Profile) == 0 || common.Unmarshal(result.Profile, &identity.Profile) != nil {
		return wechatIdentity{OpenID: result.Data}, nil
	}
	identity.Profile.Nickname = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, identity.Profile.Nickname))
	if name := []rune(identity.Profile.Nickname); len(name) > 20 {
		identity.Profile.Nickname = string(name[:20])
	}
	avatar, err := url.Parse(identity.Profile.AvatarURL)
	if err != nil || avatar.Scheme != "https" || avatar.Hostname() == "" || avatar.User != nil || len(identity.Profile.AvatarURL) > 2048 {
		identity.Profile.AvatarURL = ""
	}
	return identity, nil
}

func getWeChatResponseByCode(code string) (*wechatLoginResponse, error) {
	if code == "" {
		return nil, common.NewMessage("Invalid parameters")
	}
	req, err := http.NewRequest("GET", fmt.Sprintf("%s/api/wechat/user?code=%s", common.WeChatServerAddress, url.QueryEscape(code)), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", common.WeChatServerToken)
	client := http.Client{
		Timeout: 5 * time.Second,
	}
	httpResponse, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer httpResponse.Body.Close()
	var res wechatLoginResponse
	err = common.DecodeJson(httpResponse.Body, &res)
	if err != nil {
		return nil, err
	}
	if !res.Success {
		return nil, errors.New(res.Message)
	}
	if res.Data == "" {
		return nil, common.NewMessage("Verification code is incorrect or has expired")
	}
	return &res, nil
}

func WeChatAuth(c *gin.Context) {
	if !common.WeChatAuthEnabled {
		common.ApiErrorT(c, "{{provider}} login and registration has not been enabled by administrator", providerParams("WeChat"))
		return
	}
	code := c.Query("code")
	identity, err := getWeChatIdentityByCode(code)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	wechatId := identity.OpenID
	user := model.User{
		WeChatId: wechatId,
	}
	if model.IsWeChatIdAlreadyTaken(wechatId) {
		err := user.FillUserByWeChatId()
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if user.Id == 0 {
			common.ApiErrorT(c, "User has been deleted")
			return
		}
	} else {
		if common.RegisterEnabled {
			user.Username = "wechat_" + strconv.Itoa(model.GetMaxUserId()+1)
			user.DisplayName = "WeChat User"
			if identity.Profile.Nickname != "" {
				user.DisplayName = identity.Profile.Nickname
			}
			if identity.Profile.AvatarURL != "" {
				user.AvatarURL = identity.Profile.AvatarURL
				user.AvatarSource = "wechat"
			}
			user.Role = common.RoleCommonUser
			user.Status = common.UserStatusEnabled

			if err := user.Insert(0); err != nil {
				common.ApiError(c, err)
				return
			}
		} else {
			common.ApiErrorT(c, "New user registration has been disabled by administrator")
			return
		}
	}

	if user.Status != common.UserStatusEnabled {
		common.ApiErrorT(c, "User has been banned")
		return
	}
	if err := model.SyncWeChatProfile(user.Id, wechatId, identity.Profile.Nickname, identity.Profile.AvatarURL, false); err != nil {
		common.SysLog(fmt.Sprintf("WeChat optional profile synchronization failed for user %d", user.Id))
	}
	setupLogin(&user, nil, c)
}

type wechatBindRequest struct {
	Code string `json:"code"`
}

func WeChatBind(c *gin.Context) {
	identity, ok := middleware.GetStepUpIdentity(c)
	if !ok {
		writeSecurityOperationError(c, service.ErrAuthTokenInvalid)
		return
	}
	succeeded, notificationFailed := false, false
	defer func() {
		recordUserSecurityAudit(c, identity.UserID, "user.binding_bind", map[string]any{"provider": "wechat", "success": succeeded, "notification_failed": notificationFailed})
	}()
	if !common.WeChatAuthEnabled {
		common.ApiErrorT(c, "{{provider}} login and registration has not been enabled by administrator", providerParams("WeChat"))
		return
	}
	var req wechatBindRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid request")
		return
	}
	code := strings.TrimSpace(req.Code)
	context, err := common.Marshal(service.AccountBindingContext{Provider: "wechat", Code: code})
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	if middleware.RequireSecurityProof(c, service.VerificationOperation{Scope: service.VerificationScopeAccountBind, Context: context}) == nil {
		return
	}
	wechatIdentity, err := getWeChatIdentityByCode(code)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	wechatId := wechatIdentity.OpenID
	if model.IsWeChatIdAlreadyTaken(wechatId) {
		common.ApiErrorT(c, "This {{provider}} account has already been bound", providerParams("WeChat"))
		return
	}
	// 只更新绑定列，避免完整用户快照覆盖并发的封禁、降权或分组变更。
	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		return model.UpdateUserBindColumnForSessionWithTx(tx, identity, "wechat_id", wechatId)
	}); err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	succeeded = true
	if err := model.SyncWeChatProfile(identity.UserID, wechatId, "", wechatIdentity.Profile.AvatarURL, true); err != nil {
		common.SysLog(fmt.Sprintf("WeChat optional profile synchronization failed for user %d", identity.UserID))
	}
	user, err := model.GetUserById(identity.UserID, false)
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	notificationFailed = service.NotifyAccountSecurityChange(service.AccountMailLanguage(c, user.Id), user.Email, i18n.MsgSecurityEventWeChatLinked) != nil
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    gin.H{"notification_warning": notificationFailed},
	})
	return
}
