package model

import (
	"gorm.io/gorm"
)

// TopModel 本月最常用模型（按调用次数，含免费模型）。
type TopModel struct {
	ModelName string `json:"model_name"`
	Count     int64  `json:"count"`
}

// TopToken 本月最烧钱秘钥（按积分消耗，仅付费调用）。
type TopToken struct {
	TokenID   int    `json:"token_id"`
	TokenName string `json:"token_name"`
	Points    int64  `json:"points"`
}

// MonthlySummary 本月（自然月）速览聚合结果。
// Quota 为额度（前端按系统货币格式化）；Points 为积分；TotalCalls 为调用次数。
type MonthlySummary struct {
	Quota      int64     `json:"quota"`
	Points     int64     `json:"points"`
	TotalCalls int64     `json:"total_calls"`
	TopModel   *TopModel `json:"top_model"`
	TopToken   *TopToken `json:"top_token"`
}

// GetMonthlySummary 聚合本月数据。
// userID=0 表示全量（root）；start/end 为 Unix 秒。
// quota_data 用秒级时间戳（含免费模型）；point_call_billing 用毫秒级时间戳（仅付费调用）。
func GetMonthlySummary(userID int, start, end int64) (*MonthlySummary, error) {
	summary := &MonthlySummary{}

	// quota_data 聚合：每次调用返回独立查询，避免 GORM 条件累积。
	quotaBase := func() *gorm.DB {
		q := DB.Model(&QuotaData{}).Where("created_at >= ? AND created_at <= ?", start, end)
		if userID > 0 {
			q = q.Where("user_id = ?", userID)
		}
		return q
	}

	// 本月花费金额（额度）+ 总调用次数
	var quotaAgg struct {
		Quota int64
		Count int64
	}
	if err := quotaBase().
		Select("COALESCE(SUM(quota), 0) as quota, COALESCE(SUM(count), 0) as count").
		Scan(&quotaAgg).Error; err != nil {
		return nil, err
	}
	summary.Quota = quotaAgg.Quota
	summary.TotalCalls = quotaAgg.Count

	// 最常用模型（含免费模型）
	var topModel TopModel
	if err := quotaBase().
		Select("model_name, SUM(count) as count").
		Group("model_name").
		Order("SUM(count) DESC").
		Limit(1).
		Scan(&topModel).Error; err != nil {
		return nil, err
	}
	if topModel.ModelName != "" {
		summary.TopModel = &topModel
	}

	// point_call_billing 聚合：毫秒级时间戳，仅已计费（charged）调用。
	pointBase := func() *gorm.DB {
		q := DB.Model(&PointCallBilling{}).
			Where("state = ?", "charged").
			Where("created_at >= ? AND created_at <= ?", start*1000, end*1000)
		if userID > 0 {
			q = q.Where("user_id = ?", userID)
		}
		return q
	}

	// 本月花费积分
	var pointsAgg struct {
		Points int64
	}
	if err := pointBase().
		Select("COALESCE(SUM(points), 0) as points").
		Scan(&pointsAgg).Error; err != nil {
		return nil, err
	}
	summary.Points = pointsAgg.Points

	// 最烧钱秘钥（排除 token_id=0 的 playground/无秘钥调用）
	var topToken TopToken
	if err := pointBase().
		Where("token_id > 0").
		Select("token_id, SUM(points) as points").
		Group("token_id").
		Order("SUM(points) DESC").
		Limit(1).
		Scan(&topToken).Error; err != nil {
		return nil, err
	}
	if topToken.TokenID > 0 {
		// 秘钥可能已删除，用 Unscoped 查询名称
		var token Token
		if err := DB.Unscoped().Select("name").First(&token, "id = ?", topToken.TokenID).Error; err == nil {
			topToken.TokenName = token.Name
		}
		summary.TopToken = &topToken
	}

	return summary, nil
}
