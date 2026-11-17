package service

import (
	"crypto/subtle"
	"errors"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
)

const phoneChangeSMSPurpose = "phone_change_sms_v2"
const phoneChangeOldPurpose = "phone_change_old_v2"
const phoneChangeReadyPurpose = "phone_change_ready_v2"

type PhoneChangeStatus struct {
	Bound                bool   `json:"bound"`
	PhoneMasked          string `json:"phone_masked"`
	VerificationRequired bool   `json:"verification_required"`
}

type phoneChangePayload struct {
	Identity         AuthIdentity         `json:"identity"`
	Original         string               `json:"original"`
	Phone            string               `json:"phone"`
	Step             string               `json:"step"`
	Digest           string               `json:"digest,omitempty"`
	BindingContact   *phoneBindingContact `json:"binding_contact,omitempty"`
	BindingExpiresAt int64                `json:"binding_expires_at,omitempty"`
}

func getCurrentPhone(tx *gorm.DB, userID int) (string, error) {
	var claim model.ExternalIdentityClaim
	err := tx.Where("provider = ? AND user_id = ?", model.ExternalIdentityProviderPhone, userID).Take(&claim).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	return claim.Subject, err
}

func GetPhoneChangeStatus(identity AuthIdentity) (*PhoneChangeStatus, error) {
	if _, pat := model.ParseAccessTokenSessionID(identity.SessionID); pat {
		return nil, ErrVerificationForbidden
	}
	if err := ValidateStepUpIdentity(identity); err != nil {
		return nil, err
	}
	phone, err := getCurrentPhone(model.DB, identity.UserID)
	if err != nil {
		return nil, err
	}
	result := &PhoneChangeStatus{Bound: phone != "", VerificationRequired: phone == ""}
	if phone != "" {
		if !mainlandPhonePattern.MatchString(phone) {
			return nil, ErrVerificationUnavailable
		}
		result.PhoneMasked = phone[:3] + "****" + phone[7:]
	}
	return result, nil
}

func newPhoneChangeFlow(purpose string, payload phoneChangePayload, ttl time.Duration) (string, error) {
	encoded, err := common.Marshal(payload)
	if err != nil {
		return "", err
	}
	token, _, err := model.CreateAuthFlow(model.AuthFlowCreate{Purpose: purpose, UserId: payload.Identity.UserID, SessionId: payload.Identity.SessionID, Payload: string(encoded), ExpiresAt: time.Now().Add(ttl)})
	return token, err
}

func readPhoneChangeFlow(identity AuthIdentity, token, purpose string) (*model.AuthFlow, phoneChangePayload, error) {
	flow, err := model.GetAuthFlow(token, model.AuthFlowMatch{Purpose: purpose, UserId: identity.UserID, SessionId: identity.SessionID})
	var payload phoneChangePayload
	if err != nil || common.UnmarshalJsonStr(flow.Payload, &payload) != nil || payload.Identity != identity {
		return nil, payload, ErrVerificationFailed
	}
	return flow, payload, nil
}

func validatePhoneChangeWithTx(tx *gorm.DB, payload phoneChangePayload) error {
	if err := model.ValidateAuthSessionWithTx(tx, payload.Identity); err != nil {
		return err
	}
	phone, err := getCurrentPhone(tx, payload.Identity.UserID)
	if err != nil {
		return err
	}
	if phone != payload.Original {
		return model.ErrAccountBindingChanged
	}
	if (payload.Step != "old" && payload.BindingExpiresAt == 0) || (payload.BindingExpiresAt != 0 && payload.BindingExpiresAt <= time.Now().Unix()) {
		return ErrAuthTokenExpired
	}
	if payload.Original == "" {
		if payload.BindingContact == nil || payload.BindingExpiresAt == 0 {
			return ErrAuthTokenExpired
		}
		encoded, err := common.Marshal(payload.BindingContact)
		if err != nil {
			return err
		}
		return validatePhoneBindingContactWithTx(tx, payload.Identity, payload.BindingContact.Method, string(encoded))
	}

	return nil
}

func SendPhoneChangeCode(identity AuthIdentity, step, phone, verifiedToken, ip, captchaToken, captchaAnswer string) (string, error) {
	if !PhoneSMSConfigured() {
		return "", ErrVerificationUnavailable
	}
	status, err := GetPhoneChangeStatus(identity)
	if err != nil {
		return "", err
	}
	original, err := getCurrentPhone(model.DB, identity.UserID)
	if err != nil {
		return "", err
	}
	payload := phoneChangePayload{Identity: identity, Original: original, Step: step}
	var oldFlow *model.AuthFlow
	if step == "old" {
		if !status.Bound {
			return "", ErrVerificationFailed
		}
		payload.Phone = original
	} else if step == "new" {
		if !mainlandPhonePattern.MatchString(phone) || phone == original {
			return "", common.NewMessage("Enter a valid mainland China phone number")
		}
		if status.Bound {
			oldFlow, payload, err = readPhoneChangeFlow(identity, verifiedToken, phoneChangeOldPurpose)
			if err != nil {
				return "", err
			}
			payload.Step = "new"
			payload.Phone = phone
		} else {
			_, payload, err = readPhoneChangeFlow(identity, verifiedToken, phoneBindingPurpose)
			if err != nil {
				return "", err
			}
			payload.Step = "new"
			payload.Phone = phone
		}
		owner, err := model.GetPhoneUserID(phone)
		if err != nil {
			return "", err
		}
		if owner != 0 {
			return "", ErrPhoneOwned
		}
	} else {
		return "", ErrVerificationFailed
	}
	_, captcha, err := readPhoneChangeFlow(identity, captchaToken, phoneChangeImagePurpose)
	if err != nil {
		return "", ErrPhoneVerification
	}
	if err := model.AttemptAuthFlow(captchaToken, phoneChangeImagePurpose, 1); err != nil {
		return "", ErrPhoneVerification
	}
	if subtle.ConstantTimeCompare([]byte(captcha.Digest), []byte(phoneCodeDigest(strings.TrimSpace(captchaAnswer)))) != 1 {
		return "", ErrPhoneVerification
	}
	_, err = model.ConsumeAuthFlowWithAction(captchaToken, model.AuthFlowMatch{Purpose: phoneChangeImagePurpose, UserId: identity.UserID, SessionId: identity.SessionID}, func(tx *gorm.DB, _ *model.AuthFlow) error {
		if err := validatePhoneChangeWithTx(tx, payload); err != nil {
			return err
		}
		if oldFlow != nil {
			var count int64
			if err := tx.Model(&model.AuthFlow{}).Where("id = ? AND consumed_at IS NULL AND expires_at > ?", oldFlow.Id, time.Now()).Count(&count).Error; err != nil {
				return err
			}
			if count != 1 {
				return ErrVerificationFailed
			}
		}
		return reservePhoneSend(tx, payload.Phone, ip)
	})
	if err != nil {
		return "", err
	}
	code, err := randomPhoneDigits(6)
	if err != nil {
		return "", err
	}
	if err := SendAliyunSMS(payload.Phone, code); err != nil {
		return "", ErrBindingSMSDelivery
	}
	payload.Digest, err = common.Password2Hash(phoneCodeDigest(code))
	if err != nil {
		return "", err
	}
	// A resend invalidates only this session's phone-change codes, never login codes.
	if err := model.DB.Model(&model.AuthFlow{}).Where("purpose = ? AND user_id = ? AND session_id = ? AND consumed_at IS NULL", phoneChangeSMSPurpose, identity.UserID, identity.SessionID).Update("consumed_at", time.Now()).Error; err != nil {
		return "", err
	}
	return newPhoneChangeFlow(phoneChangeSMSPurpose, payload, 5*time.Minute)
}

func VerifyPhoneChangeCode(identity AuthIdentity, step, token, phone, code string) (string, error) {
	_, payload, err := readPhoneChangeFlow(identity, token, phoneChangeSMSPurpose)
	if err != nil {
		return "", err
	}
	if payload.Step != step || (step == "new" && payload.Phone != phone) {
		return "", ErrVerificationFailed
	}
	if err := model.AttemptAuthFlow(token, phoneChangeSMSPurpose, 5); err != nil {
		return "", ErrVerificationFailed
	}
	code = strings.TrimSpace(code)
	if len(code) != 6 || !common.ValidatePasswordAndHash(phoneCodeDigest(code), payload.Digest) {
		return "", ErrVerificationFailed
	}
	_, err = model.ConsumeAuthFlowWithAction(token, model.AuthFlowMatch{Purpose: phoneChangeSMSPurpose, UserId: identity.UserID, SessionId: identity.SessionID}, func(tx *gorm.DB, _ *model.AuthFlow) error { return validatePhoneChangeWithTx(tx, payload) })
	if err != nil {
		return "", err
	}
	payload.Digest = ""
	if step == "old" {
		payload.BindingExpiresAt = time.Now().Add(10 * time.Minute).Unix()
	}
	purpose := phoneChangeOldPurpose
	if step == "new" {
		purpose = phoneChangeReadyPurpose
	}
	return newPhoneChangeFlow(purpose, payload, 10*time.Minute)
}

func CompletePhoneChange(identity AuthIdentity, token string) error {
	_, payload, err := readPhoneChangeFlow(identity, token, phoneChangeReadyPurpose)
	if err != nil {
		return err
	}
	if payload.Step != "new" || !mainlandPhonePattern.MatchString(payload.Phone) || payload.Phone == payload.Original {
		return ErrVerificationFailed
	}
	_, err = model.ConsumeAuthFlowWithAction(token, model.AuthFlowMatch{Purpose: phoneChangeReadyPurpose, UserId: identity.UserID, SessionId: identity.SessionID}, func(tx *gorm.DB, _ *model.AuthFlow) error {
		if err := validatePhoneChangeWithTx(tx, payload); err != nil {
			return err
		}
		if err := model.ReleaseExternalIdentityWithTx(tx, model.ExternalIdentityProviderPhone, identity.UserID); err != nil {
			return err
		}
		if err := model.ClaimExternalIdentityWithTx(tx, model.ExternalIdentityProviderPhone, payload.Phone, identity.UserID); err != nil {
			return ErrPhoneOwned
		}
		_, err := model.IncrementUserAuthVersionWithTx(tx, identity.UserID)
		return err
	})
	return err
}
