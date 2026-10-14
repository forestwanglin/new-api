package jsplugin

import (
	"errors"
	"reflect"
	"sort"
	"testing"
)

func TestConvertVideoURLs(t *testing.T) {
	payload := map[string]any{
		"videos": []any{
			"https://cdn.example.com/a.mp4",
			"data:video/mp4;base64,EXISTING",
		},
		"content": []any{
			map[string]any{
				"type":      "video_url",
				"video_url": map[string]any{"url": "https://cdn.example.com/b.mov"},
			},
			map[string]any{
				"type":      "image_url",
				"image_url": map[string]any{"url": "https://cdn.example.com/image.png"},
			},
		},
		"url": "https://cdn.example.com/unrelated.mp4",
	}

	calls := []string{}
	converted, err := convertVideoURLs(payload, 10, func(rawURL string) (string, int64, error) {
		calls = append(calls, rawURL)
		return "data:video/mp4;base64,CONVERTED", 4, nil
	})
	if err != nil {
		t.Fatalf("convertVideoURLs returned error: %v", err)
	}
	if converted != 2 {
		t.Fatalf("converted = %d, want 2", converted)
	}
	sort.Strings(calls)
	if !reflect.DeepEqual(calls, []string{
		"https://cdn.example.com/a.mp4",
		"https://cdn.example.com/b.mov",
	}) {
		t.Fatalf("loader calls = %#v", calls)
	}

	videos := payload["videos"].([]any)
	if videos[0] != "data:video/mp4;base64,CONVERTED" {
		t.Fatalf("videos[0] was not converted: %v", videos[0])
	}
	if videos[1] != "data:video/mp4;base64,EXISTING" {
		t.Fatalf("existing data URI changed: %v", videos[1])
	}
	content := payload["content"].([]any)
	videoPart := content[0].(map[string]any)
	videoURL := videoPart["video_url"].(map[string]any)["url"]
	if videoURL != "data:video/mp4;base64,CONVERTED" {
		t.Fatalf("nested video URL was not converted: %v", videoURL)
	}
	imagePart := content[1].(map[string]any)
	imageURL := imagePart["image_url"].(map[string]any)["url"]
	if imageURL != "https://cdn.example.com/image.png" {
		t.Fatalf("image URL changed: %v", imageURL)
	}
	if payload["url"] != "https://cdn.example.com/unrelated.mp4" {
		t.Fatalf("unrelated URL changed: %v", payload["url"])
	}
}

func TestConvertVideoURLsEnforcesAggregateLimit(t *testing.T) {
	payload := map[string]any{
		"videos": []any{
			"https://cdn.example.com/a.mp4",
			"https://cdn.example.com/b.mp4",
		},
	}

	_, err := convertVideoURLs(payload, 5, func(string) (string, int64, error) {
		return "data:video/mp4;base64,CONVERTED", 3, nil
	})
	if err == nil {
		t.Fatal("expected aggregate size error")
	}
}

func TestConvertVideoURLsReturnsLoaderError(t *testing.T) {
	payload := map[string]any{"video_url": "https://cdn.example.com/a.mp4"}
	wantErr := errors.New("download failed")

	_, err := convertVideoURLs(payload, 10, func(string) (string, int64, error) {
		return "", 0, wantErr
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("error = %v, want %v", err, wantErr)
	}
}
