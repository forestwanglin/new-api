#!/usr/bin/env bash
#
# setup-build-builder.sh — 初始化（或修复）带 CPU/内存配额的构建 builder
#
# 为什么需要：生产机只有 4 vCPU，而 new-api 自带 CPU 保护（默认阈值 90%，
# middleware/performance.go）。直接用默认 builder 执行 `compose build` 会把
# 宿主机 CPU 打到 99%，触发该保护，正在服务的实例会对用户返回 503
# （system_cpu_overloaded）。详见 blue-green-switch.sh 的 N7 注释。
#
# 用法:
#   sudo ./setup-build-builder.sh
#   BUILD_CPUS=3 sudo ./setup-build-builder.sh     # 覆盖 CPU 上限
#
# 幂等：builder 已存在时只做校验与配额校正。
# 需要重新执行的场景：docker buildx rm <builder>、迁移到新机器、Docker 重装。
# blue-green-switch.sh 每次 update 也会校正配额，但 builder 本身必须先存在。
#
set -euo pipefail

BUILDER="${BUILDX_BUILDER_NAME:-build-limited}"
BUILD_CPUS="${BUILD_CPUS:-2}"
BUILD_MEM="${BUILD_MEM:-2g}"
BUILDER_CT="buildx_buildkit_${BUILDER}0"
# 与默认 docker driver 的 worker（network=host）保持一致，避免构建期 DNS/NAT 差异
DRIVER_OPT_NETWORK="${DRIVER_OPT_NETWORK:-host}"

log()  { echo -e "\033[32m[INFO]\033[0m  $*"; }
die()  { echo -e "\033[31m[FAIL]\033[0m  $*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "未找到 docker 命令"

case "$BUILD_CPUS" in
  ''|*[!0-9]*) die "BUILD_CPUS 必须是正整数，当前为 '$BUILD_CPUS'" ;;
esac
[ "$BUILD_CPUS" -ge 1 ] || die "BUILD_CPUS 必须 >= 1"

if docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  log "builder '$BUILDER' 已存在，仅校正配额"
else
  log "创建 builder '$BUILDER'（driver=docker-container, network=${DRIVER_OPT_NETWORK}）"
  docker buildx create --name "$BUILDER" --driver docker-container \
    --driver-opt "network=${DRIVER_OPT_NETWORK}" >/dev/null
  # 首次需要拉取 moby/buildkit 镜像，约 100-200MB
  log "启动 builder（首次需拉取 moby/buildkit 镜像，约 1 分钟）"
  docker buildx inspect "$BUILDER" --bootstrap >/dev/null
fi

docker inspect "$BUILDER_CT" >/dev/null 2>&1 \
  || die "builder 容器 ${BUILDER_CT} 不存在，bootstrap 可能失败，请检查 'docker buildx inspect ${BUILDER} --bootstrap'"

log "设置配额: cpu=${BUILD_CPUS}核 mem=${BUILD_MEM}"
docker update --cpus="$BUILD_CPUS" --memory="$BUILD_MEM" --memory-swap="$BUILD_MEM" "$BUILDER_CT" >/dev/null

want_nano=$((BUILD_CPUS * 1000000000))
got_nano="$(docker inspect -f '{{.HostConfig.NanoCpus}}' "$BUILDER_CT")"
[ "$got_nano" = "$want_nano" ] \
  || die "CPU 配额未生效: NanoCpus=${got_nano}（期望 ${want_nano}）"

log "完成: builder=${BUILDER} 容器=${BUILDER_CT} cpu=${BUILD_CPUS}核 mem=$(docker inspect -f '{{.HostConfig.Memory}}' "$BUILDER_CT") 字节"
log "验证: sudo ${DEPLOY_DIR:-/opt/new-api-deploy}/blue-green-switch.sh check"
