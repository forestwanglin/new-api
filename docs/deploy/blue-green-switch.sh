#!/usr/bin/env bash
#
# blue-green-switch.sh — New API 蓝绿零停机更新脚本
#
# 用法:
#   sudo ./blue-green-switch.sh update      # 完整零停机更新（默认）
#   sudo ./blue-green-switch.sh rollback    # 快速回滚：Nginx 切回旧实例（旧实例未被删除时有效）
#   sudo ./blue-green-switch.sh check       # 只做预检（含构建资源限制校验），不改动线上任何东西
#   sudo ./blue-green-switch.sh prune       # 只清构建缓存（默认保留 7 天内用过的），不碰实例/Nginx/数据库
#
# 前置条件:
#   1. /opt/new-api-deploy/compose.yaml 为双实例配置（new-api-a:3000 / new-api-b:3001）
#   2. Nginx 配置中有且仅有一处 proxy_pass 指向 127.0.0.1:3000 或 127.0.0.1:3001
#   3. compose 中 stop_grace_period(130s) > 应用 SHUTDOWN_TIMEOUT_SECONDS(默认120s)
#   4. 3000/3001 均未对公网开放
#   5. 受限构建 builder 已初始化（setup-build-builder.sh，见 N7）
#
# 等待点（脚本会暂停等待，属正常现象，请勿中断）:
#   W1 等待新实例健康检查通过   最长 HEALTH_TIMEOUT（默认 300s，含数据库迁移）
#   W2 等待旧实例在途请求排空   DRAIN_WAIT（默认 300s，SSE 流式请求）
#   W3 docker stop 旧实例       应用优雅排空，最长 SHUTDOWN_TIMEOUT_SECONDS（默认 120s）
#
# 注意点:
#   N1 运行前确认本次更新的数据库迁移向后兼容（旧实例在切流前仍在服务）
#   N2 Nginx 配置自动探测：找不到、找到多处、或文件中有多处 proxy_pass 时脚本中止，需人工处理
#   N3 切流后、停旧实例前是快速回滚窗口，发现异常立即执行: ./blue-green-switch.sh rollback
#   N4 停旧实例后快速回滚失效，需按 zero-downtime-update.md 的备份标签流程回滚
#   N5 新实例启动失败时脚本不会切流，线上零影响
#   N6 版本盖章：step_pull_and_build 会在构建前把版本写成
#      ${BRANCH}-<commit 前 8 位> 存入 $SRC_DIR/VERSION（前端
#      VITE_REACT_APP_VERSION + 后端 common.Version），构建后还原空文件。
#      这样界面左上角版本号才随部署变化（受保护行为，修改构建流程时必须保留）。
#      注意：手工在 $SRC_DIR 直接 compose build 不会盖章，只有本脚本会。
#   N7 构建 CPU 配额：构建必须走受限 builder（BUILDX_BUILDER_NAME），
#      由 ensure_build_limits 校验“CPU 配额存在且不超过总核数；
#      若设了内存上限则必须小于总内存”；不满足时 update 直接中止，
#      不会退回无限制构建。
#      配额本身由 setup-build-builder.sh 写入并记录到 build-limits.env，
#      本脚本只读不写（不会把运维调整过的值改回去）。
#      内存配额默认不限制：本机实测 2g 上限 + cgroup 零 swap 会让构建卡在
#      内存回收上，BuildKit 会话心跳超时，导出时报 no active session。
#      另 ensure_build_headroom 会在构建前校验“内存余量”（MemAvailable +
#      SwapFree >= MIN_BUILD_HEADROOM_MB，默认 2048MiB）：2026-10-18 的部署
#      失败就是宿主机空闲 swap 只剩 ~23MiB，前端 node 峰值 1.75GiB 触发内核
#      全局 OOM 被 SIGKILL（buildkitd 报 cannot allocate memory）。
#      另：只构建本次要启动的备用 target，避免两个 service 各导出一份镜像。
#      rollback 不构建，因此不受该检查影响。
#   N8 构建缓存清理：两个 builder（default 与 BUILDX_BUILDER_NAME）的构建缓存
#      互不共享且只增不减，是本机磁盘的主要增长项（2026-10-18 实测 30G/34G）。
#      update 在构建成功后按 BUILD_CACHE_KEEP（默认 168h）各清一次；prune 子命令
#      只做同样的清理，供 cron 做周度兜底（不依赖线上实例，任意时间可跑）。
#      只删 build cache，不删镜像/容器/volume，不影响备份标签与回滚。
#
set -euo pipefail

# ==================== 可配置项 ====================
DEPLOY_DIR="/opt/new-api-deploy"
SRC_DIR="/opt/new-api-src"
BRANCH="zyy"
COMPOSE_FILE="${DEPLOY_DIR}/compose.yaml"

PORT_A=3000                      # new-api-a 监听端口
PORT_B=3001                      # new-api-b 监听端口
SVC_A="new-api-a"
SVC_B="new-api-b"
CONTAINER_A="new-api-zyy-a"      # 与 compose 中 container_name 一致
CONTAINER_B="new-api-zyy-b"
LEGACY_CONTAINER="new-api-zyy"   # 旧单容器时代的容器名（如仍存在）

MYSQL_DB="new_api"
BACKUP_DIR="/opt/new-api-backups"
BACKUP_KEEP=3                    # 数据库备份与镜像备份标签各保留份数

HEALTH_TIMEOUT=300               # W1: 等待新实例 healthy 的最长秒数
DRAIN_WAIT=300                   # W2: 切流后等待在途请求排空的秒数

# N7: 构建资源限制。配额的唯一写入方是 setup-build-builder.sh（它会把选择记到
# build-limits.env）；本脚本只读取与校验，不会覆盖实际配额。
# 优先级: 显式环境变量 > build-limits.env > 内置默认。
BUILD_LIMITS_FILE="${DEPLOY_DIR}/build-limits.env"
if [ -r "$BUILD_LIMITS_FILE" ]; then
  # 文件内为 "${VAR:-value}" 形式，不会覆盖调用方显式传入的环境变量
  . "$BUILD_LIMITS_FILE"
fi
BUILDX_BUILDER_NAME="${BUILDX_BUILDER_NAME:-build-limited}"
BUILD_CPUS="${BUILD_CPUS:-2}"    # 仅用于与实际配额比对提示，不写回
BUILD_MEM="${BUILD_MEM:-off}"    # off = 不限制；同上，不写回

# N7: 构建前内存余量下限（MiB），口径 = MemAvailable + SwapFree。前端 rspack/node
# 峰值实测约 1.8GiB 且与 Go 编译并行；2026-10-18 的部署失败正是宿主机 4G 内存 +
# 1G swap 已被占满（空闲 swap 仅 ~23MiB），node 被内核全局 OOM SIGKILL。
# 置 0 可跳过该检查（风险自担）。
MIN_BUILD_HEADROOM_MB="${MIN_BUILD_HEADROOM_MB:-2048}"

# N8: 构建缓存清理。build cache 只增不减：2026-10-18 实测根分区 34G 里有约 30G
# 是构建缓存（默认 builder 在 /var/lib/containerd 20G + 受限 builder 的 state
# volume 9.9G），而实际镜像只有 1.3G。两个 builder 的缓存互不共享，必须分别清理。
# 清理只针对 build cache（docker system df 的 Build Cache 一类），不删镜像、
# 容器、volume 数据，镜像备份标签与回滚流程都不受影响。保留期内用过的缓存会
# 留下，所以正常情况下不会把每次部署都变成冷构建。
BUILD_CACHE_KEEP="${BUILD_CACHE_KEEP:-168h}"     # 保留最近用过的时间窗（Go duration，不支持 'd'）
PRUNE_BUILD_CACHE="${PRUNE_BUILD_CACHE:-true}"   # false = 跳过 update 构建后的自动清理

NGINX_SEARCH_PATHS="/etc/nginx/sites-enabled /etc/nginx/sites-available /etc/nginx/conf.d"

# ==================== 工具函数 ====================
log()  { echo -e "\033[32m[INFO]\033[0m  $*"; }
warn() { echo -e "\033[33m[WARN]\033[0m  $*"; }
die()  { echo -e "\033[31m[FAIL]\033[0m  $*" >&2; exit 1; }

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

container_of() { # service -> container name
  case "$1" in
    "$SVC_A") echo "$CONTAINER_A" ;;
    "$SVC_B") echo "$CONTAINER_B" ;;
    *) echo "$1" ;;  # 遗留容器名原样返回
  esac
}

port_of_svc() {
  case "$1" in
    "$SVC_A") echo "$PORT_A" ;;
    "$SVC_B") echo "$PORT_B" ;;
  esac
}

svc_of_port() {
  case "$1" in
    "$PORT_A") echo "$SVC_A" ;;
    "$PORT_B") echo "$SVC_B" ;;
  esac
}

is_running() { # container name -> 0/1
  docker inspect "$1" >/dev/null 2>&1 \
    && [ "$(docker inspect --format '{{.State.Running}}' "$1")" = "true" ]
}

# ==================== 构建资源限制（N7） ====================
# 背景：本机只有 4 vCPU，而 new-api 自带 CPU 保护（middleware/performance.go，
# 默认阈值 90%）。宿主机 CPU 超阈值时，relay 请求会被直接拒绝并返回
# 503 system_cpu_overloaded —— 2026-10-17 的线上 503 就是部署时 `compose build`
# 把宿主机 CPU 打到 99% 触发的（旧实例仍在服务，用户拿到 503）。
#
# 因此构建必须跑在带 cgroup CPU 配额的独立 builder 容器里。注意：默认 builder
# 是 docker driver，其构建步由 containerd 创建，不落在 `--cgroup-parent` 指定的
# 父 cgroup 下 —— 在本机实测 `--cgroup-parent` 对构建 CPU 完全无效（仍占满 4 核）。
# docker-container driver 的 builder 则整体受容器配额约束（实测 --cpus=1 时
# 4 个满载进程合计恰好 1 核）。
#
# 配额会随 builder 容器重建而丢失，所以这里每次 update 前都做校验；
# 但本脚本**不写入**配额（不调 docker update）：配额由 setup-build-builder.sh
# 决定并记录到 build-limits.env，避免两处配置互相覆盖。
ensure_build_limits() {
  local ct="buildx_buildkit_${BUILDX_BUILDER_NAME}0"
  local nano mem cpu_total mem_total_kb mem_total_bytes cpu_desc mem_desc

  [ -n "$BUILDX_BUILDER_NAME" ] \
    || die "N7: BUILDX_BUILDER_NAME 为空，拒绝执行无配额构建"

  if ! docker inspect "$ct" >/dev/null 2>&1; then
    warn "N7: 未找到受限 builder '${BUILDX_BUILDER_NAME}'（容器 ${ct} 不存在）。"
    warn "    无配额的构建会打满宿主机 CPU，触发 new-api 的 CPU 保护并让用户拿到 503。"
    die "    请先执行: sudo ${DEPLOY_DIR}/setup-build-builder.sh"
  fi

  nano="$(docker inspect -f '{{.HostConfig.NanoCpus}}' "$ct")"
  mem="$(docker inspect -f '{{.HostConfig.Memory}}' "$ct")"

  # 断言①：CPU 配额必须存在（内存配额可选，见下）
  [ "${nano:-0}" -gt 0 ] 2>/dev/null \
    || die "N7: builder '${BUILDX_BUILDER_NAME}' 没有 CPU 配额（NanoCpus=${nano:-空}），拒绝构建；请执行 sudo ${DEPLOY_DIR}/setup-build-builder.sh"

  # 断言②：配额不超过服务器总资源（大于等于总资源等于不限制，防线失效）
  cpu_total="$(nproc --all 2>/dev/null || nproc)"
  case "$cpu_total" in
    ''|*[!0-9]*) die "N7: 无法识别服务器 CPU 核数（nproc 输出: '${cpu_total}'）" ;;
  esac
  [ "$nano" -le "$((cpu_total * 1000000000))" ] \
    || die "N7: builder 的 CPU 配额 $(awk -v n="$nano" 'BEGIN{printf "%.2f", n/1e9}') 核 超过服务器总核数 ${cpu_total}，等于不限制构建，拒绝"

  mem_total_bytes=""
  mem_total_kb="$(awk '/^MemTotal:/{print $2}' /proc/meminfo)"
  case "$mem_total_kb" in
    ''|*[!0-9]*) warn "N7: 读不到 /proc/meminfo 的总内存，跳过内存配额上限校验" ;;
    *) mem_total_bytes=$((mem_total_kb * 1024))
       # 内存配额是可选的（0 = 不限制）；设了就必须小于总内存
       if [ "${mem:-0}" -gt 0 ] 2>/dev/null; then
         [ "$mem" -lt "$mem_total_bytes" ] \
           || die "N7: builder 的内存配额 $((mem / 1024 / 1024))MiB 不小于服务器总内存 $((mem_total_bytes / 1024 / 1024))MiB，拒绝构建"
       fi ;;
  esac

  cpu_desc="$(awk -v n="$nano" 'BEGIN{printf "%.2f", n/1e9}')/${cpu_total}核"
  mem_desc="不限制"
  if [ "${mem:-0}" -gt 0 ] 2>/dev/null; then
    mem_desc="$((mem / 1024 / 1024))MiB"
    [ -n "$mem_total_bytes" ] && mem_desc="${mem_desc}/$((mem_total_bytes / 1024 / 1024))MiB"
  fi
  log "N7 构建资源限制: builder=${BUILDX_BUILDER_NAME} cpu=${cpu_desc} mem=${mem_desc}"

  # 期望值（环境变量或 build-limits.env）与实际不一致时只提示，不覆盖
  if [ "$BUILD_CPUS" -gt 0 ] 2>/dev/null && [ "$nano" != "$((BUILD_CPUS * 1000000000))" ]; then
    warn "N7: 实际 CPU 配额 $(awk -v n="$nano" 'BEGIN{printf "%.2f", n/1e9}') 核 与期望 ${BUILD_CPUS} 核（环境变量或 ${BUILD_LIMITS_FILE}）不一致；"
    warn "    本脚本不覆盖配额，如需统一请重跑 sudo ${DEPLOY_DIR}/setup-build-builder.sh"
  fi
}

# N7: 构建前内存余量预检。CPU 配额解决的是 503（CPU 超阈值），管不住内存：
# 构建期前端 rsbuild(node) 峰值实测约 1.8GiB，且与 Go 编译并行推进。
# 2026-10-18 的失败证据：
#   dmesg: Out of memory: Killed process (node) ... anon-rss:1757864kB, global_oom
#   buildkitd: ... bun run build ... cannot allocate memory
# 当时宿主机 MemAvailable ≈ 1.9GiB、空闲 swap 仅 ~23MiB，尖峰无处可去。
# 这里在构建前把余量摆出来并直接中止，避免白跑几分钟才被 OOM 杀掉。
ensure_build_headroom() {
  local avail_kb swap_free_kb avail_mb swap_mb headroom_mb
  case "$MIN_BUILD_HEADROOM_MB" in
    ''|*[!0-9]*) die "N7: MIN_BUILD_HEADROOM_MB 必须是整数（MiB），当前为 '${MIN_BUILD_HEADROOM_MB}'" ;;
  esac
  if [ "$MIN_BUILD_HEADROOM_MB" -eq 0 ]; then
    warn "N7: MIN_BUILD_HEADROOM_MB=0，跳过构建内存余量预检（风险自担）"
    return 0
  fi

  avail_kb="$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)"
  swap_free_kb="$(awk '/^SwapFree:/{print $2}' /proc/meminfo)"
  case "$avail_kb" in
    ''|*[!0-9]*) warn "N7: 读不到 /proc/meminfo 的 MemAvailable，跳过构建内存余量预检"; return 0 ;;
  esac
  case "$swap_free_kb" in ''|*[!0-9]*) swap_free_kb=0 ;; esac
  avail_mb=$((avail_kb / 1024))
  swap_mb=$((swap_free_kb / 1024))
  headroom_mb=$((avail_mb + swap_mb))

  log "N7 构建内存余量: 可用内存 ${avail_mb}MiB + 空闲 swap ${swap_mb}MiB = ${headroom_mb}MiB（下限 ${MIN_BUILD_HEADROOM_MB}MiB）"
  [ "$headroom_mb" -ge "$MIN_BUILD_HEADROOM_MB" ] || die "N7: 构建内存余量不足（${headroom_mb}MiB < ${MIN_BUILD_HEADROOM_MB}MiB）。\
前端 rsbuild 峰值约 1.8GiB 且与 Go 编译并行，继续构建大概率被内核 OOM 杀掉（见 2026-10-18 事件）。\
请先扩容/释放内存再重试，例如：\
  1) 加 swapfile: fallocate -l 4G /swap2 && chmod 600 /swap2 && mkswap /swap2 && swapon /swap2（并把 /swap2 写入 /etc/fstab 持久化）\
  2) 释放构建缓存常驻内存: docker restart buildx_buildkit_${BUILDX_BUILDER_NAME}0（保留缓存）或 docker builder prune -f（会冷构建）\
  3) 确认风险可接受时覆盖阈值: MIN_BUILD_HEADROOM_MB=0 sudo $0 update"
}

# ==================== 构建缓存清理（N8） ====================
validate_build_cache_config() {
  # buildx 把 until= 当 Go duration 解析（支持 s/m/h，不支持 'd'）。格式错时 prune
  # 只会失败/不生效，缓存继续累积却没人发现，所以这里提前 fail-closed。
  [[ "$BUILD_CACHE_KEEP" =~ ^[0-9]+(s|m|h)([0-9]+(s|m|h))*$ ]] \
    || die "N8: BUILD_CACHE_KEEP 需为 Go duration（例如 168h、30m、1h30m），不支持 'd'；当前为 '${BUILD_CACHE_KEEP}'"
  case "$PRUNE_BUILD_CACHE" in
    true|false) ;;
    *) die "N8: PRUNE_BUILD_CACHE 只能是 true 或 false，当前为 '${PRUNE_BUILD_CACHE}'" ;;
  esac
}

# 清理两个 builder 的构建缓存。$1=true 时清理失败会让脚本失败（prune 子命令用），
# 否则只告警：update 里的这一步是 housekeeping，不该让一次已经构建成功的部署失败。
prune_build_cache() {
  local strict="${1:-false}" b out total targets rc=0
  validate_build_cache_config

  # 词分割是有意的：builder 名不含空格；两者同名（BUILDX_BUILDER_NAME=default）时去重
  targets="default"
  [ "$BUILDX_BUILDER_NAME" = "default" ] || targets="default ${BUILDX_BUILDER_NAME}"
  for b in $targets; do
    if ! docker buildx inspect "$b" >/dev/null 2>&1; then
      warn "N8: builder '$b' 不存在，跳过构建缓存清理"
      continue
    fi
    if out="$(docker buildx prune --builder "$b" --filter "until=${BUILD_CACHE_KEEP}" -f 2>&1)"; then
      total="$(printf '%s\n' "$out" | sed -n 's/^Total:[[:space:]]*//p' | tail -1)"
      if [ -n "$total" ]; then
        log "N8 构建缓存清理 [$b]: 保留 ${BUILD_CACHE_KEEP} 内用过的缓存，回收 ${total}"
      else
        log "N8 构建缓存清理 [$b]: 保留 ${BUILD_CACHE_KEEP} 内用过的缓存"
        printf '%s\n' "$out" | sed 's/^/    /'
      fi
    else
      rc=1
      warn "N8: 构建缓存清理失败 [$b]"
      printf '%s\n' "$out" | tail -5 | sed 's/^/    /' >&2
    fi
  done
  if [ "$rc" -ne 0 ] && [ "$strict" = true ]; then
    die "N8: 构建缓存清理失败（见上方输出）"
  fi
}

# ==================== 状态探测 ====================
find_nginx_file() {
  local files f n
  # --exclude 排除本脚本生成的 .bak-* 备份，避免备份文件被计入探测结果
  files="$(grep -rlE "proxy_pass[[:space:]]+http://127\.0\.0\.1:(${PORT_A}|${PORT_B})" --exclude='*.bak-*' $NGINX_SEARCH_PATHS 2>/dev/null \
    | xargs -r -n1 readlink -f | sort -u)"
  if [ -z "$files" ]; then
    die "N2: 在 $NGINX_SEARCH_PATHS 中未找到含 proxy_pass(3000/3001) 的 Nginx 配置文件。请确认 Nginx 已配置反向代理，或修改 NGINX_SEARCH_PATHS。"
  fi
  n="$(echo "$files" | wc -l | tr -d ' ')"
  if [ "$n" -ne 1 ]; then
    die "N2: 找到 $n 个含 proxy_pass(3000/3001) 的 Nginx 配置文件（期望恰好 1 个）:\n$files\n请人工确认后重试，或修改 NGINX_SEARCH_PATHS。"
  fi
  f="$files"
  n="$(grep -cE "proxy_pass[[:space:]]+http://127\.0\.0\.1:(${PORT_A}|${PORT_B})" "$f")"
  if [ "$n" -ne 1 ]; then
    die "N2: $f 中有 $n 处 proxy_pass 指向 3000/3001（期望恰好 1 处）。请人工处理。"
  fi
  echo "$f"
}

active_port() { # 当前 Nginx 指向的端口；探测失败时返回非 0（不输出）
  local f
  # 注意：本函数经命令替换调用，子 shell 中 set -e 失效，必须显式传播失败，
  # 否则 find_nginx_file 的 die 只终止子 shell，父脚本会拿着空值继续执行
  f="$(find_nginx_file)" || return 1
  [ -n "$f" ] || return 1
  if grep -qE "proxy_pass[[:space:]]+http://127\.0\.0\.1:${PORT_A}([;[:space:]]|$)" "$f"; then
    echo "$PORT_A"
  else
    echo "$PORT_B"
  fi
}

running_instance() { # 输出当前运行中的实例（服务名或遗留容器名），无则输出空
  if is_running "$CONTAINER_A"; then echo "$SVC_A"; return; fi
  if is_running "$CONTAINER_B"; then echo "$SVC_B"; return; fi
  if is_running "$LEGACY_CONTAINER"; then echo "$LEGACY_CONTAINER"; return; fi
  echo ""
}

check_preconditions() {
  [ -f "$COMPOSE_FILE" ] || die "找不到 compose 文件: $COMPOSE_FILE"
  compose config --quiet >/dev/null 2>&1 || die "compose 配置校验失败: $COMPOSE_FILE"
  command -v mysqldump >/dev/null || die "未找到 mysqldump 命令"
  command -v nginx >/dev/null || die "未找到 nginx 命令"

  local running
  running="$(running_instance)"
  if [ -z "$running" ]; then
    die "没有实例在运行。状态不明确（可能服务已停），请人工检查后再运行。"
  fi
  log "当前活跃实例: $running"
}

# ==================== 步骤实现 ====================
step_backup() {
  log "① 备份数据库与镜像"
  mkdir -p "$BACKUP_DIR"
  local ts db_file
  ts="$(date +%F_%H%M%S)"
  db_file="${BACKUP_DIR}/new_api_${ts}.sql.gz"
  mysqldump --single-transaction --routines --triggers "$MYSQL_DB" | gzip > "$db_file" \
    || die "数据库备份失败: $db_file"
  log "数据库备份: $db_file"

  docker image tag "new-api-zyy:latest" "new-api-zyy:backup-${ts}"
  log "镜像备份标签: new-api-zyy:backup-${ts}"

  # 清理旧备份（各保留 BACKUP_KEEP 份）
  find "$BACKUP_DIR" -name 'new_api_*.sql.gz' | sort -r | tail -n +$((BACKUP_KEEP + 1)) | xargs -r rm -f
  docker images "new-api-zyy:backup-*" --format '{{.Tag}}' 2>/dev/null | sort -r | tail -n +$((BACKUP_KEEP + 1)) \
    | while read -r t; do docker rmi "new-api-zyy:$t" >/dev/null 2>&1 || true; done
}

step_pull_and_build() { # $1 = 本次要启动的备用服务名（只构建它，见下方注释）
  local target="$1"
  log "② 拉取 ${BRANCH} 分支并构建镜像（target=${target}）"
  warn "N1: 请确认本次更新的数据库迁移向后兼容（旧实例在切流前仍在服务）"
  git -C "$SRC_DIR" fetch origin "$BRANCH"
  git -C "$SRC_DIR" pull --ff-only origin "$BRANCH"
  git -C "$SRC_DIR" log -1 --oneline

  # 版本盖章：仓库里的 VERSION 是空文件，Dockerfile 用它注入前端
  # VITE_REACT_APP_VERSION 和二进制 common.Version（即 /api/status 里显示在
  # 界面左上角的版本号）。格式为 ${BRANCH}-<commit 前 8 位>。不在构建前写入
  # 本次部署的 commit，版本号就会一直是旧的/空值。构建后立即还原空文件，并挂
  # EXIT trap 覆盖构建失败与 Ctrl-C，否则残留的本地改动会让下一次
  # git pull --ff-only 失败。
  local build_version
  build_version="${BRANCH}-$(git -C "$SRC_DIR" rev-parse HEAD | cut -c1-8)"
  printf '%s' "$build_version" > "$SRC_DIR/VERSION"
  trap 'git -C "$SRC_DIR" checkout -- VERSION >/dev/null 2>&1 || true' EXIT

  # N7: 必须显式指定受限 builder，否则会回到会打满宿主机 CPU 的默认 builder。
  # 只构建本次要启动的那个 service：两个 service 共用同一个 image
  # (new-api-zyy:latest)，全都构建会让 compose bake 各导出一份镜像；导出是最
  # 吃内存的阶段，2026-10-17 就是两轮导出 + 内存上限把 BuildKit 会话挤死导致
  # 部署失败（no active session）。
  compose build --builder "$BUILDX_BUILDER_NAME" --pull --progress=plain "$target"
  git -C "$SRC_DIR" checkout -- VERSION
  trap - EXIT
  log "镜像构建完成 (version=${build_version})"

  # N8: 清理过期构建缓存。放在构建之后、起备用实例之前：此时旧实例仍在服务，
  # 清理不影响线上；刚构建出的缓存层在保留期内不会被删，所以下次部署依然是
  # 热缓存。清理失败只告警，不会让本次部署失败。
  if [ "$PRUNE_BUILD_CACHE" = true ]; then
    prune_build_cache
  else
    log "N8: PRUNE_BUILD_CACHE=false，跳过构建缓存清理"
  fi
}

step_start_standby() {
  local standby="$1" container
  container="$(container_of "$standby")"
  log "③ 在备用端口启动新实例: $standby ($(port_of_svc "$standby"))"
  compose up -d "$standby"

  warn "W1: 等待新实例健康检查通过（最长 ${HEALTH_TIMEOUT}s，含数据库迁移）..."
  local i status
  for i in $(seq 1 $((HEALTH_TIMEOUT / 5))); do
    status="$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || echo missing)"
    if [ "$status" = "healthy" ]; then
      log "新实例已 healthy（用时约 $((i * 5))s）"
      return 0
    fi
    sleep 5
  done
  warn "N5: 新实例未通过健康检查，不切流，线上零影响。最近日志:"
  docker logs --tail 50 "$container" >&2 || true
  compose stop "$standby"
  die "新实例启动失败，已停止备用实例，请排查后重试"
}

step_switch_nginx() {
  local target_port="$1" mode="${2:-update}" nginx_file bak
  nginx_file="$(find_nginx_file)"
  log "④ 切换 Nginx 上游 → ${target_port}（配置: $nginx_file）"

  bak="${nginx_file}.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$nginx_file" "$bak"
  # 注意：sed 分隔符必须用 #，不能用 |（pattern 中的 | 是正则 alternation，会提前截断表达式）
  sed -i -E "s#(proxy_pass[[:space:]]+http://127\.0\.0\.1:)(${PORT_A}|${PORT_B})#\1${target_port}#" "$nginx_file"

  if ! nginx -t >/dev/null 2>&1; then
    cp "$bak" "$nginx_file"
    die "nginx -t 校验失败，已恢复原配置（备份: $bak），未执行 reload"
  fi
  nginx -s reload
  log "Nginx 已切换并 reload（存量连接不受影响，新请求走 ${target_port}）"
  if [ "$mode" = "update" ]; then
    warn "N3: 从现在到旧实例停止之间是快速回滚窗口，发现异常立即执行: $0 rollback"
  fi
}

step_drain_and_stop_old() {
  local old="$1" i
  warn "W2: 等待旧实例在途请求排空（${DRAIN_WAIT}s，SSE 流式请求；长任务请调大 DRAIN_WAIT）..."
  for i in $(seq "$DRAIN_WAIT" -5 1); do
    printf "\r\033[33m[WARN]\033[0m  剩余排空等待: %4ds " "$i"
    sleep 5
  done
  echo

  warn "W3: 停止旧实例 $old（应用优雅排空，最长约 120s，请勿中断）..."
  if [ "$old" = "$LEGACY_CONTAINER" ]; then
    # 遗留单容器不属于当前 compose，必须按容器名操作
    docker stop "$LEGACY_CONTAINER"
    docker rm "$LEGACY_CONTAINER"
    log "已停止并删除遗留单容器 $LEGACY_CONTAINER"
  else
    compose stop "$old"
    log "旧实例 $old 已停止（容器保留，快速回滚可用: $0 rollback）"
  fi
}

step_verify() {
  local new_port="$1"
  log "⑥ 验证"
  compose ps
  curl -fsS "http://127.0.0.1:${new_port}/api/status" >/dev/null \
    || die "新端口 ${new_port} 的 /api/status 不可用"
  log "新端口 ${new_port} 服务正常，零停机更新完成"
  warn "N4: 快速回滚窗口已结束（旧实例已停止）。如后续发现问题，按 zero-downtime-update.md 用备份标签回滚"
}

# ==================== 命令入口 ====================
cmd_update() {
  check_preconditions
  # N7: 在任何副作用（数据库备份、git pull、构建）之前先确认构建资源限制可用
  ensure_build_limits
  ensure_build_headroom
  # N8: 缓存清理的配置也在这里提前校验，避免构建完才发现保留期格式不合法
  validate_build_cache_config

  local active_port active_svc running old standby standby_port
  active_port="$(active_port)"
  active_svc="$(svc_of_port "$active_port")"
  running="$(running_instance)"

  # 一致性检查：运行中的实例必须与 Nginx 指向匹配
  if [ "$running" = "$LEGACY_CONTAINER" ]; then
    [ "$active_port" = "$PORT_A" ] \
      || die "状态不一致: 遗留容器在运行（占用 3000），但 Nginx 指向 ${active_port}。请人工检查。"
    old="$LEGACY_CONTAINER"
  else
    [ "$running" = "$active_svc" ] \
      || die "状态不一致: 运行中的实例是 $running，但 Nginx 指向 $active_svc。请人工检查。"
    old="$active_svc"
  fi

  if [ "$old" = "$SVC_A" ]; then standby="$SVC_B"; else standby="$SVC_A"; fi
  standby_port="$(port_of_svc "$standby")"

  log "更新计划: 活跃 ${active_port}(${old}) → 备用 ${standby_port}(${standby})"

  step_backup
  step_pull_and_build "$standby"
  step_start_standby "$standby"
  step_switch_nginx "$standby_port" update
  step_drain_and_stop_old "$old"
  step_verify "$standby_port"
}

cmd_rollback() {
  check_preconditions

  local cur_port other_port other_svc other_container
  cur_port="$(active_port)"
  if [ "$cur_port" = "$PORT_A" ]; then other_port="$PORT_B"; other_svc="$SVC_B"; else other_port="$PORT_A"; other_svc="$SVC_A"; fi
  other_container="$(container_of "$other_svc")"

  # 旧实例必须存在（运行中或已停止未删除）
  if ! docker inspect "$other_container" >/dev/null 2>&1; then
    die "旧实例 $other_svc 不存在，快速回滚不可用。请按 zero-downtime-update.md 用备份标签在备用端口启动旧版本后手动切 Nginx。"
  fi

  # 方向校验：目标实例必须比当前活跃实例更旧，防止在未切流状态下误执行
  local cur_container cur_ts other_ts running
  running="$(running_instance)"
  if [ "$running" = "$LEGACY_CONTAINER" ]; then
    cur_container="$LEGACY_CONTAINER"
  else
    cur_container="$(container_of "$(svc_of_port "$cur_port")")"
  fi
  cur_ts="$(docker inspect --format '{{.Created}}' "$cur_container")"
  other_ts="$(docker inspect --format '{{.Created}}' "$other_container")"
  if [[ "$other_ts" > "$cur_ts" ]]; then
    die "方向检查: 目标实例 $other_svc 比当前活跃实例更新，rollback 会切向新版本。当前可能尚未切流，无需回滚。"
  fi

  log "回滚: Nginx ${cur_port} → ${other_port}（旧实例: $other_svc）"
  step_switch_nginx "$other_port" rollback

  if ! is_running "$other_container"; then
    log "旧实例处于停止状态，重新启动（仍为旧镜像）..."
    compose start "$other_svc"
  fi

  curl -fsS "http://127.0.0.1:${other_port}/api/status" >/dev/null \
    || die "回滚后端口 ${other_port} 不可用，请人工检查"
  log "回滚完成，流量已切回 ${other_port}"
  warn "新版本实例仍在 ${cur_port} 运行，确认稳定后可手动停止: docker compose -f $COMPOSE_FILE stop $(svc_of_port "$cur_port")"
}

cmd_check() { # 预检：只读校验，不改动线上任何东西
  check_preconditions
  ensure_build_limits
  ensure_build_headroom
  validate_build_cache_config

  local port
  port="$(active_port)"
  log "预检通过: 活跃端口 ${port}，运行实例 $(running_instance)，构建 builder ${BUILDX_BUILDER_NAME}"
}

cmd_prune() { # N8: 定时兜底用的独立入口；只清构建缓存，不依赖线上实例/Nginx/MySQL
  log "N8 清理构建缓存（保留 ${BUILD_CACHE_KEEP} 内用过的）"
  prune_build_cache true
}

case "${1:-update}" in
  update)   cmd_update ;;
  rollback) cmd_rollback ;;
  check)    cmd_check ;;
  prune)    cmd_prune ;;
  *)        die "未知命令: $1（可用: update | rollback | check | prune）" ;;
esac
