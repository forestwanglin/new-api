package model

import (
	"errors"

	"gorm.io/gorm"
)

// PointLedgerFilter is shared by list and count; UserID is always set for self queries.
type PointLedgerFilter struct {
	UserID         int64
	PointTypeID    int64
	Action         string
	StartTimestamp *int64
	EndTimestamp   *int64
	Page           int
	PageSize       int
}

type PointLedgerType struct {
	Id   int64  `json:"id,string"`
	Code string `json:"code"`
	Name string `json:"name"`
}

// PointLedgerItem deliberately excludes event keys, billing snapshots and operator data.
// Decimal-string JSON fields preserve every int64 value in browser clients.
type PointLedgerItem struct {
	Id                   int64  `json:"id,string"`
	TransactionId        int64  `json:"transaction_id,string"`
	AccountId            int64  `json:"account_id,string"`
	AccountVersion       int64  `json:"account_version,string"`
	FreezeId             *int64 `json:"freeze_id,string"`
	UserId               int64  `json:"user_id,string"`
	Username             string `json:"username,omitempty"`
	PointTypeId          int64  `json:"point_type_id,string"`
	PointTypeCode        string `json:"point_type_code"`
	PointTypeName        string `json:"point_type_name"`
	Action               string `json:"action"`
	BizType              string `json:"biz_type"`
	BizId                string `json:"biz_id"`
	RelatedTransactionId *int64 `json:"related_transaction_id,string"`
	Remark               string `json:"remark"`
	AvailableDelta       int64  `json:"available_delta,string"`
	FrozenDelta          int64  `json:"frozen_delta,string"`
	AvailableBefore      int64  `json:"available_before,string"`
	AvailableAfter       int64  `json:"available_after,string"`
	FrozenBefore         int64  `json:"frozen_before,string"`
	FrozenAfter          int64  `json:"frozen_after,string"`
	CreatedAt            int64  `json:"created_at"`
}

type PointLedgerPage struct {
	Page       int               `json:"page"`
	PageSize   int               `json:"page_size"`
	Total      int64             `json:"total"`
	Items      []PointLedgerItem `json:"items"`
	PointTypes []PointLedgerType `json:"point_types"`
}

func GetPointLedger(filter PointLedgerFilter, admin bool) (*PointLedgerPage, error) {
	if filter.Page < 1 || filter.PageSize < 1 || filter.PageSize > 100 || (filter.Page-1) > int(^uint(0)>>1)/filter.PageSize || (!admin && filter.UserID <= 0) {
		return nil, errors.New("invalid point ledger pagination or scope")
	}
	page := &PointLedgerPage{Page: filter.Page, PageSize: filter.PageSize, Items: []PointLedgerItem{}, PointTypes: []PointLedgerType{}}
	if err := DB.Model(&PointType{}).Select("id, code, name").Order("consume_priority ASC, id ASC").Find(&page.PointTypes).Error; err != nil {
		return nil, err
	}
	query := DB.Table("point_ledger AS ledger").
		Joins("JOIN point_accounts AS account ON account.id = ledger.account_id").
		Joins("JOIN point_transactions AS txn ON txn.id = ledger.transaction_id AND txn.user_id = account.user_id")
	if filter.UserID > 0 {
		query = query.Where("account.user_id = ? AND txn.user_id = ?", filter.UserID, filter.UserID)
	}
	if filter.PointTypeID > 0 {
		query = query.Where("account.point_type_id = ?", filter.PointTypeID)
	}
	if filter.Action != "" {
		query = query.Where("txn.action = ?", filter.Action)
	}
	if filter.StartTimestamp != nil {
		query = query.Where("ledger.created_at >= ?", *filter.StartTimestamp)
	}
	if filter.EndTimestamp != nil {
		query = query.Where("ledger.created_at < ?", *filter.EndTimestamp)
	}
	if err := query.Session(&gorm.Session{}).Count(&page.Total).Error; err != nil {
		return nil, err
	}
	selectFields := `ledger.id, ledger.transaction_id, ledger.account_id, ledger.account_version, ledger.freeze_id,
 account.user_id, account.point_type_id, COALESCE(pt.code, '') AS point_type_code, COALESCE(pt.name, '') AS point_type_name,
 txn.action, txn.biz_type, txn.biz_id, txn.related_transaction_id, txn.remark,
 ledger.available_delta, ledger.frozen_delta, ledger.available_before, ledger.available_after,
 ledger.frozen_before, ledger.frozen_after, ledger.created_at`
	query = query.Joins("LEFT JOIN point_types AS pt ON pt.id = account.point_type_id")
	if admin {
		query = query.Joins("LEFT JOIN users AS owner ON owner.id = account.user_id")
		selectFields += ", COALESCE(owner.username, '') AS username"
	}
	err := query.Select(selectFields).Order("ledger.created_at DESC, ledger.id DESC").Offset((filter.Page - 1) * filter.PageSize).Limit(filter.PageSize).Scan(&page.Items).Error
	if err != nil {
		return nil, err
	}
	for _, item := range page.Items {
		if item.CreatedAt < 0 || item.CreatedAt > 8640000000000000 {
			return nil, errors.New("invalid point ledger timestamp")
		}
	}
	return page, nil
}
