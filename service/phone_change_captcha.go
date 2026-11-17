package service

import "time"

const phoneChangeImagePurpose = "phone_change_image_v1"

// NewPhoneChangeImage issues a CAPTCHA for an authenticated phone ceremony only.
func NewPhoneChangeImage(identity AuthIdentity) (string, string, error) {
	if _, err := GetPhoneChangeStatus(identity); err != nil {
		return "", "", err
	}
	answer, err := randomPhoneDigits(5)
	if err != nil {
		return "", "", err
	}
	image, err := renderPhoneImage(answer)
	if err != nil {
		return "", "", err
	}
	token, err := newPhoneChangeFlow(phoneChangeImagePurpose, phoneChangePayload{Identity: identity, Digest: phoneCodeDigest(answer)}, 2*time.Minute)
	return token, image, err
}
