#!/usr/bin/env bash
#
# blue-green-switch.sh — New API 蓝绿零停机更新脚本
#
# 用法:
#   sudo ./blue-green-switch.sh update      # 完整零停机更新（默认）
#   sudo ./blue-green-switch.sh rollback    # 快速回滚：Nginx 切回旧实例（旧实例未被删除时有效）
#
# 前置条件:
#   1. /opt/new-api-deploy/compose.yaml 为双实例配置（new-api-a:3000 / new-api-b:3001）
#   2. Nginx 配置中有且仅有一处 proxy_pass 指向 127.0.0.1:3000 或 127.0.0.1:3001
#   3. compose 中 stop_grace_period(130s) > 应用 SHUTDOWN_TIMEOUT_SECONDS(默认120s)
#   4. 3000/3001 均未对公网开放
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

step_pull_and_build() {
  log "② 拉取 ${BRANCH} 分支并构建镜像"
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

  compose build --pull --progress=plain
  git -C "$SRC_DIR" checkout -- VERSION
  trap - EXIT
  log "镜像构建完成 (version=${build_version})"
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
  step_pull_and_build
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

case "${1:-update}" in
  update)   cmd_update ;;
  rollback) cmd_rollback ;;
  *)        die "未知命令: $1（可用: update | rollback）" ;;
esac
