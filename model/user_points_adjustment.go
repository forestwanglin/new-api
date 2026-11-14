package model

import (
	"errors"
	"math"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var (
	ErrInvalidUserPointAdjustment  = errors.New("invalid user point adjustment")
	ErrUserPointAdjustmentConflict = errors.New("conflicting user point adjustment")
	ErrUserPointAdjustmentOverflow = errors.New("point balance exceeds the supported integer range")
)

type UserPointBalances struct {
	Balances []PointWalletBalance `json:"balances"`
}
type UserPointAdjustment struct {
	PointWalletBalance
	Replayed        bool   `json:"replayed"`
	Username        string `json:"-"`
	AvailableBefore string `json:"-"`
}

func GetUserPointBalances(userID, operatorRole int) (*UserPointBalances, error) {
	var user User
	if err := DB.Select("id, role").First(&user, userID).Error; err != nil {
		return nil, err
	}
	if operatorRole < common.RoleAdminUser || operatorRole != common.RoleRootUser && operatorRole <= user.Role {
		return nil, ErrUserQuotaPermission
	}
	result := &UserPointBalances{Balances: []PointWalletBalance{}}
	var rows []struct {
		ID                            int64
		Code, Name                    string
		AvailablePoints, FrozenPoints int64
	}
	if err := DB.Table("point_types AS pt").Select("pt.id, pt.code, pt.name, COALESCE(account.available_points, 0) AS available_points, COALESCE(account.frozen_points, 0) AS frozen_points").Joins("LEFT JOIN point_accounts AS account ON account.point_type_id = pt.id AND account.user_id = ?", userID).Order("pt.consume_priority DESC, pt.id ASC").Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result.Balances = append(result.Balances, PointWalletBalance{PointTypeID: strconv.FormatInt(row.ID, 10), Code: row.Code, Name: row.Name, AvailablePoints: strconv.FormatInt(row.AvailablePoints, 10), FrozenPoints: strconv.FormatInt(row.FrozenPoints, 10)})
	}
	return result, nil
}

// AdjustUserPoints shares the model-call lock order: user then account. A stable
// request identity and immutable payload make retries safe across lost replies.
func AdjustUserPoints(userID, operatorID, operatorRole int, typeID int64, mode, amount, requestID string) (*UserPointAdjustment, error) {
	value, err := strconv.ParseInt(amount, 10, 64)
	if err != nil || value <= 0 || strconv.FormatInt(value, 10) != amount || userID <= 0 || operatorID <= 0 || typeID <= 0 || (mode != "add" && mode != "subtract") || len(requestID) < 1 || len(requestID) > 64 || strings.ContainsFunc(requestID, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_')
	}) {
		return nil, ErrInvalidUserPointAdjustment
	}
	snapshotBytes, err := common.Marshal(map[string]string{"point_type_id": strconv.FormatInt(typeID, 10), "mode": mode, "amount": amount})
	if err != nil {
		return nil, err
	}
	snapshot := string(snapshotBytes)
	event := "admin-points:" + strconv.Itoa(operatorID) + ":" + requestID
	var result UserPointAdjustment
	err = DB.Transaction(func(tx *gorm.DB) error {
		// SQLite must acquire its write lock before the first read, preventing a
		// deferred read transaction from racing a model-call writer during upgrade.
		if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
			if err := tx.Model(&User{}).Where("id = ?", userID).UpdateColumn("quota", gorm.Expr("quota")).Error; err != nil {
				return err
			}
		}
		var user User
		if err := lockForUpdate(tx).Select("id, role, username").First(&user, userID).Error; err != nil {
			return err
		}
		if operatorRole < common.RoleAdminUser || operatorRole != common.RoleRootUser && operatorRole <= user.Role {
			return ErrUserQuotaPermission
		}
		result.Username = user.Username
		var pointType PointType
		if err := tx.First(&pointType, typeID).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPointTypeNotFound
		} else if err != nil {
			return err
		}
		result.PointWalletBalance = PointWalletBalance{PointTypeID: strconv.FormatInt(typeID, 10), Code: pointType.Code, Name: pointType.Name}
		var previous PointTransaction
		err := tx.Where("user_id = ? AND event_key = ?", userID, event).First(&previous).Error
		if err == nil {
			if previous.BizId != requestID || previous.EventKey != event || previous.BizType != "ADMIN_ADJUST" || previous.BillingSnapshot == nil || *previous.BillingSnapshot != snapshot || previous.OperatorId == nil || *previous.OperatorId != int64(operatorID) {
				return ErrUserPointAdjustmentConflict
			}
			var ledger PointLedger
			if err := tx.Where("transaction_id = ?", previous.Id).First(&ledger).Error; err != nil {
				return err
			}
			result.AvailableBefore = strconv.FormatInt(ledger.AvailableBefore, 10)
			result.AvailablePoints = strconv.FormatInt(ledger.AvailableAfter, 10)
			result.FrozenPoints = strconv.FormatInt(ledger.FrozenAfter, 10)
			result.Replayed = true
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var account PointAccount
		err = lockForUpdate(tx).Where("user_id = ? AND point_type_id = ?", userID, typeID).First(&account).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			account = PointAccount{UserId: int64(userID), PointTypeId: typeID}
			if err := tx.Create(&account).Error; err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		delta, action := value, PointActionCredit
		if mode == "subtract" {
			delta = -value
			action = PointActionRevoke
		}
		if account.FrozenPoints < 0 || account.Version < 0 {
			return ErrInvalidUserPointAdjustment
		}
		if delta > 0 && account.AvailablePoints > math.MaxInt64-delta || delta < 0 && account.AvailablePoints < math.MinInt64-delta || account.Version == math.MaxInt64 {
			return ErrUserPointAdjustmentOverflow
		}
		result.AvailableBefore = strconv.FormatInt(account.AvailablePoints, 10)
		actorID := int64(operatorID)
		transaction := PointTransaction{UserId: int64(userID), EventKey: event, Action: action, BizType: "ADMIN_ADJUST", BizId: requestID, Points: value, BillingSnapshot: &snapshot, OperatorType: PointOperatorAdmin, OperatorId: &actorID, Remark: "Administrator point adjustment: " + mode}
		if err := tx.Create(&transaction).Error; err != nil {
			return err
		}
		if err := pointCallMutation(tx, &transaction, &account, delta, 0, nil); err != nil {
			return err
		}
		result.AvailablePoints = strconv.FormatInt(account.AvailablePoints, 10)
		result.FrozenPoints = strconv.FormatInt(account.FrozenPoints, 10)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &result, nil
}
