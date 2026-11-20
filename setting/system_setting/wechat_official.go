package system_setting

import "github.com/QuantumNous/new-api/setting/config"

// Runtime authorization deliberately reads authoritative options from the DB;
// the registry only supplies defaults and administrator option discovery.
type WeChatOfficialSettings struct {
	DisplayName string `json:"display_name"`
	LogoURL     string `json:"logo_url"`
	Enabled     bool   `json:"enabled"`
	AppID       string `json:"app_id"`
	AppSecret   string `json:"app_secret"`
}

func init() { config.GlobalConfig.Register("wechat_official", &WeChatOfficialSettings{}) }
