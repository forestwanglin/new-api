package service

import (
	"crypto/hmac"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
)

const VerificationScopePhoneBinding = "phone.binding"
const phoneBindingPurpose = "phone_change_binding_v2"

type phoneBindingContact struct {
	Method  string `json:"method"`
	Subject string `json:"subject"`
}

type PhoneBindingAuthorization struct {
	Token     string `json:"token"`
	ExpiresAt int64  `json:"expires_at"`
}

// First binding has its own routing policy; generic account and token proofs
// cannot authorize it. Current account ownership is always selected server-side.
func getPhoneBindingContact(tx *gorm.DB, userID int) (phoneBindingContact, error) {
	phone, err := getCurrentPhone(tx, userID)
	if err != nil {
		return phoneBindingContact{}, err
	}
	if phone != "" {
		return phoneBindingContact{}, model.ErrAccountBindingChanged
	}
	var user model.User
	if err := tx.Select("id", "wechat_id").First(&user, userID).Error; err != nil {
		return phoneBindingContact{}, err
	}
	if user.WeChatId != "" {
		return phoneBindingContact{Method: VerificationMethodWeChat, Subject: user.WeChatId}, nil
	}
	return phoneBindingContact{Method: VerificationMethodPassword}, nil
}

func phoneBindingRequirements(identity AuthIdentity, state *model.UserVerificationState) (*VerificationRequirements, error) {
	if _, pat := model.ParseAccessTokenSessionID(identity.SessionID); pat {
		return nil, ErrVerificationForbidden
	}
	if err := ValidateStepUpIdentity(identity); err != nil {
		return nil, err
	}
	contact, err := getPhoneBindingContact(model.DB, identity.UserID)
	if err != nil {
		return nil, err
	}
	available := state.HasPassword && common.PasswordLoginEnabled
	if contact.Method == VerificationMethodWeChat {
		available = contactMethodAvailable(accessTokenContact{Method: contact.Method, Subject: contact.Subject})
	}
	option := VerificationMethodOption{Method: contact.Method, Available: available}
	if !available {
		option.Reason = ErrVerificationUnavailable.Error()
	}
	requirements := &VerificationRequirements{Scope: VerificationScopePhoneBinding, Methods: []VerificationMethodOption{option}, OAuthProviders: []VerificationOAuthProvider{}, PasswordEncryptionEnabled: common.PasswordLoginEncryptionEnabled}
	if contact.Method == VerificationMethodWeChat {
		requirements.WeChatQRCode = common.WeChatAccountQRCodeImageURL
	}
	return requirements, nil
}

func validatePhoneBindingContactWithTx(tx *gorm.DB, identity AuthIdentity, method, payload string) error {
	current, err := getPhoneBindingContact(tx, identity.UserID)
	if err != nil {
		return err
	}
	var issued phoneBindingContact
	if common.UnmarshalJsonStr(payload, &issued) != nil || current.Method != method || issued.Method != method || !hmac.Equal([]byte(issued.Subject), []byte(current.Subject)) {
		return ErrProofMethod
	}
	if method == VerificationMethodWeChat && !contactMethodAvailable(accessTokenContact{Method: method, Subject: current.Subject}) {
		return ErrVerificationUnavailable
	}
	if method == VerificationMethodPassword {
		var user model.User
		if err := tx.Select("password").First(&user, identity.UserID).Error; err != nil {
			return err
		}
		if !common.PasswordLoginEnabled || user.Password == "" {
			return ErrVerificationUnavailable
		}
	}
	return nil
}

func issuePhoneBindingProof(identity AuthIdentity, binding VerificationBinding, method, openID string) (*SecurityProof, error) {
	if binding.Scope != VerificationScopePhoneBinding {
		return nil, ErrProofScope
	}
	if _, err := RequireVerificationMethod(identity, binding.Scope, method); err != nil {
		return nil, err
	}
	contact, err := getPhoneBindingContact(model.DB, identity.UserID)
	if err != nil {
		return nil, err
	}
	if contact.Method != method || (method == VerificationMethodWeChat && (openID == "" || !hmac.Equal([]byte(openID), []byte(contact.Subject)))) {
		return nil, ErrVerificationFailed
	}
	payload, err := common.Marshal(contact)
	if err != nil {
		return nil, err
	}
	token, expiresAt, err := issueSecurityProof(identity, method, binding, string(payload))
	if err != nil {
		return nil, err
	}
	return &SecurityProof{ProofToken: token, ExpiresAt: expiresAt, Method: method, Scope: binding.Scope}, nil
}

// The trusted WeChat service has already consumed the submitted code.
func CompletePhoneBindingWeChat(identity AuthIdentity, operation VerificationOperation, openID string) (*SecurityProof, error) {
	binding, err := BindVerificationOperation(operation)
	if err != nil {
		return nil, err
	}
	return issuePhoneBindingProof(identity, binding, VerificationMethodWeChat, openID)
}

func StartPhoneBinding(identity AuthIdentity, authorization *model.AuthFlowAuthorization) (*PhoneBindingAuthorization, error) {
	operation := VerificationOperation{Scope: VerificationScopePhoneBinding}
	if err := ValidateFlowAuthorization(identity, operation, authorization); err != nil {
		return nil, err
	}
	var proof model.AuthFlow
	expiresAt := time.Now().Add(10 * time.Minute).Truncate(time.Second)
	var contact phoneBindingContact
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		if err := model.ValidateAuthSessionWithTx(tx, identity); err != nil {
			return err
		}
		if err := tx.Where("id = ? AND purpose = ? AND user_id = ? AND session_id = ? AND consumed_at IS NOT NULL", authorization.ProofID, model.AuthFlowPurposeSecurityProof, identity.UserID, identity.SessionID).Take(&proof).Error; err != nil {
			return err
		}
		if err := validatePhoneBindingContactWithTx(tx, identity, authorization.Method, proof.Payload); err != nil {
			return err
		}
		return common.UnmarshalJsonStr(proof.Payload, &contact)
	})
	if err != nil {
		return nil, err
	}
	token, err := newPhoneChangeFlow(phoneBindingPurpose, phoneChangePayload{Identity: identity, BindingContact: &contact, BindingExpiresAt: expiresAt.Unix()}, time.Until(expiresAt))
	if err != nil {
		return nil, err
	}
	return &PhoneBindingAuthorization{Token: token, ExpiresAt: expiresAt.Unix()}, nil
}
