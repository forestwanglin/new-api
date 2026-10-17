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
#   sudo ./setup-build-builder.sh                      # 默认 CPU 2 核 / 内存 2g
#   sudo ./setup-build-builder.sh --cpus 3 --mem 3g    # 修改配额
#   sudo ./setup-build-builder.sh --help
#
# 注意: blue-green-switch.sh update 会用 BUILD_CPUS/BUILD_MEM 校正配额。
#       要让新配额在部署时长期生效，两者必须一致：
#         BUILD_CPUS=3 BUILD_MEM=3g sudo /opt/new-api-deploy/blue-green-switch.sh update
#
# 幂等：builder 已存在时只做校验与配额校正。
# 需要重新执行的场景：docker buildx rm <builder>、迁移到新机器、Docker 重装。
#
set -euo pipefail

BUILDER="${BUILDX_BUILDER_NAME:-build-limited}"
BUILD_CPUS="${BUILD_CPUS:-2}"
BUILD_MEM="${BUILD_MEM:-2g}"
# 与默认 docker driver 的 worker（network=host）保持一致，避免构建期 DNS/NAT 差异
DRIVER_OPT_NETWORK="${DRIVER_OPT_NETWORK:-host}"

log()  { echo -e "\033[32m[INFO]\033[0m  $*"; }
warn() { echo -e "\033[33m[WARN]\033[0m  $*"; }
die()  { echo -e "\033[31m[FAIL]\033[0m  $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
用法: setup-build-builder.sh [--cpus <核数>] [--mem <大小>]

初始化（或修复）带 cgroup CPU/内存配额的构建 builder。
不传参数时使用默认值：CPU 2 核、内存 2g。

参数:
  --cpus <核数>   构建可用 CPU 上限。正整数，且不得超过服务器总核数。
  --mem  <大小>   构建可用内存上限。支持 512m、2g、1073741824 等写法。
  -h, --help      显示本帮助。

同名环境变量 BUILD_CPUS / BUILD_MEM / BUILDX_BUILDER_NAME 仍然可用，
命令行参数优先于环境变量。

注意: blue-green-switch.sh update 会用 BUILD_CPUS/BUILD_MEM 校正配额，
      要让新配额在部署时长期生效，两者必须一致，例如：
        BUILD_CPUS=3 BUILD_MEM=3g sudo /opt/new-api-deploy/blue-green-switch.sh update
EOF
}

# "2g" / "512m" / "2gb" / "1073741824" -> 字节数；无法识别时返回非 0
size_to_bytes() {
  local s="${1,,}" n u mult
  case "$s" in
    *b) s="${s%b}" ;;
  esac
  case "$s" in
    *[kgmtp]) u="${s: -1}"; n="${s%?}" ;;
    *[0-9])   u="";         n="$s" ;;
    *) return 1 ;;
  esac
  case "$n" in
    ''|*[!0-9]*) return 1 ;;
  esac
  case "$u" in
    "") mult=1 ;;
    k)  mult=1024 ;;
    m)  mult=$((1024 * 1024)) ;;
    g)  mult=$((1024 * 1024 * 1024)) ;;
    t)  mult=$((1024 * 1024 * 1024 * 1024)) ;;
    p)  mult=$((1024 * 1024 * 1024 * 1024 * 1024)) ;;
  esac
  echo $((n * mult))
}

human_size() { # 字节 -> 人类可读（GiB，保留一位小数）
  awk -v b="$1" 'BEGIN {
    split("B KiB MiB GiB TiB", u, " "); i = 1; v = b;
    while (v >= 1024 && i < 5) { v /= 1024; i++ }
    printf (i == 2 ? "%.0f%s" : "%.1f%s"), v, u[i]
  }'
}

# ==================== 参数解析 ====================
while [ $# -gt 0 ]; do
  case "$1" in
    --cpus)      [ $# -ge 2 ] || die "--cpus 缺少参数"; BUILD_CPUS="$2"; shift 2 ;;
    --cpus=*)    BUILD_CPUS="${1#*=}"; shift ;;
    --mem|--memory) [ $# -ge 2 ] || die "$1 缺少参数"; BUILD_MEM="$2"; shift 2 ;;
    --mem=*|--memory=*) BUILD_MEM="${1#*=}"; shift ;;
    -h|--help)   usage; exit 0 ;;
    *)           die "未知参数: $1（用 --help 查看用法）" ;;
  esac
done

# ==================== 服务器资源 ====================
command -v docker >/dev/null 2>&1 || die "未找到 docker 命令"

cpu_total="$(nproc --all 2>/dev/null || nproc)"
case "$cpu_total" in
  ''|*[!0-9]*) die "无法识别服务器 CPU 核数（nproc 输出: '${cpu_total}'）" ;;
esac
[ "$cpu_total" -ge 1 ] || die "无法识别服务器 CPU 核数（nproc 输出: '${cpu_total}'）"

mem_total_kb="$(awk '/^MemTotal:/{print $2}' /proc/meminfo)"
mem_avail_kb="$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)"
[ -n "$mem_total_kb" ] || die "无法读取 /proc/meminfo 的总内存"
mem_total_bytes=$((mem_total_kb * 1024))

log "服务器资源: CPU 共 ${cpu_total} 核 | 内存共 $(human_size "$mem_total_bytes")（当前可用 $(human_size $((mem_avail_kb * 1024)))）"

# ==================== 配额校验 ====================
case "$BUILD_CPUS" in
  ''|*[!0-9]*) die "--cpus/CPU 必须是正整数，当前为 '$BUILD_CPUS'" ;;
esac
[ "$BUILD_CPUS" -ge 1 ] || die "--cpus/CPU 必须 >= 1"
if [ "$BUILD_CPUS" -gt "$cpu_total" ]; then
  die "--cpus=$BUILD_CPUS 超过服务器总核数 ${cpu_total}：配额大于总核数等于不限制构建，会打满 CPU 并触发线上 503"
fi
[ "$BUILD_CPUS" -lt "$cpu_total" ] \
  || warn "--cpus=$BUILD_CPUS 等于总核数 ${cpu_total}：构建期没有核留给线上服务"

mem_bytes="$(size_to_bytes "$BUILD_MEM")" \
  || die "--mem/内存 格式无法识别: '$BUILD_MEM'（示例: 512m、2g、1073741824）"
[ "$mem_bytes" -ge $((256 * 1024 * 1024)) ] \
  || warn "--mem=$(human_size "$mem_bytes") 偏小，前端打包与 Go 编译可能 OOM"
if [ "$mem_bytes" -ge "$mem_total_bytes" ]; then
  die "--mem=$(human_size "$mem_bytes") 不小于服务器总内存 $(human_size "$mem_total_bytes")：构建会把机器压进 swap 甚至 OOM"
fi
[ "$((mem_bytes * 100))" -le "$((mem_total_bytes * 60))" ] \
  || warn "--mem=$(human_size "$mem_bytes") 超过总内存的 60%（$(human_size "$mem_total_bytes")）：构建期内存峰值可能挤压线上服务"

log "本次配额  : CPU ${BUILD_CPUS} 核（占总核数 $((BUILD_CPUS * 100 / cpu_total))%）| 内存 $(human_size "$mem_bytes")（占总内存 $((mem_bytes * 100 / mem_total_bytes))%）"

# ==================== 创建 / 校正 builder ====================
BUILDER_CT="buildx_buildkit_${BUILDER}0"

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

old_nano="$(docker inspect -f '{{.HostConfig.NanoCpus}}' "$BUILDER_CT")"
old_mem="$(docker inspect -f '{{.HostConfig.Memory}}' "$BUILDER_CT")"
old_cpu_desc="未限制"
[ "$old_nano" -gt 0 ] && old_cpu_desc="$(awk -v n="$old_nano" 'BEGIN{printf "%.2f", n/1e9}') 核"
old_mem_desc="未限制"
[ "$old_mem" -gt 0 ] && old_mem_desc="$(human_size "$old_mem")"
log "应用配额: cpu=${old_cpu_desc} / mem=${old_mem_desc}  ->  cpu=${BUILD_CPUS} 核 / mem=$(human_size "$mem_bytes")"

docker update --cpus="$BUILD_CPUS" --memory="$mem_bytes" --memory-swap="$mem_bytes" "$BUILDER_CT" >/dev/null

want_nano=$((BUILD_CPUS * 1000000000))
got_nano="$(docker inspect -f '{{.HostConfig.NanoCpus}}' "$BUILDER_CT")"
got_mem="$(docker inspect -f '{{.HostConfig.Memory}}' "$BUILDER_CT")"
[ "$got_nano" = "$want_nano" ] \
  || die "CPU 配额未生效: NanoCpus=${got_nano}（期望 ${want_nano}）"
[ "$got_mem" = "$mem_bytes" ] \
  || die "内存配额未生效: Memory=${got_mem}（期望 ${mem_bytes}）"

log "完成: builder=${BUILDER} 容器=${BUILDER_CT}"
log "配额生效: CPU ${BUILD_CPUS}/${cpu_total} 核（$((BUILD_CPUS * 100 / cpu_total))%）、内存 $(human_size "$got_mem")/$(human_size "$mem_total_bytes")（$((got_mem * 100 / mem_total_bytes))%）"

# 内核视角的配额（systemd cgroup driver 下可读）；失败不影响结果
cg_root="/sys/fs/cgroup/system.slice/docker-$(docker inspect -f '{{.Id}}' "$BUILDER_CT").scope"
if [ -r "${cg_root}/cpu.max" ]; then
  log "内核强制: cpu.max=$(cat "${cg_root}/cpu.max") memory.max=$(cat "${cg_root}/memory.max" 2>/dev/null || echo n/a)"
fi

log "验证: sudo /opt/new-api-deploy/blue-green-switch.sh check"
if [ "$BUILD_CPUS" != "2" ] || [ "$mem_bytes" != $((2 * 1024 * 1024 * 1024)) ]; then
  warn "提醒: 非默认配额只在本次生效。blue-green-switch.sh 默认会用 2 核 / 2g 校正配额，"
  warn "      部署时请保持一致，否则配额会被改回："
  warn "        BUILD_CPUS=${BUILD_CPUS} BUILD_MEM=${BUILD_MEM} sudo /opt/new-api-deploy/blue-green-switch.sh update"
fi
