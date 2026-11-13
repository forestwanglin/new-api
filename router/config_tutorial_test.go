package router

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestConfigTutorialAPI(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.ConfigTutorialGroup{}, &model.ConfigTutorialChapter{}, &model.Option{}, &model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}))
	require.NoError(t, model.InitializeConfigTutorials(db))
	oldDB, oldLogDB, oldType, oldRedis, oldSecret := model.DB, model.LOG_DB, common.MainDatabaseType(), common.RedisEnabled, common.SessionSecret
	model.DB, model.LOG_DB = db, db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	common.SessionSecret = "tutorial-test-secret"
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.SetMainDatabaseType(oldType)
		common.RedisEnabled, common.SessionSecret = oldRedis, oldSecret
		require.NoError(t, sqlDB.Close())
	})
	tokens := map[int]string{}
	var pat string
	for _, role := range []int{common.RoleCommonUser, common.RoleAdminUser, common.RoleRootUser} {
		user := model.User{Username: fmt.Sprintf("tutorial-%d", role), Password: "placeholder", Role: role, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: fmt.Sprintf("tutorial-%d", role)}
		require.NoError(t, db.Create(&user).Error)
		bundle, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "tutorial-test")
		require.NoError(t, err)
		tokens[role] = bundle.AccessToken
		if role == common.RoleAdminUser {
			pat = model.AccessTokenPrefix + strings.Repeat("t", 43)
			token := &model.UserAccessToken{Name: "tutorial session-only", TokenHash: model.AccessTokenFingerprint(pat), TokenHint: model.AccessTokenHint(pat)}
			require.NoError(t, token.SetScopes([]string{"group:read", "group:write"}))
			require.NoError(t, model.CreateUserAccessToken(user.Id, token, service.AccessTokenMaxPerUser))
		}
	}
	engine := gin.New()
	SetApiRouter(engine)
	request := func(method, path, body, token string, status int) pointAdminResponse {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		engine.ServeHTTP(rec, req)
		require.Equal(t, status, rec.Code, rec.Body.String())
		var result pointAdminResponse
		if status == http.StatusOK {
			require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &result))
		}
		return result
	}
	admin := tokens[common.RoleAdminUser]
	base := "/api/config_tutorial"
	groups := base + "/admin/groups"
	chapters := base + "/admin/chapters"
	public := request("GET", base, "", "", 200)
	require.True(t, public.Success, public.Message)
	var doc map[string]any
	require.NoError(t, common.Unmarshal(public.Data, &doc))
	require.Len(t, doc["groups"], 3)
	first := doc["groups"].([]any)[0].(map[string]any)
	assert.Len(t, first, 3)
	assert.Contains(t, first, "group_key")
	assert.NotContains(t, first, "enabled")
	for _, kind := range []string{groups, chapters} {
		for _, route := range []struct{ method, path string }{{"GET", kind}, {"POST", kind}, {"GET", kind + "/1"}, {"PUT", kind + "/1"}, {"DELETE", kind + "/1"}} {
			request(route.method, route.path, `{}`, "", 401)
			request(route.method, route.path, `{}`, tokens[common.RoleCommonUser], 403)
			request(route.method, route.path, `{}`, pat, 403)
		}
	}
	groupBody := `{"group_key":"custom","title":"100%_tutorial","sort_order":0,"enabled":true}`
	created := request("POST", groups, groupBody, admin, 200)
	require.True(t, created.Success, created.Message)
	var group map[string]any
	require.NoError(t, common.Unmarshal(created.Data, &group))
	groupID := group["id"].(string)
	assert.IsType(t, "", group["created_at"])
	path := groups + "/" + groupID
	require.True(t, request("GET", path, "", tokens[common.RoleRootUser], 200).Success)
	require.False(t, request("POST", groups, groupBody, admin, 200).Success)
	for _, bad := range []string{`{}`, groupBody + `{}`, strings.Replace(groupBody, `"enabled":true`, `"enabled":null`, 1), strings.Replace(groupBody, `"sort_order":0`, `"sort_order":-1`, 1), strings.Replace(groupBody, `"sort_order":0`, `"sort_order":2147483648`, 1), strings.Replace(groupBody, `"title":"100%_tutorial"`, `"title":" "`, 1), strings.Replace(groupBody, `"group_key":"custom"`, `"group_key":"Bad Key"`, 1), strings.Replace(groupBody, `"sort_order":0`, `"sort_order":0,"id":"9"`, 1)} {
		assert.False(t, request("POST", groups, bad, admin, 200).Success)
	}
	chapterBody := fmt.Sprintf(`{"group_id":%q,"anchor":"custom-chapter","title":"A chapter","content_markdown":"## Markdown\n\n<script>literal text</script>","sort_order":0,"enabled":true}`, groupID)
	created = request("POST", chapters, chapterBody, admin, 200)
	require.True(t, created.Success, created.Message)
	var chapter map[string]any
	require.NoError(t, common.Unmarshal(created.Data, &chapter))
	chapterPath := chapters + "/" + chapter["id"].(string)
	assert.Equal(t, "1", chapter["version"])
	assert.Equal(t, groupID, chapter["group_id"])
	assert.False(t, request("DELETE", path, "", admin, 200).Success)
	update := fmt.Sprintf(`{"group_id":%q,"title":"Changed","content_markdown":"new markdown","sort_order":0,"enabled":false,"version":"1"}`, groupID)
	changed := request("PUT", chapterPath, update, admin, 200)
	require.True(t, changed.Success, changed.Message)
	require.NoError(t, common.Unmarshal(changed.Data, &chapter))
	assert.Equal(t, "2", chapter["version"])
	assert.Equal(t, false, chapter["enabled"])
	assert.False(t, request("PUT", chapterPath, update, admin, 200).Success)
	assert.False(t, request("PUT", chapterPath, strings.Replace(update, `"version":"1"`, `"version":"2","anchor":"changed"`, 1), admin, 200).Success)
	assert.False(t, request("POST", chapters, strings.Replace(chapterBody, `"group_id":`+fmt.Sprintf("%q", groupID), `"group_id":"999999"`, 1), admin, 200).Success)
	huge := fmt.Sprintf(`{"group_id":%q,"anchor":"large","title":"Large","content_markdown":%q,"sort_order":0,"enabled":true}`, groupID, strings.Repeat("x", 65537))
	assert.False(t, request("POST", chapters, huge, admin, 200).Success)
	list := request("GET", chapters+"?group_id="+groupID, "", admin, 200)
	require.True(t, list.Success, list.Message)
	var page struct {
		Items []map[string]any `json:"items"`
		Total int              `json:"total"`
	}
	require.NoError(t, common.Unmarshal(list.Data, &page))
	require.Len(t, page.Items, 1)
	assert.NotContains(t, page.Items[0], "content_markdown")
	assert.True(t, request("GET", chapterPath, "", admin, 200).Success)
	filtered := request("GET", groups+"?keyword=%25_", "", admin, 200)
	require.True(t, filtered.Success)
	require.NoError(t, common.Unmarshal(filtered.Data, &page))
	assert.Equal(t, 1, page.Total)
	for _, query := range []string{"?page_size=0", "?page_size=101", "?p=0", "?p=9223372036854775807&page_size=100", "?p=1&p=2", "?unknown=1"} {
		assert.False(t, request("GET", groups+query, "", admin, 200).Success, query)
	}
	for _, query := range []string{"?group_id=0", "?enabled=1", "?enabled=true&enabled=false"} {
		assert.False(t, request("GET", chapters+query, "", admin, 200).Success, query)
	}
	assert.False(t, request("GET", base+"?enabled=false", "", "", 200).Success)
	assert.False(t, request("GET", groups+"/01", "", admin, 200).Success)
	// Public reads include every enabled chapter rather than the first admin page.
	var stored model.ConfigTutorialGroup
	require.NoError(t, db.Where("group_key = ?", "custom").First(&stored).Error)
	extra := make([]model.ConfigTutorialChapter, 101)
	for i := range extra {
		extra[i] = model.ConfigTutorialChapter{GroupId: stored.Id, Anchor: fmt.Sprintf("bulk-%d", i), Title: fmt.Sprintf("Bulk %d", i), ContentMarkdown: "body", Enabled: true, Version: 1}
	}
	require.NoError(t, db.Create(&extra).Error)
	public = request("GET", base, "", "", 200)
	require.True(t, public.Success)
	require.NoError(t, common.Unmarshal(public.Data, &doc))
	found := false
	for _, entry := range doc["groups"].([]any) {
		g := entry.(map[string]any)
		if g["group_key"] == "custom" {
			found = true
			assert.Len(t, g["chapters"], 101)
			for _, entry := range g["chapters"].([]any) {
				ch := entry.(map[string]any)
				assert.Len(t, ch, 4)
				assert.NotContains(t, ch, "version")
			}
		}
	}
	assert.True(t, found)
	disable := `{"title":"Hidden","sort_order":0,"enabled":false,"version":"1"}`
	assert.True(t, request("PUT", path, disable, admin, 200).Success)
	public = request("GET", base, "", "", 200)
	require.True(t, public.Success)
	require.NoError(t, common.Unmarshal(public.Data, &doc))
	for _, entry := range doc["groups"].([]any) {
		assert.NotEqual(t, "custom", entry.(map[string]any)["group_key"])
	}
	require.NoError(t, db.Where("group_id = ?", stored.Id).Where("anchor LIKE ?", "bulk-%").Delete(&model.ConfigTutorialChapter{}).Error)
	assert.True(t, request("DELETE", chapterPath, "", admin, 200).Success)
	assert.True(t, request("DELETE", path, "", admin, 200).Success)
	assert.False(t, request("GET", chapterPath, "", admin, 200).Success)
	// IDs, versions and timestamps beyond JavaScript's safe integer remain exact.
	const wideID int64 = 9007199254740993
	wideGroup := model.ConfigTutorialGroup{Id: wideID, GroupKey: "wide-id", Title: "Wide ID", Enabled: true, Version: wideID, CreatedAt: wideID, UpdatedAt: wideID}
	require.NoError(t, db.Create(&wideGroup).Error)
	wideChapter := model.ConfigTutorialChapter{Id: wideID + 2, GroupId: wideID, Anchor: "wide-id", Title: "Wide chapter", ContentMarkdown: "body", Enabled: true, Version: wideID, CreatedAt: wideID, UpdatedAt: wideID}
	require.NoError(t, db.Create(&wideChapter).Error)
	wide := request("GET", groups+"/9007199254740993", "", admin, 200)
	require.True(t, wide.Success, wide.Message)
	require.NoError(t, common.Unmarshal(wide.Data, &group))
	for _, field := range []string{"id", "version", "created_at", "updated_at"} {
		assert.Equal(t, "9007199254740993", group[field], field)
	}
	wide = request("GET", chapters+"/9007199254740995", "", admin, 200)
	require.True(t, wide.Success, wide.Message)
	require.NoError(t, common.Unmarshal(wide.Data, &chapter))
	assert.Equal(t, "9007199254740995", chapter["id"])
	assert.Equal(t, "9007199254740993", chapter["group_id"])
	assert.Equal(t, "9007199254740993", chapter["version"])
	wide = request("PUT", groups+"/9007199254740993", `{"title":"Wide updated","sort_order":0,"enabled":true,"version":"9007199254740993"}`, admin, 200)
	require.True(t, wide.Success, wide.Message)
	require.NoError(t, common.Unmarshal(wide.Data, &group))
	assert.Equal(t, "9007199254740994", group["version"])
	require.NoError(t, db.Exec("ALTER TABLE config_tutorial_chapters RENAME TO unavailable_tutorial_chapters").Error)
	assert.False(t, request("GET", base, "", "", 200).Success)
	require.NoError(t, db.Exec("ALTER TABLE unavailable_tutorial_chapters RENAME TO config_tutorial_chapters").Error)
}
