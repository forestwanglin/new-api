package service

import (
	"bytes"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
	"gorm.io/gorm"
)

const (
	phoneImagePurpose  = "phone_image"
	phoneSendPurpose   = "phone_send"
	phoneSMSPurpose    = "phone_sms"
	WeChatPhonePurpose = "wechat_phone"
)

var (
	mainlandPhonePattern = regexp.MustCompile(`^1[3-9][0-9]{9}$`)
	ErrPhoneVerification = common.NewMessage("Verification code is incorrect or has expired")
	ErrPhoneOwned        = common.NewMessage("This phone number belongs to another account. Please use another phone number.")
	ErrPhoneRateLimit    = common.NewMessage("Too many SMS requests. Please try again later.")
)

type phoneFlowPayload struct {
	OfficialFingerprint string `json:"official_fingerprint,omitempty"`
	WeChatID            string `json:"wechat_id,omitempty"`
	Phone               string `json:"phone,omitempty"`
	AffiliateCode       string `json:"affiliate_code,omitempty"`
	Digest              string `json:"digest,omitempty"`
	BindFlowID          int64  `json:"bind_flow_id,omitempty"`
	AuthVersion         int64  `json:"auth_version,omitempty"`
	SendAttempts        int    `json:"send_attempts,omitempty"`
}

func phoneCodeDigest(code string) string {
	return common.GenerateHMACWithKey([]byte("phone-code:"+common.SessionSecret), code)
}

func randomPhoneDigits(length int) (string, error) {
	digits := make([]byte, length)
	for i := range digits {
		n, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", err
		}
		digits[i] = '0' + byte(n.Int64())
	}
	return string(digits), nil
}

func createPhoneFlow(purpose, browser string, payload phoneFlowPayload, ttl time.Duration) (string, *model.AuthFlow, error) {
	encoded, err := common.Marshal(payload)
	if err != nil {
		return "", nil, err
	}
	return model.CreateAuthFlow(model.AuthFlowCreate{Purpose: purpose, Provider: payload.Phone, SessionId: browser, Payload: string(encoded), ExpiresAt: time.Now().Add(ttl)})
}

func NewPhoneImage(browser string) (string, string, error) {
	answer, err := randomPhoneDigits(5)
	if err != nil {
		return "", "", err
	}
	token, _, err := createPhoneFlow(phoneImagePurpose, browser, phoneFlowPayload{Digest: phoneCodeDigest(answer)}, 2*time.Minute)
	if err != nil {
		return "", "", err
	}
	image, err := renderPhoneImage(answer)
	return token, image, err
}

func renderPhoneImage(answer string) (string, error) {
	small := image.NewRGBA(image.Rect(0, 0, 55, 18))
	draw.Draw(small, small.Bounds(), &image.Uniform{color.RGBA{241, 245, 249, 255}}, image.Point{}, draw.Src)
	// Random noise and glyph offsets make the image independent of browser fonts.
	for range 70 {
		x, _ := rand.Int(rand.Reader, big.NewInt(55))
		y, _ := rand.Int(rand.Reader, big.NewInt(18))
		small.Set(int(x.Int64()), int(y.Int64()), color.RGBA{148, 163, 184, 255})
	}
	for i, c := range answer {
		offset, _ := rand.Int(rand.Reader, big.NewInt(3))
		d := font.Drawer{Dst: small, Src: &image.Uniform{color.RGBA{30, 64, 175, 255}}, Face: basicfont.Face7x13, Dot: fixed.P(3+i*10, 13+int(offset.Int64()))}
		d.DrawString(string(c))
	}
	large := image.NewRGBA(image.Rect(0, 0, 165, 54))
	for y := range 54 {
		for x := range 165 {
			large.Set(x, y, small.At(x/3, y/3))
		}
	}
	var out bytes.Buffer
	if err := png.Encode(&out, large); err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(out.Bytes()), nil
}

func readPhoneFlow(token, purpose, browser string) (*model.AuthFlow, phoneFlowPayload, error) {
	flow, err := model.GetAuthFlow(token, model.AuthFlowMatch{Purpose: purpose, SessionId: browser})
	if err != nil || purpose == phoneSMSPurpose && !smsFlowVerifiable(flow) {
		return nil, phoneFlowPayload{}, ErrPhoneVerification
	}
	var payload phoneFlowPayload
	if browser == "" || common.UnmarshalJsonStr(flow.Payload, &payload) != nil {
		return nil, payload, ErrPhoneVerification
	}
	return flow, payload, nil
}

func VerifyPhoneImage(token, answer, phone, bindToken, browser, affiliateCode string) (string, error) {
	if !mainlandPhonePattern.MatchString(phone) {
		return "", common.NewMessage("Enter a valid mainland China phone number")
	}
	_, payload, err := readPhoneFlow(token, phoneImagePurpose, browser)
	if err != nil {
		return "", err
	}
	var bindID int64
	if bindToken != "" {
		bind, err := RequireWeChatPhoneFlow(bindToken, browser)
		if err != nil {
			return "", err
		}
		bindID = bind.Id
	}
	if err := model.AttemptAuthFlow(token, phoneImagePurpose, 1); err != nil {
		return "", ErrPhoneVerification
	}
	if subtle.ConstantTimeCompare([]byte(payload.Digest), []byte(phoneCodeDigest(answer))) != 1 {
		return "", ErrPhoneVerification
	}
	if _, err := model.ConsumeAuthFlow(token, model.AuthFlowMatch{Purpose: phoneImagePurpose, SessionId: browser}); err != nil {
		return "", ErrPhoneVerification
	}
	affiliateCode = strings.TrimSpace(affiliateCode)
	if len(affiliateCode) > 32 || bindID != 0 {
		affiliateCode = ""
	}
	permit, _, err := createPhoneFlow(phoneSendPurpose, browser, phoneFlowPayload{Phone: phone, BindFlowID: bindID, AffiliateCode: affiliateCode}, 2*time.Minute)
	return permit, err
}

func StartWeChatPhoneFlow(user *model.User, browser string) (string, error) {
	encoded, err := common.Marshal(phoneFlowPayload{AuthVersion: user.AuthVersion, OfficialFingerprint: user.WeChatConfig, WeChatID: user.WeChatId})
	if err != nil {
		return "", err
	}
	token, _, err := model.CreateAuthFlow(model.AuthFlowCreate{Purpose: WeChatPhonePurpose, UserId: user.Id, SessionId: browser, Payload: string(encoded), ExpiresAt: time.Now().Add(10 * time.Minute)})
	return token, err
}

func RequireWeChatPhoneFlow(token, browser string) (*model.AuthFlow, error) {
	flow, payload, err := readPhoneFlow(token, WeChatPhonePurpose, browser)
	if err != nil {
		return nil, err
	}
	user, err := model.GetUserById(flow.UserId, false)
	if err != nil || user.Status != common.UserStatusEnabled || user.AuthVersion != payload.AuthVersion || (payload.WeChatID != "" && user.WeChatId != payload.WeChatID) {
		return nil, ErrPhoneVerification
	}
	if payload.OfficialFingerprint != "" {
		if _, err := model.RequireWeChatOfficialConfig(model.DB, payload.OfficialFingerprint); err != nil {
			return nil, err
		}
	}
	return flow, nil
}

// Claim SMS slots in the same transaction as the one-time send authorization.
// The durable unique assertions serialize multiple processes without Redis.
func reservePhoneSend(tx *gorm.DB, phone, ip string) error {
	now := time.Now()
	expiry := now.Add(25 * time.Hour)
	// A sliding cooldown uses adjacent 30-second buckets: any two requests less
	// than 60 seconds apart share at least one unique bucket.
	bucket := now.Unix() / 30
	for _, b := range []int64{bucket, bucket + 1, bucket + 2} {
		if err := model.ClaimExternalAuthAssertionWithTx(tx, "phone_cooldown", phone+":"+strconv.FormatInt(b, 10), now.Add(2*time.Minute)); err != nil {
			return ErrPhoneRateLimit
		}
	}
	for _, limit := range []struct {
		subject string
		slots   int
		window  int64
	}{{"phone:" + phone, 10, 86400}, {"ip:" + ip, 20, 3600}} {
		reserved := false
		for i := range limit.slots {
			err := model.ClaimExternalAuthAssertionWithTx(tx, "phone_send_limit", limit.subject+":"+strconv.FormatInt(now.Unix()/limit.window, 10)+":"+strconv.Itoa(i), expiry)
			if err == nil {
				reserved = true
				break
			}
			if !errors.Is(err, model.ErrAuthFlowConsumed) {
				return err
			}
		}
		if !reserved {
			return ErrPhoneRateLimit
		}
	}
	return nil
}

func SendPhoneSMS(permit, browser, ip string) (string, error) {
	permitFlow, payload, err := readPhoneFlow(permit, phoneSendPurpose, browser)
	if err != nil {
		return "", err
	}
	if payload.SendAttempts >= 3 {
		return "", ErrPhoneVerification
	}
	if payload.BindFlowID != 0 {
		if _, _, err := readWeChatPhoneFlowByID(payload.BindFlowID, browser); err != nil {
			return "", err
		}
	}
	code, digest, err := newSMSCode()
	if err != nil {
		return "", err
	}
	payload.Digest = digest
	payload.SendAttempts++
	encoded, err := common.Marshal(payload)
	if err != nil {
		return "", err
	}
	var token string
	var verification *model.AuthFlow
	_, err = model.ConsumeAuthFlowWithAction(permit, model.AuthFlowMatch{Purpose: phoneSendPurpose, SessionId: browser}, func(tx *gorm.DB, _ *model.AuthFlow) error {
		if err := reservePhoneSend(tx, payload.Phone, ip); err != nil {
			return err
		}
		var err error
		token, verification, err = prepareSMSFlowWithTx(tx, model.AuthFlowCreate{Purpose: phoneSMSPurpose, Provider: payload.Phone, SessionId: browser, Payload: string(encoded), ExpiresAt: time.Now().Add(5 * time.Minute)})
		return err
	})
	if err != nil {
		return "", err
	}
	var retry *model.AuthFlowCreate
	if payload.SendAttempts < 3 {
		payload.Digest = ""
		encoded, err = common.Marshal(payload)
		if err != nil {
			return "", err
		}
		retry = &model.AuthFlowCreate{Purpose: phoneSendPurpose, Provider: payload.Phone, SessionId: browser, Payload: string(encoded), ExpiresAt: permitFlow.ExpiresAt}
	}
	return dispatchPreparedSMS(payload.Phone, code, token, verification, retry)
}

func CompletePhoneLogin(token, code, browser string) (*model.User, error) {
	_, payload, err := readPhoneFlow(token, phoneSMSPurpose, browser)
	if err != nil {
		return nil, err
	}
	if err := model.AttemptAuthFlow(token, phoneSMSPurpose, 5); err != nil {
		return nil, ErrPhoneVerification
	}
	if len(code) != 6 || !common.ValidatePasswordAndHash(phoneCodeDigest(code), payload.Digest) {
		return nil, ErrPhoneVerification
	}
	var bindFlow *model.AuthFlow
	var bindPayload phoneFlowPayload
	if payload.BindFlowID != 0 {
		bindFlow, bindPayload, err = readWeChatPhoneFlowByID(payload.BindFlowID, browser)
		if err != nil {
			return nil, err
		}
	}
	var user model.User
	created := false
	for attempt := range 3 {
		user, created = model.User{}, false
		_, err = model.ConsumeAuthFlowWithAction(token, model.AuthFlowMatch{Purpose: phoneSMSPurpose, SessionId: browser}, func(tx *gorm.DB, _ *model.AuthFlow) error {
			if bindFlow != nil {
				// Consume the bound primary identity together with the SMS proof and claim.
				result := tx.Model(&model.AuthFlow{}).Where("id = ? AND purpose = ? AND session_id = ? AND consumed_at IS NULL AND expires_at > ?", bindFlow.Id, WeChatPhonePurpose, browser, time.Now()).Update("consumed_at", time.Now())
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected != 1 {
					return ErrPhoneVerification
				}
				bound, err := model.BindPhoneForPrimaryAuthWithTx(tx, bindFlow.UserId, bindPayload.AuthVersion, payload.Phone)
				if err != nil {
					if errors.Is(err, model.ErrExternalIdentityAlreadyClaimed) {
						return ErrPhoneOwned
					}
					return err
				}
				if bindPayload.WeChatID != "" && bound.WeChatId != bindPayload.WeChatID {
					return model.ErrAccountBindingChanged
				}
				if bindPayload.OfficialFingerprint != "" {
					if _, err := model.LockWeChatOfficialConfig(tx, bindPayload.OfficialFingerprint); err != nil {
						return err
					}
				}
				user = *bound
				user.WeChatConfig = bindPayload.OfficialFingerprint
				return nil
			}
			var claim model.ExternalIdentityClaim
			findErr := tx.Where("provider = ? AND subject = ?", "phone", payload.Phone).Take(&claim).Error
			if findErr == nil {
				return tx.First(&user, claim.UserId).Error
			}
			if !errors.Is(findErr, gorm.ErrRecordNotFound) {
				return findErr
			}
			if !common.RegisterEnabled {
				return common.NewMessage("New user registration has been disabled by administrator")
			}
			inviterID, err := ResolveAffiliateInviter(tx, payload.AffiliateCode)
			if err != nil {
				return err
			}
			suffix, err := common.GenerateRandomCharsKey(14)
			if err != nil {
				return err
			}
			user = model.User{Username: "phone_" + suffix, DisplayName: "Phone User", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1, InviterId: inviterID}
			if err := user.InsertWithTx(tx, inviterID); err != nil {
				return err
			}
			if err := model.ClaimExternalIdentityWithTx(tx, "phone", payload.Phone, user.Id); err != nil {
				return ErrPhoneOwned
			}
			created = true
			return nil
		})
		if err == nil {
			break
		}
		// ConsumeAuthFlowWithAction has rolled back before another transaction
		// begins; PostgreSQL cannot reuse a transaction after a unique violation.
		if attempt == 2 || !isPhoneRegistrationUsernameConflict(err) {
			return nil, err
		}
	}
	if created {
		user.FinishInsert(user.InviterId)
	}
	return &user, nil
}

func readWeChatPhoneFlowByID(id int64, browser string) (*model.AuthFlow, phoneFlowPayload, error) {
	var flow model.AuthFlow
	var payload phoneFlowPayload
	err := model.DB.Where("id = ? AND purpose = ? AND session_id = ? AND consumed_at IS NULL AND expires_at > ?", id, WeChatPhonePurpose, browser, time.Now()).Take(&flow).Error
	if err != nil || common.UnmarshalJsonStr(flow.Payload, &payload) != nil {
		return nil, payload, ErrPhoneVerification
	}
	user, err := model.GetUserById(flow.UserId, false)
	if err != nil || user.Status != common.UserStatusEnabled || user.AuthVersion != payload.AuthVersion || (payload.WeChatID != "" && user.WeChatId != payload.WeChatID) {
		return nil, payload, ErrPhoneVerification
	}
	if payload.OfficialFingerprint != "" {
		if _, err := model.RequireWeChatOfficialConfig(model.DB, payload.OfficialFingerprint); err != nil {
			return nil, payload, err
		}
	}
	return &flow, payload, nil
}

// ResolveAffiliateInviter resolves optional registration metadata against the
// caller's database/transaction. Unknown codes do not block registration, but
// storage failures must not silently discard a valid invitation.
func ResolveAffiliateInviter(db *gorm.DB, code string) (int, error) {
	code = strings.TrimSpace(code)
	if code == "" || len(code) > 32 {
		return 0, nil
	}
	var inviter model.User
	err := db.Select("id").Where("aff_code = ?", code).First(&inviter).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, nil
	}
	return inviter.Id, err
}
