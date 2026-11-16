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

type PointWalletPendingReward struct {
	PointTypeID      string `json:"point_type_id"`
	Code             string `json:"code"`
	Name             string `json:"name"`
	ProcessingPoints string `json:"processing_points"`
	FrozenPoints     string `json:"frozen_points"`
	PendingPoints    string `json:"pending_points"`
}

type PointWallet struct {
	PendingInvitationRewards []PointWalletPendingReward `json:"pending_invitation_rewards"`
	Balances                 []PointWalletBalance       `json:"balances"`
	PendingGPTPoints         *string                    `json:"pending_gpt_points"`
	SourceSummaries          []PointWalletSourceSummary `json:"source_summaries"`
}

// GetPointWallet reads current accounts and cumulative ledger movements. Source
// movements cannot identify which source's points remain unspent. Invitation
// pending amounts come only from current reward processing and frozen amounts.
func GetPointWallet(userID int64) (*PointWallet, error) {
	if userID <= 0 {
		return nil, errors.New("invalid point wallet owner")
	}
	pendingGPT := "0"
	wallet := &PointWallet{Balances: []PointWalletBalance{}, SourceSummaries: []PointWalletSourceSummary{}, PendingInvitationRewards: []PointWalletPendingReward{}, PendingGPTPoints: &pendingGPT}
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
	// This read intentionally avoids GetInvitationSummary: qualification
	// reconciliation belongs to the invitation flow, not the wallet projection.
	var rewards []struct {
		PointTypeId      int64
		Code             string
		Name             string
		ProcessingPoints int64
		FrozenPoints     int64
	}
	if err := DB.Table("invitation_rewards AS reward").
		Select("reward.point_type_id, COALESCE(pt.code, reward.point_type_code) AS code, COALESCE(pt.name, reward.point_type_name) AS name, reward.processing_points, reward.frozen_points").
		Joins("LEFT JOIN point_types AS pt ON pt.id = reward.point_type_id").
		Where("reward.inviter_id = ? AND (reward.processing_points <> 0 OR reward.frozen_points <> 0)", userID).
		Order("reward.point_type_id ASC, reward.id ASC").Scan(&rewards).Error; err != nil {
		return nil, err
	}
	type pendingTotal struct {
		item       PointWalletPendingReward
		processing big.Int
		frozen     big.Int
	}
	pendingTotals := map[int64]*pendingTotal{}
	pendingIDs := []int64{}
	for _, reward := range rewards {
		if reward.ProcessingPoints < 0 || reward.FrozenPoints < 0 {
			return nil, errors.New("invalid pending invitation points")
		}
		total := pendingTotals[reward.PointTypeId]
		if total == nil {
			total = &pendingTotal{item: PointWalletPendingReward{PointTypeID: strconv.FormatInt(reward.PointTypeId, 10), Code: reward.Code, Name: reward.Name}}
			pendingTotals[reward.PointTypeId] = total
			pendingIDs = append(pendingIDs, reward.PointTypeId)
		}
		total.processing.Add(&total.processing, big.NewInt(reward.ProcessingPoints))
		total.frozen.Add(&total.frozen, big.NewInt(reward.FrozenPoints))
	}
	var gptTotal big.Int
	for _, id := range pendingIDs {
		total := pendingTotals[id]
		var pending big.Int
		pending.Add(&total.processing, &total.frozen)
		total.item.ProcessingPoints = total.processing.String()
		total.item.FrozenPoints = total.frozen.String()
		total.item.PendingPoints = pending.String()
		wallet.PendingInvitationRewards = append(wallet.PendingInvitationRewards, total.item)
		if total.item.Code == PointTypeGPT {
			gptTotal.Add(&gptTotal, &pending)
		}
	}
	pendingGPT = gptTotal.String()
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
