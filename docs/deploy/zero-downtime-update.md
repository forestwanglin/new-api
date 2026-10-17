# 零停机更新（蓝绿切换）

线上已有用户在使用大模型转发服务（尤其是 SSE 流式请求可能持续数分钟）时，[deploy-zyy-branch.md](deploy-zyy-branch.md) 第十步"停旧容器 → 起新容器"的方式会产生中断。本文描述基于蓝绿切换的零停机更新流程。

## 原理

以下事实已对照源码核实，使零停机更新可行：

| 事实 | 依据 |
| --- | --- |
| 应用支持 `--port` 参数，两个实例可同时监听不同端口 | `common/init.go`（`flag.Int("port", 3000, ...)`） |
| 收到 SIGTERM 后应用会优雅等待在途请求（含 SSE 流）完成再退出，默认 120 秒，可用 `SHUTDOWN_TIMEOUT_SECONDS` 调整 | `main.go` |
| Nginx `reload` 是平滑切换：存量连接继续由旧上游处理，只有新请求走新上游 | Nginx 行为 |
| 应用支持多实例部署（共享 MySQL/Redis，`NODE_NAME` 区分实例）；同一 `SESSION_SECRET` 下切换后用户会话保持 | 官方 Compose 的 `NODE_NAME` 说明 |

流程概览：

```
Nginx ──► 3000（旧实例，旧镜像）
   │
   │ ① 构建新镜像
   │ ② 在 3001 启动新实例（新镜像），等待健康检查通过
   │ ③ Nginx 上游改为 3001 并 reload（新请求走新实例，存量请求不受影响）
   │ ④ 等待旧实例在途请求排空
   │ ⑤ 停止旧实例
   ▼
Nginx ──► 3001（新实例，新镜像）
```

下一次更新反向进行（新实例起在 3000，切回 3000，停 3001），两个实例交替承担"活跃/备用"角色。

## 前提

- Nginx 反向代理已配置（域名 → `127.0.0.1:3000`），见 deploy-zyy-branch.md 的注意事项。
- 3001 端口与 3000 一样只在宿主机监听，不要对公网开放（UFW 默认拒绝入站即可满足）。

## 脚本化执行（推荐）

"备份 → 构建 → 起备用 → 切流 → 排空 → 停旧"的完整流程已脚本化为 [blue-green-switch.sh](blue-green-switch.sh)（放到服务器的 `/opt/new-api-deploy/` 下）：

```bash
sudo /opt/new-api-deploy/blue-green-switch.sh update     # 零停机更新
sudo /opt/new-api-deploy/blue-green-switch.sh rollback    # 快速回滚（旧实例未被删除前有效）
sudo /opt/new-api-deploy/blue-green-switch.sh check       # 只做预检（含构建配额校验），不改动线上
```

脚本会自动探测当前活跃实例（解析 Nginx `proxy_pass` 指向的端口）、做状态一致性检查，并在以下情况安全中止（线上零影响）：新实例启动失败、Nginx 配置探测到 0 处或多处、运行实例与 Nginx 指向不匹配、rollback 方向错误。

**等待点**（脚本会暂停等待，属正常现象，请勿中断）：

| 编号 | 等待内容 | 默认时长 |
| --- | --- | --- |
| W1 | 新实例健康检查通过（含数据库迁移） | 最长 300s（`HEALTH_TIMEOUT`） |
| W2 | 旧实例在途请求排空（SSE 流式请求） | 300s（`DRAIN_WAIT`，长任务调大） |
| W3 | 停止旧实例时应用优雅排空 | 最长约 120s（`SHUTDOWN_TIMEOUT_SECONDS`） |

**注意点**：

| 编号 | 内容 |
| --- | --- |
| N1 | 运行前确认本次更新的数据库迁移向后兼容（旧实例在切流前仍在服务） |
| N2 | Nginx 配置自动探测失败（0 处/多处 proxy_pass）时脚本中止，需人工处理 |
| N3 | 切流后、停旧实例前是快速回滚窗口，发现异常立即执行 `rollback` |
| N4 | 停旧实例后快速回滚失效，需按备份标签流程回滚 |
| N5 | 新实例启动失败时脚本不会切流，线上零影响 |
| N6 | 版本盖章：构建前把 `VERSION` 写成 `<branch>-<commit 前 8 位>`（界面版本号来源），构建后还原；手工 `compose build` 不会盖章 |
| N7 | 构建必须有 CPU/内存配额：配额由 `setup-build-builder.sh` 写入 `build-limits.env`；`update` 只校验不修改，配额缺失或超过总资源时直接中止 |

### 构建资源限制（N7，必须）

生产机只有 4 vCPU，而 new-api 自带 CPU 保护（`middleware/performance.go`，默认阈值 90%）：宿主机 CPU 超过阈值时，relay 请求会被直接拒绝并返回 `503 system_cpu_overloaded`。2026-10-17 的线上 503 就是部署时 `compose build`（bun/vite 前端构建 + Go 编译）把宿主机 CPU 打到 99%，而当时旧实例仍在服务、用户请求正好打在旧实例上造成的。

因此构建必须跑在带 cgroup CPU 配额的独立 builder 里 —— 配额由内核强制，构建过程无法绕过：

```bash
# 一次性初始化（约 1 分钟，含拉取 moby/buildkit 镜像）
sudo /opt/new-api-deploy/setup-build-builder.sh
# 预检：确认活跃实例、Nginx 探测与构建配额都正常
sudo /opt/new-api-deploy/blue-green-switch.sh check
```

`blue-green-switch.sh update` 每次会校验并校正配额；builder 不存在时**直接中止**，不会退回无限制构建。`rollback` 不构建，不受该检查影响。

实测数据（同一满载构建任务，观察构建期宿主机 CPU 占用）：

| 构建方式 | 构建期宿主机 CPU |
| --- | --- |
| 默认 builder（docker driver） | 3.9 核 / 4（约 98%） |
| 默认 builder + `--cgroup-parent=<slice>` | 3.9 核 / 4（无效：构建步由 containerd 创建，不继承该父 cgroup） |
| 受限 builder + `--cpus=1` | 1.0 核 / 4（26%） |
| 受限 builder + `--cpus=2`（默认） | 2.0 核 / 4（50%） |

代价与注意：

- **构建时间约翻倍**：2 核配额下原先约 2.5 分钟的构建约变 5 分钟。想调大配额（会先打印服务器总核数/总内存再校验）：
  ```bash
  sudo /opt/new-api-deploy/setup-build-builder.sh --cpus 3 --mem 3g
  ```
  `--cpus` 不得超过服务器总核数（大于等于总核数等于不限制构建），`--mem` 不得达到总内存，两者都会被拒绝。
- **配额来源（单一事实来源）**：`setup-build-builder.sh` 是唯一写入配额的地方，并把选择记录到 `/opt/new-api-deploy/build-limits.env`；`blue-green-switch.sh` 启动时 source 它，**只校验不修改**（builder 必须存在、必须已有配额且不超过总核数/总内存，否则直接中止）。优先级为 **显式环境变量 > `build-limits.env` > 脚本内置默认**，因此临时覆盖一次部署只需 `BUILD_CPUS=2 sudo .../blue-green-switch.sh check`，不会写回文件。副作用：builder 容器被重建导致配额丢失时，部署会中止并提示重跑 `setup-build-builder.sh`（不再自动写回默认值）。
- **首次构建是冷缓存**：docker-container driver 与默认 builder 的层缓存不共享，第一次会全量构建（明显更慢），之后缓存在 builder 容器里。
- 构建内存同样受限（默认 2g），避免构建期内存冲高（实测曾从 33% 冲到 60%）把机器压进 swap。
- 配额存放在 builder 容器的 HostConfig 中，容器重启、宿主机重启后依然有效；只有 `docker buildx rm` 重建 builder 才会丢失，此时重跑 `setup-build-builder.sh` 即可。

下面的手动流程用于理解原理，以及脚本中止时的人工处理参考。

## 第一步：改造 Compose 配置

用下面的双实例配置替换 `/opt/new-api-deploy/compose.yaml`。两个实例共用同一镜像、同一份 `.env`、同一组数据卷，仅端口、容器名和 `NODE_NAME` 不同：

```yaml
services:
  new-api-a:
    build:
      context: /opt/new-api-src
      dockerfile: Dockerfile

    image: new-api-zyy:latest
    container_name: new-api-zyy-a
    restart: unless-stopped

    # 直接使用宿主机网络，访问宿主机上的 MySQL 和 Redis
    network_mode: host

    command: ["--port", "3000", "--log-dir", "/app/logs"]

    env_file:
      - /opt/new-api-deploy/.env

    environment:
      # 覆盖 .env 中的 NODE_NAME，便于审计日志区分实例
      - NODE_NAME=new-api-zyy-a

    volumes:
      - /opt/new-api-data:/data
      - /opt/new-api-logs:/app/logs

    # 必须大于 SHUTDOWN_TIMEOUT_SECONDS（默认 120s），
    # 否则 Docker 会在应用排空在途请求前 SIGKILL
    stop_grace_period: 130s

    healthcheck:
      test: ["CMD-SHELL", "wget -q -O - http://127.0.0.1:3000/api/status | grep -o '\"success\":\\s*true' || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3

  new-api-b:
    build:
      context: /opt/new-api-src
      dockerfile: Dockerfile

    image: new-api-zyy:latest
    container_name: new-api-zyy-b
    restart: unless-stopped

    network_mode: host

    command: ["--port", "3001", "--log-dir", "/app/logs"]

    env_file:
      - /opt/new-api-deploy/.env

    environment:
      - NODE_NAME=new-api-zyy-b

    volumes:
      - /opt/new-api-data:/data
      - /opt/new-api-logs:/app/logs

    stop_grace_period: 130s

    healthcheck:
      test: ["CMD-SHELL", "wget -q -O - http://127.0.0.1:3001/api/status | grep -o '\"success\":\\s*true' || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
```

关键点：

| 配置 | 作用 |
| --- | --- |
| `--port 3000` / `--port 3001` | 两个实例监听不同端口，Nginx 决定流量走向 |
| `stop_grace_period: 130s` | Docker 默认只给 10 秒就 SIGKILL，会切断正在进行的 SSE 流；必须放宽到大于应用的排空超时 |
| `NODE_NAME` 按实例覆盖 | 审计日志能区分请求来自哪个实例 |
| 各自独立的 `healthcheck` | 分别检查 3000 / 3001 |

验证配置：

```bash
cd /opt/new-api-deploy
docker compose config --quiet
```

## 第二步：一次性迁移（从单容器切换到双实例）

如果当前运行的是 deploy-zyy-branch.md 里的单容器 `new-api-zyy`，需要一次性迁移（仅此一次有短暂中断）：

```bash
cd /opt/new-api-deploy

# 停掉并删除旧单容器
docker stop new-api-zyy
docker rm new-api-zyy

# 用当前镜像启动 A 实例（3000），B 保持停止
docker compose up -d new-api-a

# 确认 3000 恢复服务
curl -i http://127.0.0.1:3000/api/status
```

迁移完成后，日常状态是"只有一个实例在运行"，备用实例不占内存。

## 第三步：零停机更新流程

以下以"A（3000）活跃、B（3001）备用"为例，下一次更新角色对调。

### ① 备份（与 deploy-zyy-branch.md 第十步相同）

```bash
mysqldump --single-transaction --routines --triggers new_api \
  | gzip > "/opt/new-api-backups/new_api_$(date +%F_%H%M%S).sql.gz"

BACKUP_TAG="new-api-zyy:backup-$(date +%Y%m%d-%H%M%S)"
docker image tag new-api-zyy:latest "$BACKUP_TAG"
echo "当前镜像备份标签：$BACKUP_TAG"
```

### ② 拉取代码并构建新镜像

```bash
cd /opt/new-api-src
git fetch origin zyy
git pull --ff-only origin zyy
git log -1 --oneline

# 版本盖章：仓库里的 VERSION 是空文件，Dockerfile 用它注入前端
# VITE_REACT_APP_VERSION 和二进制 common.Version（即界面左上角版本号）。
# 不写它，部署多少次版本号都不会变。构建后必须还原，否则下次
# git pull --ff-only 会因本地改动失败。
VERSION_TAG="zyy-$(git rev-parse HEAD | cut -c1-8)"
printf '%s' "$VERSION_TAG" > VERSION

cd /opt/new-api-deploy
docker compose build --pull --progress=plain

cd /opt/new-api-src
git checkout -- VERSION   # 还原空文件
```

构建完成后 `new-api-zyy:latest` 指向新镜像；正在运行的 A 实例仍使用旧镜像（容器在创建时固定镜像），不受影响。可用 `curl -s http://127.0.0.1:3001/api/status | grep -o '"version":"[^"]*"'` 确认版本号已随本次 commit 变化。

> `blue-green-switch.sh update` 已内置同样的盖章与还原逻辑，走脚本更新时无需手工执行。

### ③ 在备用端口启动新实例

```bash
docker compose up -d new-api-b
```

等待 B 健康（首次启动包含数据库迁移，可能需要 1–2 分钟）：

```bash
timeout 300 bash -c \
  'until [ "$(docker inspect --format {{.State.Health.Status}} new-api-zyy-b)" = "healthy" ]; do sleep 5; done' \
  && echo "B is healthy"

curl -i http://127.0.0.1:3001/api/status
```

> 如果 B 启动失败或一直不健康：不要动 Nginx，直接 `docker compose stop new-api-b`，线上服务完全不受影响。这是蓝绿方案最大的安全垫。

### ④ 切换 Nginx 上游

修改 Nginx 站点配置（Ubuntu 默认在 `/etc/nginx/sites-available/`，按实际布局调整），把 `proxy_pass` 从 3000 改为 3001：

```nginx
location / {
    proxy_pass http://127.0.0.1:3001;
    # 其余 proxy_header / SSE 相关配置保持不变
}
```

校验并平滑 reload：

```bash
nginx -t && nginx -s reload
```

reload 后：新请求走 B（新版本）；已经建立的 SSE 流继续由 A 处理，不会被切断。

### ⑤ 等待旧实例排空，然后停止

应用没有公开的"在途请求数"接口，用固定等待 + 应用自身排空兜底：

```bash
# 等待在途流式请求结束（按业务调整；普通对话 5 分钟通常足够）
sleep 300

# 停止旧实例：Docker 发 SIGTERM，应用最多再排空 SHUTDOWN_TIMEOUT_SECONDS（默认 120s）
docker compose stop new-api-a
```

两层保护叠加：切换后 5 分钟的自然排空 + 停止时最多 120 秒的优雅排空。如果业务存在更长的流式任务（如长视频生成转发），相应调大等待时间，并在 `.env` 中调大 `SHUTDOWN_TIMEOUT_SECONDS`（同时保持 `stop_grace_period` 大于它）。

### ⑥ 验证

```bash
docker compose ps
curl -i http://127.0.0.1:3001/api/status
docker compose logs --tail=100 new-api-b
```

确认无误后，本次更新完成。B（3001）成为新的活跃实例，下次更新在 A（3000）上启动新版本并切回。

## 回滚

- **快速回滚（推荐）**：在旧实例停止前执行 `sudo /opt/new-api-deploy/blue-green-switch.sh rollback`，脚本会把 Nginx 切回旧端口并在必要时重启旧实例（仍为旧镜像）。
- **切换后、停止旧实例前**（约 5–7 分钟窗口内）：把 Nginx 上游改回旧端口并 `nginx -s reload` 即可，旧实例还在运行，秒级回滚。
- **停止旧实例后**：按 deploy-zyy-branch.md 第十步的镜像回滚流程，用备份标签在备用端口启动旧版本，再切 Nginx。
- **数据库**：更新前已做 mysqldump 备份。注意新版本启动时（切流量之前）已执行过迁移，若回滚后旧版本与新表结构不兼容，需要恢复数据库备份——这正是每次更新前必须备份的原因。

## 风险与注意事项

1. **数据库迁移的向后兼容性。** 新实例在切换流量之前就会执行数据库迁移，此时旧实例仍在服务。要求旧版本能容忍新表结构。GORM 自动迁移大多是增量式（加列/加表），通常兼容；但上游大版本更新前，应检查 release notes 和迁移相关改动，确认没有破坏性变更（删列/改类型）。
2. **双实例短暂并存是应用支持的模式。** 应用支持多实例部署（`NODE_NAME`、会话限制等机制），后台任务有分布式协调；但更新窗口外不要长期双跑，备用实例用完即停，节省内存。
3. **3001 不要暴露公网。** host 网络模式下 3001 同样监听在宿主机，保持 UFW 默认拒绝入站。
4. **更新前仍须备份。** 蓝绿只解决"服务不中断"，不解决"新版本有 bug"或"迁移不兼容"，备份与回滚流程不变。
5. **`stop_grace_period` 与 `SHUTDOWN_TIMEOUT_SECONDS` 的约束关系**：前者必须大于后者，否则优雅排空会被 SIGKILL 打断。
