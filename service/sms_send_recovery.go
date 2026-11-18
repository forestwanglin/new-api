package service

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
)

const (
	smsSending  = "sms_sending"
	smsAccepted = "sms_accepted"
	smsUnknown  = "sms_unknown"
	smsRejected = "sms_rejected"
)

// Provider errors never retain response bodies, codes, phone numbers or tokens.
// Existing callers still receive an error for an ambiguous send; only callers
// that prepared a durable code explicitly elect to accept unknown outcomes.
type smsProviderError struct{ rejected bool }

func (*smsProviderError) Error() string { return ErrBindingSMSDelivery.Error() }
func (*smsProviderError) Unwrap() error { return ErrBindingSMSDelivery }

// SMSDeliveryError carries only the bounded client recovery authorization.
// Error() deliberately omits all usable proofs and provider details.
type SMSDeliveryError struct {
	RetryToken     string
	RetryAfter     int
	RetryExpiresAt int64
}

func (*SMSDeliveryError) Error() string { return ErrBindingSMSDelivery.Error() }
func (*SMSDeliveryError) Unwrap() error { return ErrBindingSMSDelivery }

func newSMSCode() (string, string, error) {
	code, err := randomPhoneDigits(6)
	if err != nil {
		return "", "", err
	}
	digest, err := common.Password2Hash(phoneCodeDigest(code))
	return code, digest, err
}

func smsFlowVerifiable(flow *model.AuthFlow) bool {
	return flow.Intent == "" || flow.Intent == smsAccepted || flow.Intent == smsUnknown
}

// Preparation and invalidation commit with the one-use authorization and rate
// slots. No external request is made unless the complete preparation succeeds.
func prepareSMSFlowWithTx(tx *gorm.DB, input model.AuthFlowCreate) (string, *model.AuthFlow, error) {
	query := tx.Model(&model.AuthFlow{}).Where("purpose = ? AND user_id = ? AND session_id = ? AND consumed_at IS NULL", input.Purpose, input.UserId, input.SessionId)
	if input.Provider != "" {
		query = query.Where("provider = ?", input.Provider)
	}
	if err := query.Update("consumed_at", time.Now()).Error; err != nil {
		return "", nil, err
	}
	input.Intent = smsSending
	return model.CreateAuthFlowWithTx(tx, input)
}

// dispatchPreparedSMS performs exactly one provider request, outside any DB
// transaction. Unknown outcomes remain verifiable but never reopen send rights.
func dispatchPreparedSMS(phone, code, token string, flow *model.AuthFlow, retry *model.AuthFlowCreate) (string, error) {
	providerErr := SendAliyunSMS(phone, code)
	state := smsAccepted
	var outcome *smsProviderError
	if providerErr != nil {
		if !errors.As(providerErr, &outcome) {
			return "", providerErr
		}
		state = smsUnknown
		if outcome.rejected {
			state = smsRejected
		}
	}
	recovery := &SMSDeliveryError{RetryAfter: 90}
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		updates := map[string]any{"intent": state}
		if state == smsRejected {
			updates["consumed_at"] = time.Now()
		}
		result := tx.Model(&model.AuthFlow{}).Where("id = ? AND intent = ? AND consumed_at IS NULL", flow.Id, smsSending).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrPhoneVerification
		}
		if state == smsRejected && retry != nil && retry.ExpiresAt.After(time.Now()) {
			var err error
			recovery.RetryToken, _, err = model.CreateAuthFlowWithTx(tx, *retry)
			if err != nil {
				return err
			}
			recovery.RetryExpiresAt = retry.ExpiresAt.Unix()
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if state == smsRejected {
		return "", recovery
	}
	return token, nil
}
