package model

// SyncWeChatProfile updates only provider-owned metadata, never a stale user snapshot.
// Binding preserves display names and existing avatars regardless of their source.
func SyncWeChatProfile(userID int, openID, nickname, avatarURL string, binding bool) error {
	if nickname != "" && !binding {
		if err := DB.Model(&User{}).Where("id = ? AND wechat_id = ?", userID, openID).
			Where("display_name IS NULL OR display_name = '' OR display_name = ?", "WeChat User").
			Update("display_name", nickname).Error; err != nil {
			return err
		}
	}
	if avatarURL != "" {
		query := DB.Model(&User{}).Where("id = ? AND wechat_id = ?", userID, openID)
		if binding {
			query = query.Where("avatar_url IS NULL OR avatar_url = ''")
		} else {
			query = query.Where("avatar_url IS NULL OR avatar_url = '' OR avatar_source = ?", "wechat")
		}
		if err := query.Updates(map[string]any{"avatar_url": avatarURL, "avatar_source": "wechat"}).Error; err != nil {
			return err
		}
	}
	// UserBase/auth cache does not contain display names or avatars. Self profiles
	// are read directly from the database; no authentication cache publish is needed.
	return nil
}
