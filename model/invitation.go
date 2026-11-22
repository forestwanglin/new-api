package model

import (
	"errors"
	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"math"
	"strconv"
	"strings"
	"time"
)

var (
	ErrInvitationInvalid        = errors.New("invalid invitation")
	ErrInvitationStartPassed    = errors.New("invitation campaign start time has passed")
	ErrInvitationEndPassed      = errors.New("invitation campaign end time has passed")
	ErrInvitationNotFound       = errors.New("invitation not found")
	ErrInvitationConflict       = errors.New("invitation version conflict")
	ErrInvitationAlreadyBound   = errors.New("invitation already bound")
	ErrInvitationSelf           = errors.New("cannot invite yourself")
	ErrInvitationCycle          = errors.New("invitation cycle")
	ErrInvitationOverlap        = errors.New("invitation campaign overlaps")
	ErrInvitationPointType      = errors.New("invalid invitation point type")
	ErrInvitationRefundConflict = errors.New("invitation refund conflict")
	ErrInvitationReviewRequired = errors.New("invitation review required")
)

type InvitationControl struct {
	Id       int64 `gorm:"primaryKey"`
	Revision int64 `gorm:"not null"`
}
type InvitationCampaign struct {
	Id               int64  `gorm:"primaryKey"`
	Code             string `gorm:"size:64;uniqueIndex"`
	Period           int
	Name             string `gorm:"size:128"`
	Description      string `gorm:"size:500"`
	RulesText        string `gorm:"type:text"`
	Visible          bool
	Version          int64
	CurrentVersionId *int64
	CreatedAt        int64
	UpdatedAt        int64
}
type InvitationCampaignVersion struct {
	Id                int64 `gorm:"primaryKey"`
	CampaignId        int64 `gorm:"index;uniqueIndex:idx_inv_campaign_version"`
	Version           int64 `gorm:"uniqueIndex:idx_inv_campaign_version"`
	StartsAt          int64
	EndsAt            int64
	RewardPointTypeId int64
	FreezeDays        int
	Name              string
	Description       string
	RulesText         string
}
type InvitationCampaignActivation struct {
	Id            int64 `gorm:"primaryKey"`
	VersionId     int64 `gorm:"uniqueIndex"`
	EffectiveFrom int64
	EndedAt       *int64
}
type InvitationCampaignTier struct {
	Id                  int64 `gorm:"primaryKey"`
	VersionId           int64 `gorm:"uniqueIndex:idx_inv_tier"`
	MinEffectiveFriends int   `gorm:"uniqueIndex:idx_inv_tier"`
	RateBps             int
}
type InvitationBinding struct {
	Id          int64 `gorm:"primaryKey"`
	InviteeId   int64 `gorm:"uniqueIndex"`
	InviterId   int64 `gorm:"index"`
	BoundAt     *int64
	Source      string
	InviterCode string
}
type InvitationQualification struct {
	Id               int64 `gorm:"primaryKey"`
	InviteeId        int64 `gorm:"uniqueIndex"`
	InviterId        int64 `gorm:"index"`
	CandidateOrderId int64
	EligibleAt       int64 `gorm:"index"`
	QualifiedAt      *int64
	Status           string `gorm:"size:24"`
}
type InvitationAuditLog struct {
	Id         int64 `gorm:"primaryKey"`
	OperatorId int64
	Action     string
	EntityType string
	EntityId   int64
	Detail     string
	CreatedAt  int64
}
type InvitationTierInput struct {
	MinEffectiveFriends int `json:"min_effective_friends"`
	RateBps             int `json:"rate_bps"`
}
type InvitationCampaignInput struct {
	Code              string                `json:"code"`
	Period            int                   `json:"period"`
	Name              string                `json:"name"`
	Description       string                `json:"description"`
	StartsAt          int64                 `json:"starts_at,string"`
	EndsAt            int64                 `json:"ends_at,string"`
	RewardPointTypeId int64                 `json:"reward_point_type_id,string"`
	FreezeDays        int                   `json:"freeze_days"`
	Tiers             []InvitationTierInput `json:"tiers"`
	RulesText         string                `json:"rules_text"`
	Visible           bool                  `json:"visible"`
}
type InvitationTierView = InvitationTierInput
type InvitationPointTypeView struct {
	Id   int64  `json:"id,string"`
	Code string `json:"code"`
	Name string `json:"name"`
}
type InvitationCampaignView struct {
	Id                int64                   `json:"id,string"`
	Code              string                  `json:"code"`
	Period            int                     `json:"period"`
	Name              string                  `json:"name"`
	Description       string                  `json:"description"`
	StartsAt          int64                   `json:"starts_at,string"`
	EndsAt            int64                   `json:"ends_at,string"`
	RewardPointTypeId int64                   `json:"reward_point_type_id,string"`
	RewardPointType   InvitationPointTypeView `json:"reward_point_type"`
	FreezeDays        int                     `json:"freeze_days"`
	Tiers             []InvitationTierView    `json:"tiers"`
	RulesText         string                  `json:"rules_text"`
	Visible           bool                    `json:"visible"`
	Status            string                  `json:"status"`
	Version           int64                   `json:"version,string"`
	PublishedVersion  *string                 `json:"published_version"`
}
type InvitationCampaignPage struct {
	Page     int                      `json:"page"`
	PageSize int                      `json:"page_size"`
	Total    int64                    `json:"total,string"`
	Items    []InvitationCampaignView `json:"items"`
}
type InvitationBindingView struct {
	Bound        bool   `json:"bound"`
	InviterCode  string `json:"inviter_code"`
	InviterLabel string `json:"inviter_label"`
	BoundAt      *int64 `json:"-"`
}

func (v InvitationBindingView) MarshalJSON() ([]byte, error) {
	type dto struct {
		Bound        bool    `json:"bound"`
		InviterCode  string  `json:"inviter_code"`
		InviterLabel string  `json:"inviter_label"`
		BoundAt      *string `json:"bound_at"`
	}
	return common.Marshal(dto{v.Bound, v.InviterCode, v.InviterLabel, invitationTime(v.BoundAt)})
}

type InvitationFriend struct {
	InviteeId   int64  `json:"invitee_id,string"`
	Label       string `json:"label"`
	BoundAt     *int64 `json:"-"`
	QualifiedAt *int64 `json:"-"`
	Status      string `json:"status"`
}

func (v InvitationFriend) MarshalJSON() ([]byte, error) {
	type dto struct {
		InviteeId   int64   `json:"invitee_id,string"`
		Label       string  `json:"label"`
		BoundAt     *string `json:"bound_at"`
		QualifiedAt *string `json:"qualified_at"`
		Status      string  `json:"status"`
	}
	return common.Marshal(dto{v.InviteeId, v.Label, invitationTime(v.BoundAt), invitationTime(v.QualifiedAt), v.Status})
}
func invitationTime(value *int64) *string {
	if value == nil {
		return nil
	}
	s := strconv.FormatInt(*value, 10)
	return &s
}

type InvitationFriendPage struct {
	Page     int                `json:"page"`
	PageSize int                `json:"page_size"`
	Total    int64              `json:"total,string"`
	Items    []InvitationFriend `json:"items"`
}

func invitationTransaction(clock func() int64, action func(*gorm.DB, int64) error) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := lockInvitationControl(tx); err != nil {
			return err
		}
		return action(tx, clock())
	})
}
func lockInvitationControl(tx *gorm.DB) error {
	result := tx.Model(&InvitationControl{}).Where("id = ?", 1).Update("revision", gorm.Expr("revision + 1"))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrInvitationConflict
	}
	return nil
}
func migrateInvitations(db *gorm.DB) error {
	if err := db.AutoMigrate(&InvitationControl{}, &InvitationCampaign{}, &InvitationCampaignVersion{}, &InvitationCampaignActivation{}, &InvitationCampaignTier{}, &InvitationBinding{}, &InvitationQualification{}, &InvitationAuditLog{}); err != nil {
		return err
	}
	if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&InvitationControl{Id: 1}).Error; err != nil {
		return err
	}
	var users []User
	if err := db.Where("inviter_id <> 0").Find(&users).Error; err != nil {
		return err
	}
	for _, u := range users {
		var n int64
		if err := db.Model(&InvitationBinding{}).Where("invitee_id = ?", u.Id).Count(&n).Error; err != nil {
			return err
		}
		if n == 0 {
			if err := db.Create(&InvitationBinding{InviteeId: int64(u.Id), InviterId: int64(u.InviterId), Source: "legacy", InviterCode: ""}).Error; err != nil {
				return err
			}
		}
	}
	return migrateInvitationFinance(db)
}
func validateCampaign(in InvitationCampaignInput) error {
	if strings.TrimSpace(in.Code) == "" || len(in.Code) > 64 || strings.TrimSpace(in.Name) == "" || len(in.Name) > 128 || len(in.Description) > 500 || len(in.RulesText) > 32000 || in.Period < 1 || in.StartsAt <= 0 || in.EndsAt <= in.StartsAt || in.FreezeDays < 1 || in.FreezeDays > 365 || in.RewardPointTypeId < 1 || len(in.Tiers) == 0 || len(in.Tiers) > 20 {
		return ErrInvitationInvalid
	}
	if in.Tiers[0].MinEffectiveFriends != 0 {
		return ErrInvitationInvalid
	}
	prev, rate := -1, -1
	for _, t := range in.Tiers {
		if t.MinEffectiveFriends < 0 || t.MinEffectiveFriends > 1000000 || t.MinEffectiveFriends <= prev || t.RateBps < rate || t.RateBps < 0 || t.RateBps > 10000 {
			return ErrInvitationInvalid
		}
		prev = t.MinEffectiveFriends
		rate = t.RateBps
	}
	return nil
}
func validateInvitationPointType(tx *gorm.DB, id int64, publish bool) error {
	var pt PointType
	if err := lockForShare(tx).First(&pt, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrInvitationPointType
		}
		return err
	}
	if publish {
		var rules []PointModelRule
		if pt.EligibilityPolicy == nil || *pt.EligibilityPolicy == "" {
			if err := tx.Where("point_type_id = ?", id).Find(&rules).Error; err != nil {
				return err
			}
		}
		policy, err := ResolvePointEligibilityPolicy(pt, rules)
		if err != nil || ValidatePointEligibilitySnapshotPolicy(policy) != nil {
			return ErrInvitationPointType
		}
		for _, group := range policy.Groups {
			if !group.Enabled {
				continue
			}
			for _, condition := range group.Conditions {
				if condition.Enabled {
					return nil
				}
			}
		}
		return ErrInvitationPointType
	}
	return nil
}
func campaignView(tx *gorm.DB, c InvitationCampaign, v InvitationCampaignVersion) (InvitationCampaignView, error) {
	var tiers []InvitationCampaignTier
	if err := tx.Where("version_id = ?", v.Id).Order("min_effective_friends").Find(&tiers).Error; err != nil {
		return InvitationCampaignView{}, err
	}
	var pt PointType
	if err := tx.First(&pt, v.RewardPointTypeId).Error; err != nil {
		return InvitationCampaignView{}, err
	}
	out := InvitationCampaignView{Id: c.Id, Code: c.Code, Period: c.Period, Name: v.Name, Description: v.Description, StartsAt: v.StartsAt, EndsAt: v.EndsAt, RewardPointTypeId: v.RewardPointTypeId, RewardPointType: InvitationPointTypeView{pt.Id, pt.Code, pt.Name}, FreezeDays: v.FreezeDays, Tiers: make([]InvitationTierView, len(tiers)), RulesText: v.RulesText, Visible: c.Visible, Version: v.Version, Status: "draft"}
	if c.CurrentVersionId != nil {
		var published InvitationCampaignVersion
		if err := tx.First(&published, *c.CurrentVersionId).Error; err != nil {
			return out, err
		}
		var pending int64
		if err := tx.Model(&InvitationCampaignActivation{}).Where("version_id = ? AND ended_at IS NULL", published.Id).Count(&pending).Error; err != nil {
			return out, err
		}
		if pending > 0 && published.EndsAt > time.Now().UnixMilli() {
			version := strconv.FormatInt(published.Version, 10)
			out.PublishedVersion = &version
		}
	}
	var a InvitationCampaignActivation
	result := tx.Where("version_id = ?", v.Id).First(&a)
	if result.Error != nil && !errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return out, result.Error
	}
	if result.RowsAffected > 0 {
		end := v.EndsAt
		if a.EndedAt != nil {
			end = min(end, *a.EndedAt)
		}
		out.EndsAt = end
		now := time.Now().UnixMilli()
		out.Status = "upcoming"
		if now >= end {
			out.Status = "ended"
		} else if now >= a.EffectiveFrom {
			out.Status = "active"
		}
	}
	for i, t := range tiers {
		out.Tiers[i] = InvitationTierView{MinEffectiveFriends: t.MinEffectiveFriends, RateBps: t.RateBps}
	}
	return out, nil
}
func CreateInvitationCampaign(in InvitationCampaignInput, op int64) (*InvitationCampaignView, error) {
	if in.FreezeDays == 0 {
		in.FreezeDays = 7
	}
	if err := validateCampaign(in); err != nil {
		return nil, err
	}
	var out InvitationCampaignView
	err := invitationTransaction(time.Now().UnixMilli, func(tx *gorm.DB, now int64) error {
		if in.EndsAt <= now {
			return ErrInvitationEndPassed
		}
		if err := validateInvitationPointType(tx, in.RewardPointTypeId, false); err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&InvitationCampaign{}).Where("code = ?", in.Code).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrInvitationConflict
		}
		c := InvitationCampaign{Code: in.Code, Period: in.Period, Name: in.Name, Description: in.Description, RulesText: in.RulesText, Visible: in.Visible, Version: 1, CreatedAt: now, UpdatedAt: now}
		if err := tx.Create(&c).Error; err != nil {
			return err
		}
		v := InvitationCampaignVersion{CampaignId: c.Id, Version: 1, StartsAt: in.StartsAt, EndsAt: in.EndsAt, RewardPointTypeId: in.RewardPointTypeId, FreezeDays: in.FreezeDays, Name: in.Name, Description: in.Description, RulesText: in.RulesText}
		if err := tx.Create(&v).Error; err != nil {
			return err
		}
		for _, t := range in.Tiers {
			if err := tx.Create(&InvitationCampaignTier{VersionId: v.Id, MinEffectiveFriends: t.MinEffectiveFriends, RateBps: t.RateBps}).Error; err != nil {
				return err
			}
		}
		if err := invitationAudit(tx, op, "save", "campaign", c.Id, now); err != nil {
			return err
		}
		var err error
		out, err = campaignView(tx, c, v)
		return err
	})
	return &out, err
}
func GetInvitationCampaign(id int64) (*InvitationCampaignView, error) {
	var c InvitationCampaign
	var v InvitationCampaignVersion
	if err := DB.First(&c, id).Error; err != nil {
		return nil, invitationLookupError(err)
	}
	if err := DB.Where("campaign_id = ?", id).Order("version desc").First(&v).Error; err != nil {
		return nil, ErrInvitationNotFound
	}
	o, e := campaignView(DB, c, v)
	return &o, e
}
func UpdateInvitationCampaign(id, version, op int64, in InvitationCampaignInput) (*InvitationCampaignView, error) {
	if in.FreezeDays == 0 {
		in.FreezeDays = 7
	}
	if err := validateCampaign(in); err != nil {
		return nil, err
	}
	var out InvitationCampaignView
	err := invitationTransaction(time.Now().UnixMilli, func(tx *gorm.DB, now int64) error {
		if in.EndsAt <= now {
			return ErrInvitationEndPassed
		}
		var c InvitationCampaign
		if err := tx.First(&c, id).Error; err != nil {
			return ErrInvitationNotFound
		}
		if c.Version != version {
			return ErrInvitationConflict
		}
		if err := validateInvitationPointType(tx, in.RewardPointTypeId, false); err != nil {
			return err
		}
		c.Version++
		c.Code = in.Code
		c.Period = in.Period
		c.Visible = in.Visible
		c.UpdatedAt = now
		if err := tx.Save(&c).Error; err != nil {
			return err
		}
		v := InvitationCampaignVersion{CampaignId: id, Version: c.Version, StartsAt: in.StartsAt, EndsAt: in.EndsAt, RewardPointTypeId: in.RewardPointTypeId, FreezeDays: in.FreezeDays, Name: in.Name, Description: in.Description, RulesText: in.RulesText}
		if err := tx.Create(&v).Error; err != nil {
			return err
		}
		for _, t := range in.Tiers {
			if err := tx.Create(&InvitationCampaignTier{VersionId: v.Id, MinEffectiveFriends: t.MinEffectiveFriends, RateBps: t.RateBps}).Error; err != nil {
				return err
			}
		}
		if err := invitationAudit(tx, op, "save", "campaign", c.Id, now); err != nil {
			return err
		}
		var err error
		out, err = campaignView(tx, c, v)
		return err
	})
	return &out, err
}
func PublishInvitationCampaign(id, version, op int64) (*InvitationCampaignView, error) {
	var out InvitationCampaignView
	err := invitationTransaction(time.Now().UnixMilli, func(tx *gorm.DB, now int64) error {
		var c InvitationCampaign
		if err := tx.First(&c, id).Error; err != nil {
			return invitationLookupError(err)
		}
		if c.Version != version {
			return ErrInvitationConflict
		}
		var v InvitationCampaignVersion
		if err := tx.Where("campaign_id = ? AND version = ?", id, version).First(&v).Error; err != nil {
			return err
		}
		if v.EndsAt <= now {
			return ErrInvitationEndPassed
		}
		effectiveFrom := max(v.StartsAt, now)
		if err := validateInvitationPointType(tx, v.RewardPointTypeId, true); err != nil {
			return err
		}
		var activations []InvitationCampaignActivation
		if err := tx.Find(&activations).Error; err != nil {
			return err
		}
		for _, a := range activations {
			if a.VersionId == v.Id {
				return ErrInvitationConflict
			}
			var other InvitationCampaignVersion
			if err := tx.First(&other, a.VersionId).Error; err != nil {
				return err
			}
			end := other.EndsAt
			if a.EndedAt != nil {
				end = min(end, *a.EndedAt)
			}
			if effectiveFrom < end && a.EffectiveFrom < v.EndsAt {
				return ErrInvitationOverlap
			}
		}
		if err := tx.Create(&InvitationCampaignActivation{VersionId: v.Id, EffectiveFrom: effectiveFrom}).Error; err != nil {
			return err
		}
		if err := tx.Model(&c).Update("current_version_id", v.Id).Error; err != nil {
			return err
		}
		if err := invitationAudit(tx, op, "publish", "campaign", id, now); err != nil {
			return err
		}
		var err error
		out, err = campaignView(tx, c, v)
		return err
	})
	return &out, err
}
func EndInvitationCampaign(id, version, op int64) (*InvitationCampaignView, error) {
	var out InvitationCampaignView
	err := invitationTransaction(time.Now().UnixMilli, func(tx *gorm.DB, now int64) error {
		var c InvitationCampaign
		if err := tx.First(&c, id).Error; err != nil {
			return invitationLookupError(err)
		}
		if c.Version != version {
			return ErrInvitationConflict
		}
		var latest InvitationCampaignVersion
		if err := tx.Where("campaign_id = ? AND version = ?", id, version).First(&latest).Error; err != nil {
			return err
		}
		// The optimistic version belongs to the editable campaign draft. The
		// activation may still point at an older published version when that
		// draft was saved after publication.
		activationVersionID := c.CurrentVersionId
		if activationVersionID == nil {
			return ErrInvitationConflict
		}
		var a InvitationCampaignActivation
		if err := tx.Where("version_id = ? AND ended_at IS NULL", *activationVersionID).First(&a).Error; err != nil {
			return invitationLookupError(err)
		}
		var activeVersion InvitationCampaignVersion
		if err := tx.First(&activeVersion, a.VersionId).Error; err != nil {
			return invitationLookupError(err)
		}
		if activeVersion.EndsAt <= now {
			return ErrInvitationConflict
		}
		if err := tx.Model(&a).Update("ended_at", now).Error; err != nil {
			return err
		}
		if err := invitationAudit(tx, op, "end", "campaign", id, now); err != nil {
			return err
		}
		var err error
		out, err = campaignView(tx, c, latest)
		return err
	})
	return &out, err
}
func invitationLookupError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrInvitationNotFound
	}
	return err
}
func invitationAudit(tx *gorm.DB, op int64, action, entity string, id, now int64) error {
	return tx.Create(&InvitationAuditLog{OperatorId: op, Action: action, EntityType: entity, EntityId: id, CreatedAt: now}).Error
}
func GetInvitationBinding(uid int64) (*InvitationBindingView, error) {
	var out *InvitationBindingView
	err := DB.Transaction(func(tx *gorm.DB) error {
		var b InvitationBinding
		err := tx.Where("invitee_id = ?", uid).First(&b).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			out = &InvitationBindingView{}
			return nil
		}
		if err != nil {
			return err
		}
		out = &InvitationBindingView{Bound: true, InviterCode: b.InviterCode, InviterLabel: invitationLabel(b.InviterId), BoundAt: b.BoundAt}
		return nil
	})
	return out, err
}
func invitationLabel(id int64) string { return "User #" + strconv.FormatInt(id, 10) }
func BindInvitation(uid int64, code, request string) (*InvitationBindingView, error) {
	if uid < 1 || strings.TrimSpace(code) == "" || len(code) > 32 || len(request) == 0 || len(request) > 64 {
		return nil, ErrInvitationInvalid
	}
	var out *InvitationBindingView
	err := invitationTransaction(time.Now().UnixMilli, func(tx *gorm.DB, now int64) error {
		var u User
		if err := tx.First(&u, uid).Error; err != nil {
			return invitationLookupError(err)
		}
		var count int64
		if err := tx.Model(&InvitationBinding{}).Where("invitee_id = ?", uid).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 || u.InviterId != 0 {
			return ErrInvitationAlreadyBound
		}
		var inviter User
		if err := tx.Where("aff_code = ?", strings.TrimSpace(code)).First(&inviter).Error; err != nil {
			return invitationLookupError(err)
		}
		if inviter.Status != common.UserStatusEnabled {
			return ErrInvitationNotFound
		}
		if int64(inviter.Id) == uid {
			return ErrInvitationSelf
		}
		visited := map[int64]bool{uid: true}
		current := int64(inviter.Id)
		for current != 0 {
			if visited[current] {
				return ErrInvitationCycle
			}
			visited[current] = true
			var ancestor User
			if err := tx.Select("id", "inviter_id", "status").First(&ancestor, current).Error; err != nil {
				return invitationLookupError(err)
			}
			if ancestor.Status != common.UserStatusEnabled {
				return ErrInvitationNotFound
			}
			var parent InvitationBinding
			err := tx.Where("invitee_id = ?", current).First(&parent).Error
			if err == nil {
				current = parent.InviterId
				continue
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			current = int64(ancestor.InviterId)
		}
		b := InvitationBinding{InviteeId: uid, InviterId: int64(inviter.Id), BoundAt: &now, Source: "explicit", InviterCode: inviter.AffCode}
		if err := tx.Create(&b).Error; err != nil {
			return err
		}
		result := tx.Model(&User{}).Where("id = ? AND inviter_id = ?", uid, 0).Update("inviter_id", inviter.Id)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrInvitationAlreadyBound
		}
		if err := invitationAudit(tx, uid, "bind", "binding", b.Id, now); err != nil {
			return err
		}
		out = &InvitationBindingView{Bound: true, InviterCode: inviter.AffCode, InviterLabel: invitationLabel(int64(inviter.Id)), BoundAt: &now}
		return nil
	})
	return out, err
}
func invitationPagination(page, size int) (int, int, error) {
	if page < 1 || size < 1 || size > 100 || page-1 > math.MaxInt/size {
		return 0, 0, ErrInvitationInvalid
	}
	return page, size, nil
}
func ListInvitationCampaigns(admin bool, page, size int) (*InvitationCampaignPage, error) {
	if _, _, err := invitationPagination(page, size); err != nil {
		return nil, err
	}
	out := &InvitationCampaignPage{Page: page, PageSize: size, Items: []InvitationCampaignView{}}
	var cs []InvitationCampaign
	q := DB.Model(&InvitationCampaign{})
	if !admin {
		q = q.Where("visible = ? AND current_version_id IS NOT NULL", true)
	}
	if err := q.Count(&out.Total).Error; err != nil {
		return nil, err
	}
	if err := q.Offset((page - 1) * size).Limit(size).Order("id desc").Find(&cs).Error; err != nil {
		return nil, err
	}
	for _, c := range cs {
		var v InvitationCampaignVersion
		query := DB.Where("campaign_id = ?", c.Id).Order("version desc")
		if !admin {
			query = DB.Where("id = ?", *c.CurrentVersionId)
		}
		if err := query.First(&v).Error; err != nil {
			return nil, err
		}
		view, err := campaignView(DB, c, v)
		if err != nil {
			return nil, err
		}
		out.Items = append(out.Items, view)
	}
	return out, nil
}
func CurrentInvitationCampaign() (*InvitationCampaignView, error) {
	v, err := activeInvitationVersion(DB, time.Now().UnixMilli())
	if err != nil || v == nil {
		return nil, err
	}
	var c InvitationCampaign
	if err := DB.First(&c, v.CampaignId).Error; err != nil {
		return nil, err
	}
	if !c.Visible {
		return nil, nil
	}
	out, err := campaignView(DB, c, *v)
	return &out, err
}
func ListInvitationFriends(uid int64, page, size int) (*InvitationFriendPage, error) {
	if _, _, err := invitationPagination(page, size); err != nil {
		return nil, err
	}
	out := &InvitationFriendPage{Page: page, PageSize: size, Items: []InvitationFriend{}}
	var bs []InvitationBinding
	q := DB.Model(&InvitationBinding{}).Where("inviter_id = ?", uid)
	if err := q.Count(&out.Total).Error; err != nil {
		return nil, err
	}
	if err := q.Order("id desc").Offset((page - 1) * size).Limit(size).Find(&bs).Error; err != nil {
		return nil, err
	}
	for _, b := range bs {
		item := InvitationFriend{InviteeId: b.InviteeId, Label: invitationLabel(b.InviteeId), BoundAt: b.BoundAt, Status: "pending"}
		var qual InvitationQualification
		err := DB.Where("invitee_id = ?", b.InviteeId).First(&qual).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		if err == nil {
			item.QualifiedAt = qual.QualifiedAt
			item.Status = qual.Status
		}
		out.Items = append(out.Items, item)
	}
	return out, nil
}
func activeInvitationVersion(tx *gorm.DB, now int64) (*InvitationCampaignVersion, error) {
	var activations []InvitationCampaignActivation
	if err := tx.Where("effective_from <= ? AND (ended_at IS NULL OR ended_at > ?)", now, now).Order("effective_from desc").Find(&activations).Error; err != nil {
		return nil, err
	}
	for _, a := range activations {
		var v InvitationCampaignVersion
		if err := tx.First(&v, a.VersionId).Error; err != nil {
			return nil, err
		}
		if v.StartsAt <= now && now < v.EndsAt {
			return &v, nil
		}
	}
	return nil, nil
}

// validInvitationRewardBinding rejects malformed legacy relations before a
// payment can create a reward. A missing binding for an ancestor is valid: it
// simply means that inviter is the root of the chain. Missing users, disabled
// inviters, future bindings and cycles fail closed without affecting payment.
func validInvitationRewardBinding(tx *gorm.DB, inviteeID int64, now int64) (bool, error) {
	var binding InvitationBinding
	if err := tx.Where("invitee_id = ?", inviteeID).First(&binding).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	if binding.InviterId <= 0 || binding.InviterId == inviteeID || (binding.BoundAt != nil && *binding.BoundAt > now) {
		return false, nil
	}
	visited := map[int64]bool{inviteeID: true}
	current := binding.InviterId
	for current != 0 {
		if current < 0 || visited[current] {
			return false, nil
		}
		visited[current] = true
		var user User
		if err := tx.Select("id", "status", "inviter_id").First(&user, current).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return false, nil
			}
			return false, err
		}
		if user.Status != common.UserStatusEnabled {
			return false, nil
		}
		var parent InvitationBinding
		err := tx.Where("invitee_id = ?", current).First(&parent).Error
		if err == nil {
			if parent.InviterId <= 0 || (parent.BoundAt != nil && *parent.BoundAt > now) {
				return false, nil
			}
			current = parent.InviterId
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return false, err
		}
		// A legacy row may still be represented only by users.inviter_id.
		current = int64(user.InviterId)
	}
	return true, nil
}
func invitationEffectiveCount(tx *gorm.DB, inviter int64) (int64, error) {
	var n int64
	e := tx.Model(&InvitationQualification{}).Where("inviter_id = ? AND qualified_at IS NOT NULL", inviter).Count(&n).Error
	return n, e
}
func invitationRate(tx *gorm.DB, version, count int64) (int, error) {
	var t InvitationCampaignTier
	if e := tx.Where("version_id = ? AND min_effective_friends <= ?", version, count).Order("min_effective_friends desc").First(&t).Error; e != nil {
		return 0, e
	}
	return t.RateBps, nil
}

const invitationQualificationPeriod int64 = 7 * 24 * 60 * 60 * 1000

func reconcileInvitationQualifications(tx *gorm.DB, now int64) error {
	var qs []InvitationQualification
	if err := tx.Where("qualified_at IS NULL AND eligible_at <= ?", now).Find(&qs).Error; err != nil {
		return err
	}
	for _, q := range qs {
		var orders []CustomSubscriptionOrder
		if err := tx.Where("user_id = ? AND invitation_capture_result IN ?", q.InviteeId, []string{"captured", "no_campaign"}).Order("paid_at asc,id asc").Find(&orders).Error; err != nil {
			return err
		}
		for _, order := range orders {
			if order.PaidAt == nil || order.AmountPaidMinor <= order.RefundedAmountMinor {
				continue
			}
			if *order.PaidAt > math.MaxInt64-invitationQualificationPeriod {
				return ErrInvitationInvalid
			}
			eligible := *order.PaidAt + invitationQualificationPeriod
			q.CandidateOrderId = order.Id
			q.EligibleAt = eligible
			q.Status = "pending"
			var refunds []InvitationRefundOperation
			if err := tx.Where("order_id = ?", order.Id).Order("prepared_at asc,id asc").Find(&refunds).Error; err != nil {
				return err
			}
			qualifiedAt := eligible
			held := false
			for _, refund := range refunds {
				if refund.PreparedAt > qualifiedAt {
					continue
				}
				if refund.Status == "PREPARED" {
					held = true
					break
				}
				if refund.CompletedAt != nil {
					qualifiedAt = max(qualifiedAt, *refund.CompletedAt)
				}
				if refund.CancelledAt != nil {
					qualifiedAt = max(qualifiedAt, *refund.CancelledAt)
				}
			}
			if !held && qualifiedAt <= now {
				q.QualifiedAt = &qualifiedAt
				q.Status = "qualified"
			}
			break
		}
		if err := tx.Save(&q).Error; err != nil {
			return err
		}
	}
	return nil
}
func captureInvitationQualification(tx *gorm.DB, order *CustomSubscriptionOrder, now int64) error {
	if now > math.MaxInt64-invitationQualificationPeriod {
		return ErrInvitationInvalid
	}
	if order.AmountPaidMinor <= 0 {
		return nil
	}
	var b InvitationBinding
	err := tx.Where("invitee_id = ?", order.UserId).First(&b).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if b.InviterId == order.UserId || (b.BoundAt != nil && *b.BoundAt > now) {
		return nil
	}
	var count int64
	if err := tx.Model(&InvitationQualification{}).Where("invitee_id = ?", order.UserId).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	return tx.Create(&InvitationQualification{InviteeId: order.UserId, InviterId: b.InviterId, CandidateOrderId: order.Id, EligibleAt: now + invitationQualificationPeriod, Status: "pending"}).Error
}

// Registrations created by older integrations can still run against their minimal
// user-only fixtures. The application migrates the invitation schema before serving.
func lockInvitationRegistration(tx *gorm.DB, inviterID int) error {
	if inviterID == 0 || !tx.Migrator().HasTable(&InvitationControl{}) {
		return nil
	}
	return lockInvitationControl(tx)
}
func bindInvitationRegistration(tx *gorm.DB, user *User, inviterID int) error {
	if inviterID == 0 || !tx.Migrator().HasTable(&InvitationBinding{}) {
		return nil
	}
	var inviter User
	if err := tx.First(&inviter, inviterID).Error; err != nil {
		return invitationLookupError(err)
	}
	if inviter.Id == user.Id {
		return ErrInvitationSelf
	}
	now := time.Now().UnixMilli()
	if err := tx.Create(&InvitationBinding{InviteeId: int64(user.Id), InviterId: int64(inviterID), BoundAt: &now, Source: "registration", InviterCode: inviter.AffCode}).Error; err != nil {
		return err
	}
	user.InviterId = inviterID
	return tx.Model(user).Update("inviter_id", inviterID).Error
}
