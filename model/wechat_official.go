package model

import (
	"errors"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

const weChatOfficialRevisionKey = "wechat_official.revision"

var ErrWeChatOfficialUnavailable = errors.New("WeChat Official Account authorization is unavailable. Please try again.")
var ErrWeChatOfficialConfiguration = errors.New("Invalid WeChat Official Account configuration. Check credentials and HTTPS site URL.")
var ErrWeChatOfficialAppIDPinned = errors.New("The WeChat AppID identity namespace is pinned. A separate identity migration is required to change it.")
var officialAppIDPattern = regexp.MustCompile(`^wx[a-zA-Z0-9]{16}$`)

type WeChatOfficialConfig struct {
	Enabled     bool
	AppID       string
	AppSecret   string
	CallbackURL string
	Fingerprint string
	Revision    string
	PinnedAppID string
}

func ReadWeChatOfficialConfig(tx *gorm.DB) (WeChatOfficialConfig, error) {
	var options []Option
	if err := tx.Where(tx.Statement.Quote("key")+" LIKE ? OR "+tx.Statement.Quote("key")+" = ?", "wechat_official.%", "ServerAddress").Find(&options).Error; err != nil {
		return WeChatOfficialConfig{}, err
	}
	values := map[string]string{}
	for _, o := range options {
		values[o.Key] = o.Value
	}
	cfg := WeChatOfficialConfig{Enabled: values["wechat_official.enabled"] == "true", AppID: values["wechat_official.app_id"], AppSecret: values["wechat_official.app_secret"], Revision: values[weChatOfficialRevisionKey], PinnedAppID: values["wechat_official.pinned_app_id"]}
	// Never trust the request Host or an instance-local stale site configuration.
	site, err := url.Parse(strings.TrimRight(values["ServerAddress"], "/"))
	if err == nil && site.Scheme == "https" && site.Hostname() != "" && site.User == nil && site.RawQuery == "" && site.Fragment == "" && (site.Path == "" || site.Path == "/") {
		cfg.CallbackURL = strings.TrimRight(site.String(), "/") + "/api/oauth/wechat_official/callback"
	}
	cfg.Fingerprint = common.GenerateHMACWithKey([]byte("wechat-official-config:"+common.SessionSecret), cfg.Revision+"\x00"+cfg.AppID+"\x00"+cfg.AppSecret+"\x00"+cfg.CallbackURL)
	return cfg, nil
}

func (c WeChatOfficialConfig) Ready() bool {
	callback, err := url.Parse(c.CallbackURL)
	if err != nil {
		return false
	}
	origin, err := common.NormalizeOrigin(callback.Scheme + "://" + callback.Host)
	if err != nil || !slices.Contains(common.SessionCookieTrustedURLs, origin) {
		return false
	}

	return common.SessionCookieSecure && c.Enabled && officialAppIDPattern.MatchString(c.AppID) && c.AppSecret != "" && c.CallbackURL != "" && c.Revision != "" && c.AppID == c.PinnedAppID
}
func RequireWeChatOfficialConfig(tx *gorm.DB, fingerprint string) (WeChatOfficialConfig, error) {
	c, err := ReadWeChatOfficialConfig(tx)
	if err != nil {
		return c, err
	}
	if !c.Ready() || (fingerprint != "" && c.Fingerprint != fingerprint) {
		return c, ErrWeChatOfficialUnavailable
	}
	return c, nil
}
func WeChatOfficialAvailable() bool {
	c, err := ReadWeChatOfficialConfig(DB)
	return err == nil && c.Ready()
}
func IsWeChatOfficialOption(key string) bool { return strings.HasPrefix(key, "wechat_official.") }

// The revision row is the first write and serializes configuration edits on all
// supported databases, including SQLite. Disable/re-enable cannot revive flows.
func UpdateWeChatOfficialOption(key, value string) error {
	if key != "wechat_official.enabled" && key != "wechat_official.app_id" && key != "wechat_official.app_secret" {
		return ErrWeChatOfficialConfiguration
	}
	value = strings.TrimSpace(value)
	if key == "wechat_official.app_secret" && value == "" {
		return nil
	}
	if key == "wechat_official.enabled" && value != "true" && value != "false" {
		return ErrWeChatOfficialConfiguration
	}
	if key == "wechat_official.app_id" && value != "" && !officialAppIDPattern.MatchString(value) {
		return ErrWeChatOfficialConfiguration
	}
	if key == "wechat_official.app_secret" && (len(value) > 256 || strings.ContainsAny(value, "\r\n\x00")) {
		return ErrWeChatOfficialConfiguration
	}
	err := DB.Session(&gorm.Session{Logger: logger.Discard}).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&Option{Key: weChatOfficialRevisionKey, Value: "initial"}).Error; err != nil {
			return err
		}
		if err := tx.Model(&Option{}).Where(tx.Statement.Quote("key")+" = ?", weChatOfficialRevisionKey).Update("value", common.GetRandomString(32)).Error; err != nil {
			return err
		}
		cfg, err := ReadWeChatOfficialConfig(tx)
		if err != nil {
			return err
		}
		if key == "wechat_official.app_id" && cfg.PinnedAppID != "" && value != cfg.PinnedAppID {
			return ErrWeChatOfficialAppIDPinned
		}
		if err := tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(&Option{Key: key, Value: value}).Error; err != nil {
			return err
		}
		if key == "wechat_official.app_id" && value != "" && cfg.PinnedAppID == "" {
			if err := tx.Create(&Option{Key: "wechat_official.pinned_app_id", Value: value}).Error; err != nil {
				return err
			}
		}
		cfg, err = ReadWeChatOfficialConfig(tx)
		if err != nil {
			return err
		}
		if cfg.Enabled && !cfg.Ready() {
			return ErrWeChatOfficialConfiguration
		}
		return nil
	})
	if err != nil {
		return err
	}
	return updateOptionMap(key, value)
}

// TransitionWeChatOfficialFlow is a compare-and-swap, not a JSON SQL update.
// The exact previous payload prevents concurrent scanners from replacing state.
func TransitionWeChatOfficialFlow(tx *gorm.DB, flow *AuthFlow, payload string) error {
	result := tx.Model(&AuthFlow{}).Where("id = ? AND payload = ? AND consumed_at IS NULL AND expires_at > ?", flow.Id, flow.Payload, time.Now()).Update("payload", payload)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrAuthFlowInvalid
	}
	flow.Payload = payload
	return nil
}

// LockWeChatOfficialConfig serializes a final mutation with administrator edits.
// It must run in the caller's transaction before committing a credential/proof.
func LockWeChatOfficialConfig(tx *gorm.DB, fingerprint string) (WeChatOfficialConfig, error) {
	if err := tx.Model(&Option{}).Where(tx.Statement.Quote("key")+" = ?", weChatOfficialRevisionKey).Update("value", gorm.Expr("value")).Error; err != nil {
		return WeChatOfficialConfig{}, err
	}
	return RequireWeChatOfficialConfig(lockForUpdate(tx), fingerprint)
}
