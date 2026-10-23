# 任务插件（task plugin）的存储、定制与升级

本文说明「任务插件」页面的插件代码到底存在哪里、重新部署会不会丢、以及本分支（`zyy`）对内置插件的定制为什么会在线上显示「不在索引中」。结论都对照过源码，文末给出可复制的核对命令。

关联文档：[deploy-zyy-branch.md](deploy-zyy-branch.md)（构建与更新部署）、[sync-upstream.md](sync-upstream.md)（升级与定制管理）。

## 一、两套存储，不要混淆

| | 内置插件（factory） | 线上安装/更新的插件（override） |
| --- | --- | --- |
| 存放位置 | **编译进二进制** | **MySQL 表 `task_plugins`** |
| 来源 | `plugins/tasks/<key>/plugin.js`，由 `plugins/embed.go` 的 `//go:embed tasks` 打进镜像 | 市场「安装」或「上传」，`Source` 列存 `plugin.js` 全文 |
| 重新部署是否丢失 | 跟随镜像，**由部署的分支决定** | **不丢**，只要数据库还在 |
| 生效条件 | 该 key 没有 active 的 override 行 | 有 active 行时优先于内置 |

关键代码：

- `plugins/embed.go:12` — `//go:embed tasks`，内置插件在启动时注册进 `jsplugin` registry
- `model/task_plugin.go:78-96` — `TaskPlugin{Key, Version, Source, SourceHash, Enabled, Active}`，`(key, version)` 有唯一索引 `uk_task_plugin_key_version`
- `model/task_plugin.go:102-131` — `SaveTaskPlugin`：新版本入库时若该 key 没有其他 active 行，自动置 `Active = true`
- `pkg/jsplugin/registry.go:1000-1014` — `resolveActiveOverrides`：active 的 override 覆盖同名内置插件
- `controller/task_plugin.go:192` — 列表接口把这种状态标记为 `override_over_factory`
- `controller/task_plugin.go:716` — `syncTaskPluginsOnceContext`：启动时与每次增删改后，从 DB 拉一次快照重建 registry

容器运行期**不从磁盘读插件**。线上的 compose 只挂载 `/opt/new-api-data:/data` 与 `/opt/new-api-logs:/app/logs`，都不存放插件代码。

## 二、运行时优先级：`override_over_factory`

```
改内置插件源码 → 编进镜像 → factory 层
线上点「安装」   → 写入 task_plugins（active） → override 层，覆盖 factory
```

由此得到两个方向相反的坑：

1. **重新部署不会丢线上安装的版本**，但会**遮住**你改在镜像里的内置插件——镜像里是新逻辑，运行时用的却是 DB 里那份旧/新市场版本。
2. **点「安装」会静默降级**，把改动过的内置插件盖回市场版本（详见第五节）。

## 三、本分支的定制：doubao 1.3.1

`plugins/tasks/doubao/plugin.js` 的版本号 `1.3.1` **不是上游市场版本**，是本分支为「不接管 relay 渠道的模型」这一改动特意升上去的：

| commit | 日期 | 内容 |
| --- | --- | --- |
| `56211bfb8` | 2026-10-20 | `fix(plugins): leave relay-served Seedance models to type 55 channels`：`version: "1.3.0"` → `"1.3.1"` |
| `56a5ee183` | 2026-10-20 | `fix(plugins): match every Seedance mini/fast family and guard the patch`：把前缀列表改成通配正则，版本号未再动 |

改动理由（写在 commit message 里）：插件声明过的模型会被"钉"在该插件上，而 task-plugin 的身份过滤只认 VolcEngine(45) / DoubaoVideo(54) 渠道（或绑定该插件的 New API / TaskPlugin 渠道）。线上 `doubao-seedance-*-mini/fast` 系列走的是 type 55 relay 渠道，一旦被插件声明，请求就找不到可用渠道。因此：

- `plugins/tasks/doubao/plugin.js:25` — `RELAY_VIDEO_MODEL_PATTERN = /^doubao-seedance-.*-(?:mini|fast)-/`
- `plugins/tasks/doubao/plugin.js:29` — `OWNED_VIDEO_MODELS` 从 `VIDEO_MODELS` 里排除匹配的模型
- `VIDEO_MODELS` 仍保留这些型号的能力信息，等原生 Ark 渠道上线后改一行即可恢复接管

### 「已装 v1.3.1 不在索引中」是定制生效的正常标志

市场卡片的判定在 `web/src/features/task-plugins/lib/marketplace.ts:257-282`（`deriveInstallState`）：

| 条件 | 状态 | 卡片显示 |
| --- | --- | --- |
| 未安装 | `not_installed` | 安装 |
| 安装版本 == 索引最新 | `up_to_date` | 已是最新 |
| 安装版本在索引里，但不是最新 | `upgradable` | `vX → vY` |
| 安装版本**不在索引里** | `diverged` | `已装 vX 不在索引中` |

内置插件同样参与这个判定（`installed` 来自 `/api/plugin/task`，包含 `source: "factory"` 的项）。公开市场索引里 doubao 最新是 `1.3.0`，镜像内置是 `1.3.1`，因此必然落到 `diverged`。

**所以看到 `已装 v1.3.1 不在索引中` 说明两件事：镜像带上了本分支的定制、且 DB 里没有该插件的 override 行。** 反过来说，如果这里变成「已是最新」，说明定制被覆盖（或部署的分支里没有那两个 commit）。

### 回归基线（2026-10-22 核对）

内置版本可用下面一行重新取，无需查库：

```bash
cd /opt/new-api-src
for d in plugins/tasks/*/; do
  printf '%-12s %s\n' "$(basename "$d")" "$(grep -m1 'version:' "$d/plugin.js" | sed 's/.*version: *//;s/,//;s/"//g')"
done
```

| 插件 | 本地内置 | 当时市场索引最新 | 卡片应显示 |
| --- | --- | --- | --- |
| alibaba | 1.4.2 | 1.4.2 | 已是最新 |
| **doubao** | **1.3.1** | **1.3.0** | **已装 v1.3.1 不在索引中** |
| google | 1.1.0 | 1.1.0 | 已是最新 |
| hailuo | 1.3.0 | 1.3.0 | 已是最新 |
| jimeng | 1.1.0 | 1.1.0 | 已是最新 |
| sora | 1.1.0 | 1.1.0 | 已是最新 |
| sunoapi | 1.1.0 | 1.1.0 | 已是最新 |
| vertex-ai | 1.1.0 | 1.1.0 | 已是最新 |
| vidu | 1.1.0 | 1.1.0 | 已是最新 |
| kling | 1.1.0 | 1.1.1 | `可升级：v1.1.0 → v1.1.1` |
| xai | 1.1.0 | 未核对 | 未核对（截图中未出现该卡片） |

除 doubao 外，其余行会随上游索引变化，不必逐条记忆；**只需要盯住 doubao 那一行**，它是定制是否生效的指示灯。

## 四、改内置插件源码的约定

- **必须 bump `version`。** 版本号是线上唯一能区分"新逻辑是否上线"的信号：不升版本时，卡片仍显示「已是最新」，回归验证无从判断，出问题也只能靠猜。
- **同 key 同版本不允许不同源码。** `SaveTaskPlugin` 对已存在的 `(key, version)` 若 `SourceHash` 不同会直接拒绝：`plugin key and version already exist with different source`。所以把改动上传到同版本会失败。
- 内置插件**删不掉**，只能被 override 覆盖；`DELETE .../versions/:version` 只删 DB 行，不存在对应行时返回 `factory plugins cannot be deleted`。

## 五、风险：点「安装」会静默降级

以 doubao 为例，假设线上当前是内置 1.3.1、市场索引最新 1.3.0，有人在卡片上点「安装」：

| 步骤 | 结果 |
| --- | --- |
| 安装对话框 | 会提示「当前已安装 v1.3.1，但该源未列出此版本。安装将把它替换为 v1.3.0。」（`marketplace-install-dialog.tsx:418-430`，文案键见 `web/src/i18n/locales/zh.json:6999`）——**有提示，但不拦截** |
| 确认安装 | `SaveTaskPlugin` 写入 `(doubao, 1.3.0)`，因无其他 active 行而自动 active |
| 即时效果 | `override_over_factory` 生效，镜像里的 1.3.1 被 1.3.0 覆盖；mini/fast 型号重新被插件接管，请求因无匹配渠道而失败 |
| UI 表现 | 卡片从「已装 v1.3.1 不在索引中」变成「已是最新」——**看不出被降级过** |

因此线上运维约定：

1. **不要点 doubao 卡片的「安装」。**
2. 想彻底消除这个陷阱，把市场源指向自己的索引（「管理源」→ `PUT /api/plugin/task/marketplace/sources`），把 1.3.1 发进去，卡片就会显示「已是最新」。
3. 重新部署后顺手确认 doubao 仍是「已装 v1.3.1 不在索引中」。

## 六、核实线上到底跑的是哪一份

数据库是唯一真相来源（只读查询，不影响运行）：

```sql
-- 有无 override 行；为空表示全部走镜像内置版本
SELECT id, `key`, version, active, enabled, source_hash, created_at
FROM task_plugins
ORDER BY `key`, id;
```

- 查不到 doubao 任何行 → 运行时用的是镜像内置 1.3.1（期望状态）
- 出现 `key='doubao'` 且 `active=1` 的行 → 该版本覆盖了内置，`version` 就是实际生效的版本

接口层等价视角（管理员会话）：`GET /api/plugin/task`，看对应项的 `source` 字段：

| `source` | 含义 |
| --- | --- |
| `factory` | 纯内置，无 override |
| `override_over_factory` | DB 版本覆盖了内置（`factory_meta` 里能看到被遮住的内置版本） |
| `override` | 只有 DB 版本，镜像里没有内置的 key |

表名不确认时先 `SHOW TABLES LIKE '%plugin%';`，MySQL 下就是 `task_plugins`。

## 七、让内置版本重新生效 / 回退

1. **删除 DB 版本行**：插件详情里删除对应版本（`DELETE /api/plugin/task/:key/versions/:version`），删除后会自动 sync，立刻回落到内置版本。
2. **激活指定版本**：`POST /api/plugin/task/:key/activate`。
3. **手工删库行**：不需要重启。后台每 30 秒跑一次 `syncTaskPluginsOnce`（`main.go:116` → `controller/task_plugin.go:865-870`），会重新读一次 DB 快照并重建 override 层，删除后最多 30 秒生效；想立即生效就重启容器，或在界面上做一次增删改（这类操作会当场 sync）。

回退前注意：如果被删的 override 比内置版本新（例如内置 1.3.0、DB 是 1.3.1），删除会让功能回落到旧内置版本，可能缺新字段/新模型支持，先看插件详情里的 changelog。

## 八、部署回归清单

每次重建镜像并 `up -d` 之后（流程见 [deploy-zyy-branch.md](deploy-zyy-branch.md) 第十步）：

- [ ] `task_plugins` 表里没有意外的 `active=1` override 行（尤其是 doubao）
- [ ] 任务插件页面 doubao 卡片显示「已装 v1.3.1 不在索引中」
- [ ] 抽查一条 `doubao-seedance-*-mini/fast` 任务，确认仍走 type 55 relay 渠道而不是 task plugin
- [ ] 若本次部署**没有**带 `56211bfb8` / `56a5ee183`，说明拉错了分支或回退过，定制已丢失
