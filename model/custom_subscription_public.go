package model

func ReadPublicCustomSubscriptionPlans() ([]CustomSubscriptionPlan, error) {
	plans := make([]CustomSubscriptionPlan, 0)
	err := DB.Where("enabled = ?", true).Order("sort_order DESC").Order("id DESC").Find(&plans).Error
	return plans, err
}
