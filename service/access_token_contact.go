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

const accessTokenSMSPurpose = "access_token_sms"
const VerificationMethodWeChat = "wechat"

// Contact identity is private proof payload, never returned to the browser.
type accessTokenContact struct {
	Method  string `json:"method"`
	Subject string `json:"subject"`
}

type accessTokenSMSPayload struct {
	Contact  accessTokenContact  `json:"contact"`
	Digest   string              `json:"digest,omitempty"`
	Binding  VerificationBinding `json:"binding"`
	Identity AuthIdentity        `json:"identity"`
}

func getAccessTokenContact(db *gorm.DB, userID int) (accessTokenContact, error) {
	var user model.User
	if err := db.Select("id", "wechat_id").First(&user, userID).Error; err != nil {
		return accessTokenContact{}, err
	}
	if user.WeChatId != "" {
		return accessTokenContact{Method: VerificationMethodWeChat, Subject: user.WeChatId}, nil
	}
	var claim model.ExternalIdentityClaim
	err := db.Where("provider = ? AND user_id = ?", model.ExternalIdentityProviderPhone, userID).Take(&claim).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return accessTokenContact{}, nil
	}
	if err != nil {
		return accessTokenContact{}, err
	}
	return accessTokenContact{Method: VerificationMethodSMS, Subject: claim.Subject}, nil
}

func contactMethodAvailable(contact accessTokenContact) bool {
	switch contact.Method {
	case VerificationMethodWeChat:
		return common.WeChatAuthEnabled && strings.TrimSpace(common.WeChatServerAddress) != "" && strings.TrimSpace(common.WeChatServerToken) != ""
	case VerificationMethodSMS:
		return mainlandPhonePattern.MatchString(contact.Subject) && PhoneSMSConfigured()
	}
	return false
}

// supportsAccessTokenContactVerification covers the operations that change an
// access token's grant, so create, update and revoke share one contact policy.
func supportsAccessTokenContactVerification(scope string) bool {
	switch scope {
	case VerificationScopeAccessTokenGenerate, VerificationScopeAccessTokenUpdate, VerificationScopeAccessTokenRevoke:
		return true
	}
	return false
}

func requireAccessTokenContact(identity AuthIdentity, operation VerificationOperation, method string) (accessTokenContact, VerificationBinding, error) {
	if !supportsAccessTokenContactVerification(operation.Scope) {
		return accessTokenContact{}, VerificationBinding{}, ErrProofScope
	}
	binding, err := BindVerificationOperation(operation)
	if err != nil {
		return accessTokenContact{}, binding, err
	}
	if _, token := model.ParseAccessTokenSessionID(identity.SessionID); token {
		return accessTokenContact{}, binding, ErrVerificationForbidden
	}
	if err := ValidateStepUpIdentity(identity); err != nil {
		return accessTokenContact{}, binding, err
	}
	contact, err := getAccessTokenContact(model.DB, identity.UserID)
	if err != nil {
		return contact, binding, err
	}
	if contact.Method != method {
		return contact, binding, ErrProofMethod
	}
	if !contactMethodAvailable(contact) {
		return contact, binding, ErrVerificationUnavailable
	}
	return contact, binding, nil
}

// Called after the trusted WeChat server has consumed the submitted code.
func CompleteAccessTokenWeChat(identity AuthIdentity, operation VerificationOperation, openID string) (*SecurityProof, error) {
	contact, binding, err := requireAccessTokenContact(identity, operation, VerificationMethodWeChat)
	if err != nil {
		return nil, err
	}
	if openID == "" || !hmac.Equal([]byte(contact.Subject), []byte(openID)) {
		return nil, ErrVerificationFailed
	}
	return issueAccessTokenContactProof(identity, binding, contact)
}

func issueAccessTokenContactProof(identity AuthIdentity, binding VerificationBinding, contact accessTokenContact) (*SecurityProof, error) {
	payload, err := common.Marshal(contact)
	if err != nil {
		return nil, err
	}
	token, expiresAt, err := issueSecurityProof(identity, contact.Method, binding, string(payload))
	if err != nil {
		return nil, err
	}
	return &SecurityProof{ProofToken: token, ExpiresAt: expiresAt, Method: contact.Method, Scope: binding.Scope}, nil
}

// Validate under the user lock acquired by ValidateAuthSessionWithTx. An old
// password/MFA proof must also be rejected if a contact has since been bound.
func validateAccessTokenContactWithTx(tx *gorm.DB, identity AuthIdentity, method, payload string) error {
	contact, err := getAccessTokenContact(tx, identity.UserID)
	if err != nil {
		return err
	}
	if contact.Method == "" {
		if method == VerificationMethodSMS || method == VerificationMethodWeChat {
			return ErrProofMethod
		}
		return nil
	}
	if method != contact.Method || !contactMethodAvailable(contact) {
		return ErrProofMethod
	}
	var issued accessTokenContact
	if common.UnmarshalJsonStr(payload, &issued) != nil || issued.Method != contact.Method || !hmac.Equal([]byte(issued.Subject), []byte(contact.Subject)) {
		return ErrProofMethod
	}
	return nil
}

func SendAccessTokenSMS(identity AuthIdentity, operation VerificationOperation, ip string) (string, error) {
	contact, binding, err := requireAccessTokenContact(identity, operation, VerificationMethodSMS)
	if err != nil {
		return "", err
	}
	contactPayload, err := common.Marshal(contact)
	if err != nil {
		return "", err
	}
	code, digest, err := newSMSCode()
	if err != nil {
		return "", err
	}
	payload, err := common.Marshal(accessTokenSMSPayload{Contact: contact, Digest: digest, Binding: binding, Identity: identity})
	if err != nil {
		return "", err
	}
	var token string
	var verification *model.AuthFlow
	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		if err := model.ValidateAuthSessionWithTx(tx, identity); err != nil {
			return err
		}
		if err := validateAccessTokenContactWithTx(tx, identity, VerificationMethodSMS, string(contactPayload)); err != nil {
			return err
		}
		if err := reservePhoneSend(tx, contact.Subject, ip); err != nil {
			return err
		}
		var err error
		token, verification, err = prepareSMSFlowWithTx(tx, model.AuthFlowCreate{Purpose: accessTokenSMSPurpose, UserId: identity.UserID, SessionId: identity.SessionID, Payload: string(payload), ExpiresAt: time.Now().Add(5 * time.Minute)})
		return err
	}); err != nil {
		return "", err
	}
	// This path is already authorized by the session and exact operation. It
	// requires no CAPTCHA retry grant; each explicit resend rechecks both.
	return dispatchPreparedSMS(contact.Subject, code, token, verification, nil)
}

func verifyAccessTokenSMS(identity AuthIdentity, operation VerificationOperation, token, code string) (*SecurityProof, error) {
	contact, binding, err := requireAccessTokenContact(identity, operation, VerificationMethodSMS)
	if err != nil {
		return nil, err
	}
	match := model.AuthFlowMatch{Purpose: accessTokenSMSPurpose, UserId: identity.UserID, SessionId: identity.SessionID}
	flow, err := model.GetAuthFlow(token, match)
	if err != nil || !smsFlowVerifiable(flow) {
		return nil, ErrVerificationFailed
	}
	var payload accessTokenSMSPayload
	if common.UnmarshalJsonStr(flow.Payload, &payload) != nil || payload.Identity != identity || payload.Contact != contact || payload.Binding.Scope != binding.Scope || !hmac.Equal([]byte(payload.Binding.ContextHash), []byte(binding.ContextHash)) {
		return nil, ErrVerificationFailed
	}
	if err := model.AttemptAuthFlow(token, accessTokenSMSPurpose, 5); err != nil {
		return nil, ErrVerificationFailed
	}
	code = strings.TrimSpace(code)
	if len(code) != 6 || !common.ValidatePasswordAndHash(phoneCodeDigest(code), payload.Digest) {
		return nil, ErrVerificationFailed
	}
	proofPayload, err := common.Marshal(contact)
	if err != nil {
		return nil, err
	}
	_, err = model.ConsumeAuthFlowWithAction(token, match, func(tx *gorm.DB, _ *model.AuthFlow) error {
		if err := model.ValidateAuthSessionWithTx(tx, identity); err != nil {
			return err
		}
		return validateAccessTokenContactWithTx(tx, identity, VerificationMethodSMS, string(proofPayload))
	})
	if err != nil {
		return nil, ErrVerificationFailed
	}
	return issueAccessTokenContactProof(identity, binding, contact)
}
