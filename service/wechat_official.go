package service

import (
	"context"
	"crypto/hmac"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
)

const officialFlowPurpose = "wechat_official_owner"
const officialStartPurpose = "wechat_official_start"
const officialScanPurpose = "wechat_official_scan"
const officialConsentPurpose = "wechat_official_consent"
const officialAssertionPurpose = "wechat_official_assert"

var ErrWeChatOfficialFlow = errors.New("WeChat authorization expired or changed. Please start again.")

type WeChatOfficialFlowRequest struct {
	Intent       string `json:"intent"`
	Aff          string `json:"aff,omitempty"`
	Scope        string `json:"scope,omitempty"`
	Context      []byte `json:"-"`
	SameDevice   bool   `json:"same_device,omitempty"`
	ReturnTarget string `json:"return_target,omitempty"`
}

type WeChatOfficialFlowPayload struct {
	Browser      string                 `json:"browser"`
	Identity     AuthIdentity           `json:"identity"`
	Intent       string                 `json:"intent"`
	Aff          string                 `json:"aff,omitempty"`
	Scope        string                 `json:"scope,omitempty"`
	Context      string                 `json:"context,omitempty"`
	ContextHash  string                 `json:"context_hash,omitempty"`
	SameDevice   bool                   `json:"same_device,omitempty"`
	ReturnTarget string                 `json:"return_target,omitempty"`
	Fingerprint  string                 `json:"fingerprint"`
	Status       string                 `json:"status"`
	Subject      WeChatOfficialIdentity `json:"subject"`
}

type officialLink struct {
	OwnerID     int64  `json:"owner_id"`
	Fingerprint string `json:"fingerprint"`
}

type WeChatOfficialFlow struct {
	FlowToken string `json:"flow_token"`
	QRURL     string `json:"qr_url"`
	ExpiresAt int64  `json:"expires_at"`
}

func officialMarshal(value any) (string, error) {
	b, err := common.Marshal(value)
	return string(b), err
}
func officialMatch(purpose string) model.AuthFlowMatch {
	return model.AuthFlowMatch{Purpose: purpose, Provider: "wechat_official"}
}
func officialOwner(tx *gorm.DB, id int64) (*model.AuthFlow, WeChatOfficialFlowPayload, error) {
	var flow model.AuthFlow
	var payload WeChatOfficialFlowPayload
	if err := tx.Where("id = ? AND purpose = ? AND provider = ? AND consumed_at IS NULL AND expires_at > ?", id, officialFlowPurpose, "wechat_official", time.Now()).First(&flow).Error; err != nil {
		return nil, payload, ErrWeChatOfficialFlow
	}
	if common.UnmarshalJsonStr(flow.Payload, &payload) != nil {
		return nil, payload, ErrWeChatOfficialFlow
	}
	if payload.Intent != "login" {
		if err := model.ValidateAuthSessionWithTx(tx, payload.Identity); err != nil {
			return nil, payload, err
		}
	}
	if _, err := model.LockWeChatOfficialConfig(tx, payload.Fingerprint); err != nil {
		return nil, payload, err
	}
	return &flow, payload, nil
}
func officialTransition(tx *gorm.DB, flow *model.AuthFlow, payload WeChatOfficialFlowPayload) error {
	encoded, err := officialMarshal(payload)
	if err != nil {
		return err
	}
	return model.TransitionWeChatOfficialFlow(tx, flow, encoded)
}

func NewWeChatOfficialFlow(browser string, identity AuthIdentity, req WeChatOfficialFlowRequest) (*WeChatOfficialFlow, error) {
	cfg, err := model.RequireWeChatOfficialConfig(model.DB, "")
	if err != nil {
		return nil, err
	}
	p := WeChatOfficialFlowPayload{Browser: browser, Identity: identity, Intent: req.Intent, Aff: req.Aff, Scope: req.Scope, Context: string(req.Context), SameDevice: req.SameDevice, Fingerprint: cfg.Fingerprint, Status: "pending"}
	if browser == "" {
		return nil, ErrWeChatOfficialFlow
	}
	if req.ReturnTarget != "" {
		u, err := url.Parse(req.ReturnTarget)
		if err != nil || !strings.HasPrefix(req.ReturnTarget, "/") || strings.HasPrefix(req.ReturnTarget, "//") || strings.ContainsAny(req.ReturnTarget, "\\\r\n") || u.IsAbs() || u.Host != "" || u.Fragment != "" || len(req.ReturnTarget) > 1024 || strings.HasPrefix(u.Path, "//") || strings.ContainsAny(u.Path, "\\\r\n\x00") {
			return nil, ErrWeChatOfficialFlow
		}
		p.ReturnTarget = req.ReturnTarget
	}
	switch req.Intent {
	case "login":
		if identity.UserID != 0 || req.Scope != "" || len(req.Context) > 0 || len(req.Aff) > 128 {
			return nil, ErrWeChatOfficialFlow
		}
	case "bind":
		if req.Aff != "" || req.Scope != "" || len(req.Context) > 0 {
			return nil, ErrWeChatOfficialFlow
		}
		if err := ValidateStepUpIdentity(identity); err != nil {
			return nil, err
		}
		var user model.User
		if err := model.DB.Select("wechat_id").First(&user, identity.UserID).Error; err != nil {
			return nil, err
		}
		if user.WeChatId != "" {
			return nil, model.ErrAccountBindingChanged
		}
	case "verify":
		if req.Aff != "" || (req.Scope != VerificationScopePhoneBinding && !supportsAccessTokenContactVerification(req.Scope)) {
			return nil, ErrProofScope
		}
		op := VerificationOperation{Scope: req.Scope, Context: req.Context}
		binding, err := BindVerificationOperation(op)
		if err != nil {
			return nil, err
		}
		p.ContextHash = binding.ContextHash
		if _, err := RequireVerificationMethod(identity, req.Scope, VerificationMethodWeChat); err != nil {
			return nil, err
		}
	default:
		return nil, ErrWeChatOfficialFlow
	}
	if _, pat := model.ParseAccessTokenSessionID(identity.SessionID); pat {
		return nil, ErrVerificationForbidden
	}
	expires := time.Now().Add(5 * time.Minute)
	result := &WeChatOfficialFlow{ExpiresAt: expires.Unix()}
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		if _, err := model.LockWeChatOfficialConfig(tx, cfg.Fingerprint); err != nil {
			return err
		}
		encoded, err := officialMarshal(p)
		if err != nil {
			return err
		}
		var owner *model.AuthFlow
		result.FlowToken, owner, err = model.CreateAuthFlowWithTx(tx, model.AuthFlowCreate{Purpose: officialFlowPurpose, Provider: "wechat_official", Intent: req.Intent, UserId: identity.UserID, SessionId: identity.SessionID, Payload: encoded, ExpiresAt: expires})
		if err != nil {
			return err
		}
		link, err := officialMarshal(officialLink{OwnerID: owner.Id, Fingerprint: cfg.Fingerprint})
		if err != nil {
			return err
		}
		start, _, err := model.CreateAuthFlowWithTx(tx, model.AuthFlowCreate{Purpose: officialStartPurpose, Provider: "wechat_official", Payload: link, ExpiresAt: expires})
		if err != nil {
			return err
		}
		result.QRURL = strings.TrimSuffix(cfg.CallbackURL, "/callback") + "/start?ref=" + url.QueryEscape(start)
		return nil
	})
	return result, err
}

func ownedOfficialFlow(token, browser string, identity AuthIdentity) (*model.AuthFlow, WeChatOfficialFlowPayload, error) {
	var p WeChatOfficialFlowPayload
	f, err := model.GetAuthFlow(token, officialMatch(officialFlowPurpose))
	if err != nil {
		return nil, p, ErrWeChatOfficialFlow
	}
	if common.UnmarshalJsonStr(f.Payload, &p) != nil || !hmac.Equal([]byte(p.Browser), []byte(browser)) || p.Identity != identity {
		return nil, p, ErrWeChatOfficialFlow
	}
	if _, err := model.RequireWeChatOfficialConfig(model.DB, p.Fingerprint); err != nil {
		return nil, p, err
	}
	if p.Intent != "login" {
		if err := ValidateStepUpIdentity(identity); err != nil {
			return nil, p, err
		}
	}
	return f, p, nil
}
func WeChatOfficialStatus(token, browser string, identity AuthIdentity) (string, error) {
	_, p, err := ownedOfficialFlow(token, browser, identity)
	return p.Status, err
}
func ResumeWeChatOfficial(token, browser string, identity AuthIdentity) (WeChatOfficialFlowPayload, error) {
	_, p, err := ownedOfficialFlow(token, browser, identity)
	if err == nil && !p.SameDevice {
		err = ErrWeChatOfficialFlow
	}
	return p, err
}
func CancelWeChatOfficial(token, browser string, identity AuthIdentity) error {
	f, p, err := ownedOfficialFlow(token, browser, identity)
	if err != nil {
		return err
	}
	p.Status = "cancelled"
	return officialTransition(model.DB, f, p)
}

func StartWeChatOfficial(ref string) (state, authorization string, err error) {
	var cfg model.WeChatOfficialConfig
	_, err = model.ConsumeAuthFlowWithAction(ref, officialMatch(officialStartPurpose), func(tx *gorm.DB, start *model.AuthFlow) error {
		var link officialLink
		if common.UnmarshalJsonStr(start.Payload, &link) != nil {
			return ErrWeChatOfficialFlow
		}
		cfgErr := error(nil)
		cfg, cfgErr = model.RequireWeChatOfficialConfig(tx, link.Fingerprint)
		if cfgErr != nil {
			return cfgErr
		}
		owner, p, e := officialOwner(tx, link.OwnerID)
		if e != nil {
			return e
		}
		if p.Status != "pending" {
			return ErrWeChatOfficialFlow
		}
		p.Status = "scanning"
		if e = officialTransition(tx, owner, p); e != nil {
			return e
		}
		state, _, e = model.CreateAuthFlowWithTx(tx, model.AuthFlowCreate{Purpose: officialScanPurpose, Provider: "wechat_official", Payload: start.Payload, ExpiresAt: owner.ExpiresAt})
		return e
	})
	if err != nil {
		return "", "", ErrWeChatOfficialFlow
	}
	raw, err := base64.RawURLEncoding.DecodeString(state)
	if err != nil {
		return "", "", ErrWeChatOfficialFlow
	}
	state = hex.EncodeToString(raw)
	return state, WeChatOfficialAuthorizationURL(cfg, state), nil
}

// Claim the scanner state BEFORE provider HTTP. Uncertain exchanges require a
// fresh ceremony; neither reloads nor competing callbacks retry a provider code.
func CallbackWeChatOfficial(ctx context.Context, state, code string) (string, error) {
	raw, err := hex.DecodeString(state)
	if err != nil || len(raw) != 32 {
		return "", ErrWeChatOfficialFlow
	}
	state = base64.RawURLEncoding.EncodeToString(raw)
	var link officialLink
	var cfg model.WeChatOfficialConfig
	_, err = model.ConsumeAuthFlowWithAction(state, officialMatch(officialScanPurpose), func(tx *gorm.DB, f *model.AuthFlow) error {
		if common.UnmarshalJsonStr(f.Payload, &link) != nil {
			return ErrWeChatOfficialFlow
		}
		var e error
		cfg, e = model.RequireWeChatOfficialConfig(tx, link.Fingerprint)
		if e != nil {
			return e
		}
		_, p, e := officialOwner(tx, link.OwnerID)
		if e != nil || p.Status != "scanning" {
			return ErrWeChatOfficialFlow
		}
		return nil
	})
	if err != nil {
		return "", ErrWeChatOfficialFlow
	}
	subject, exchangeErr := exchangeWeChatOfficial(ctx, cfg, code)
	var confirmation string
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		owner, p, e := officialOwner(tx, link.OwnerID)
		if e != nil {
			return e
		}
		if p.Status != "scanning" {
			return ErrWeChatOfficialFlow
		}
		if exchangeErr != nil {
			p.Status = "failed"
			return officialTransition(tx, owner, p)
		}
		p.Subject = subject
		p.Status = "awaiting_consent"
		if e = officialTransition(tx, owner, p); e != nil {
			return e
		}
		encoded, e := officialMarshal(link)
		if e != nil {
			return e
		}
		confirmation, _, e = model.CreateAuthFlowWithTx(tx, model.AuthFlowCreate{Purpose: officialConsentPurpose, Provider: "wechat_official", Payload: encoded, ExpiresAt: owner.ExpiresAt})
		return e
	})
	if err != nil || exchangeErr != nil {
		return "", ErrWeChatOfficialFailed
	}
	return confirmation, nil
}

type WeChatOfficialConfirmation struct {
	OfficialAccountName string `json:"official_account_name"`
	OfficialAccountLogo string `json:"official_account_logo"`
	Intent              string `json:"intent"`
	SiteName            string `json:"site_name"`
	ExpiresAt           int64  `json:"expires_at"`
	SameDevice          bool   `json:"same_device"`
}

func GetWeChatOfficialConfirmation(token string) (WeChatOfficialConfirmation, error) {
	f, err := model.GetAuthFlow(token, officialMatch(officialConsentPurpose))
	if err != nil {
		return WeChatOfficialConfirmation{}, ErrWeChatOfficialFlow
	}
	var link officialLink
	if common.UnmarshalJsonStr(f.Payload, &link) != nil {
		return WeChatOfficialConfirmation{}, ErrWeChatOfficialFlow
	}
	_, p, err := officialOwner(model.DB, link.OwnerID)
	if err != nil || p.Status != "awaiting_consent" {
		return WeChatOfficialConfirmation{}, ErrWeChatOfficialFlow
	}
	cfg, err := model.RequireWeChatOfficialConfig(model.DB, p.Fingerprint)
	if err != nil {
		return WeChatOfficialConfirmation{}, err
	}
	site, _ := url.Parse(cfg.CallbackURL)
	return WeChatOfficialConfirmation{OfficialAccountName: cfg.DisplayName, OfficialAccountLogo: cfg.LogoURL, Intent: p.Intent, SiteName: site.Hostname(), ExpiresAt: f.ExpiresAt.Unix(), SameDevice: p.SameDevice}, nil
}
func ConfirmWeChatOfficial(token string, confirmed bool) error {
	_, err := model.ConsumeAuthFlowWithAction(token, officialMatch(officialConsentPurpose), func(tx *gorm.DB, f *model.AuthFlow) error {
		var link officialLink
		if common.UnmarshalJsonStr(f.Payload, &link) != nil {
			return ErrWeChatOfficialFlow
		}
		owner, p, e := officialOwner(tx, link.OwnerID)
		if e != nil {
			return e
		}
		if p.Status != "awaiting_consent" {
			return ErrWeChatOfficialFlow
		}
		p.Status = "denied"
		if confirmed {
			p.Status = "authorized"
		}
		return officialTransition(tx, owner, p)
	})
	return err
}

// Only the initiating browser can consume an explicitly confirmed identity.
func CompleteWeChatOfficial(token, browser string, identity AuthIdentity) (WeChatOfficialFlowPayload, string, *SecurityProof, error) {
	_, p, err := ownedOfficialFlow(token, browser, identity)
	if err != nil {
		return p, "", nil, err
	}
	var assertion string
	_, err = model.ConsumeAuthFlowWithAction(token, officialMatch(officialFlowPurpose), func(tx *gorm.DB, f *model.AuthFlow) error {
		if common.UnmarshalJsonStr(f.Payload, &p) != nil || p.Browser != browser || p.Identity != identity || p.Status != "authorized" {
			return ErrWeChatOfficialFlow
		}
		if p.Intent != "login" {
			if e := model.ValidateAuthSessionWithTx(tx, identity); e != nil {
				return e
			}
		}
		if _, e := model.LockWeChatOfficialConfig(tx, p.Fingerprint); e != nil {
			return e
		}
		if p.Intent == "bind" {
			var e error
			assertion, _, e = model.CreateAuthFlowWithTx(tx, model.AuthFlowCreate{Purpose: officialAssertionPurpose, Provider: "wechat_official", UserId: identity.UserID, SessionId: identity.SessionID, Payload: f.Payload, ExpiresAt: f.ExpiresAt})
			return e
		}
		return nil
	})
	if err != nil {
		return p, "", nil, err
	}
	if p.Intent == "verify" {
		proof, err := completeOfficialVerification(identity, VerificationOperation{Scope: p.Scope, Context: []byte(p.Context)}, p.Subject.OpenID, p.Fingerprint)
		return p, "", proof, err
	}
	return p, assertion, nil, nil
}

func GetWeChatOfficialAssertion(token, browser string, identity AuthIdentity) (WeChatOfficialFlowPayload, error) {
	var p WeChatOfficialFlowPayload
	f, err := model.GetAuthFlow(token, model.AuthFlowMatch{Purpose: officialAssertionPurpose, Provider: "wechat_official", UserId: identity.UserID, SessionId: identity.SessionID})
	if err != nil || common.UnmarshalJsonStr(f.Payload, &p) != nil || p.Intent != "bind" || p.Identity != identity || p.Browser != browser {
		return p, ErrWeChatOfficialFlow
	}
	if _, err := model.RequireWeChatOfficialConfig(model.DB, p.Fingerprint); err != nil {
		return p, err
	}
	return p, ValidateStepUpIdentity(identity)
}
func BindWeChatOfficialAssertion(token, browser, proof string, identity AuthIdentity) (WeChatOfficialIdentity, error) {
	p, err := GetWeChatOfficialAssertion(token, browser, identity)
	if err != nil {
		return p.Subject, err
	}

	context, _ := common.Marshal(AccountBindingContext{Provider: "wechat_official", Code: token})
	_, err = ConsumeOperationProofWithAction(proof, identity, VerificationOperation{Scope: VerificationScopeAccountBind, Context: context}, func(tx *gorm.DB) error {
		if _, e := model.LockWeChatOfficialConfig(tx, p.Fingerprint); e != nil {
			return e
		}
		_, e := model.ConsumeAuthFlowWithTx(tx, token, model.AuthFlowMatch{Purpose: officialAssertionPurpose, Provider: "wechat_official", UserId: identity.UserID, SessionId: identity.SessionID}, func(tx *gorm.DB, f *model.AuthFlow) error {
			return model.UpdateUserBindColumnForSessionWithTx(tx, identity, "wechat_id", p.Subject.OpenID)
		})
		return e
	})
	return p.Subject, err
}

func LegacyWeChatAvailable() bool {
	return common.WeChatAuthEnabled && strings.TrimSpace(common.WeChatServerAddress) != "" && strings.TrimSpace(common.WeChatServerToken) != ""
}
func AvailableWeChatMethods() []string {
	methods := []string{}
	if LegacyWeChatAvailable() {
		methods = append(methods, "code")
	}
	if model.WeChatOfficialAvailable() {
		methods = append(methods, "official")
	}
	return methods
}
func validateWeChatProofConfig(tx *gorm.DB, method, fingerprint string) error {
	if method != VerificationMethodWeChat {
		return nil
	}
	if fingerprint == "" {
		if !LegacyWeChatAvailable() {
			return ErrVerificationUnavailable
		}
		return nil
	}
	_, err := model.LockWeChatOfficialConfig(tx, fingerprint)
	return err
}
func completeOfficialVerification(identity AuthIdentity, operation VerificationOperation, openid, fingerprint string) (*SecurityProof, error) {
	if _, err := model.RequireWeChatOfficialConfig(model.DB, fingerprint); err != nil {
		return nil, err
	}
	binding, err := BindVerificationOperation(operation)
	if err != nil {
		return nil, err
	}
	if _, err := RequireVerificationMethod(identity, binding.Scope, VerificationMethodWeChat); err != nil {
		return nil, err
	}
	var payload string
	if operation.Scope == VerificationScopePhoneBinding {
		contact, err := getPhoneBindingContact(model.DB, identity.UserID)
		if err != nil {
			return nil, err
		}
		if contact.Method != VerificationMethodWeChat || !hmac.Equal([]byte(contact.Subject), []byte(openid)) {
			return nil, ErrVerificationFailed
		}
		contact.OfficialFingerprint = fingerprint
		payload, err = officialMarshal(contact)
		if err != nil {
			return nil, err
		}
	} else {
		contact, _, err := requireAccessTokenContact(identity, operation, VerificationMethodWeChat)
		if err != nil {
			return nil, err
		}
		if !hmac.Equal([]byte(contact.Subject), []byte(openid)) {
			return nil, ErrVerificationFailed
		}
		contact.OfficialFingerprint = fingerprint
		payload, err = officialMarshal(contact)
		if err != nil {
			return nil, err
		}
	}
	token, expires, err := issueSecurityProof(identity, VerificationMethodWeChat, binding, payload)
	if err != nil {
		return nil, err
	}
	return &SecurityProof{ProofToken: token, ExpiresAt: expires, Method: VerificationMethodWeChat, Scope: binding.Scope}, nil
}
