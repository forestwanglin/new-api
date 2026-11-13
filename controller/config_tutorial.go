package controller

import (
	"errors"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func configTutorialError(c *gin.Context, err error) {
	for _, safe := range []error{model.ErrConfigTutorialFields, model.ErrConfigTutorialNotFound, model.ErrConfigTutorialGroupNotFound, model.ErrConfigTutorialGroupNotEmpty, model.ErrConfigTutorialDuplicate, model.ErrConfigTutorialConflict} {
		if errors.Is(err, safe) {
			common.ApiErrorT(c, safe.Error())
			return
		}
	}
	common.ApiErrorT(c, "Failed to manage configuration tutorials")
}

func configTutorialID(value string) (int64, bool) {
	id, err := strconv.ParseInt(value, 10, 64)
	return id, err == nil && id > 0 && strconv.FormatInt(id, 10) == value
}

func configTutorialRouteID(c *gin.Context) (int64, bool) {
	id, ok := configTutorialID(c.Param("id"))
	if !ok || c.Request.URL.RawQuery != "" {
		common.ApiErrorT(c, "Invalid tutorial query")
		return 0, false
	}
	return id, true
}

type configTutorialInput struct {
	GroupKey        string `json:"group_key"`
	GroupId         string `json:"group_id"`
	Anchor          string `json:"anchor"`
	Title           string `json:"title"`
	ContentMarkdown string `json:"content_markdown"`
	SortOrder       int    `json:"sort_order"`
	Enabled         bool   `json:"enabled"`
	Version         string `json:"version"`
}

func readConfigTutorialInput(c *gin.Context, chapter, update bool) (configTutorialInput, int64, bool) {
	var in configTutorialInput
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 512*1024))
	var fields map[string]common.RawMessage
	if err != nil || !utf8.Valid(body) || common.Unmarshal(body, &fields) != nil || fields == nil || c.Request.URL.RawQuery != "" {
		configTutorialError(c, model.ErrConfigTutorialFields)
		return in, 0, false
	}
	allowed := []string{"title", "sort_order", "enabled"}
	if chapter {
		allowed = append(allowed, "group_id", "content_markdown")
		if !update {
			allowed = append(allowed, "anchor")
		}
	} else if !update {
		allowed = append(allowed, "group_key")
	}
	if update {
		allowed = append(allowed, "version")
	}
	if len(fields) != len(allowed) {
		configTutorialError(c, model.ErrConfigTutorialFields)
		return in, 0, false
	}
	for _, key := range allowed {
		value, ok := fields[key]
		if !ok || string(value) == "null" {
			configTutorialError(c, model.ErrConfigTutorialFields)
			return in, 0, false
		}
	}
	if common.Unmarshal(body, &in) != nil || !model.ValidConfigTutorialTitle(in.Title) || in.SortOrder < 0 || in.SortOrder > math.MaxInt32 {
		configTutorialError(c, model.ErrConfigTutorialFields)
		return in, 0, false
	}
	version := int64(0)
	if update {
		var ok bool
		version, ok = configTutorialID(in.Version)
		if !ok {
			configTutorialError(c, model.ErrConfigTutorialFields)
			return in, 0, false
		}
	}
	return in, version, true
}

func configTutorialFilter(c *gin.Context, chapter bool) (model.ConfigTutorialFilter, bool) {
	filter := model.ConfigTutorialFilter{Page: 1, PageSize: 20}
	values, err := url.ParseQuery(c.Request.URL.RawQuery)
	if err != nil {
		common.ApiErrorT(c, "Invalid tutorial query")
		return filter, false
	}
	for key, items := range values {
		if len(items) != 1 || items[0] == "" {
			common.ApiErrorT(c, "Invalid tutorial query")
			return filter, false
		}
		value := items[0]
		switch key {
		case "p", "page_size":
			n, ok := configTutorialID(value)
			if !ok || n > int64(math.MaxInt) {
				common.ApiErrorT(c, "Invalid tutorial query")
				return filter, false
			}
			if key == "p" {
				filter.Page = int(n)
			} else {
				filter.PageSize = int(n)
			}
		case "keyword":
			if !utf8.ValidString(value) || utf8.RuneCountInString(value) > 128 {
				common.ApiErrorT(c, "Invalid tutorial query")
				return filter, false
			}
			filter.Keyword = value
		case "enabled":
			if !chapter || value != "true" && value != "false" {
				common.ApiErrorT(c, "Invalid tutorial query")
				return filter, false
			}
			enabled := value == "true"
			filter.Enabled = &enabled
		case "group_id":
			n, ok := configTutorialID(value)
			if !chapter || !ok {
				common.ApiErrorT(c, "Invalid tutorial query")
				return filter, false
			}
			filter.GroupId = &n
		default:
			common.ApiErrorT(c, "Invalid tutorial query")
			return filter, false
		}
	}
	if filter.PageSize > 100 || (filter.Page-1) > math.MaxInt/filter.PageSize {
		common.ApiErrorT(c, "Invalid tutorial query")
		return filter, false
	}
	return filter, true
}

func configTutorialGroupDTO(group model.ConfigTutorialGroup) map[string]any {
	return map[string]any{"id": strconv.FormatInt(group.Id, 10), "group_key": group.GroupKey, "title": group.Title, "sort_order": group.SortOrder, "enabled": group.Enabled, "version": strconv.FormatInt(group.Version, 10), "created_at": strconv.FormatInt(group.CreatedAt, 10), "updated_at": strconv.FormatInt(group.UpdatedAt, 10)}
}

func configTutorialChapterDTO(chapter model.ConfigTutorialChapter, detail bool) map[string]any {
	dto := map[string]any{"id": strconv.FormatInt(chapter.Id, 10), "group_id": strconv.FormatInt(chapter.GroupId, 10), "anchor": chapter.Anchor, "title": chapter.Title, "sort_order": chapter.SortOrder, "enabled": chapter.Enabled, "version": strconv.FormatInt(chapter.Version, 10), "created_at": strconv.FormatInt(chapter.CreatedAt, 10), "updated_at": strconv.FormatInt(chapter.UpdatedAt, 10)}
	if detail {
		dto["content_markdown"] = chapter.ContentMarkdown
	}
	return dto
}

func ReadConfigTutorial(c *gin.Context) {
	if c.Request.URL.RawQuery != "" {
		common.ApiErrorT(c, "Invalid tutorial query")
		return
	}
	groups, err := model.ReadConfigTutorial()
	if err != nil {
		configTutorialError(c, err)
		return
	}
	items := make([]map[string]any, 0, len(groups))
	for _, group := range groups {
		chapters := make([]map[string]any, 0, len(group.Chapters))
		for _, chapter := range group.Chapters {
			chapters = append(chapters, map[string]any{"id": strconv.FormatInt(chapter.Id, 10), "anchor": chapter.Anchor, "title": chapter.Title, "content_markdown": chapter.ContentMarkdown})
		}
		items = append(items, map[string]any{"group_key": group.Group.GroupKey, "title": group.Group.Title, "chapters": chapters})
	}
	common.ApiSuccess(c, gin.H{"groups": items})
}

func ListConfigTutorialGroups(c *gin.Context) {
	filter, ok := configTutorialFilter(c, false)
	if !ok {
		return
	}
	groups, total, err := model.ListConfigTutorialGroups(filter)
	if err != nil {
		configTutorialError(c, err)
		return
	}
	items := make([]map[string]any, 0, len(groups))
	for _, group := range groups {
		items = append(items, configTutorialGroupDTO(group))
	}
	common.ApiSuccess(c, gin.H{"items": items, "total": total, "page": filter.Page, "page_size": filter.PageSize})
}

func GetConfigTutorialGroup(c *gin.Context) {
	id, ok := configTutorialRouteID(c)
	if !ok {
		return
	}
	group, err := model.GetConfigTutorialGroup(id)
	if err != nil {
		configTutorialError(c, err)
		return
	}
	common.ApiSuccess(c, configTutorialGroupDTO(*group))
}

func CreateConfigTutorialGroup(c *gin.Context) {
	in, _, ok := readConfigTutorialInput(c, false, false)
	if !ok {
		return
	}
	saved, err := model.SaveConfigTutorialGroup(0, 0, model.ConfigTutorialGroup{GroupKey: in.GroupKey, Title: in.Title, SortOrder: in.SortOrder, Enabled: in.Enabled})
	if err != nil {
		configTutorialError(c, err)
		return
	}
	common.ApiSuccess(c, configTutorialGroupDTO(*saved))
}

func UpdateConfigTutorialGroup(c *gin.Context) {
	id, ok := configTutorialRouteID(c)
	if !ok {
		return
	}
	in, version, ok := readConfigTutorialInput(c, false, true)
	if !ok {
		return
	}
	saved, err := model.SaveConfigTutorialGroup(id, version, model.ConfigTutorialGroup{Title: in.Title, SortOrder: in.SortOrder, Enabled: in.Enabled})
	if err != nil {
		configTutorialError(c, err)
		return
	}
	common.ApiSuccess(c, configTutorialGroupDTO(*saved))
}

func DeleteConfigTutorialGroup(c *gin.Context) {
	id, ok := configTutorialRouteID(c)
	if !ok {
		return
	}
	if err := model.DeleteConfigTutorialGroup(id); err != nil {
		configTutorialError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func ListConfigTutorialChapters(c *gin.Context) {
	filter, ok := configTutorialFilter(c, true)
	if !ok {
		return
	}
	chapters, total, err := model.ListConfigTutorialChapters(filter)
	if err != nil {
		configTutorialError(c, err)
		return
	}
	items := make([]map[string]any, 0, len(chapters))
	for _, chapter := range chapters {
		items = append(items, configTutorialChapterDTO(chapter, false))
	}
	common.ApiSuccess(c, gin.H{"items": items, "total": total, "page": filter.Page, "page_size": filter.PageSize})
}

func GetConfigTutorialChapter(c *gin.Context) {
	id, ok := configTutorialRouteID(c)
	if !ok {
		return
	}
	chapter, err := model.GetConfigTutorialChapter(id)
	if err != nil {
		configTutorialError(c, err)
		return
	}
	common.ApiSuccess(c, configTutorialChapterDTO(*chapter, true))
}

func CreateConfigTutorialChapter(c *gin.Context) {
	in, _, ok := readConfigTutorialInput(c, true, false)
	if !ok {
		return
	}
	group, valid := configTutorialID(in.GroupId)
	if !valid {
		configTutorialError(c, model.ErrConfigTutorialFields)
		return
	}
	saved, err := model.SaveConfigTutorialChapter(0, 0, model.ConfigTutorialChapter{GroupId: group, Anchor: in.Anchor, Title: in.Title, ContentMarkdown: model.LongText(in.ContentMarkdown), SortOrder: in.SortOrder, Enabled: in.Enabled})
	if err != nil {
		configTutorialError(c, err)
		return
	}
	common.ApiSuccess(c, configTutorialChapterDTO(*saved, true))
}

func UpdateConfigTutorialChapter(c *gin.Context) {
	id, ok := configTutorialRouteID(c)
	if !ok {
		return
	}
	in, version, ok := readConfigTutorialInput(c, true, true)
	if !ok {
		return
	}
	group, valid := configTutorialID(in.GroupId)
	if !valid {
		configTutorialError(c, model.ErrConfigTutorialFields)
		return
	}
	saved, err := model.SaveConfigTutorialChapter(id, version, model.ConfigTutorialChapter{GroupId: group, Title: in.Title, ContentMarkdown: model.LongText(in.ContentMarkdown), SortOrder: in.SortOrder, Enabled: in.Enabled})
	if err != nil {
		configTutorialError(c, err)
		return
	}
	common.ApiSuccess(c, configTutorialChapterDTO(*saved, true))
}

func DeleteConfigTutorialChapter(c *gin.Context) {
	id, ok := configTutorialRouteID(c)
	if !ok {
		return
	}
	if err := model.DeleteConfigTutorialChapter(id); err != nil {
		configTutorialError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
