package model

import (
	"cmp"
	"slices"
	"strconv"
)

// UserPointBalance serializes integer points exactly for browser consumers.
type UserPointBalance struct {
	Code            string `json:"code"`
	Name            string `json:"name"`
	AvailablePoints string `json:"available_points"`
	FrozenPoints    string `json:"frozen_points"`
}

// UserWithPointBalances adds read-only points to administrator list responses.
type UserWithPointBalances struct {
	*User
	PointBalances []UserPointBalance `json:"point_balances"`
}

// AttachUserPointBalances reads only accounts belonging to the selected page.
func AttachUserPointBalances(users []*User) ([]UserWithPointBalances, error) {
	items := make([]UserWithPointBalances, len(users))
	if len(users) == 0 {
		return items, nil
	}

	userIDs := make([]int, len(users))
	for i, user := range users {
		userIDs[i] = user.Id
		items[i] = UserWithPointBalances{User: user, PointBalances: []UserPointBalance{}}
	}
	type pointBalanceRow struct {
		UserId          int
		Code            string
		Name            string
		AvailablePoints int64
		FrozenPoints    int64
	}
	var rows []pointBalanceRow
	err := DB.Table("point_accounts").
		Select("point_accounts.user_id, point_types.code, point_types.name, point_accounts.available_points, point_accounts.frozen_points").
		Joins("JOIN point_types ON point_types.id = point_accounts.point_type_id").
		Where("point_accounts.user_id IN ?", userIDs).
		Where("point_accounts.available_points <> ? OR point_accounts.frozen_points <> ?", 0, 0).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	// Sort in Go so ordering does not depend on the database collation.
	priority := map[string]int{PointTypeGeneral: -2, PointTypeGPT: -1}
	slices.SortFunc(rows, func(a, b pointBalanceRow) int {
		if order := cmp.Compare(priority[a.Code], priority[b.Code]); order != 0 {
			return order
		}
		return cmp.Compare(a.Code, b.Code)
	})
	balancesByUser := make(map[int][]UserPointBalance, len(users))
	for _, row := range rows {
		balancesByUser[row.UserId] = append(balancesByUser[row.UserId], UserPointBalance{
			Code: row.Code, Name: row.Name,
			AvailablePoints: strconv.FormatInt(row.AvailablePoints, 10),
			FrozenPoints:    strconv.FormatInt(row.FrozenPoints, 10),
		})
	}
	for i := range items {
		if balances := balancesByUser[items[i].Id]; len(balances) > 0 {
			items[i].PointBalances = balances
		}
	}
	return items, nil
}
