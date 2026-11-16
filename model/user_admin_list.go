package model

// AdminUserListItem exposes phone numbers only in administrator list responses.
type AdminUserListItem struct {
	UserWithPointBalances
	Phone string `json:"phone"`
}

// AttachAdminUserListDetails reads phone bindings only for the selected page.
func AttachAdminUserListDetails(users []*User) ([]AdminUserListItem, error) {
	balances, err := AttachUserPointBalances(users)
	if err != nil {
		return nil, err
	}
	items := make([]AdminUserListItem, len(users))
	if len(users) == 0 {
		return items, nil
	}
	userIDs := make([]int, len(users))
	for i, user := range users {
		userIDs[i] = user.Id
	}
	var claims []ExternalIdentityClaim
	if err := DB.Select("user_id", "subject").Where("provider = ? AND user_id IN ?", ExternalIdentityProviderPhone, userIDs).Find(&claims).Error; err != nil {
		return nil, err
	}
	phones := make(map[int]string, len(claims))
	for _, claim := range claims {
		phones[claim.UserId] = claim.Subject
	}
	for i, user := range users {
		items[i] = AdminUserListItem{UserWithPointBalances: balances[i], Phone: phones[user.Id]}
	}
	return items, nil
}
