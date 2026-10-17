# 部署 zyy 分支到服务器（Docker Compose 自建镜像）

目标：把 fork 仓库中 `zyy` 分支的代码部署到服务器，使用 Docker Compose 管理，并继续复用服务器上已安装的 MySQL、Redis 和 Nginx。

## 部署结构

```
GitHub：fork 仓库的 zyy 分支
  拉取源代码 → Dockerfile 构建自定义镜像

Docker Compose：new-api-zyy
  容器名称固定、数据持久化、开机自动启动

MySQL   → 现有宿主机服务
Redis   → 现有宿主机服务
Nginx   → HTTP/HTTPS 反向代理
```

官方源码包含 `Dockerfile`，可以在服务器上构建前端和 Go 后端；官方 Compose 示例（`docker-compose.yml`）则默认使用预构建镜像 `calciumion/new-api:latest`。因此单独编写部署用的 Compose 文件，让容器运行自己的分支，而不是直接运行官方 `latest` 镜像。

## 方案核对结论

以下关键点已对照仓库源码核实，方案可行：

| 核对项 | 结论 |
| --- | --- |
| `Dockerfile` | 存在，多阶段构建：bun 构建前端 → Go 编译后端 → debian 运行时 |
| 健康检查路径 | `/api/status`，与官方 Compose 的 healthcheck 一致 |
| 环境变量 | `SQL_DSN`、`REDIS_CONN_STRING`、`SESSION_SECRET`、`CRYPTO_SECRET`、`NODE_NAME`、`TZ` 均被代码读取 |
| 启动参数 | `--log-dir` 为官方支持的命令行参数（见 `common/init.go`） |
| 数据目录 | 镜像 `WORKDIR` 为 `/data`，官方 Compose 同样挂载 `/data` 与 `/app/logs` |
| 网络模式 | `network_mode: host` 下容器经 `127.0.0.1` 访问宿主机 MySQL/Redis，与 MySQL 账户 `'newapi'@'127.0.0.1'` 匹配 |

下面按步骤执行，命令默认都在服务器上运行。文中 `<服务器IP>` 请替换为实际地址。

## 第一步：检查 Docker 环境

先 SSH 登录：

```bash
ssh <服务器IP>
```

检查 Docker、Compose、Git 是否已安装：

```bash
docker --version
docker compose version
git --version
```

如果 Docker 和 Compose 都能正常显示版本，跳到第二步。

如果没有安装 Docker，执行以下安装流程（使用 Docker 官方 APT 软件源，适用于 Ubuntu/Debian）：

```bash
apt update
apt install -y ca-certificates curl git

install -m 0755 -d /etc/apt/keyrings

curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc

chmod a+r /etc/apt/keyrings/docker.asc

cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt update

apt install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

systemctl enable --now docker
```

检查：

```bash
docker --version
docker compose version
systemctl is-active docker
```

最后一条应返回 `active`。

> 注意：如果服务器已经装有 Docker，但运行的是 Ubuntu 自带的 `docker.io`，不要不加检查就重复安装或卸载 Docker 软件包，以免影响已有容器。

## 第二步：拉取 zyy 分支

将下面命令里的 `<你的GitHub用户名>` 替换为自己的 GitHub 用户名：

```bash
mkdir -p /opt

git clone \
  --branch zyy \
  --single-branch \
  https://github.com/<你的GitHub用户名>/new-api.git \
  /opt/new-api-src
```

这里假设 fork 仓库名称仍然叫 `new-api`。

如果仓库是私有仓库，需要先配置 GitHub SSH 密钥或其他安全的 Git 认证方式；不要把 Personal Access Token 直接写进克隆地址。

进入源码目录：

```bash
cd /opt/new-api-src
```

确认当前确实使用 zyy 分支：

```bash
git branch --show-current
git log -1 --oneline
git remote -v
```

第一条命令应该输出：

```
zyy
```

再检查源码构建文件：

```bash
test -f Dockerfile && echo "Dockerfile exists"
test -f go.mod && echo "go.mod exists"
test -f web/package.json && echo "Frontend exists"
```

这几项都正常后再继续。后续 Docker 构建的代码来源就是这里的 zyy 分支。

## 第三步：为 New API 创建独立的 MySQL 数据库

之前创建的高权限账户（`%` 通配 host）不建议应用程序直接使用。单独创建 `newapi` 账户，只授权访问 New API 自己的数据库。

先生成一个数据库密码：

```bash
openssl rand -hex 24
```

复制输出的 48 位十六进制字符串，后面称为 `MYSQL_PASSWORD`。请保存好，后续要重复使用。

进入 MySQL：

```bash
sudo mysql
```

执行以下 SQL，将两处 `替换为MYSQL_PASSWORD` 改成刚刚生成的实际密码：

```sql
CREATE DATABASE IF NOT EXISTS new_api
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'newapi'@'127.0.0.1'
  IDENTIFIED BY '替换为MYSQL_PASSWORD';

GRANT ALL PRIVILEGES ON new_api.*
  TO 'newapi'@'127.0.0.1';

SHOW GRANTS FOR 'newapi'@'127.0.0.1';
```

退出：

```sql
exit;
```

测试新账户：

```bash
mysql -h 127.0.0.1 -u newapi -p new_api -e "SELECT 1;"
```

输入刚才设置的密码。如果输出中出现 `1`，则说明数据库账户可以正常访问。

> 排错：如果测试报 `Access denied`，通常是 MySQL 名称解析导致连接被匹配到其他 host 条目，可再创建并授权 `'newapi'@'localhost'` 后重试。

## 第四步：确认 Redis 密码

之前已经为服务器上的 Redis 设置过 `requirepass`，这里继续使用该密码即可，不用另建 Redis 服务。

先确认 Redis 正常运行：

```bash
systemctl is-active redis-server
```

测试 Redis 密码：

```bash
redis-cli --askpass ping
```

输入当前 Redis 密码。预期输出：

```
PONG
```

本次 Compose 使用 `network_mode: host`，让应用容器直接通过 `127.0.0.1` 连接宿主机的 MySQL 和 Redis。因此，不需要为了 Docker 容器而把 Redis 改成监听公网地址，也不需要发布数据库端口给容器使用。

## 第五步：创建独立的部署目录

为了避免更新 GitHub 源码时覆盖配置文件或误删数据，把源码、部署配置、数据和日志分开放。

在服务器执行：

```bash
mkdir -p /opt/new-api-deploy
mkdir -p /opt/new-api-data
mkdir -p /opt/new-api-logs
mkdir -p /opt/new-api-backups

cd /opt/new-api-deploy
```

再生成两个应用密钥：

```bash
openssl rand -hex 32
openssl rand -hex 32
```

保存这两个输出，分别用作 `SESSION_SECRET` 和 `CRYPTO_SECRET`。即使现在只有一个实例，也建议固定保存密钥，避免每次部署都生成新值而导致会话或缓存加密相关行为变化。

### 创建环境变量文件

执行：

```bash
nano /opt/new-api-deploy/.env
```

写入以下内容，并替换其中的密码和密钥：

```dotenv
SQL_DSN=newapi:MYSQL_PASSWORD@tcp(127.0.0.1:3306)/new_api?charset=utf8mb4&parseTime=True&loc=Local

REDIS_CONN_STRING=redis://:REDIS_PASSWORD@127.0.0.1:6379/0

TZ=Asia/Shanghai
NODE_NAME=new-api-zyy

SESSION_SECRET=替换为第一个生成的64位十六进制密钥
CRYPTO_SECRET=替换为第二个生成的64位十六进制密钥
```

这里的 `MYSQL_PASSWORD`、`REDIS_PASSWORD` 都要替换成实际密码，而不是保留占位符。生成密钥时建议采用十六进制格式，避免密码中的特殊字符影响连接字符串解析。

保存后限制文件权限：

```bash
chmod 600 /opt/new-api-deploy/.env
```

## 第六步：创建 Docker Compose 配置

执行：

```bash
nano /opt/new-api-deploy/compose.yaml
```

将以下配置完整写入：

```yaml
services:
  new-api:
    build:
      context: /opt/new-api-src
      dockerfile: Dockerfile

    image: new-api-zyy:latest
    container_name: new-api-zyy
    restart: unless-stopped

    # 直接使用宿主机网络，访问宿主机上的 MySQL 和 Redis
    network_mode: host

    command: ["--log-dir", "/app/logs"]

    env_file:
      - /opt/new-api-deploy/.env

    volumes:
      - /opt/new-api-data:/data
      - /opt/new-api-logs:/app/logs

    # 与官方 Compose 一致的健康检查（运行时镜像已包含 wget）
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O - http://127.0.0.1:3000/api/status | grep -o '\"success\":\\s*true' || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
```

这份配置的几个关键点：

| 配置 | 作用 |
| --- | --- |
| `build.context` | 从自己的 zyy 分支源码构建 |
| `image` | 给自定义镜像命名，不使用官方预构建镜像 |
| `container_name` | 固定容器名称为 `new-api-zyy` |
| `restart` | 服务器重启后自动尝试启动容器（如需手动停止后仍自动拉起，可改为 `always`） |
| `network_mode: host` | 容器可以通过 `127.0.0.1` 访问宿主机的 MySQL、Redis |
| `/opt/new-api-data` | 持久化应用数据 |
| `/opt/new-api-logs` | 持久化应用日志 |
| `healthcheck` | 基于 `/api/status` 的健康检查，`docker compose ps` 可直接看到健康状态 |

> 注意：使用 host 网络模式后，不要再添加 `ports` 映射，因为容器和宿主机共用网络。应用的 3000 端口会在宿主机上监听，后续通过 Nginx 代理访问；不要为了调试而将 3000 端口直接开放给公网。

## 第七步：构建自己的镜像

进入部署目录：

```bash
cd /opt/new-api-deploy
```

先验证配置格式：

```bash
docker compose config --quiet
```

没有错误输出时，开始构建：

```bash
# 版本盖章：仓库里的 VERSION 是空文件，Dockerfile 用它注入前端
# VITE_REACT_APP_VERSION 和二进制 common.Version（即界面左上角的版本号）。
# 不写它，部署多少次版本号都不会变；构建后必须还原，否则下次
# git pull --ff-only 会因本地改动失败。
cd /opt/new-api-src
VERSION_TAG="$(git describe --tags --match 'v[0-9]*' --always 2>/dev/null || git rev-parse --short HEAD)"
printf '%s' "$VERSION_TAG" > VERSION

cd /opt/new-api-deploy
docker compose build --pull --progress=plain new-api

cd /opt/new-api-src
git checkout -- VERSION   # 还原空文件
```

> `blue-green-switch.sh update` 已内置同样的盖章与还原逻辑，走脚本更新时无需手工执行。构建后可用 `curl -s http://127.0.0.1:3000/api/status | grep -o '"version":"[^"]*"'` 确认版本号已随本次 commit 变化。

这个步骤会使用 `/opt/new-api-src` 中的 Dockerfile 和源码构建镜像。官方 Dockerfile 采用多阶段构建，包含前端构建和 Go 后端编译。

首次构建会依次执行前端依赖安装、前端打包和 Go 编译，对磁盘和内存要求较高（建议磁盘剩余 10GB 以上、内存 2GB 以上；小内存 VPS 上构建可能较慢，必要时可临时增加 swap）。构建期间如果失败，先保留终端完整报错，不要急着切换回官方镜像，否则就无法验证自己的分支。

构建成功后检查镜像：

```bash
docker images new-api-zyy
```

应该能看到 `new-api-zyy:latest`。

## 第八步：启动 New API

执行：

```bash
cd /opt/new-api-deploy

docker compose up -d
```

检查容器状态：

```bash
docker compose ps
```

查看启动日志：

```bash
docker compose logs --tail=100 new-api
```

如果需要实时观察日志：

```bash
docker compose logs -f new-api
```

看到应用成功启动后，可按 `Ctrl + C` 退出日志查看。这个操作不会停止后台容器。

检查服务接口：

```bash
curl -i http://127.0.0.1:3000/api/status
```

官方 Compose 配置也使用 `/api/status` 作为健康检查路径。

如果接口返回成功响应，就继续下一步。如果启动失败，优先检查日志中是否有以下问题：

- MySQL 登录失败：检查 `SQL_DSN` 的用户名、密码和数据库名。
- Redis 认证失败：检查 `REDIS_CONN_STRING` 里的 Redis 密码。
- 端口占用：检查宿主机的 3000 端口是否已经被其他程序使用。
- 数据库迁移失败：检查 `newapi` 账户是否拥有 `new_api` 数据库的权限。

端口检查命令：

```bash
ss -lntp | grep ':3000'
```

## 第九步：从本机安全访问首次初始化页面

因为还没有为服务器配置域名和 HTTPS 证书，建议先使用 SSH 隧道进行首次初始化，而不是通过公网 HTTP 提交管理员密码。

在本地机器（如 Mac）的另一个终端窗口执行：

```bash
ssh -L 13000:127.0.0.1:3000 <服务器IP>
```

如果已在 `~/.ssh/config` 中配置了 SSH 快捷名称，也可以直接使用别名：

```bash
ssh -L 13000:127.0.0.1:3000 <ssh别名>
```

保持该 SSH 连接窗口打开，然后在浏览器中访问：

```
http://127.0.0.1:13000
```

这时浏览器访问的是服务器上的 New API，而不是将应用的 3000 端口直接暴露到互联网。

按照初始化页面设置管理员账户和密码。完成后，再为实际使用的域名配置 Nginx 反向代理和 HTTPS。

## 第十步：后续更新 zyy 分支

以后在 GitHub 的 zyy 分支提交新代码后（包括按 [sync-upstream.md](sync-upstream.md) 同步 upstream 产生的 merge commit），按照这个流程更新部署。

> 如果线上已有较多用户在使用转发服务、不能接受中断，请改用 [zero-downtime-update.md](zero-downtime-update.md) 的蓝绿切换流程（本流程作为其简化版，适用于无用户或可接受短暂中断的场景）。

先备份数据库，并备份当前镜像：

```bash
mkdir -p /opt/new-api-backups

mysqldump --single-transaction --routines --triggers new_api \
  | gzip > "/opt/new-api-backups/new_api_$(date +%F_%H%M%S).sql.gz"

BACKUP_TAG="new-api-zyy:backup-$(date +%Y%m%d-%H%M%S)"

docker image tag new-api-zyy:latest "$BACKUP_TAG"

echo "当前镜像备份标签：$BACKUP_TAG"
```

然后拉取分支代码：

```bash
cd /opt/new-api-src

git fetch origin zyy
git pull --ff-only origin zyy

git log -1 --oneline
```

重新构建并更新容器：

```bash
cd /opt/new-api-deploy

docker compose build --pull --progress=plain new-api
docker compose up -d --force-recreate new-api
```

检查：

```bash
docker compose ps
docker compose logs --tail=100 new-api

curl -i http://127.0.0.1:3000/api/status
```

如果新版本出现问题，可以将 `BACKUP_TAG` 替换为先前输出的真实备份标签，再恢复旧镜像：

```bash
docker image tag new-api-zyy:backup-实际时间标签 new-api-zyy:latest

cd /opt/new-api-deploy
docker compose up -d --force-recreate new-api
```

> 注意：如果新版本已经执行过数据库结构迁移，单独回滚镜像不一定够，还需要评估并在必要时恢复对应的数据库备份。

## 部署完成后的注意事项

1. **MySQL 的公网访问权限。** 如果 3306 端口已对外开放，且存在高权限账户，建议将 UFW 的 3306 规则收紧为只允许本机公网 IP 访问，或改用 SSH 隧道管理 MySQL。
2. **Nginx 和 HTTPS。** 上述步骤完成后，New API 已在宿主机的 3000 端口运行，但尚未完成域名反向代理和 HTTPS 配置。不要把管理员登录、API 密钥等敏感信息长期通过公网明文 HTTP 传输。
3. **反向代理后的客户端 IP。** Nginx 反向代理后，应用看到的来源 IP 都是 `127.0.0.1`。应用默认信任回环地址并解析 `X-Forwarded-For`（会打印告警日志），如需消除告警并显式声明，可在 `.env` 中设置 `TRUSTED_PROXIES=127.0.0.1`；同时注意基于 IP 的限流与审计日志记录的是代理地址而非真实客户端 IP。
4. **日志与镜像清理。** 应用每次启动都会新建一个 `oneapi-<时间戳>.log`（无内置轮转），每次更新容器都会新增日志文件；第十步的备份标签也会随更新不断累积镜像。建议定期清理：

```bash
# 清理 30 天前的日志（可加入 cron）
find /opt/new-api-logs -name 'oneapi-*.log' -mtime +30 -delete

# 清理悬空镜像
docker image prune -f

# 备份标签只保留最近 3 个，其余删除
docker images new-api-zyy:backup-* --format '{{.Tag}}' | sort -r | tail -n +4 | xargs -r -I{} docker rmi "new-api-zyy:{}"
```

下一步应当根据准备绑定到该服务器的域名，配置 Nginx 反向代理和免费 HTTPS 证书。
