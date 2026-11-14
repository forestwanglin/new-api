package model

import (
	"context"
	"errors"
	"math"
	"time"

	"gorm.io/gorm"
)

type Midjourney struct {
	Id          int    `json:"id"`
	Code        int    `json:"code"`
	UserId      int    `json:"user_id" gorm:"index"`
	Action      string `json:"action" gorm:"type:varchar(40);index"`
	MjId        string `json:"mj_id" gorm:"index"`
	Prompt      string `json:"prompt"`
	PromptEn    string `json:"prompt_en"`
	Description string `json:"description"`
	State       string `json:"state"`
	SubmitTime  int64  `json:"submit_time" gorm:"index"`
	StartTime   int64  `json:"start_time" gorm:"index"`
	FinishTime  int64  `json:"finish_time" gorm:"index"`
	ImageUrl    string `json:"image_url"`
	VideoUrl    string `json:"video_url"`
	VideoUrls   string `json:"video_urls"`
	Status      string `json:"status" gorm:"type:varchar(20);index"`
	Progress    string `json:"progress" gorm:"type:varchar(30);index"`
	FailReason  string `json:"fail_reason"`
	ChannelId   int    `json:"channel_id"`
	Quota       int    `json:"quota"`
	Buttons     string `json:"buttons"`
	Properties  string `json:"properties"`

	OutcomeVersion        int64                 `json:"-" gorm:"not null;default:0;index:idx_mj_points_pending"`
	AppliedOutcomeVersion int64                 `json:"-" gorm:"not null;default:0"`
	PollFence             int64                 `json:"-" gorm:"not null;default:0"`
	PollLeaseUntil        int64                 `json:"-" gorm:"not null;default:0"`
	SettlementRetryAt     int64                 `json:"-" gorm:"not null;default:0;index:idx_mj_points_retry"`
	PointsBillingID       string                `json:"-" gorm:"type:varchar(64);index"`
	PointsBilling         *PointBillingMetadata `json:"points_billing,omitempty" gorm:"-"`
	TokenId               int                   `json:"-" gorm:"default:0"`
	BillingChannelId      int                   `json:"-" gorm:"default:0"`
}

// TaskQueryParams 用于包含所有搜索条件的结构体，可以根据需求添加更多字段
type TaskQueryParams struct {
	ChannelID      string
	MjID           string
	StartTimestamp string
	EndTimestamp   string
}

func GetAllUserTask(userId int, startIdx int, num int, queryParams TaskQueryParams) []*Midjourney {
	var tasks []*Midjourney
	var err error

	// 初始化查询构建器
	query := DB.Where("user_id = ?", userId)

	if queryParams.MjID != "" {
		query = query.Where("mj_id = ?", queryParams.MjID)
	}
	if queryParams.StartTimestamp != "" {
		// 假设您已将前端传来的时间戳转换为数据库所需的时间格式，并处理了时间戳的验证和解析
		query = query.Where("submit_time >= ?", queryParams.StartTimestamp)
	}
	if queryParams.EndTimestamp != "" {
		query = query.Where("submit_time <= ?", queryParams.EndTimestamp)
	}

	// 获取数据
	err = query.Order("id desc").Limit(num).Offset(startIdx).Find(&tasks).Error
	if err != nil {
		return nil
	}

	if err := EnrichPointsMidjourney(tasks); err != nil {
		return nil
	}
	return tasks
}

func GetAllTasks(startIdx int, num int, queryParams TaskQueryParams) []*Midjourney {
	var tasks []*Midjourney
	var err error

	// 初始化查询构建器
	query := DB

	// 添加过滤条件
	if queryParams.ChannelID != "" {
		query = query.Where("channel_id = ?", queryParams.ChannelID)
	}
	if queryParams.MjID != "" {
		query = query.Where("mj_id = ?", queryParams.MjID)
	}
	if queryParams.StartTimestamp != "" {
		query = query.Where("submit_time >= ?", queryParams.StartTimestamp)
	}
	if queryParams.EndTimestamp != "" {
		query = query.Where("submit_time <= ?", queryParams.EndTimestamp)
	}

	// 获取数据
	err = query.Order("id desc").Limit(num).Offset(startIdx).Find(&tasks).Error
	if err != nil {
		return nil
	}

	if err := EnrichPointsMidjourney(tasks); err != nil {
		return nil
	}
	return tasks
}

func GetAllUnFinishTasks() []*Midjourney {
	var tasks []*Midjourney
	var err error
	// get all tasks progress is not 100%
	err = DB.Where("progress != ?", "100%").Find(&tasks).Error
	if err != nil {
		return nil
	}
	return tasks
}

// HasUnfinishedMidjourneyTasks reports whether at least one Midjourney task is
// still in progress. It is a cheap existence check (LIMIT 1) used to decide
// whether the midjourney_poll system task needs to run; when no task is pending
// the scheduler skips creating a row entirely.
func HasUnfinishedMidjourneyTasks() bool {
	var id int
	err := DB.Model(&Midjourney{}).
		Where("progress != ? OR (outcome_version > applied_outcome_version AND status IN ?)",
			"100%", []string{"SUCCESS", "FAILURE"}).
		Limit(1).
		Pluck("id", &id).Error
	return err == nil && id != 0
}

func GetByOnlyMJId(mjId string) *Midjourney {
	var mj *Midjourney
	var err error
	err = DB.Where("mj_id = ?", mjId).First(&mj).Error
	if err != nil {
		return nil
	}
	return mj
}

func GetByMJId(userId int, mjId string) *Midjourney {
	var mj *Midjourney
	var err error
	err = DB.Where("user_id = ? and mj_id = ?", userId, mjId).First(&mj).Error
	if err != nil {
		return nil
	}
	return mj
}

func GetByMJIds(userId int, mjIds []string) []*Midjourney {
	var mj []*Midjourney
	var err error
	err = DB.Where("user_id = ? and mj_id in (?)", userId, mjIds).Find(&mj).Error
	if err != nil {
		return nil
	}
	return mj
}

func GetMjByuId(id int) *Midjourney {
	var mj *Midjourney
	var err error
	err = DB.Where("id = ?", id).First(&mj).Error
	if err != nil {
		return nil
	}
	return mj
}

func UpdateProgress(id int, progress string) error {
	return DB.Model(&Midjourney{}).Where("id = ? AND (points_billing_id IS NULL OR points_billing_id = ?)", id, "").Update("progress", progress).Error
}

func (midjourney *Midjourney) Insert() error {
	var err error
	err = DB.Create(midjourney).Error
	return err
}

func (midjourney *Midjourney) Update() error {
	if midjourney.PointsBillingID != "" {
		return ErrPointsTaskConditionalWriteRequired
	}
	var err error
	err = DB.Save(midjourney).Error
	return err
}

func (midjourney *Midjourney) UpdateBillingState() error {
	if midjourney.PointsBillingID != "" {
		return ErrPointsTaskConditionalWriteRequired
	}
	return DB.Model(midjourney).
		Select("quota", "token_id", "billing_channel_id").
		Updates(midjourney).Error
}

func (midjourney *Midjourney) GetBillingChannelId() int {
	if midjourney.BillingChannelId > 0 {
		return midjourney.BillingChannelId
	}
	return midjourney.ChannelId
}

// UpdateWithStatus performs a conditional UPDATE guarded by fromStatus (CAS).
// Returns (true, nil) if this caller won the update, (false, nil) if
// another process already moved the task out of fromStatus.
// UpdateWithStatus performs a conditional UPDATE guarded by fromStatus (CAS).
// Uses Model().Select("*").Updates() to avoid GORM Save()'s INSERT fallback.
func (midjourney *Midjourney) UpdateWithStatus(fromStatus string) (bool, error) {
	if midjourney.PointsBillingID != "" {
		return updatePointsMidjourneyOutcome(midjourney, fromStatus)
	}
	result := DB.Model(midjourney).Where("status = ?", fromStatus).Select("*").Updates(midjourney)
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected > 0, nil
}

func MjBulkUpdate(mjIds []string, params map[string]any) error {
	return DB.Model(&Midjourney{}).
		Where("mj_id in (?) AND (points_billing_id IS NULL OR points_billing_id = ?)", mjIds, "").
		Updates(params).Error
}

func MjBulkUpdateByTaskIds(taskIDs []int, params map[string]any) error {
	return DB.Model(&Midjourney{}).
		Where("id in (?) AND (points_billing_id IS NULL OR points_billing_id = ?)", taskIDs, "").
		Updates(params).Error
}

// CountAllTasks returns total midjourney tasks for admin query
func CountAllTasks(queryParams TaskQueryParams) int64 {
	var total int64
	query := DB.Model(&Midjourney{})
	if queryParams.ChannelID != "" {
		query = query.Where("channel_id = ?", queryParams.ChannelID)
	}
	if queryParams.MjID != "" {
		query = query.Where("mj_id = ?", queryParams.MjID)
	}
	if queryParams.StartTimestamp != "" {
		query = query.Where("submit_time >= ?", queryParams.StartTimestamp)
	}
	if queryParams.EndTimestamp != "" {
		query = query.Where("submit_time <= ?", queryParams.EndTimestamp)
	}
	_ = query.Count(&total).Error
	return total
}

// CountAllUserTask returns total midjourney tasks for user
func CountAllUserTask(userId int, queryParams TaskQueryParams) int64 {
	var total int64
	query := DB.Model(&Midjourney{}).Where("user_id = ?", userId)
	if queryParams.MjID != "" {
		query = query.Where("mj_id = ?", queryParams.MjID)
	}
	if queryParams.StartTimestamp != "" {
		query = query.Where("submit_time >= ?", queryParams.StartTimestamp)
	}
	if queryParams.EndTimestamp != "" {
		query = query.Where("submit_time <= ?", queryParams.EndTimestamp)
	}
	_ = query.Count(&total).Error
	return total
}

func (task *Midjourney) BeforeCreate(_ *gorm.DB) error {
	if task.PointsBillingID != "" && task.OutcomeVersion == 0 {
		task.OutcomeVersion = 1
	}
	return nil
}

func TryClaimPointsMidjourneyPoll(task *Midjourney, now, leaseUntil int64) (bool, error) {
	if task.PointsBillingID == "" {
		return true, nil
	}
	if now < 0 || leaseUntil <= now || task.PollFence == math.MaxInt64 {
		return false, errors.New("invalid Midjourney poll lease")
	}
	result := DB.Model(&Midjourney{}).Where("id = ? AND outcome_version = ? AND poll_fence = ? AND poll_lease_until <= ? AND status NOT IN ?",
		task.Id, task.OutcomeVersion, task.PollFence, now, []string{"SUCCESS", "FAILURE"}).
		Updates(map[string]any{"poll_fence": task.PollFence + 1, "poll_lease_until": leaseUntil})
	if result.Error != nil || result.RowsAffected != 1 {
		return false, result.Error
	}
	task.PollFence++
	task.PollLeaseUntil = leaseUntil
	return true, nil
}

func ReleasePointsMidjourneyPoll(task *Midjourney) error {
	if task.PointsBillingID == "" {
		return nil
	}
	return DB.Model(&Midjourney{}).Where("id = ? AND outcome_version = ? AND poll_fence = ?", task.Id, task.OutcomeVersion, task.PollFence).
		Update("poll_lease_until", 0).Error
}

func updatePointsMidjourneyOutcome(task *Midjourney, fromStatus string) (bool, error) {
	won := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		var current Midjourney
		if err := lockForUpdate(tx).First(&current, task.Id).Error; err != nil {
			return err
		}
		if current.PointsBillingID != task.PointsBillingID || current.Status != fromStatus ||
			current.OutcomeVersion != task.OutcomeVersion || current.PollFence != task.PollFence ||
			current.Status == "SUCCESS" || current.Status == "FAILURE" {
			return nil
		}
		if task.PollLeaseUntil == 0 || current.PollLeaseUntil != task.PollLeaseUntil || current.PollLeaseUntil <= time.Now().UnixMilli() {
			return nil
		}
		if current.OutcomeVersion == math.MaxInt64 || current.PollFence == math.MaxInt64 {
			return errors.New("Midjourney outcome version overflow")
		}
		updates := map[string]any{
			"code": task.Code, "progress": task.Progress, "prompt_en": task.PromptEn,
			"state": task.State, "submit_time": task.SubmitTime, "start_time": task.StartTime,
			"finish_time": task.FinishTime, "image_url": task.ImageUrl, "video_url": task.VideoUrl,
			"video_urls": task.VideoUrls, "status": task.Status, "fail_reason": task.FailReason,
			"properties": task.Properties, "buttons": task.Buttons,
			"outcome_version": current.OutcomeVersion + 1, "poll_fence": current.PollFence + 1, "poll_lease_until": 0, "settlement_retry_at": 0,
		}
		result := tx.Model(&Midjourney{}).Where("id = ? AND outcome_version = ? AND poll_fence = ?", task.Id, current.OutcomeVersion, current.PollFence).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrStaleTaskOutcome
		}
		task.OutcomeVersion = current.OutcomeVersion + 1
		task.PollFence = current.PollFence + 1
		task.PollLeaseUntil = 0
		task.AppliedOutcomeVersion = current.AppliedOutcomeVersion
		task.Quota = current.Quota
		won = true
		return nil
	})
	return won, err
}

func LockPointsMidjourneyBilling(tx *gorm.DB, id int, expectedOutcomeVersion int64) (*Midjourney, error) {
	var task Midjourney
	if err := lockForUpdate(tx).First(&task, id).Error; err != nil {
		return nil, err
	}
	if task.PointsBillingID == "" || task.OutcomeVersion != expectedOutcomeVersion {
		return nil, ErrStaleTaskOutcome
	}
	return &task, nil
}

func CommitPointsMidjourneyBilling(tx *gorm.DB, task *Midjourney, quota int) error {
	if quota < 0 || task.PointsBillingID == "" {
		return errors.New("invalid Midjourney billing target")
	}
	result := tx.Model(&Midjourney{}).Where("id = ? AND outcome_version = ?", task.Id, task.OutcomeVersion).
		Updates(map[string]any{"quota": quota, "applied_outcome_version": task.OutcomeVersion})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		var current Midjourney
		if err := tx.First(&current, task.Id).Error; err != nil {
			return err
		}
		if current.OutcomeVersion != task.OutcomeVersion || current.Quota != quota || current.AppliedOutcomeVersion != task.OutcomeVersion {
			return ErrStaleTaskOutcome
		}
	}
	task.Quota = quota
	task.AppliedOutcomeVersion = task.OutcomeVersion
	return nil
}

func GetPointsMidjourneyPendingSettlement(ctx context.Context, limit int) ([]*Midjourney, error) {
	return claimPointsMidjourneySettlements(ctx, limit, time.Now().UnixMilli())
}

func claimPointsMidjourneySettlements(ctx context.Context, limit int, now int64) ([]*Midjourney, error) {
	var tasks []*Midjourney
	if limit <= 0 {
		return tasks, nil
	}
	if now < 0 || now > math.MaxInt64-60000 {
		return nil, errors.New("invalid Midjourney settlement lease")
	}
	err := DB.WithContext(ctx).Where("outcome_version > applied_outcome_version AND status IN ? AND settlement_retry_at <= ?", []string{"SUCCESS", "FAILURE"}, now).
		Order("settlement_retry_at ASC, id ASC").Limit(min(limit, 200)).Find(&tasks).Error
	if err != nil {
		return nil, err
	}
	claimed := make([]*Midjourney, 0, len(tasks))
	for _, task := range tasks {
		result := DB.WithContext(ctx).Model(&Midjourney{}).
			Where("id = ? AND outcome_version = ? AND applied_outcome_version < outcome_version AND settlement_retry_at <= ?", task.Id, task.OutcomeVersion, now).
			Update("settlement_retry_at", now+60000)
		if result.Error != nil {
			return nil, result.Error
		}
		if result.RowsAffected == 1 {
			task.SettlementRetryAt = now + 60000
			claimed = append(claimed, task)
		}
	}
	return claimed, nil
}
