package system_setting

import "github.com/QuantumNous/new-api/setting/config"

type PhoneSettings struct {
	Enabled      bool   `json:"enabled"`
	Region       string `json:"region"`
	SignName     string `json:"sign_name"`
	TemplateCode string `json:"template_code"`
}

var phoneSettings = PhoneSettings{Region: "cn-hangzhou"}

func init()                            { config.GlobalConfig.Register("phone", &phoneSettings) }
func GetPhoneSettings() *PhoneSettings { return &phoneSettings }
