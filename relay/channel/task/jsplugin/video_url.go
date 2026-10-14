package jsplugin

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// Reference video URLs inside a JSON task body are downloaded and rewritten as
// base64 data URIs before the body leaves the gateway. Some Sora-compatible
// upstreams reject remote video URLs and only accept inline video content.
type videoURLLoader func(rawURL string) (dataURI string, size int64, err error)

// inlineVideoURLs walks a decoded JSON body and rewrites every reference video
// URL it finds. The walk is a no-op when the body carries no video URL.
func inlineVideoURLs(c *gin.Context, payload any) (any, error) {
	maxTotalBytes := int64(constant.MaxFileDownloadMB) * 1024 * 1024
	_, err := convertVideoURLs(payload, maxTotalBytes, func(rawURL string) (string, int64, error) {
		return loadVideoDataURI(c, rawURL)
	})
	if err != nil {
		return payload, err
	}
	return payload, nil
}

func loadVideoDataURI(c *gin.Context, rawURL string) (string, int64, error) {
	cachedData, err := service.LoadFileSource(c, types.NewURLFileSource(rawURL), "video_url_to_base64")
	if err != nil {
		return "", 0, fmt.Errorf("failed to download video URL")
	}

	mimeType := strings.ToLower(strings.TrimSpace(cachedData.MimeType))
	if !strings.HasPrefix(mimeType, "video/") {
		return "", 0, fmt.Errorf("video URL returned unsupported content type %q", cachedData.MimeType)
	}

	base64Data, err := cachedData.GetBase64Data()
	if err != nil {
		return "", 0, fmt.Errorf("failed to encode downloaded video")
	}
	return "data:" + mimeType + ";base64," + base64Data, cachedData.Size, nil
}

func convertVideoURLs(payload any, maxTotalBytes int64, loader videoURLLoader) (int, error) {
	totalBytes := int64(0)
	_, converted, err := convertVideoURLValue(payload, false, maxTotalBytes, &totalBytes, loader)
	return converted, err
}

func convertVideoURLValue(value any, videoContext bool, maxTotalBytes int64, totalBytes *int64, loader videoURLLoader) (any, int, error) {
	switch typed := value.(type) {
	case map[string]any:
		converted := 0
		typeMarksVideo := mapTypeMarksVideo(typed)
		for key, child := range typed {
			childVideoContext := videoContext || isVideoField(key) || (typeMarksVideo && strings.EqualFold(key, "url"))
			convertedChild, count, err := convertVideoURLValue(child, childVideoContext, maxTotalBytes, totalBytes, loader)
			if err != nil {
				return value, converted, err
			}
			typed[key] = convertedChild
			converted += count
		}
		return typed, converted, nil

	case []any:
		converted := 0
		for index, child := range typed {
			convertedChild, count, err := convertVideoURLValue(child, videoContext, maxTotalBytes, totalBytes, loader)
			if err != nil {
				return value, converted, err
			}
			typed[index] = convertedChild
			converted += count
		}
		return typed, converted, nil

	case string:
		if !videoContext || !isHTTPURL(typed) {
			return value, 0, nil
		}
		dataURI, size, err := loader(typed)
		if err != nil {
			return value, 0, err
		}
		if size < 0 || (maxTotalBytes > 0 && *totalBytes+size > maxTotalBytes) {
			return value, 0, fmt.Errorf("total video size exceeds maximum allowed size: %dMB", maxTotalBytes/(1024*1024))
		}
		*totalBytes += size
		return dataURI, 1, nil
	}

	return value, 0, nil
}

func isVideoField(key string) bool {
	switch strings.ToLower(strings.ReplaceAll(key, "-", "_")) {
	case "video", "videos", "video_url", "video_urls", "videourl", "videourls", "input_video":
		return true
	default:
		return false
	}
}

func mapTypeMarksVideo(value map[string]any) bool {
	typeName, ok := value["type"].(string)
	if !ok {
		return false
	}
	typeName = strings.ToLower(typeName)
	return strings.Contains(typeName, "video")
}

func isHTTPURL(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	return strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://")
}
