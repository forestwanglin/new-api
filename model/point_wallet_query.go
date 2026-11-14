package model

import (
	"cmp"
	"errors"
	"math/big"
	"slices"
	"strconv"
)

type PointWalletBalance struct {
	PointTypeID     string `json:"point_type_id"`
	Code            string `json:"code"`
	Name            string `json:"name"`
	AvailablePoints string `json:"available_points"`
	FrozenPoints    string `json:"frozen_points"`
}

type PointWalletSourceSummary struct {
	PointTypeID     string `json:"point_type_id"`
	PointTypeCode   string `json:"point_type_code"`
	PointTypeName   string `json:"point_type_name"`
	BizType         string `json:"biz_type"`
	IncreasedPoints string `json:"increased_points"`
	DecreasedPoints string `json:"decreased_points"`
	NetPoints       string `json:"net_points"`
}

type PointWallet struct {
	Balances         []PointWalletBalance       `json:"balances"`
	PendingGPTPoints *string                    `json:"pending_gpt_points"`
	SourceSummaries  []PointWalletSourceSummary `json:"source_summaries"`
}

// GetPointWallet reads current accounts and cumulative ledger movements. Source
// movements cannot identify which source's points remain unspent. Referral
// pending rewards have no authoritative read model yet and remain unavailable.
func GetPointWallet(userID int64) (*PointWallet, error) {
	if userID <= 0 {
		return nil, errors.New("invalid point wallet owner")
	}
	wallet := &PointWallet{Balances: []PointWalletBalance{}, SourceSummaries: []PointWalletSourceSummary{}}
	var balances []struct {
		ID              int64
		Code            string
		Name            string
		AvailablePoints int64
		FrozenPoints    int64
	}
	if err := DB.Table("point_types AS pt").
		Select("pt.id, pt.code, pt.name, COALESCE(account.available_points, 0) AS available_points, COALESCE(account.frozen_points, 0) AS frozen_points").
		Joins("LEFT JOIN point_accounts AS account ON account.point_type_id = pt.id AND account.user_id = ?", userID).
		Order("pt.consume_priority ASC, pt.id ASC").Scan(&balances).Error; err != nil {
		return nil, err
	}
	for _, balance := range balances {
		wallet.Balances = append(wallet.Balances, PointWalletBalance{
			PointTypeID: strconv.FormatInt(balance.ID, 10), Code: balance.Code, Name: balance.Name,
			AvailablePoints: strconv.FormatInt(balance.AvailablePoints, 10), FrozenPoints: strconv.FormatInt(balance.FrozenPoints, 10),
		})
	}
	rows, err := DB.Table("point_ledger AS ledger").
		Select("account.point_type_id, COALESCE(pt.code, ''), COALESCE(pt.name, ''), txn.biz_type, ledger.available_delta, ledger.frozen_delta").
		Joins("JOIN point_accounts AS account ON account.id = ledger.account_id").
		Joins("JOIN point_transactions AS txn ON txn.id = ledger.transaction_id AND txn.user_id = account.user_id").
		Joins("LEFT JOIN point_types AS pt ON pt.id = account.point_type_id").
		Where("account.user_id = ? AND txn.user_id = ?", userID, userID).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type sourceKey struct {
		pointTypeID int64
		bizType     string
	}
	type sourceTotal struct {
		summary   PointWalletSourceSummary
		increased big.Int
		decreased big.Int
		net       big.Int
	}
	totals := make(map[sourceKey]*sourceTotal)
	for rows.Next() {
		var id, availableDelta, frozenDelta int64
		var code, name, bizType string
		if err := rows.Scan(&id, &code, &name, &bizType, &availableDelta, &frozenDelta); err != nil {
			return nil, err
		}
		key := sourceKey{pointTypeID: id, bizType: bizType}
		total := totals[key]
		if total == nil {
			total = &sourceTotal{summary: PointWalletSourceSummary{PointTypeID: strconv.FormatInt(id, 10), PointTypeCode: code, PointTypeName: name, BizType: bizType}}
			totals[key] = total
		}
		// Add the deltas outside SQL/int64 so freeze transfers cancel and even
		// long-lived or historical totals retain exact integer precision.
		var delta, frozen big.Int
		delta.SetInt64(availableDelta)
		frozen.SetInt64(frozenDelta)
		delta.Add(&delta, &frozen)
		total.net.Add(&total.net, &delta)
		if delta.Sign() > 0 {
			total.increased.Add(&total.increased, &delta)
		} else if delta.Sign() < 0 {
			delta.Neg(&delta)
			total.decreased.Add(&total.decreased, &delta)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	keys := make([]sourceKey, 0, len(totals))
	for key := range totals {
		keys = append(keys, key)
	}
	slices.SortFunc(keys, func(a, b sourceKey) int {
		if order := cmp.Compare(a.pointTypeID, b.pointTypeID); order != 0 {
			return order
		}
		return cmp.Compare(a.bizType, b.bizType)
	})
	for _, key := range keys {
		total := totals[key]
		total.summary.IncreasedPoints = total.increased.String()
		total.summary.DecreasedPoints = total.decreased.String()
		total.summary.NetPoints = total.net.String()
		wallet.SourceSummaries = append(wallet.SourceSummaries, total.summary)
	}
	return wallet, nil
}
