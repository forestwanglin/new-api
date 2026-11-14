package model

// Model-call finance is primary-database authoritative. The lock order is user,
// call, optional task, token, then point accounts in ascending type ID. Priority
// controls allocation only. No cache or log write participates in this commit.
import (
	"errors"
	"fmt"
	"math"
	"math/big"
	"sort"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var (
	ErrInsufficientPoints = errors.New("applicable available points do not cover the estimated cost")
	ErrPointCallConflict  = errors.New("conflicting model billing event")
	ErrPointCallInvalid   = errors.New("invalid model points billing state")
)

type PointCallBilling struct {
	ID            string `gorm:"primaryKey;type:varchar(64)"`
	UserID        int    `gorm:"not null;index"`
	TokenID       int
	ChannelID     int
	Group         string `gorm:"type:varchar(64)"`
	Model         string `gorm:"type:varchar(255);not null"`
	Rate          string `gorm:"type:varchar(128);not null"`
	Unit          string `gorm:"type:varchar(128);not null"`
	Allocations   string `gorm:"type:text;not null"`
	ReservedQuota int64
	TokenQuota    int64
	BookedQuota   int64
	FeeQuota      int64
	Points        int64
	Revision      int64
	State         string `gorm:"type:varchar(32);index"`
	Dispatch      string `gorm:"type:varchar(32);index"`
	CreatedAt     int64  `gorm:"autoCreateTime:milli"`
	UpdatedAt     int64  `gorm:"autoUpdateTime:milli;index"`
}

type pointCallAllocation struct {
	TypeID    int64  `json:"type_id"`
	Code      string `json:"code"`
	Name      string `json:"name"`
	Priority  int    `json:"priority"`
	AccountID int64  `json:"account_id"`
	FreezeID  int64  `json:"freeze_id"`
	Held      int64  `json:"held"`
	Charged   int64  `json:"charged"`
}

// Events arbitrate replay and are also durable pending log effects. Payload is
// immutable, while LogPayload/LogState describe the independent log projection.
type PointCallEvent struct {
	ID         string `gorm:"primaryKey;type:varchar(128)"`
	CallID     string `gorm:"type:varchar(64);not null;index"`
	Payload    string `gorm:"type:text;not null"`
	Metadata   string `gorm:"type:text;not null"`
	QuotaDelta int64
	Revision   int64
	LogPayload string `gorm:"type:text"`
	CacheState string `gorm:"type:varchar(16);index"`
	LogState   string `gorm:"type:varchar(16);index"`
	RetryAt    int64  `gorm:"not null;default:0;index"`
	CreatedAt  int64  `gorm:"autoCreateTime:milli"`
}

type PointBillingItem struct {
	PointTypeID string `json:"point_type_id"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	Points      string `json:"points"`
}
type PointBillingMetadata struct {
	Version     int                `json:"version"`
	CallID      string             `json:"call_id"`
	EventID     string             `json:"event_id"`
	Status      string             `json:"status"`
	TotalPoints string             `json:"total_points"`
	Items       []PointBillingItem `json:"items"`
}
type PointBillingResult struct {
	Call       PointCallBilling
	Metadata   PointBillingMetadata
	QuotaDelta int64
	Replayed   bool
}

func PointCallPoints(quota int64, rate, unit string) (int64, error) {
	r, ok := new(big.Rat).SetString(rate)
	if !ok || r.Sign() <= 0 {
		return 0, ErrPointCallInvalid
	}
	u, ok := new(big.Rat).SetString(unit)
	if !ok || u.Sign() <= 0 || quota < 0 {
		return 0, ErrPointCallInvalid
	}
	r.Mul(r, new(big.Rat).SetInt64(quota))
	r.Mul(r, new(big.Rat).SetInt64(PointsPerRMB))
	r.Quo(r, u)
	n, rem := new(big.Int).QuoRem(r.Num(), r.Denom(), new(big.Int))
	if rem.Sign() > 0 {
		n.Add(n, big.NewInt(1))
	}
	if !n.IsInt64() {
		return 0, ErrPointCallInvalid
	}
	return n.Int64(), nil
}

// Only * and ? are special, including for slash, brackets and Unicode.
func PointModelMatches(kind, pattern, value string) bool {
	if kind == PointMatchExact {
		return pattern == value
	}
	if kind != PointMatchPattern {
		return false
	}
	p, v := []rune(pattern), []rune(value)
	i, j, star, back := 0, 0, -1, 0
	for j < len(v) {
		if i < len(p) && (p[i] == '?' || p[i] == v[j]) {
			i++
			j++
		} else if i < len(p) && p[i] == '*' {
			star = i
			i++
			back = j
		} else if star >= 0 {
			back++
			j = back
			i = star + 1
		} else {
			return false
		}
	}
	for i < len(p) && p[i] == '*' {
		i++
	}
	return i == len(p)
}

func pointAdd(a, b int64) (int64, error) {
	if b > 0 && a > math.MaxInt64-b || b < 0 && a < math.MinInt64-b {
		return 0, ErrPointCallInvalid
	}
	return a + b, nil
}
func pointCallDecode(c *PointCallBilling) ([]pointCallAllocation, error) {
	var a []pointCallAllocation
	err := common.Unmarshal([]byte(c.Allocations), &a)
	return a, err
}
func pointCallEncode(c *PointCallBilling, a []pointCallAllocation) error {
	b, e := common.Marshal(a)
	c.Allocations = string(b)
	return e
}

func pointCallLock(tx *gorm.DB, id string) (*PointCallBilling, error) {
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		if e := tx.Model(&PointCallBilling{}).Where("id = ?", id).UpdateColumn("updated_at", gorm.Expr("updated_at")).Error; e != nil {
			return nil, e
		}
	}
	var hint PointCallBilling
	if err := tx.Select("user_id").First(&hint, "id = ?", id).Error; err != nil {
		return nil, err
	}
	var user User
	if err := lockForUpdate(tx).Select("id").First(&user, hint.UserID).Error; err != nil {
		return nil, err
	}
	var c PointCallBilling
	if err := lockForUpdate(tx).First(&c, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &c, nil
}
func pointCallAccounts(tx *gorm.DB, userID int, callID string, a []pointCallAllocation) (map[int64]*PointAccount, error) {
	ids := make([]int64, 0, len(a))
	for _, v := range a {
		ids = append(ids, v.TypeID)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	out := map[int64]*PointAccount{}
	for _, id := range ids {
		var account PointAccount
		var aid int64
		for _, v := range a {
			if v.TypeID == id {
				aid = v.AccountID
				break
			}
		}
		query := lockForUpdate(tx)
		if aid > 0 {
			query = query.Where("id = ?", aid)
		} else {
			query = query.Where("user_id = ? AND point_type_id = ?", userID, id)
		}
		if err := query.First(&account).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) && aid == 0 {
				continue
			}
			return nil, err
		}
		for i := range a {
			if a[i].TypeID == id {
				a[i].AccountID = account.Id
			}
		}
		if account.UserId != int64(userID) || account.PointTypeId != id || account.FrozenPoints < 0 || account.Version < 0 {
			return nil, ErrPointCallInvalid
		}
		out[id] = &account
	}
	for _, allocation := range a {
		if allocation.Held < 0 || allocation.Charged < 0 || allocation.Held > 0 && allocation.FreezeID == 0 {
			return nil, ErrPointCallInvalid
		}
		if allocation.FreezeID == 0 {
			continue
		}
		var freeze PointFreeze
		if err := lockForUpdate(tx).First(&freeze, allocation.FreezeID).Error; err != nil {
			return nil, err
		}
		account := out[allocation.TypeID]
		if account == nil || freeze.AccountId != account.Id || freeze.ReasonCode != "MODEL_CALL" || freeze.Reason != callID || freeze.RemainingPoints != allocation.Held || freeze.OriginalPoints < freeze.RemainingPoints || account.FrozenPoints < allocation.Held || allocation.Held > 0 && freeze.Status != PointFreezeActive {
			return nil, ErrPointCallInvalid
		}
	}
	return out, nil
}
func pointCallMutation(tx *gorm.DB, tr *PointTransaction, account *PointAccount, available, frozen int64, freezeID *int64) error {
	av, e := pointAdd(account.AvailablePoints, available)
	if e != nil {
		return e
	}
	fr, e := pointAdd(account.FrozenPoints, frozen)
	if e != nil || fr < 0 || account.Version == math.MaxInt64 {
		return ErrPointCallInvalid
	}
	ledger := PointLedger{TransactionId: tr.Id, AccountId: account.Id, AccountVersion: account.Version + 1, FreezeId: freezeID, AvailableDelta: available, FrozenDelta: frozen, AvailableBefore: account.AvailablePoints, AvailableAfter: av, FrozenBefore: account.FrozenPoints, FrozenAfter: fr, CreatedAt: time.Now().UnixMilli()}
	result := tx.Model(&PointAccount{}).Where("id = ? AND version = ?", account.Id, account.Version).Updates(map[string]any{"available_points": av, "frozen_points": fr, "version": account.Version + 1})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrPointCallConflict
	}
	if err := tx.Create(&ledger).Error; err != nil {
		return err
	}
	account.AvailablePoints = av
	account.FrozenPoints = fr
	account.Version++
	return nil
}
func pointCallTransaction(tx *gorm.DB, c *PointCallBilling, event, action string, points int64) (*PointTransaction, error) {
	snapshot, _ := common.Marshal(map[string]string{"rate": c.Rate, "unit": c.Unit, "model": c.Model})
	snap := string(snapshot)
	tr := &PointTransaction{UserId: int64(c.UserID), EventKey: event, Action: action, BizType: "MODEL_CALL", BizId: c.ID, Points: points, BillingSnapshot: &snap, OperatorType: PointOperatorSystem, Remark: "Model call " + action}
	return tr, tx.Create(tr).Error
}
func pointCallSave(tx *gorm.DB, c *PointCallBilling, a []pointCallAllocation) error {
	if err := pointCallEncode(c, a); err != nil {
		return err
	}
	return tx.Save(c).Error
}

// CreatePointCall creates a stable identity and snapshot without charging money.
// Account discovery is read-only; no account is invented to absorb future debt.
func CreatePointCall(id string, userID, tokenID int, model, rate, unit string) error {
	if id == "" || len(id) > 64 || userID <= 0 || model == "" {
		return ErrPointCallInvalid
	}
	if _, e := PointCallPoints(0, rate, unit); e != nil {
		return e
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if e := lockForUpdate(tx).Select("id").First(&user, userID).Error; e != nil {
			return e
		}
		var old PointCallBilling
		e := tx.First(&old, "id = ?", id).Error
		if e == nil {
			if old.UserID != userID || old.TokenID != tokenID || old.Model != model {
				return ErrPointCallConflict
			}
			return nil
		}
		if !errors.Is(e, gorm.ErrRecordNotFound) {
			return e
		}
		var types []PointType
		var rules []PointModelRule
		if e := tx.Order("consume_priority DESC, id ASC").Find(&types).Error; e != nil {
			return e
		}
		if e := tx.Where("enabled = ?", true).Find(&rules).Error; e != nil {
			return e
		}
		eligible := map[int64]bool{}
		for _, r := range rules {
			if PointModelMatches(r.MatchType, string(r.MatchValue), model) {
				eligible[r.PointTypeId] = true
			}
		}
		a := []pointCallAllocation{}
		owned := 0
		for _, typ := range types {
			if !eligible[typ.Id] {
				continue
			}
			var account PointAccount
			e := tx.Where("user_id = ? AND point_type_id = ?", userID, typ.Id).First(&account).Error
			if errors.Is(e, gorm.ErrRecordNotFound) {
				account = PointAccount{}
				e = nil
			} else if e == nil {
				owned++
			}
			if e != nil {
				return e
			}
			a = append(a, pointCallAllocation{TypeID: typ.Id, Code: typ.Code, Name: typ.Name, Priority: typ.ConsumePriority, AccountID: account.Id})
		}
		if len(a) == 0 || owned == 0 {
			return ErrInsufficientPoints
		}
		c := PointCallBilling{ID: id, UserID: userID, TokenID: tokenID, Model: model, Rate: rate, Unit: unit, State: "reserved", Dispatch: "unsubmitted"}
		return pointCallSave(tx, &c, a)
	})
}

func pointCallReplay(tx *gorm.DB, c *PointCallBilling, event, payload string) (*PointBillingResult, error) {
	var old PointCallEvent
	e := tx.First(&old, "id = ?", event).Error
	if errors.Is(e, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	if old.CallID != c.ID || old.Payload != payload {
		return nil, ErrPointCallConflict
	}
	var meta PointBillingMetadata
	if e := common.Unmarshal([]byte(old.Metadata), &meta); e != nil {
		return nil, e
	}
	return &PointBillingResult{Call: *c, Metadata: meta, QuotaDelta: old.QuotaDelta, Replayed: true}, nil
}

// ReservePointCall atomically holds points and API Key quota, including extensions.
func ReservePointCall(id, event string, target int, unlimited bool) error {
	if target < 0 {
		return ErrPointCallInvalid
	}
	payload := fmt.Sprintf("reserve:%d", target)
	return DB.Transaction(func(tx *gorm.DB) error {
		c, e := pointCallLock(tx, id)
		if e != nil {
			return e
		}
		if r, e := pointCallReplay(tx, c, event, payload); r != nil || e != nil {
			return e
		}
		if c.State == "refunded" {
			return ErrPointCallConflict
		}
		if int64(target) <= c.ReservedQuota && c.Dispatch != "unsubmitted" {
			return nil
		}
		points, e := PointCallPoints(int64(target), c.Rate, c.Unit)
		if e != nil {
			return e
		}
		a, e := pointCallDecode(c)
		if e != nil {
			return e
		}
		// Token is locked before point accounts even when the points check will fail.
		if c.TokenID > 0 && int64(target) > c.TokenQuota {
			ok, e := ReserveTokenQuotaTx(tx, c.TokenID, target-int(c.TokenQuota), unlimited)
			if e != nil {
				return e
			}
			if !ok {
				return errors.New("token quota is not enough")
			}
		}
		accounts, e := pointCallAccounts(tx, c.UserID, c.ID, a)
		if e != nil {
			return e
		}
		net := new(big.Int)
		held := int64(0)
		for _, v := range a {
			if account := accounts[v.TypeID]; account != nil {
				net.Add(net, big.NewInt(account.AvailablePoints))
			}
			held += v.Held
		}
		needed := points - c.Points - held
		if needed < 0 {
			needed = 0
		}
		if net.Cmp(big.NewInt(needed)) < 0 {
			return ErrInsufficientPoints
		}
		tr, e := pointCallTransaction(tx, c, event, PointActionFreeze, needed)
		if e != nil {
			return e
		}
		remaining := needed
		for i := range a {
			if remaining == 0 {
				break
			}
			account := accounts[a[i].TypeID]
			if account == nil {
				continue
			}
			n := min(max(account.AvailablePoints, int64(0)), remaining)
			if n == 0 {
				continue
			}
			if a[i].FreezeID == 0 {
				f := PointFreeze{AccountId: account.Id, TransactionId: tr.Id, ReasonCode: "MODEL_CALL", Reason: c.ID, Status: PointFreezeActive}
				if e := tx.Create(&f).Error; e != nil {
					return e
				}
				a[i].FreezeID = f.Id
			}
			var freeze PointFreeze
			if e := lockForUpdate(tx).First(&freeze, a[i].FreezeID).Error; e != nil {
				return e
			}
			freeze.OriginalPoints, e = pointAdd(freeze.OriginalPoints, n)
			if e != nil {
				return e
			}
			freeze.RemainingPoints, e = pointAdd(freeze.RemainingPoints, n)
			if e != nil {
				return e
			}
			freeze.Status = PointFreezeActive
			freeze.ClosedAt = nil
			if e := tx.Save(&freeze).Error; e != nil {
				return e
			}
			if e := pointCallMutation(tx, tr, account, -n, n, &a[i].FreezeID); e != nil {
				return e
			}
			a[i].Held += n
			remaining -= n
		}
		if remaining != 0 {
			return ErrInsufficientPoints
		}
		c.ReservedQuota = int64(target)
		c.TokenQuota = int64(target)
		if c.Dispatch == "unsubmitted" {
			c.Dispatch = "dispatching"
		}
		c.Revision++
		if e := pointCallSave(tx, c, a); e != nil {
			return e
		}
		meta := PointBillingMetadata{Version: 1, CallID: id, EventID: event, Status: "reserved", TotalPoints: "0", Items: []PointBillingItem{}}
		m, _ := common.Marshal(meta)
		return tx.Create(&PointCallEvent{ID: event, CallID: id, Payload: payload, Metadata: string(m), Revision: c.Revision, CacheState: "pending", LogState: "none"}).Error
	})
}

// SetPointCallTarget adjusts the cumulative BASE quota. Fees have a distinct
// event but share the call's cumulative rounding. Guard is inside this financial
// transaction and may lock/check/update task quota and applied outcome version.
func SetPointCallTarget(id, event string, target int, final, fee bool, guard func(*gorm.DB, *PointCallBilling) error) (*PointBillingResult, error) {
	if target < 0 || event == "" || len(event) > 128 {
		return nil, ErrPointCallInvalid
	}
	payload := fmt.Sprintf("target:%d:%t:%t", target, final, fee)
	var out *PointBillingResult
	if guard == nil {
		if err := stagePointCallTarget(id, event, target, final, fee); err != nil {
			return nil, err
		}
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		c, e := pointCallLock(tx, id)
		if e != nil {
			return e
		}
		if r, e := pointCallReplay(tx, c, event, payload); r != nil || e != nil {
			out = r
			return e
		}
		if guard == nil {
			var op PointCallOperation
			if e := tx.First(&op, "id = ?", event).Error; e == nil && op.State == "superseded" {
				return ErrPointCallConflict
			}
		}
		if guard != nil {
			if e := guard(tx, c); e != nil {
				return e
			}
		}
		a, e := pointCallDecode(c)
		if e != nil {
			return e
		}
		base := int64(target)
		feeQuota := c.FeeQuota
		if fee {
			base = c.BookedQuota
			feeQuota = int64(target)
		}
		total, e := pointAdd(base, feeQuota)
		if e != nil {
			return e
		}
		oldTotal, e := pointAdd(c.BookedQuota, c.FeeQuota)
		if e != nil {
			return e
		}
		newPoints, e := PointCallPoints(total, c.Rate, c.Unit)
		if e != nil {
			return e
		}
		delta := newPoints - c.Points
		// Monetary bookkeeping and Key reservation/actual adjustment share this tx.
		if total != oldTotal {
			deltaQuota := total - oldTotal
			query := tx.Model(&User{}).Where("id = ?", c.UserID)
			if deltaQuota > 0 {
				query = query.Where("quota >= ?", int64(math.MinInt64)+deltaQuota)
			} else {
				query = query.Where("quota <= ?", int64(math.MaxInt64)+deltaQuota)
			}
			r := query.Update("quota", gorm.Expr("quota - ?", deltaQuota))
			if r.Error != nil {
				return r.Error
			}
			if r.RowsAffected != 1 {
				return gorm.ErrRecordNotFound
			}
		}
		if c.TokenID > 0 {
			if e := AdjustTokenQuotaTx(tx, c.TokenID, int(c.TokenQuota-total)); e != nil {
				return e
			}
		}
		c.TokenQuota = total
		accounts, e := pointCallAccounts(tx, c.UserID, c.ID, a)
		if e != nil {
			return e
		}
		heldBefore := make([]int64, len(a))
		for i := range a {
			heldBefore[i] = a[i].Held
		}
		action := PointActionConsume
		if delta < 0 {
			action = PointActionRefund
		}
		tr, e := pointCallTransaction(tx, c, event, action, delta)
		if e != nil {
			return e
		}
		contrib := make([]int64, len(a))
		if delta >= 0 {
			remaining := delta
			last := -1
			for i := range a {
				account := accounts[a[i].TypeID]
				if account == nil {
					continue
				}
				h := min(a[i].Held, remaining)
				if h > 0 {
					if e := pointCallMutation(tx, tr, account, 0, -h, &a[i].FreezeID); e != nil {
						return e
					}
					a[i].Held -= h
					a[i].Charged += h
					contrib[i] += h
					remaining -= h
					last = i
				}
				if remaining == 0 {
					break
				}
				n := min(max(account.AvailablePoints, int64(0)), remaining)
				if n > 0 {
					if e := pointCallMutation(tx, tr, account, -n, 0, nil); e != nil {
						return e
					}
					a[i].Charged += n
					contrib[i] += n
					remaining -= n
					last = i
				}
			}
			if remaining > 0 {
				if last < 0 {
					for i := range a {
						if a[i].Charged > 0 || a[i].FreezeID > 0 {
							last = i
						}
					}
				}
				if last < 0 {
					// A zero estimate can reach actual usage without a prior debit.
					// Only an already-owned eligible account may absorb that debt.
					for i := range a {
						if accounts[a[i].TypeID] != nil {
							last = i
						}
					}
				}
				if last < 0 {
					return ErrInsufficientPoints
				}
				if e := pointCallMutation(tx, tr, accounts[a[last].TypeID], -remaining, 0, nil); e != nil {
					return e
				}
				a[last].Charged += remaining
				contrib[last] += remaining
			}
		} else {
			remaining := -delta
			for i := len(a) - 1; i >= 0 && remaining > 0; i-- {
				n := min(a[i].Charged, remaining)
				if n == 0 {
					continue
				}
				if e := pointCallMutation(tx, tr, accounts[a[i].TypeID], n, 0, nil); e != nil {
					return e
				}
				a[i].Charged -= n
				contrib[i] -= n
				remaining -= n
			}
			if remaining != 0 {
				return ErrPointCallInvalid
			}
		}
		// Finalization releases only this call's unused freezes. Never spend foreign holds.
		for i := range a {
			if final && a[i].Held > 0 {
				n := a[i].Held
				if e := pointCallMutation(tx, tr, accounts[a[i].TypeID], n, -n, &a[i].FreezeID); e != nil {
					return e
				}
				a[i].Held = 0
			}
			if a[i].FreezeID > 0 && heldBefore[i] != a[i].Held {
				updates := map[string]any{"remaining_points": a[i].Held, "status": PointFreezeActive}
				if a[i].Held == 0 {
					updates["status"] = PointFreezeClosed
					updates["closed_at"] = time.Now().UnixMilli()
				}
				result := tx.Model(&PointFreeze{}).Where("id = ? AND account_id = ? AND reason_code = ? AND reason = ?", a[i].FreezeID, a[i].AccountID, "MODEL_CALL", id).Updates(updates)
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected != 1 {
					return ErrPointCallConflict
				}
			}
		}
		c.BookedQuota = base
		c.FeeQuota = feeQuota
		c.Points = newPoints
		c.Revision++
		c.State = "charged"
		if final && total == 0 {
			c.State = "refunded"
		}
		if e := pointCallSave(tx, c, a); e != nil {
			return e
		}
		meta := PointBillingMetadata{Version: 1, CallID: id, EventID: event, Status: "committed", TotalPoints: strconv.FormatInt(delta, 10), Items: []PointBillingItem{}}
		for i, n := range contrib {
			if n != 0 {
				meta.Items = append(meta.Items, PointBillingItem{PointTypeID: strconv.FormatInt(a[i].TypeID, 10), Code: a[i].Code, Name: a[i].Name, Points: strconv.FormatInt(n, 10)})
			}
		}
		m, e := common.Marshal(meta)
		if e != nil {
			return e
		}
		logState := "pending"
		if !common.LogConsumeEnabled {
			logState = "disabled"
		}
		if e := tx.Create(&PointCallEvent{ID: event, CallID: id, Payload: payload, Metadata: string(m), QuotaDelta: total - oldTotal, Revision: c.Revision, CacheState: "pending", LogState: logState, LogPayload: pointCallLogPayload(c, &meta, total-oldTotal)}).Error; e != nil {
			return e
		}
		if guard == nil {
			if e := tx.Model(&PointCallOperation{}).Where("id = ?", event).Update("state", "applied").Error; e != nil {
				return e
			}
		}
		out = &PointBillingResult{Call: *c, Metadata: meta, QuotaDelta: total - oldTotal}
		return nil
	})
	return out, err
}

func GetPointCall(id string) (*PointCallBilling, error) {
	var c PointCallBilling
	e := DB.First(&c, "id = ?", id).Error
	return &c, e
}

// MarkPointCallDispatch is intentionally monotonic. Unknown upstream outcomes
// stay dispatching/submitted for diagnosis; there is no timer-based refund.
func MarkPointCallDispatch(id, state string) error {
	switch state {
	case "dispatching":
		return DB.Model(&PointCallBilling{}).Where("id = ? AND dispatch = ?", id, "unsubmitted").Update("dispatch", state).Error
	case "submitted":
		return DB.Model(&PointCallBilling{}).Where("id = ? AND dispatch IN ?", id, []string{"dispatching", "unsubmitted"}).Update("dispatch", state).Error
	default:
		return ErrPointCallInvalid
	}
}

// ReadPointBillingMetadata projects only safe committed event summaries.
func ReadPointBillingMetadata(id string) (*PointBillingMetadata, error) {
	var e PointCallEvent
	if err := DB.Where("call_id = ? AND log_state <> ?", id, "none").Order("revision DESC").First(&e).Error; err != nil {
		return nil, err
	}
	var m PointBillingMetadata
	err := common.Unmarshal([]byte(e.Metadata), &m)
	return &m, err
}

// Register with the primary points migration, not LOG_DB.
func migratePointCallBilling(db *gorm.DB) error {
	return db.AutoMigrate(&PointCallBilling{}, &PointCallEvent{}, &PointCallOperation{})
}

func SyncPointCallCaches(userID, tokenID int) error {
	if !common.RedisEnabled {
		return nil
	}
	if err := invalidateUserCache(userID); err != nil {
		return err
	}
	if tokenID > 0 {
		if err := InvalidateTokenQuotaCache(tokenID); err != nil {
			return err
		}
	}
	return nil
}
