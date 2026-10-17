package plugins_test

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	builtinplugins "github.com/QuantumNous/new-api/plugins"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func seedanceObject(t *testing.T, value any) map[string]any {
	t.Helper()
	encoded, err := common.Marshal(value)
	require.NoError(t, err)
	var result map[string]any
	require.NoError(t, common.Unmarshal(encoded, &result))
	return result
}

// Ark Seedance models (doubao-seedance-*) reach the sora plugin through
// OpenAI-video channels. The reservation must stay at the per-video base price
// (no duration ratio), and the completion body's upstream billing tokens must
// flow back to the host so the reserved quota is settled afterwards.
func TestSoraPluginArkSeedanceUsage(t *testing.T) {
	source, err := builtinplugins.Source("sora")
	require.NoError(t, err)
	registry := jsplugin.NewRegistry()
	plugin, err := registry.RegisterFactory(source, jsplugin.Options{Key: "sora"})
	require.NoError(t, err)

	usageCtx := func(model, purpose string) map[string]any {
		return map[string]any{
			"model":         model,
			"upstreamModel": model,
			"action":        "text_to_video",
			"usagePurpose":  purpose,
			"requestBody":   map[string]any{"model": model, "prompt": "a ceramic cup", "seconds": 5},
		}
	}

	t.Run("ark seedance reserves the base price only", func(t *testing.T) {
		for _, model := range []string{"doubao-seedance-2-0-mini-260615", "doubao-seedance-2-0-fast-260128"} {
			for _, purpose := range []string{"billing_ratios", "facts"} {
				value, callErr := plugin.Engine.Call(t.Context(), "extractUsage", usageCtx(model, purpose))
				require.NoError(t, callErr)
				assert.Empty(t, seedanceObject(t, value), model, purpose)
			}
		}
	})

	t.Run("sora duration ratio is unchanged", func(t *testing.T) {
		value, callErr := plugin.Engine.Call(t.Context(), "extractUsage", usageCtx("sora-2-pro", "billing_ratios"))
		require.NoError(t, callErr)
		assert.Equal(t, map[string]any{"seconds": float64(5), "size": "720x1280"}, seedanceObject(t, value))
	})

	t.Run("completion reports upstream billing tokens", func(t *testing.T) {
		body := map[string]any{
			"status": "completed",
			"usage":  map[string]any{"completion_tokens": 108900, "total_tokens": 108900, "billed_amount": 1.25235},
		}
		value, callErr := plugin.Engine.Call(t.Context(), "extractUsageOnComplete", usageCtx("doubao-seedance-2-0-mini-260615", "facts"), map[string]any{"status": "SUCCESS"}, body)
		require.NoError(t, callErr)
		assert.Equal(t, map[string]any{"totalTokens": float64(108900)}, seedanceObject(t, value))
	})

	t.Run("completion falls back to total tokens", func(t *testing.T) {
		body := map[string]any{"status": "completed", "usage": map[string]any{"total_tokens": 108900}}
		value, callErr := plugin.Engine.Call(t.Context(), "extractUsageOnComplete", usageCtx("doubao-seedance-2-0-mini-260615", "facts"), map[string]any{"status": "SUCCESS"}, body)
		require.NoError(t, callErr)
		assert.Equal(t, map[string]any{"totalTokens": float64(108900)}, seedanceObject(t, value))
	})

	t.Run("completion without usage keeps the reservation", func(t *testing.T) {
		// AdjustBillingOnComplete re-invokes the hook with the stored task row
		// and no body; it must not clear the facts recorded by the poll.
		taskRow := map[string]any{"properties": map[string]any{"origin_model_name": "doubao-seedance-2-0-mini-260615"}}
		value, callErr := plugin.Engine.Call(t.Context(), "extractUsageOnComplete", taskRow, map[string]any{"status": "SUCCESS"})
		require.NoError(t, callErr)
		assert.Empty(t, seedanceObject(t, value))

		value, callErr = plugin.Engine.Call(t.Context(), "extractUsageOnComplete", usageCtx("doubao-seedance-2-0-mini-260615", "facts"), map[string]any{"status": "SUCCESS"}, map[string]any{"status": "completed"})
		require.NoError(t, callErr)
		assert.Empty(t, seedanceObject(t, value))
	})

	t.Run("sora completion facts are unchanged", func(t *testing.T) {
		value, callErr := plugin.Engine.Call(t.Context(), "extractUsageOnComplete", usageCtx("sora-2-pro", "facts"), map[string]any{"status": "SUCCESS"}, map[string]any{"seconds": 8, "size": "1792x1024"})
		require.NoError(t, callErr)
		assert.Equal(t, map[string]any{"seconds": float64(8), "size": "1792x1024"}, seedanceObject(t, value))
	})
}
