package model

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type pointCallEligibilityType struct {
	TypeID   int64                  `json:"type_id"`
	Code     string                 `json:"code"`
	Name     string                 `json:"name"`
	Priority int                    `json:"priority"`
	Policy   PointEligibilityPolicy `json:"policy"`
}

type pointCallEligibilitySnapshot struct {
	Version int                        `json:"version"`
	Types   []pointCallEligibilityType `json:"types"`
}

func (s *pointCallEligibilitySnapshot) allocations(model string, channelID int) []pointCallAllocation {
	out := make([]pointCallAllocation, 0, len(s.Types))
	for _, typ := range s.Types {
		if typ.Policy.Matches(model, channelID) {
			out = append(out, pointCallAllocation{TypeID: typ.TypeID, Code: typ.Code, Name: typ.Name, Priority: typ.Priority})
		}
	}
	return out
}

// ReservePointCallForRoute validates the actual attempt against the original
// policies. A definitive, uncharged failed attempt can move only its own hold;
// the release, complete new reservation and Key delta share one transaction.
func ReservePointCallForRoute(id, event string, target int, unlimited bool, channelID int, group string, allowRebind bool) error {
	if target < 0 || channelID < 0 || event == "" || len(event) > 112 {
		return ErrPointCallInvalid
	}
	payload := fmt.Sprintf("route:%d:%s:%d", channelID, group, target)
	return DB.Transaction(func(tx *gorm.DB) error {
		c, err := pointCallLock(tx, id)
		if err != nil {
			return err
		}
		if replay, err := pointCallReplay(tx, c, event, payload); replay != nil || err != nil {
			if err == nil && (c.ChannelID != channelID || c.Group != group || c.State == "refunded") {
				return ErrPointCallConflict
			}
			return err
		}
		if c.State == "refunded" {
			return ErrPointCallConflict
		}
		if c.EligibilitySnapshot != nil {
			var snapshot pointCallEligibilitySnapshot
			if err := common.UnmarshalJsonStr(*c.EligibilitySnapshot, &snapshot); err != nil || snapshot.Version != 1 || snapshot.Types == nil {
				return ErrPointCallInvalid
			}
			seen := make(map[int64]bool, len(snapshot.Types))
			for _, typ := range snapshot.Types {
				if typ.TypeID <= 0 || seen[typ.TypeID] || ValidatePointEligibilitySnapshotPolicy(&typ.Policy) != nil {
					return ErrPointCallInvalid
				}
				seen[typ.TypeID] = true
			}
			if c.ChannelID != channelID {
				if err := rebindPointCallRouteTx(tx, c, &snapshot, channelID, event, allowRebind); err != nil {
					return err
				}
			}
		}
		// Older calls without policy snapshots keep their established ownership.
		c.ChannelID, c.Group = channelID, group
		if err := reservePointCallTx(tx, c, event+":hold", target, unlimited, payload+":hold"); err != nil {
			return err
		}
		c.Revision++
		if err := tx.Save(c).Error; err != nil {
			return err
		}
		meta, err := common.Marshal(PointBillingMetadata{Version: 1, CallID: id, EventID: event, Status: "reserved", TotalPoints: "0", Items: []PointBillingItem{}})
		if err != nil {
			return err
		}
		return tx.Create(&PointCallEvent{ID: event, CallID: id, Payload: payload, Metadata: string(meta), Revision: c.Revision, CacheState: "pending", LogState: "none"}).Error
	})
}

func rebindPointCallRouteTx(tx *gorm.DB, c *PointCallBilling, snapshot *pointCallEligibilitySnapshot, channelID int, event string, allowRebind bool) error {
	old, err := pointCallDecode(c)
	if err != nil {
		return err
	}
	next := snapshot.allocations(c.Model, channelID)
	if len(next) == 0 {
		return ErrInsufficientPoints
	}
	if c.Dispatch == "submitted" {
		return ErrPointCallConflict
	}
	// Observed charges, including pending durable settlement intents, prohibit
	// ownership reassignment. A route that accepts all existing types may reuse it.
	var pending int64
	if err := tx.Model(&PointCallOperation{}).Where("call_id = ? AND state = ?", c.ID, "pending").Count(&pending).Error; err != nil {
		return err
	}
	canRebind := allowRebind && c.Points == 0 && c.BookedQuota == 0 && c.FeeQuota == 0 && c.State == "reserved" && pending == 0
	for _, allocation := range old {
		if allocation.Charged != 0 {
			canRebind = false
		}
	}
	if !canRebind {
		for _, allocation := range old {
			eligible := false
			for _, candidate := range next {
				if candidate.TypeID == allocation.TypeID {
					eligible = true
					break
				}
			}
			if !eligible {
				return ErrInsufficientPoints
			}
		}
		return nil
	}
	if c.TokenID > 0 {
		if _, err := lockTokenQuotaTx(tx, c.TokenID); err != nil {
			return err
		}
	}
	// Lock the union in canonical type-ID order, preserving the old freeze data
	// for validation. pointCallAccounts checks account ownership and own holds.
	all := append([]pointCallAllocation(nil), old...)
	for _, candidate := range next {
		found := false
		for _, allocation := range old {
			if candidate.TypeID == allocation.TypeID {
				found = true
				break
			}
		}
		if !found {
			all = append(all, candidate)
		}
	}
	accounts, err := pointCallAccounts(tx, c.UserID, c.ID, all)
	if err != nil {
		return err
	}
	var held int64
	for _, allocation := range old {
		held, err = pointAdd(held, allocation.Held)
		if err != nil {
			return err
		}
	}
	if held > 0 {
		tr, err := pointCallTransaction(tx, c, event+":release", PointActionUnfreeze, held)
		if err != nil {
			return err
		}
		for _, allocation := range old {
			if allocation.Held == 0 {
				continue
			}
			account := accounts[allocation.TypeID]
			if err := pointCallMutation(tx, tr, account, allocation.Held, -allocation.Held, &allocation.FreezeID); err != nil {
				return err
			}
			if err := tx.Model(&PointFreeze{}).Where("id = ?", allocation.FreezeID).Updates(map[string]any{"remaining_points": 0, "status": PointFreezeClosed, "closed_at": time.Now().UnixMilli()}).Error; err != nil {
				return err
			}
		}
	}
	owned := 0
	for i := range next {
		if account := accounts[next[i].TypeID]; account != nil {
			next[i].AccountID = account.Id
			owned++
		}
	}
	if owned == 0 {
		return ErrInsufficientPoints
	}
	if err := pointCallEncode(c, next); err != nil {
		return err
	}
	// Force the shared reservation body to acquire the complete replacement
	// hold even when the target did not increase. TokenQuota stays unchanged so
	// it reserves only a genuine Key budget increase.
	c.ReservedQuota = 0
	return nil
}
