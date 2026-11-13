package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// Public offers deliberately exclude administrator identity and audit fields.
type publicCustomSubscriptionPlan struct {
	ID                 string            `json:"id"`
	Version            string            `json:"version"`
	Title              string            `json:"title"`
	Subtitle           string            `json:"subtitle"`
	BillingCycle       string            `json:"billing_cycle"`
	DurationMonths     int               `json:"duration_months"`
	Currency           string            `json:"currency"`
	PriceAmountMinor   string            `json:"price_amount_minor"`
	PaidPoints         string            `json:"paid_points"`
	PaidPointType      map[string]string `json:"paid_point_type"`
	BonusPoints        string            `json:"bonus_points"`
	BonusPointType     map[string]string `json:"bonus_point_type"`
	AutoRenewEnabled   bool              `json:"auto_renew_enabled"`
	AutoRenewBonusBps  int               `json:"auto_renew_bonus_bps"`
	AutoBonusPointType map[string]string `json:"auto_bonus_point_type"`
	Benefits           []string          `json:"benefits"`
}

func ReadPublicCustomSubscriptionPlans(c *gin.Context) {
	if len(c.Request.URL.Query()) != 0 {
		common.ApiErrorT(c, "Invalid custom subscription plan filters")
		return
	}
	plans, err := model.ReadPublicCustomSubscriptionPlans()
	if err != nil {
		customSubscriptionError(c, err)
		return
	}
	_, types, err := customSubscriptionTypes()
	if err != nil {
		customSubscriptionError(c, err)
		return
	}
	items := make([]publicCustomSubscriptionPlan, 0, len(plans))
	for _, plan := range plans {
		paidType := types[plan.PaidPointTypeId]
		var bonusType, autoType map[string]string
		if plan.BonusPointTypeId != nil {
			bonusType = types[*plan.BonusPointTypeId]
		}
		if plan.AutoBonusPointTypeId != nil {
			autoType = types[*plan.AutoBonusPointTypeId]
		}
		if paidType == nil || plan.BonusPoints > 0 && bonusType == nil || plan.AutoRenewBonusBps > 0 && autoType == nil {
			customSubscriptionError(c, model.ErrPointTypeNotFound)
			return
		}
		var benefits []string
		if err := common.UnmarshalJsonStr(plan.BenefitsJson, &benefits); err != nil {
			customSubscriptionError(c, err)
			return
		}
		if benefits == nil {
			benefits = []string{}
		}
		items = append(items, publicCustomSubscriptionPlan{
			ID: strconv.FormatInt(plan.Id, 10), Version: strconv.FormatInt(plan.Version, 10), Title: plan.Title, Subtitle: plan.Subtitle,
			BillingCycle: plan.BillingCycle, DurationMonths: plan.DurationMonths, Currency: plan.Currency,
			PriceAmountMinor: strconv.FormatInt(plan.PriceAmountMinor, 10), PaidPoints: strconv.FormatInt(plan.PaidPoints, 10), PaidPointType: paidType,
			BonusPoints: strconv.FormatInt(plan.BonusPoints, 10), BonusPointType: bonusType,
			AutoRenewEnabled: plan.AutoRenewEnabled, AutoRenewBonusBps: plan.AutoRenewBonusBps, AutoBonusPointType: autoType, Benefits: benefits,
		})
	}
	common.ApiSuccess(c, gin.H{"items": items})
}
