package model

import (
	"errors"
	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"time"
)

const ExternalIdentityProviderPhone = "phone"

func GetPhoneUserID(phone string) (int, error) {
	var claim ExternalIdentityClaim
	err := DB.Where("provider = ? AND subject = ?", ExternalIdentityProviderPhone, phone).Take(&claim).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, nil
	}
	return claim.UserId, err
}

func HasUserPhone(userID int) (bool, error) {
	var count int64
	err := DB.Model(&ExternalIdentityClaim{}).Where("provider = ? AND user_id = ?", ExternalIdentityProviderPhone, userID).Count(&count).Error
	return count > 0, err
}

// AttemptAuthFlow reserves a verification attempt before checking a guess.
// The conditional write prevents concurrent requests exceeding the attempt budget.
func AttemptAuthFlow(token, purpose string, limit int) error {
	result := applyAuthFlowMatch(DB.Model(&AuthFlow{}), token, AuthFlowMatch{Purpose: purpose}).Where("consumed_at IS NULL AND expires_at > ? AND attempts < ?", time.Now(), limit).Update("attempts", gorm.Expr("attempts + 1"))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrAuthFlowInvalid
	}
	return nil
}

// BindPhoneForPrimaryAuthWithTx serializes binding with credential changes and
// bans on the authoritative user row. The caller consumes its proofs in tx.
func BindPhoneForPrimaryAuthWithTx(tx *gorm.DB, userID int, authVersion int64, phone string) (*User, error) {
	var user User
	if err := lockForUpdate(tx).Where("id = ? AND status = ? AND auth_version = ?", userID, common.UserStatusEnabled, authVersion).Take(&user).Error; err != nil {
		return nil, ErrUserSessionInactive
	}
	if err := ClaimExternalIdentityWithTx(tx, ExternalIdentityProviderPhone, phone, userID); err != nil {
		return nil, err
	}
	return &user, nil
}
