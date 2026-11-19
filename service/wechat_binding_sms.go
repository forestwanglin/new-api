package service

import (
	"crypto/hmac"
	"errors"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
)

const weChatBindingSMSPurpose = "wechat_binding_sms"

var ErrBindingSMSDelivery = errors.New("SMS delivery failed. Please try again later.")

type WeChatBindingVerification struct {
	SMSRequired bool   `json:"sms_required"`
	PhoneMasked string `json:"phone_masked"`
}

type weChatBindingSMSPayload struct {
	Phone    string              `json:"phone"`
	Digest   string              `json:"digest,omitempty"`
	Binding  VerificationBinding `json:"binding"`
	Identity AuthIdentity        `json:"identity"`
}

func GetWeChatBindingVerification(identity AuthIdentity) (*WeChatBindingVerification, error) {
	if err := ValidateStepUpIdentity(identity); err != nil {
		return nil, err
	}
	// SMS is a restricted authenticator and must never downgrade enrolled MFA.
	state, err := model.GetUserVerificationState(identity.UserID)
	if err != nil {
		return nil, err
	}
	result := &WeChatBindingVerification{}
	if state.HasTwoFA || state.HasPasskey {
		return result, nil
	}
	if _, token := model.ParseAccessTokenSessionID(identity.SessionID); token {
		return result, nil
	}
	var claim model.ExternalIdentityClaim
	err = model.DB.Where("provider = ? AND user_id = ?", model.ExternalIdentityProviderPhone, identity.UserID).Take(&claim).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return result, nil
	}
	if err != nil {
		return nil, err
	}
	if !mainlandPhonePattern.MatchString(claim.Subject) {
		return nil, ErrVerificationUnavailable
	}
	result.SMSRequired = true
	result.PhoneMasked = claim.Subject[:3] + "****" + claim.Subject[7:]
	return result, nil
}

func isWeChatBindingOperation(operation VerificationOperation) bool {
	var context AccountBindingContext
	return operation.Scope == VerificationScopeAccountBind && common.Unmarshal(operation.Context, &context) == nil && (context.Provider == "wechat" || context.Provider == "wechat_official")
}

func requireWeChatBindingSMS(identity AuthIdentity, operation VerificationOperation) (string, error) {
	if !isWeChatBindingOperation(operation) {
		return "", ErrProofScope
	}
	if _, err := BindVerificationOperation(operation); err != nil {
		return "", err
	}
	status, err := GetWeChatBindingVerification(identity)
	if err != nil {
		return "", err
	}
	var bindingContext AccountBindingContext
	_ = common.Unmarshal(operation.Context, &bindingContext)
	available := common.WeChatAuthEnabled
	if bindingContext.Provider == "wechat_official" {
		available = model.WeChatOfficialAvailable()
	}
	if !status.SMSRequired || !PhoneSMSConfigured() || !available {
		return "", ErrVerificationUnavailable
	}
	var claim model.ExternalIdentityClaim
	if err := model.DB.Where("provider = ? AND user_id = ?", model.ExternalIdentityProviderPhone, identity.UserID).Take(&claim).Error; err != nil {
		return "", err
	}
	return claim.Subject, nil
}

func validateBindingPhoneWithTx(tx *gorm.DB, identity AuthIdentity, phone string) error {
	var count int64
	if err := tx.Model(&model.ExternalIdentityClaim{}).Where("provider = ? AND user_id = ? AND subject = ?", model.ExternalIdentityProviderPhone, identity.UserID, phone).Count(&count).Error; err != nil {
		return err
	}
	if count != 1 {
		return ErrProofMethod
	}
	// Recheck enrollment under the user lock acquired by ValidateAuthSessionWithTx.
	var twoFA, passkey int64
	if err := tx.Model(&model.TwoFA{}).Where("user_id = ? AND is_enabled = ?", identity.UserID, true).Count(&twoFA).Error; err != nil {
		return err
	}
	if err := tx.Model(&model.PasskeyCredential{}).Where("user_id = ?", identity.UserID).Count(&passkey).Error; err != nil {
		return err
	}
	if twoFA != 0 || passkey != 0 {
		return ErrProofMethod
	}
	return nil
}

func SendWeChatBindingSMS(identity AuthIdentity, operation VerificationOperation, ip string) (string, error) {
	phone, err := requireWeChatBindingSMS(identity, operation)
	if err != nil {
		return "", err
	}
	binding, err := BindVerificationOperation(operation)
	if err != nil {
		return "", err
	}
	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		if err := model.ValidateAuthSessionWithTx(tx, identity); err != nil {
			return err
		}
		if err := validateBindingPhoneWithTx(tx, identity, phone); err != nil {
			return err
		}
		return reservePhoneSend(tx, phone, ip)
	}); err != nil {
		return "", err
	}
	code, err := randomPhoneDigits(6)
	if err != nil {
		return "", err
	}
	if err := SendAliyunSMS(phone, code); err != nil {
		return "", ErrBindingSMSDelivery
	}
	digest, err := common.Password2Hash(phoneCodeDigest(code))
	if err != nil {
		return "", err
	}
	payload, err := common.Marshal(weChatBindingSMSPayload{Phone: phone, Digest: digest, Binding: binding, Identity: identity})
	if err != nil {
		return "", err
	}
	// Invalidate only this ceremony's codes. Login codes are a separate purpose.
	if err := model.DB.Model(&model.AuthFlow{}).Where("purpose = ? AND user_id = ? AND session_id = ? AND consumed_at IS NULL", weChatBindingSMSPurpose, identity.UserID, identity.SessionID).Update("consumed_at", time.Now()).Error; err != nil {
		return "", err
	}
	token, _, err := model.CreateAuthFlow(model.AuthFlowCreate{Purpose: weChatBindingSMSPurpose, UserId: identity.UserID, SessionId: identity.SessionID, Payload: string(payload), ExpiresAt: time.Now().Add(5 * time.Minute)})
	return token, err
}

func VerifyWeChatBindingSMS(identity AuthIdentity, operation VerificationOperation, token, code string) (*SecurityProof, error) {
	phone, err := requireWeChatBindingSMS(identity, operation)
	if err != nil {
		return nil, err
	}
	binding, err := BindVerificationOperation(operation)
	if err != nil {
		return nil, err
	}
	match := model.AuthFlowMatch{Purpose: weChatBindingSMSPurpose, UserId: identity.UserID, SessionId: identity.SessionID}
	flow, err := model.GetAuthFlow(token, match)
	if err != nil {
		return nil, ErrVerificationFailed
	}
	var payload weChatBindingSMSPayload
	if common.UnmarshalJsonStr(flow.Payload, &payload) != nil || payload.Identity != identity || payload.Phone != phone || payload.Binding.Scope != binding.Scope || !hmac.Equal([]byte(payload.Binding.ContextHash), []byte(binding.ContextHash)) {
		return nil, ErrVerificationFailed
	}
	if err := model.AttemptAuthFlow(token, weChatBindingSMSPurpose, 5); err != nil {
		return nil, ErrVerificationFailed
	}
	code = strings.TrimSpace(code)
	if len(code) != 6 || !common.ValidatePasswordAndHash(phoneCodeDigest(code), payload.Digest) {
		return nil, ErrVerificationFailed
	}
	_, err = model.ConsumeAuthFlowWithAction(token, match, func(tx *gorm.DB, _ *model.AuthFlow) error {
		if err := model.ValidateAuthSessionWithTx(tx, identity); err != nil {
			return err
		}
		return validateBindingPhoneWithTx(tx, identity, phone)
	})
	if err != nil {
		return nil, ErrVerificationFailed
	}
	// Consumption commits before issuing a proof: failure cannot restore the SMS.
	proofPayload, err := common.Marshal(weChatBindingSMSPayload{Phone: phone})
	if err != nil {
		return nil, err
	}
	proof, expiresAt, err := issueSecurityProof(identity, VerificationMethodSMS, binding, string(proofPayload))
	if err != nil {
		return nil, err
	}
	return &SecurityProof{ProofToken: proof, ExpiresAt: expiresAt, Method: VerificationMethodSMS, Scope: binding.Scope}, nil
}
