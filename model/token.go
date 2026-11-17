package model

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
)

var (
	ErrTokenPointLimit        = errors.New("API key point limit is exhausted")
	ErrTokenPointLimitInvalid = errors.New("invalid API key point limit")
)

type Token struct {
	Id                 int            `json:"id"`
	UserId             int            `json:"user_id" gorm:"index"`
	Key                string         `json:"key" gorm:"type:varchar(128);uniqueIndex"`
	Status             int            `json:"status" gorm:"default:1"`
	Name               string         `json:"name" gorm:"index" `
	CreatedTime        int64          `json:"created_time" gorm:"bigint"`
	AccessedTime       int64          `json:"accessed_time" gorm:"bigint"`
	ExpiredTime        int64          `json:"expired_time" gorm:"bigint;default:-1"` // -1 means never expired
	RemainQuota        int            `json:"remain_quota" gorm:"default:0"`
	UnlimitedQuota     bool           `json:"unlimited_quota"`
	PointLimitEnabled  bool           `json:"point_limit_enabled"`
	PointLimit         int64          `json:"-" gorm:"type:bigint;not null;default:0"`
	ReservedPoints     int64          `json:"-" gorm:"type:bigint;not null;default:0"`
	ModelLimitsEnabled bool           `json:"model_limits_enabled"`
	ModelLimits        string         `json:"model_limits" gorm:"type:text"`
	AllowIps           *string        `json:"allow_ips" gorm:"default:''"`
	UsedQuota          int            `json:"used_quota" gorm:"default:0"` // used quota
	Group              string         `json:"group" gorm:"default:''"`
	CrossGroupRetry    bool           `json:"cross_group_retry"` // 跨分组重试，仅auto分组有效
	AutoGroups         string         `json:"-" gorm:"type:text"`
	DeletedAt          gorm.DeletedAt `gorm:"index"`
	// 允许用此令牌查询所属用户的额度；新建令牌默认开启，已有令牌升级后保持关闭
	AllowUserQuotaQuery bool   `json:"allow_user_quota_query"`
	CacheExpiresAt      int64  `json:"-" gorm:"-"`
	CacheMAC            string `json:"-" gorm:"-"`
}

func (token *Token) GetAutoGroups() ([]string, error) {
	if token.AutoGroups == "" {
		return nil, nil
	}
	var groups []string
	if err := common.UnmarshalJsonStr(token.AutoGroups, &groups); err != nil {
		return nil, err
	}
	return groups, nil
}

func (token *Token) SetAutoGroups(groups []string) error {
	if len(groups) == 0 {
		token.AutoGroups = ""
		return nil
	}
	data, err := common.Marshal(groups)
	if err != nil {
		return err
	}
	token.AutoGroups = string(data)
	return nil
}

func (token *Token) Clean() {
	token.Key = ""
}

func MaskTokenKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 4 {
		return strings.Repeat("*", len(key))
	}
	if len(key) <= 8 {
		return key[:2] + "****" + key[len(key)-2:]
	}
	return key[:4] + "**********" + key[len(key)-4:]
}

func (token *Token) GetFullKey() string {
	return token.Key
}

func (token *Token) GetMaskedKey() string {
	return MaskTokenKey(token.Key)
}

func (token *Token) GetIpLimits() []string {
	// delete empty spaces
	//split with \n
	ipLimits := make([]string, 0)
	if token.AllowIps == nil {
		return ipLimits
	}
	cleanIps := strings.ReplaceAll(*token.AllowIps, " ", "")
	if cleanIps == "" {
		return ipLimits
	}
	ips := strings.SplitSeq(cleanIps, "\n")
	for ip := range ips {
		ip = strings.TrimSpace(ip)
		ip = strings.ReplaceAll(ip, ",", "")
		if ip != "" {
			ipLimits = append(ipLimits, ip)
		}
	}
	return ipLimits
}

func GetAllUserTokens(userId int, startIdx int, num int) ([]*Token, error) {
	var tokens []*Token
	var err error
	err = DB.Where("user_id = ?", userId).Order("id desc").Limit(num).Offset(startIdx).Find(&tokens).Error
	return tokens, err
}

// GetTokenUsedPoints returns exact cumulative point charges for API keys.
// Caller ownership is enforced by both the token lookup and billing-row join.
func GetTokenUsedPoints(userID int, tokenIDs []int) (map[int]int64, error) {
	used := make(map[int]int64, len(tokenIDs))
	if len(tokenIDs) == 0 {
		return used, nil
	}
	var calls []struct {
		TokenID int
		Points  int64
	}
	if err := DB.Model(&PointCallBilling{}).
		Select("point_call_billings.token_id, point_call_billings.points").
		Joins("JOIN tokens ON tokens.id = point_call_billings.token_id").
		Where("tokens.user_id = ? AND point_call_billings.user_id = ? AND point_call_billings.token_id IN ?", userID, userID, tokenIDs).
		Scan(&calls).Error; err != nil {
		return nil, err
	}
	for _, call := range calls {
		if call.Points < 0 {
			return nil, ErrTokenPointLimitInvalid
		}
		total, err := pointAdd(used[call.TokenID], call.Points)
		if err != nil {
			return nil, err
		}
		used[call.TokenID] = total
	}
	return used, nil
}

// sanitizeLikePattern 校验并清洗用户输入的 LIKE 搜索模式。
// 规则：
//  1. 转义 ! 和 _（使用 ! 作为 ESCAPE 字符，兼容 MySQL/PostgreSQL/SQLite）
//  2. 连续的 % 合并为单个 %
//  3. 最多允许 2 个 %
//  4. 含 % 时（模糊搜索），去掉 % 后关键词长度必须 >= 2
//  5. 不含 % 时按精确匹配
func sanitizeLikePattern(input string) (string, error) {
	// 1. 先转义 ESCAPE 字符 ! 自身，再转义 _
	//    使用 ! 而非 \ 作为 ESCAPE 字符，避免 MySQL 中反斜杠的字符串转义问题
	input = strings.ReplaceAll(input, "!", "!!")
	input = strings.ReplaceAll(input, `_`, `!_`)

	if err := validateLikePattern(input); err != nil {
		return "", err
	}

	// 5. 无 % 时，精确全匹配
	return input, nil
}

func validateLikePattern(input string) error {
	// 1. 连续的 % 直接拒绝
	if strings.Contains(input, "%%") {
		return common.NewMessage("The search pattern cannot contain consecutive % wildcards")
	}

	// 2. 统计 % 数量，不得超过 2
	count := strings.Count(input, "%")
	if count > 2 {
		return common.NewMessage("The search pattern can contain at most 2 % wildcards")
	}

	// 3. 含 % 时，去掉 % 后关键词长度必须 >= 2
	if count > 0 {
		stripped := strings.ReplaceAll(input, "%", "")
		if len(stripped) < 2 {
			return common.NewMessage("Fuzzy search keywords must be at least 2 characters long")
		}
	}

	return nil
}

const searchHardLimit = 100

func SearchUserTokens(userId int, keyword string, token string, offset int, limit int) (tokens []*Token, total int64, err error) {
	// model 层强制截断
	if limit <= 0 || limit > searchHardLimit {
		limit = searchHardLimit
	}
	if offset < 0 {
		offset = 0
	}

	if token != "" {
		token = strings.TrimPrefix(token, "sk-")
	}

	// 超量用户（令牌数超过上限）只允许精确搜索，禁止模糊搜索
	maxTokens := operation_setting.GetMaxUserTokens()
	hasFuzzy := strings.Contains(keyword, "%") || strings.Contains(token, "%")
	if hasFuzzy {
		count, err := CountUserTokens(userId)
		if err != nil {
			common.SysLog(common.LogText("failed to count user tokens: %s", err.Error()))
			return nil, 0, common.NewMessage("Failed to get the token count")
		}
		if int(count) > maxTokens {
			return nil, 0, common.NewMessage("Token count exceeds the limit. Only exact search is allowed, do not use the % wildcard")
		}
	}

	baseQuery := DB.Model(&Token{}).Where("user_id = ?", userId)

	// 非空才加 LIKE 条件，空则跳过（不过滤该字段）
	if keyword != "" {
		keywordPattern, err := sanitizeLikePattern(keyword)
		if err != nil {
			return nil, 0, err
		}
		baseQuery = baseQuery.Where("name LIKE ? ESCAPE '!'", keywordPattern)
	}
	if token != "" {
		tokenPattern, err := sanitizeLikePattern(token)
		if err != nil {
			return nil, 0, err
		}
		baseQuery = baseQuery.Where(commonKeyCol+" LIKE ? ESCAPE '!'", tokenPattern)
	}

	// 先查匹配总数（用于分页，受 maxTokens 上限保护，避免全表 COUNT）
	err = baseQuery.Limit(maxTokens).Count(&total).Error
	if err != nil {
		common.SysError(common.LogText("failed to count search tokens: %s", err.Error()))
		return nil, 0, common.NewMessage("Failed to search tokens")
	}

	// 再分页查数据
	err = baseQuery.Order("id desc").Offset(offset).Limit(limit).Find(&tokens).Error
	if err != nil {
		common.SysError(common.LogText("failed to search tokens: %s", err.Error()))
		return nil, 0, common.NewMessage("Failed to search tokens")
	}
	return tokens, total, nil
}

func ValidateUserToken(key string) (token *Token, err error) {
	if key == "" {
		return nil, ErrTokenNotProvided
	}
	token, err = GetTokenByKey(key, false)
	if err == nil {
		if token.Status == common.TokenStatusExhausted ||
			token.Status == common.TokenStatusExpired ||
			token.Status != common.TokenStatusEnabled {
			return token, ErrTokenInvalid
		}
		if token.ExpiredTime != -1 && token.ExpiredTime < common.GetTimestamp() {
			if !common.RedisEnabled {
				token.Status = common.TokenStatusExpired
				err := token.SelectUpdate()
				if err != nil {
					common.SysLog(common.LogText("failed to update token status%s", err.Error()))
				}
			}
			return token, ErrTokenInvalid
		}
		if !token.PointLimitEnabled && !token.UnlimitedQuota && token.RemainQuota <= 0 {
			if !common.RedisEnabled {
				token.Status = common.TokenStatusExhausted
				err := token.SelectUpdate()
				if err != nil {
					common.SysLog(common.LogText("failed to update token status%s", err.Error()))
				}
			}
			return token, ErrTokenInvalid
		}
		return token, nil
	}
	common.SysLog(common.LogText("ValidateUserToken: failed to get token: %s", err.Error()))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrTokenInvalid
	}
	return nil, fmt.Errorf("%w: %v", ErrDatabase, err)
}

func GetTokenByIds(id int, userId int) (*Token, error) {
	if id == 0 || userId == 0 {
		return nil, common.NewMessage("Token ID or user ID is empty")
	}
	token := Token{Id: id, UserId: userId}
	var err error = nil
	err = DB.First(&token, "id = ? and user_id = ?", id, userId).Error
	return &token, err
}

func GetTokenById(id int) (*Token, error) {
	if id == 0 {
		return nil, errors.New("token id is empty")
	}
	token := Token{Id: id}
	var err error = nil
	err = DB.First(&token, "id = ?", id).Error
	return &token, err
}

func GetTokenByKey(key string, fromDB bool) (token *Token, err error) {
	if !fromDB && common.RedisEnabled {
		// Try Redis first
		token, err := cacheGetTokenByKey(key)
		if err == nil {
			// Quota counters are primary-DB authoritative even on a cache hit.
			// A stale low counter cannot indefinitely reject a valid request.
			var current Token
			if err := DB.Select("remain_quota", "used_quota", "unlimited_quota").First(&current, token.Id).Error; err != nil {
				return nil, err
			}
			token.RemainQuota, token.UsedQuota, token.UnlimitedQuota = current.RemainQuota, current.UsedQuota, current.UnlimitedQuota
			return token, nil
		}
		// Don't return error - fall through to DB
	}
	token = &Token{}
	if err = DB.Where(commonKeyCol+" = ?", key).First(token).Error; err != nil {
		return nil, err
	}
	if common.RedisEnabled {
		// 用数据库快照初始化或修复元数据，Lua 保留正在使用的额度计数。
		// 初始化失败不影响本次读取。
		if _, cacheErr := cacheInitToken(*token); cacheErr != nil {
			common.SysLog(common.LogText("failed to init token cache: %s", cacheErr.Error()))
		}
	}
	return token, nil
}

func (token *Token) Insert() error {
	var err error
	err = DB.Create(token).Error
	return err
}

// Update Make sure your token's fields is completed, because this will update non-zero values
func (token *Token) Update() (err error) {
	// 写库前失效缓存并设置 fence，防止并发读者把过期快照重新写回缓存。
	if cacheErr := invalidateTokenCacheForMutation(token.Key); cacheErr != nil {
		common.SysLog(common.LogText("failed to invalidate token cache before update: %s", cacheErr.Error()))
	}
	err = DB.Transaction(func(tx *gorm.DB) error {
		if token.PointLimitEnabled && common.UsingMainDatabase(common.DatabaseTypeSQLite) {
			if err := tx.Model(&Token{}).Where("id = ?", token.Id).UpdateColumn("accessed_time", gorm.Expr("accessed_time")).Error; err != nil {
				return err
			}
		}
		if token.PointLimitEnabled {
			var user User
			if err := lockForUpdate(tx).Select("id").First(&user, token.UserId).Error; err != nil {
				return err
			}
		}
		current, err := lockTokenQuotaTx(tx, token.Id)
		if err != nil {
			return err
		}
		if current.UserId != token.UserId || token.PointLimit < 0 {
			return ErrTokenPointLimitInvalid
		}
		if current.PointLimitEnabled && !token.PointLimitEnabled {
			token.PointLimitEnabled = true
			token.PointLimit = current.PointLimit
		}
		if token.PointLimitEnabled {
			token.UnlimitedQuota, token.RemainQuota = true, 0
		}
		return tx.Model(token).Select("name", "status", "expired_time", "remain_quota", "unlimited_quota", "point_limit_enabled", "point_limit",
			"model_limits_enabled", "model_limits", "allow_ips", "group", "cross_group_retry", "auto_groups",
			"allow_user_quota_query").Updates(token).Error
	})
	if err == nil {
		invalidateTokenQuotaAfterCommit(token.Key)
	}
	return err
}

func tokenUsedPointsTx(tx *gorm.DB, tokenID int) (int64, error) {
	var calls []PointCallBilling
	if err := lockForUpdate(tx).Select("points").Where("token_id = ?", tokenID).Find(&calls).Error; err != nil {
		return 0, err
	}
	var used int64
	for _, call := range calls {
		if call.Points < 0 {
			return 0, ErrTokenPointLimitInvalid
		}
		var err error
		used, err = pointAdd(used, call.Points)
		if err != nil {
			return 0, err
		}
	}
	return used, nil
}

// ReserveTokenPointLimitTx reserves the increment over this call's prior hold
// under the same row lock used by legacy API-key quota admission.
func ReserveTokenPointLimitTx(tx *gorm.DB, tokenID int, callID string, nextReserved int64) (bool, error) {
	if tokenID <= 0 || callID == "" || nextReserved < 0 {
		return false, ErrTokenPointLimitInvalid
	}
	token, err := lockTokenQuotaTx(tx, tokenID)
	if err != nil {
		return false, err
	}
	if !token.PointLimitEnabled || token.Status != common.TokenStatusEnabled || token.ExpiredTime != -1 && token.ExpiredTime < common.GetTimestamp() {
		return false, ErrTokenPointLimit
	}
	var call PointCallBilling
	if err := lockForUpdate(tx).Select("token_reserved_points").First(&call, "id = ? AND token_id = ?", callID, tokenID).Error; err != nil {
		return false, err
	}
	if token.ReservedPoints < 0 || call.TokenReservedPoints < 0 {
		return false, ErrTokenPointLimitInvalid
	}
	reservedElsewhere := token.ReservedPoints - call.TokenReservedPoints
	if reservedElsewhere < 0 {
		return false, ErrTokenPointLimitInvalid
	}
	used, err := tokenUsedPointsTx(tx, tokenID)
	if err != nil {
		return false, err
	}
	requested, err := pointAdd(used, reservedElsewhere)
	if err == nil {
		requested, err = pointAdd(requested, nextReserved)
	}
	if err != nil {
		return false, err
	}
	if token.PointLimit > 0 && (requested > token.PointLimit || nextReserved == 0 && used >= token.PointLimit) {
		return false, ErrTokenPointLimit
	}
	delta := nextReserved - call.TokenReservedPoints
	newReserved, err := pointAdd(token.ReservedPoints, delta)
	if err != nil || newReserved < 0 {
		return false, ErrTokenPointLimitInvalid
	}
	if err := tx.Model(&PointCallBilling{}).Where("id = ?", callID).Update("token_reserved_points", nextReserved).Error; err != nil {
		return false, err
	}
	if err := tx.Model(&Token{}).Where("id = ?", tokenID).Update("reserved_points", newReserved).Error; err != nil {
		return false, err
	}
	return true, nil
}

// AdjustTokenPointReservationTx releases or adjusts only a call-owned hold.
func AdjustTokenPointReservationTx(tx *gorm.DB, tokenID int, callID string, nextReserved int64) error {
	if tokenID <= 0 || callID == "" || nextReserved < 0 {
		return ErrTokenPointLimitInvalid
	}
	tx = tx.Unscoped().Session(&gorm.Session{})
	token, err := lockTokenQuotaTx(tx, tokenID)
	if err != nil {
		return err
	}
	var call PointCallBilling
	if err := lockForUpdate(tx).Select("token_reserved_points").First(&call, "id = ? AND token_id = ?", callID, tokenID).Error; err != nil {
		return err
	}
	if token.ReservedPoints < 0 || call.TokenReservedPoints < 0 {
		return ErrTokenPointLimitInvalid
	}
	newReserved, err := pointAdd(token.ReservedPoints, nextReserved-call.TokenReservedPoints)
	if err != nil || newReserved < 0 {
		return ErrTokenPointLimitInvalid
	}
	if err := tx.Model(&PointCallBilling{}).Where("id = ?", callID).Update("token_reserved_points", nextReserved).Error; err != nil {
		return err
	}
	return tx.Model(&Token{}).Where("id = ?", tokenID).Update("reserved_points", newReserved).Error
}

func (token *Token) SelectUpdate() (err error) {
	if cacheErr := invalidateTokenCacheForMutation(token.Key); cacheErr != nil {
		common.SysLog(common.LogText("failed to invalidate token cache before status update: %s", cacheErr.Error()))
	}
	// This can update zero values
	err = DB.Model(token).Select("accessed_time", "status").Updates(token).Error
	if err == nil {
		invalidateTokenQuotaAfterCommit(token.Key)
	}
	return err
}

func (token *Token) Delete() (err error) {
	if cacheErr := invalidateTokenCacheForMutation(token.Key); cacheErr != nil {
		common.SysLog(common.LogText("failed to invalidate token cache before delete: %s", cacheErr.Error()))
	}
	return DB.Delete(token).Error
}

func (token *Token) IsModelLimitsEnabled() bool {
	return token.ModelLimitsEnabled
}

func (token *Token) GetModelLimits() []string {
	if token.ModelLimits == "" {
		return []string{}
	}
	return strings.Split(token.ModelLimits, ",")
}

func (token *Token) GetModelLimitsMap() map[string]bool {
	limits := token.GetModelLimits()
	limitsMap := make(map[string]bool)
	for _, limit := range limits {
		limitsMap[limit] = true
	}
	return limitsMap
}

func DisableModelLimits(tokenId int) error {
	token, err := GetTokenById(tokenId)
	if err != nil {
		return err
	}
	err = DB.Model(token).Updates(map[string]any{"model_limits_enabled": false, "model_limits": ""}).Error
	if err == nil {
		invalidateTokenQuotaAfterCommit(token.Key)
	}
	return err
}

func DeleteTokenById(id int, userId int) (err error) {
	// Why we need userId here? In case user want to delete other's token.
	if id == 0 || userId == 0 {
		return common.NewMessage("Token ID or user ID is empty")
	}
	token := Token{Id: id, UserId: userId}
	err = DB.Where(token).First(&token).Error
	if err != nil {
		return err
	}
	return token.Delete()
}

func IncreaseTokenQuota(tokenId int, key string, quota int) error {
	if quota < 0 {
		return errors.New("quota cannot be negative")
	}
	if err := increaseTokenQuota(tokenId, quota); err != nil {
		return err
	}
	invalidateTokenQuotaAfterCommit(key)
	return nil
}

// Kept for draining existing local deltas; new writes never enqueue token quota.
func increaseTokenQuota(id int, quota int) error {
	return DB.Transaction(func(tx *gorm.DB) error { return AdjustTokenQuotaTx(tx, id, quota) })
}

func DecreaseTokenQuota(id int, key string, quota int) error {
	if quota < 0 {
		return errors.New("quota cannot be negative")
	}
	if err := decreaseTokenQuota(id, quota); err != nil {
		return err
	}
	invalidateTokenQuotaAfterCommit(key)
	return nil
}

func decreaseTokenQuota(id int, quota int) error {
	return DB.Transaction(func(tx *gorm.DB) error { return AdjustTokenQuotaTx(tx, id, -quota) })
}

func invalidateTokenQuotaAfterCommit(key string) {
	if err := invalidateTokenCacheForMutation(key); err != nil {
		common.SysLog(common.LogText("failed to invalidate committed token quota cache: %s", err.Error()))
	}
}

// InvalidateTokenQuotaCache is a postcommit secondary effect, never a reason to
// compensate a committed financial transaction. Reads obtain budget from DB.
func InvalidateTokenQuotaCache(id int) error {
	if !common.RedisEnabled || id <= 0 {
		return nil
	}
	var token Token
	if err := DB.Unscoped().Select("id", commonKeyCol).First(&token, id).Error; err != nil {
		return err
	}
	return invalidateTokenCacheForMutation(token.Key)
}

// CountUserTokens returns total number of tokens for the given user, used for pagination
func CountUserTokens(userId int) (int64, error) {
	var total int64
	err := DB.Model(&Token{}).Where("user_id = ?", userId).Count(&total).Error
	return total, err
}

// BatchDeleteTokens 删除指定用户的一组令牌，返回成功删除数量
func BatchDeleteTokens(ids []int, userId int) (int, error) {
	if len(ids) == 0 {
		return 0, common.NewMessage("Token IDs cannot be empty")
	}

	tx := DB.Begin()

	var tokens []Token
	if err := tx.Where("user_id = ? AND id IN (?)", userId, ids).Find(&tokens).Error; err != nil {
		tx.Rollback()
		return 0, err
	}
	if err := invalidateTokensCache(tokens); err != nil {
		common.SysLog(common.LogText("failed to invalidate token cache before batch delete: %s", err.Error()))
	}

	if err := tx.Where("user_id = ? AND id IN (?)", userId, ids).Delete(&Token{}).Error; err != nil {
		tx.Rollback()
		return 0, err
	}

	if err := tx.Commit().Error; err != nil {
		return 0, err
	}

	return len(tokens), nil
}

func GetTokenKeysByIds(ids []int, userId int) ([]Token, error) {
	var tokens []Token
	err := DB.Select("id", commonKeyCol).
		Where("user_id = ? AND id IN (?)", userId, ids).
		Find(&tokens).Error
	return tokens, err
}

// InvalidateUserTokensCache 清理指定用户所有令牌在 Redis 中的缓存，
// 配合 InvalidateUserCache 使用，可在用户被禁用/删除时立即阻断其令牌的请求。
// 下一次请求将从数据库重新加载令牌及用户状态，从而立即识别出被禁用的用户。
func InvalidateUserTokensCache(userId int) error {
	if !common.RedisEnabled {
		return nil
	}
	if userId <= 0 {
		return errors.New("invalid user id")
	}
	var tokens []Token
	if err := DB.Unscoped().
		Select("id", commonKeyCol).
		Where("user_id = ?", userId).
		Find(&tokens).Error; err != nil {
		return err
	}
	return invalidateTokensCache(tokens)
}

func invalidateTokensCache(tokens []Token) error {
	if !common.RedisEnabled {
		return nil
	}
	var firstErr error
	for _, t := range tokens {
		if t.Key == "" {
			continue
		}
		if err := invalidateTokenCacheForMutation(t.Key); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}
