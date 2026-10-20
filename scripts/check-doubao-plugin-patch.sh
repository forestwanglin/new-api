#!/bin/sh
# Guard the local doubao plugin patch.
#
# Seedance mini/fast families are served by type 55 (Sora-compatible) relay
# channels in this fork. The task-plugin identity filter only admits VolcEngine
# (45) and DoubaoVideo (54) channels for a model the Doubao plugin claims (or a
# New API/TaskPlugin channel bound to it), so an upstream merge that drops this
# patch silently turns those requests into "no available channel".
#
# Four anchors in plugins/tasks/doubao/plugin.js:
#   1. the RELAY_VIDEO_MODEL_PATTERN rule
#   2. meta.models built from OWNED_VIDEO_MODELS
#   3. meta.usageProfiles built from OWNED_VIDEO_MODELS
#   4. the openai_video claim built from OWNED_VIDEO_MODELS
#
# Run before CI and before an image build:
#   sh scripts/check-doubao-plugin-patch.sh
set -eu

root=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
plugin="$root/plugins/tasks/doubao/plugin.js"

fail() {
	printf 'check-doubao-plugin-patch: %s\n' "$*" >&2
	exit 1
}

[ -f "$plugin" ] || fail "missing $plugin"

count() {
	grep -F -c "$1" "$plugin" || true
}

[ "$(count 'const RELAY_VIDEO_MODEL_PATTERN = /^doubao-seedance-.*-(?:mini|fast)-/;')" -eq 1 ] ||
	fail "RELAY_VIDEO_MODEL_PATTERN rule is missing or changed"

grep -F -q 'models: Object.keys(OWNED_VIDEO_MODELS).concat(Object.keys(IMAGE_MODELS))' "$plugin" ||
	fail "meta.models no longer filters through OWNED_VIDEO_MODELS"

grep -F -q 'usageProfiles: capabilityUsageProfiles(OWNED_VIDEO_MODELS' "$plugin" ||
	fail "meta.usageProfiles no longer uses OWNED_VIDEO_MODELS"

grep -F -q 'name: "openai_video", models: Object.keys(OWNED_VIDEO_MODELS)' "$plugin" ||
	fail "the openai_video claim no longer uses OWNED_VIDEO_MODELS"

anchors=$(count 'OWNED_VIDEO_MODELS')
[ "$anchors" -eq 4 ] || fail "expected 4 OWNED_VIDEO_MODELS anchors, found $anchors"

printf 'check-doubao-plugin-patch: ok (%s anchors)\n' "$anchors"
