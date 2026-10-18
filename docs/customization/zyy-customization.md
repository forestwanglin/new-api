# zyy 分支定制清单

本文是 **zyy fork 定制改动的唯一登记处**。分支模型见
[deploy/sync-upstream.md](../deploy/sync-upstream.md)：`main` 是纯上游镜像（只做
`git merge --ff-only upstream/main`），`zyy` 是交付分支（所有定制代码与部署构建都从它出）。

因此 **`git diff main zyy` 的每一处差异都是一条定制**，都必须登记在本文。

- 盘点基线：`main` = `7de10f2c6`，`zyy` = `273abb320`，盘点日期 2026-10-18
- 差异规模：58 个文件（28 新增 / 30 修改 / 0 删除）（截至 Z012）；含 Z013 后为 78 个文件
  （42 新增 / 35 修改 / 1 删除）。行数与提交数会随后续提交变化，
  以 `git diff main zyy --shortstat` 与 `git log --oneline main..zyy` 的输出为准
- 差异来源：`git diff main zyy --name-status`、`git log main..zyy`（当前含 4 个合并提交）

---

## 1. 强制规则

1. **同一次改动、同一个提交**：任何改变 fork 行为（后端逻辑、前端界面与定价、部署脚本、
   配置默认值、面向运维/用户的文档）的改动，必须在同一个提交里更新本文。
   先写代码后补文档、或把登记留到"下次一起补"，都视为改动未完成。
2. **未登记 = 未完成**：收尾自查、提交前 diff 复核、PR 描述都必须能看到对应的登记条目。
   若判断某个改动不属于定制（例如纯粹的上游同步），必须在提交说明或 PR 里写明理由。
3. **每条记录至少包含五项**：改了什么 / 为什么（业务原因）/ 影响面（文件、模块、接口）/
   覆盖或扩展了上游的什么行为 / 如何验证（命令与实测结果）。
4. **触及上游自有文件必须显式标注**。新增文件（如 `docs/deploy/*`、`docs/customization/*`、
   `controller/seedance_*.go`）几乎不产生升级冲突；而改动 `AGENTS.md`、`web/AGENTS.md`、
   `controller/relay.go`、`service/error.go` 这类上游文件会在 `git merge upstream/main` 时
   产生冲突。登记条目必须列出这类文件（汇总见 §5），升级时按清单优先复核。
5. **不要重复记录中科移植细节**。中科（zhongke）发行包移植的逐项对照、已存在/已移植/不适用的
   判定，写在 [zhongke-customization-port.md](zhongke-customization-port.md)；本文只写一行
   摘要 + 指向该文档的链接。
6. **不要在本文件里写密钥、令牌、内网地址等敏感信息**。
7. **保持"新增文件 + 单点替换"的收敛原则**：能用新增文件表达的定制，不要摊平到上游文件里；
   确实需要改上游文件时，把改动面写进记录，并尽量保持在最小行数。

## 2. 记录格式

在 §4 追加一节（`Z` + 三位递增序号，一经分配不再复用），固定使用下面这些字段：

| 字段 | 说明 |
|---|---|
| 需求与原因 | 为什么必须改，业务/运维背景 |
| 变更内容 | 后端、前端、部署分别说明；写清对外可见的行为差异 |
| 影响面 | 文件/模块/接口；**上游自有文件**单独列出，无则写"无" |
| 与上游差异 | 替代、扩展或绕过上游的哪段行为 |
| 开关与默认值 | 环境变量、配置项、默认值与边界 |
| 验证 | 实际执行的命令 + 观察到的结果；未执行的要写明 |
| 风险与未覆盖 | 已知限制、假设、待补项 |

## 3. 范围说明

- 本清单只覆盖 **本仓库（`new-api` fork）** 的定制。`zyy-ai-gateway/`（含 `deploy/` 下的
  Nginx 与远程部署控制器）属于另一个仓库，其受保护入口与部署顺序规则见该仓库的
  `deploy/deploy.md` 与 `.trellis/spec/zyy-ai-gateway/deployment/`。
- `main` 与 `zyy` 之间的合并提交本身不登记；被合并进来的具体改动按其原始提交登记。
- `git diff main zyy` 是最终事实来源；本文是它的可读版本。两者不一致时以代码为准，并立即修正本文。

---

## 4. 逐项登记

### Z001 中科发行包后端定制移植

- 需求与原因：中科（zhongke）发行包 `new-api-custom-20261013` 客户需要三项上游行为修正：
  部分上游拒绝未知 thinking 字段、上游错误被网关包装后客户看不到真实原因、Sora 兼容上游只接受
  内联视频内容。对照结论见 [zhongke-customization-port.md](zhongke-customization-port.md) §2。
- 变更内容：
  - **thinking 参数剥离**（`relay/channel/openai/adaptor.go`）：`Thinking.Type != "enabled"` 时置空
    （覆盖 `thinking:{type:"disabled"}`）；`!renderReasoning && ReasoningEffort == "none"` 时置空；
    `EnableThinking == false` 时置空。目的都是让上游使用默认思考行为，避免上游报未知字段错误。
  - **上游错误透传**（`service/error.go`）：`RelayErrorHandler` 不再用 `buildErrWithBody` 包装
    错误体；JSON 能解析但取不到 message 时，直接把原始 body 文本作为 message 返回，而不是只记日志。
    日志调用由 `common.LogText(...)` 改为 `fmt.Sprintf(...)`（即该行不再走 zh-CN 日志文本映射）。
  - **Sora 视频 URL 内联**（`relay/channel/task/jsplugin/adaptor.go` + 新增
    `relay/channel/task/jsplugin/video_url.go`）：仅当插件 `Meta.Key == "sora"` 时，遍历 JSON
    提交体，把引用视频 URL 下载后改写为 `data:video/...;base64,...`；总下载量上限
    `constant.MaxFileDownloadMB`；非 `video/*` 内容类型直接报错。其他 task 上游（如 Doubao/Ark）
    保持 URL 原样。
- 影响面：`relay/channel/openai/adaptor.go`\*、`relay/channel/task/jsplugin/adaptor.go`\*、
  `service/error.go`\*、新增 `relay/channel/task/jsplugin/video_url.go`、`video_url_test.go`
- 与上游差异：上游会丢弃/保留 thinking 字段的原样透传、会用状态码文本包裹上游错误、
  不含视频 URL 内联能力。
- 开关与默认值：无独立开关，行为常开；内联仅对 sora 插件生效。
- 验证：新增 `relay/channel/task/jsplugin/video_url_test.go`（`TestConvertVideoURLs`、
  `TestConvertVideoURLsEnforcesAggregateLimit`、`TestConvertVideoURLsReturnsLoaderError`）。
  **本轮盘点未执行 Go 测试**，原因见 §6。
- 风险与未覆盖：thinking 剥离依赖 `dto.Thinking` 的 JSON 结构，若上游新增 `type` 取值需重新确认；
  key 透传依赖上游 `errResponse.ToMessage()`，字段命名差异的上游可能仍取不到 message。

### Z002 中科发行包前端定价移植（方案 A）

- 需求与原因：客户要求模型广场能看懂 Seedance 视频类模型的价格口径（按秒、CNY），
  且火山 Ark 视频模型（旧后端把 endpoint 标成 Chat）要能看到可用的请求示例。
  详细对照见 [zhongke-customization-port.md](zhongke-customization-port.md) §3。
- 变更内容：
  - 新增 `web/src/features/pricing/lib/video-price.ts`：`SEEDANCE_SPECS`（`sd2.0-480P/720P/1080P`、
    `seedance-2.5`→720p）只在 `quota_type === REQUEST` 时命中；`getSeedanceVideoPrice` 用
    `getDisplayGroupRatio` 得出的分组倍率乘一次基准价；`formatVideoCNY` 输出 `¥` + 4 位小数。
  - 新增 `web/src/features/pricing/lib/ark-video-price.ts`：`doubao-seedance-2-0-fast-260128`
    （videoRatio 22/37）、`doubao-seedance-2-0-mini-260615`（14/23），只在 `quota_type === TOKEN`
    时命中。
  - 新增 `web/src/features/pricing/components/seedance-video-price.tsx`：琥珀色卡片，展示分辨率、
    官方示例秒价、本站售价、分组倍率徽章、5 秒合计与"参考视频不可用"说明。
  - 新增 `web/src/features/pricing/lib/ark-video-examples.ts`：为上述两个 Ark 模型生成
    `POST /v1/videos` 的 curl / python / typescript / javascript 示例（4 秒、720p、16:9）。
  - 改动上游文件接入上述逻辑：`lib/price.ts`（`formatFixedPrice` / `formatRequestPrice` 对
    Seedance 视频模型返回 CNY 秒价）、`hooks/use-pricing-data.ts`（Ark 视频模型的
    `supported_endpoint_types` 强制为 `['openai-video']`）、`components/model-card.tsx`（单价后缀
    `/ second` + 渲染价格卡片）、`components/model-details.tsx`（PriceSection 直接返回视频价格卡片）、
    `components/model-details-api.tsx`（Ark 视频模型用视频示例、补 `/v1/videos` 回退路径，
    并隐藏 Supported parameters / Rate limits 两节）、`components/model-billing-mode-badge.tsx`
    与 `components/model-price-cell.tsx`（计费模式显示 `Per Second`）。
  - i18n：7 个 locale 文件新增 20 个键（`Video specification pricing`、`Site selling rate`、
    `CNY per second · No reference video`、`Video submitted`… 见 `web/src/i18n/locales/zh.json`）。
- 影响面：新增 `web/src/features/pricing/{components/seedance-video-price.tsx,lib/video-price.ts,
  lib/ark-video-price.ts,lib/ark-video-examples.ts}` 与 3 个测试文件；
  **上游自有文件**：`web/src/features/pricing/components/{model-billing-mode-badge,model-card,
  model-details,model-details-api,model-price-cell}.tsx`、`web/src/features/pricing/hooks/use-pricing-data.ts`、
  `web/src/features/pricing/lib/price.ts`、7 个 `web/src/i18n/locales/*.json`
- 与上游差异：上游对 `quota_type=REQUEST` 的模型统一按"每次请求"展示，且不会为旧 DoubaoVideo
  后端改写 `supported_endpoint_types`。
- 开关与默认值：无开关；命中条件是模型名白名单 + `quota_type` 匹配。
- 验证：`web/src/features/pricing/components/__tests__/seedance-video-price.test.tsx`（分组倍率只乘
  一次、CNY/秒与 5 秒合计、2.5 只显示 720p、非法价格不渲染）、
  `web/src/features/pricing/lib/__tests__/ark-video-examples.test.ts`、
  `web/src/features/pricing/hooks/__tests__/ark-video-endpoints.test.tsx`。
  本轮实测：`cd web && ./node_modules/.bin/vitest run` 中这 3 个文件全部通过（见 §6）。
- 风险与未覆盖：把 `model_price` 当作 CNY 展示，若运营按 USD 配置这几个模型名会显示错误币值；
  模型名白名单是硬编码，上游改名或新增规格需同步改 `SEEDANCE_SPECS` / `ARK_VIDEO_MODELS`；
  `videoRatio` 数值来自官方示例换算，价格调整需人工维护。

### Z003 渠道测试：Seedance 快速测活与视频测活（后端）

- 需求与原因：客户需要在渠道页确认"Seedance 渠道到底通不通"，并且要区分
  "只验证接口/鉴权、不花钱"与"真实生成、可能计费"两种语义。
- 变更内容：
  - `controller/channel-test.go`：`TestChannel` 解析出 `endpointType` 后，`seedance-quick` 转
    `testSeedanceQuick`，`seedance-video` 转 `testSeedanceChannel`，不再走普通 chat 测试路径。
  - 新增 `controller/seedance_channel_quick.go`：只发一次只读 GET（`/health`、原生
    `doubao-seedance-*` 的 `/api/v3/contents/generations/tasks`、或 `/v1/models`），8 秒超时、
    禁止重定向，且**不调用 RelayTask、不建任务、不改计费与自动禁用状态**；
    取 key 用 `seedanceQuickKey`，**不推进 key 轮询索引**。
  - 新增 `controller/seedance_channel_health.go`：`seedanceTestModel` 只接受
    `seedance-2.5`、`sd2.0-*`、`doubao-seedance-*` 且必须已配置在该渠道上；`testSeedanceChannel`
    构造 4 秒 720p 请求、经 `httptest` + `RelayTask` 走**正常任务与计费管线**，要求
    `video_test_ack=true` 才允许提交，提交后按任务状态返回 queued/in_progress/completed/failed，
    错误信息里把渠道 key 替换为 `[REDACTED]`，并写一条系统日志。
  - `controller/relay.go`：`RelayTask` 识别上下文里的 `seedance_test_channel`，锁定该渠道并置
    `IsPlayground = true`。
  - `.gitignore`：忽略 `.seedance-health-backups/`（安装包写入的源码备份）。
- 影响面：新增 `controller/seedance_channel_quick.go`、`controller/seedance_channel_health.go`、
  `controller/seedance_channel_quick_test.go`、`controller/seedance_channel_test_test.go`；
  **上游自有文件**：`controller/channel-test.go`、`controller/relay.go`、`.gitignore`
- 与上游差异：上游 `TestChannel` 只有通用 chat/embedding 等测试路径，没有只读健康检查，
  也没有"走真实计费管线但不经过管理员额度"的渠道级视频测试。
- 开关与默认值：无全局开关；视频测试必须带 `video_test_ack=true`。
- 验证：`TestSeedanceQuickContract`、`TestSeedanceQuickNativeContract`、
  `TestSeedanceQuickKeyDoesNotAdvancePollingIndex`、`TestSeedanceChannelTestContract`（均用 httptest）。
  **本轮未执行 Go 测试**，见 §6。
- 风险与未覆盖：视频测活会真实扣费并占用上游配额（前端必须显式勾选确认）；
  快速测活依赖各上游存在只读端点，无可用端点时返回明确的 404/405 提示而非失败重试。
  上游集成了 `controller/relay.go` 的任务提交入口，冲突时优先保留 `seedance_test_channel` 分支。

### Z004 渠道测试：前端快速/视频测试入口

- 需求与原因：让运营在渠道测试弹窗里直接选择两种 Seedance 测试，并看清阶段与"任务已保留、
  不要重复提交"的语义。
- 变更内容：
  - `web/src/features/channels/api.ts`：`testChannel` 参数扩展 `video_test_ack`、
    `seedance_task_id`。
  - 新增 `web/src/features/channels/lib/seedance-channel-test.ts`：`runSeedanceQuickTest`
    只调一次 `endpoint_type=seedance-quick` 且拒绝把通用 success 当成通过；`runSeedanceChannelTest`
    保证**只提交一次**（提交后轮询、超时、网络失败都不重建任务），10 秒轮询间隔，
    支持用既有 `task_id` 续查，`seedance_test_submit_unknown` 映射为 `pending`。
  - `channel-test-dialog.tsx`：新增两个 endpoint 选项与阶段文案映射（`Video submitted`/
    `Video generating`/`Video generation completed`/`Video generation failed`/
    `Video task retained; check task history`），新增 `pending` 状态与结果保留，两个 endpoint
    加入 `STREAM_INCOMPATIBLE_ENDPOINTS`。
- 影响面：新增 `web/src/features/channels/lib/seedance-channel-test.ts`、
  `lib/__tests__/seedance-quick-test.test.ts`、`lib/__tests__/seedance-channel-test.test.ts`；
  **上游自有文件**：`web/src/features/channels/api.ts`、
  `web/src/features/channels/components/dialogs/channel-test-dialog.tsx`、7 个 locale json（与 Z002/Z007 共用）
- 与上游差异：上游弹窗只有通用 endpoint 选项与 idle/testing/success/error 四态。
- 开关与默认值：`auto` 仍是默认选项；选择视频测试时前端强制勾选付费确认后才带 `video_test_ack`。
- 验证：本轮实测 `vitest run` 结果见 §6 —— 这两个测试文件最初因 `node:test` / `vitest` 运行器不匹配
  而失败，经本提交修复后通过（详见下方风险）。
- 风险与未覆盖：**已修复（本提交）**。这两个文件原先 `import { test } from 'node:test'`，与项目运行器
  `vitest` 不匹配：`web/package.json` 的 `"test": "vitest run"`，CI（`.github/workflows/ci.yml:99`）
  执行 `bun run test`，vitest 报 `No test suite found in file`。修复方式为改为
  `import { test } from 'vitest'`，断言仍用 `node:assert/strict`（断言与用例语义完全不变，
  不是为通过而削弱测试）。定向验证：`vitest run <两个文件>` → `2 passed (2)` / `6 passed (6)`；
  随后全量 `vitest run` 只剩 1 个与 zyy 无关的既有失败（见 §6）。
  其余未覆盖项：视频测活仍会真实扣费（前端必须勾选确认）；`pending` 状态要求运营到任务记录页继续查询。

### Z005 Ark Seedance 任务改用上游用量结算

- 需求与原因：Ark Seedance（`doubao-seedance-*`）走 sora 插件时，原先按 `seconds` 时长比例做
  预扣，且完成回调不看上游真实用量，与火山按 token 计费的口径不符（会多扣/少扣）。
- 变更内容（`plugins/tasks/sora/plugin.js`）：
  - 新增 `doubao-seedance-` 前缀识别（模型名可来自 `upstreamModel`/`model`/`properties.origin_model_name`/
    `properties.upstream_model_name`，以兼容 `AdjustBillingOnComplete` 传 task 行的路径）。
  - `extractUsage`：Ark Seedance 返回 `{}`，即**不再按时长比例放大预扣**，保持"一条视频"的基准价。
  - `extractUsageOnComplete`：Ark Seedance 返回 `{ totalTokens: usage.completion_tokens || usage.total_tokens }`，
    由宿主机按 token 结算；取不到 body/usage 时返回 `{}`，保留原有预扣。
- 影响面：**上游自有文件**：`plugins/tasks/sora/plugin.js`；新增回归测试 `plugins/sora_seedance_usage_test.go`
- 与上游差异：上游该插件对视频任务一律用 `seconds` 比例 + 完成回调的 seconds 事实结算。
- 开关与默认值：无开关，按模型名前缀生效。
- 验证：新增 `TestSoraPluginArkSeedanceUsage`。**本轮未执行 Go 测试**，见 §6。
- 风险与未覆盖：依赖上游在轮询 body 里返回 `usage.completion_tokens`/`total_tokens`；
  上游不返回时该任务保持预扣，需要 Z006 的对账任务或人工核对兜底。涉及计费，
  改动前必须按 `AGENTS.md` 的 billing read gate 读 `.agents/rules/billing.md`。

### Z006 新增 `task_billing_reconcile` 系统任务（Ark Seedance 计费对账）

- 需求与原因：滚动发布期间，完成态任务可能由仍运行旧插件的实例终结，导致从未按 token 结算，
  预扣额度一直留在账上。需要一个可重复执行的对账任务把差额退回/补扣。
- 变更内容：
  - `model/system_task.go`：新增任务类型常量 `task_billing_reconcile`。
  - `model/task.go`：新增 `GetSettledTasksForBillingReconcile(submittedAfter, limit)`，
    取 `status=success 且 quota>0 且 submit_time>=lookback`，按 id 倒序，limit 默认 200；
    模型名/用量是 JSON 列、各 DB 驱动序列化不同，因此在 Go 侧过滤而非 SQL。
  - 新增 `service/task_billing_reconcile.go`：`ReconcileArkSeedanceTaskBillingOnce` 扫描窗口
    24 小时、宽限期 10 分钟（避开正在终结任务的轮询器）、单批 200；从任务已存的 usage 计算
    实际额度，用 `RecalculateTaskQuota` **只移动差额**（因此幂等，两边都能调整）；
    排除旧的 `seconds` 时长比例键，避免对旧任务二次放大；返回
    `{scanned, eligible, settled, adjusted_quota, failed, skipped}` 摘要；丢失租约（ctx 取消）时立即退出。
  - `controller/system_task_handlers.go`：新增 `arkSeedanceSettleHandler` 并注册到
    `RegisterScheduledSystemTasks`。
- 影响面：新增 `service/task_billing_reconcile.go`、`service/task_billing_reconcile_test.go`；
  **上游自有文件**：`controller/system_task_handlers.go`、`model/system_task.go`、`model/task.go`
- 与上游差异：上游没有计费对账类系统任务，也没有"按已存用量重算任务额度"的入口。
- 开关与默认值：`TASK_BILLING_RECONCILE_ENABLED` 默认 `true`；
  `TASK_BILLING_RECONCILE_INTERVAL_MINUTES` 默认 5 分钟，小于 1 时回落到 5。
- 验证：`TestReconcileArkSeedanceTaskBillingSettlesStaleReservation`、
  `...IsIdempotentAndTwoWay`、`...SkipsIneligibleTasks`。**本轮未执行 Go 测试**，见 §6。
- 风险与未覆盖：对账只覆盖 `doubao-seedance-` 前缀与 24 小时窗口，更久的漏结算需人工处理；
  多实例并发由系统任务租约去重，单实例内为顺序执行。

### Z007 前端为对账任务补充标签

- 需求与原因：系统任务列表需要能读懂新增的 `task_billing_reconcile`。
- 变更内容：`web/src/features/system-info/constants.ts` 的 `SYSTEM_TASK_TYPE_LABEL` 增加
  `task_billing_reconcile: 'Billing reconciliation'`，并在 7 个 locale 增加
  `"Billing reconciliation"` 翻译键。
- 影响面：**上游自有文件**：`web/src/features/system-info/constants.ts`、7 个 locale json
- 与上游差异：上游没有该任务类型。标签为英文源串 + 前端翻译，符合 i18n 约定。
- 开关与默认值：无。
- 验证：属纯展示常量，已通过本轮 `vitest run` 的全量前端测试（无相关失败）。
- 风险与未覆盖：无。新增系统任务类型时必须同时补这里，否则列表显示原始 key。

### Z008 部署文档与脚本（zyy 分支部署、蓝绿切流、构建配额）

- 需求与原因：zyy 是交付分支，需要一套可复现的部署与升级流程；线上用户较多时需要零停机切换；
  构建机资源有限，需要可控的 buildx 缓存/CPU/内存配额与可追溯的构建版本戳。
- 变更内容（全部为新增文件）：
  - `docs/deploy/deploy-zyy-branch.md`（534 行）：zyy 分支 Docker Compose 部署全流程。
  - `docs/deploy/sync-upstream.md`（129 行）：main 纯上游镜像 + zyy 定制分支的同步策略与
    `merge : push --tags` 流程。
  - `docs/deploy/zero-downtime-update.md`（345 行）：零停机（蓝绿）更新指南。
  - `docs/deploy/blue-green-switch.sh`（454 行）：蓝绿切流脚本；历经修复包含 Nginx 探测排除
    `.bak`、子 shell 失败被吞、`sed` 分隔符与正则 alternation 冲突、构建版本戳
    `<branch>-<commit 前 8 位>`、buildx 配额等。
  - `docs/deploy/setup-build-builder.sh`（252 行）：构建 builder 配额初始化，并作为配额唯一写入方。
- 影响面：`docs/deploy/**`（新增文件，无上游冲突面）
- 与上游差异：上游不提供 fork 分支部署与蓝绿方案。
- 开关与默认值：构建配额可由环境变量覆盖；构建缓存上限与 compose 单 target 由脚本写入。
- 验证：本轮仅做静态复核（文件存在、行数、提交来源）。**脚本未执行**：它们是受保护的运维入口，
  按项目规则改动前需先读 `zyy-ai-gateway/deploy/deploy.md` 与
  `.trellis/spec/zyy-ai-gateway/deployment/`，并同步 `*.example`、部署顺序测试与 shell 语法检查。
- 风险与未覆盖：脚本与线上 Nginx/Compose 强耦合，未在本次盘点中做干跑验证；
  `setup-build-builder.sh` 与 `blue-green-switch.sh` 必须保持"单一配额写入方"的约束。

### Z009 中科移植对照文档

- 需求与原因：中科发行包的定制项需要逐项对照"发行包 → 本分支"的状态，供后续升级复核。
- 变更内容：`docs/customization/zhongke-customization-port.md`（346 行）：12 项定制的
  已存在/已移植/不适用判定、后端 Go 变更明细、前端定价方案 A 说明、排除项与约束。
  文档先落在 `docs/zhongke/`，随后迁入 `docs/customization/` 并修订。
- 影响面：`docs/customization/zhongke-customization-port.md`（新增文件）
- 与上游差异：无（纯文档）。
- 开关与默认值：无。
- 验证：内容与代码逐项对照见 Z001/Z002 的条目；文档中引用的提交号可用 `git show` 复核。
- 风险与未覆盖：文档随上游演进可能过期；按 §1.5，后续中科相关改动只在此文档补细节。

### Z010 模型广场隐藏 `default` 用户分组（已回退）

- 需求与原因：曾尝试在模型广场的分组筛选里隐藏 `default` 用户分组。
- 变更内容：`719529daf` 引入，`f409dd330` 完整回退（`Revert "feat(web): 模型广场分组筛选隐藏 default 用户分组"`）。
- 影响面：`web/src/features/pricing/**`（当前与 `main` 无差异）
- 与上游差异：无（净差异为零）。
- 开关与默认值：无。
- 验证：`git diff main zyy -- web/src/features/pricing` 中不含该筛选逻辑。
- 风险与未覆盖：保留记录仅为说明该行为曾被尝试并撤销，避免后续重复实现同一个已被否决的需求。

### Z011 定制清单与本规则的建立

- 需求与原因：zyy 的改动此前散落在提交历史里，升级上游时无法一眼看出"我们改了什么"，
  存在定制被上游实现静默覆盖的风险。
- 变更内容：
  - `AGENTS.md` 新增 `### Zyy Fork Customization Records (mandatory)`：定义登记义务、
    条目必备字段、上游自有文件标注要求、中科移植不重复记录、纯上游同步豁免、禁写敏感信息。
  - 新增 `docs/customization/zyy-customization.md`（本文）：规则、格式、范围、
    逐项登记（Z001–Z011）、上游自有文件清单（§5）、验证快照（§6）。
- 影响面：**上游自有文件**：`AGENTS.md`；新增 `docs/customization/zyy-customization.md`
- 与上游差异：上游没有 fork 定制登记要求。
- 开关与默认值：无。
- 验证：`git diff main zyy --name-status` 与本文 §4/§5 逐条对齐（54 个文件全部有归属）；
  事实以 `git log`、`git show --name-status`、`git cat-file -e main:<path>` 取证。
- 风险与未覆盖：`AGENTS.md` 属上游文件，本次改动会在下次 `git merge upstream/main` 时冲突；
  未来的登记条目要持续维护，且模型/价格白名单类定制（Z002）需要随业务变更同步。

### Z012 概览页顶部展示「邀请好友注册」卡片

- 需求与原因：交付方要求注册/邀请入口出现在用户进入系统后的第一屏（概览页 `/dashboard/overview`），
  而不是只在钱包页底部；同时把简体中文标题从「推荐计划」改为「邀请好友注册」，贴合业务口径。
  钱包页保持原样（卡片位置不动）。
- 变更内容（前端）：
  - 新增 `web/src/features/dashboard/components/overview/referral-panel.tsx`：复用钱包的
    `AffiliateRewardsCard` 与 `TransferDialog`；邀请链接与划转来自 `useAffiliate()`；邀请计数
    （`aff_count` / `aff_quota` / `aff_history_quota`）来自独立的 `/api/user/self` react-query
    （`staleTime` 60s），因为 auth-store 快照只在登录/引导时刷新，会话中别人用你的邀请码注册后
    计数会过期；「转移到余额」的可用性来自 `/api/user/topup/info` 的
    `payment_compliance_confirmed`（只取该布尔值，不引入 `useTopupInfo` 的整套充值解析）。
    划转成功后重新拉取 self，并把 `quota` / `used_quota` / `request_count` / `aff_*` 写回
    auth-store，避免旁边的概览指标仍显示划转前的余额。
  - `web/src/features/dashboard/components/overview/overview-dashboard.tsx`：在概览内容
    栈最前面插入 `<ReferralPanel />`，位于引导区与 `SummaryCards` 之前。
  - `web/src/i18n/locales/zh.json`：键 `"Referral Program"` 的简体中文值 `推荐计划` →
    `邀请好友注册`。其余 6 种语言未改（英文仍为 `Referral Program`）。
- 影响面：新增 `referral-panel.tsx` 与 `__tests__/referral-panel.test.tsx`；
  **上游自有文件**：`web/src/features/dashboard/components/overview/overview-dashboard.tsx`、
  `web/src/features/dashboard/components/overview/__tests__/setup-guide.test.tsx`、
  `web/src/i18n/locales/zh.json`。`affiliate-rewards-card.tsx` 未改动（仍接收 `UserWalletData`）。
- 与上游差异：上游概览页没有邀请入口，该卡片只出现在钱包页；上游中文标题为「推荐计划」。
- 开关与默认值：无独立开关，登录用户在概览页常显（邀请 0 人、奖励 0 时也显示，与钱包页一致）；
  合规未确认时卡片提示划转不可用并禁用按钮，后端接口本身也会拒绝划转。
- 验证：见 §6 的 Z012 小节（定向测试 2 文件 10 用例通过；全量 193 文件 1 失败 / 192 通过，
  唯一失败仍是既有的 `markdown.test.tsx`；`tsgo -b` 退出码 0；oxlint 改动文件无 error；
  `rsbuild build` 成功）。
- 风险与未覆盖：概览页因此新增 `/api/user/self` 与 `/api/user/topup/info` 两个请求
  （`useAffiliate` 的 `/api/user/aff` 沿用钱包实现，不带缓存）。概览页的 `SummaryCards` 仍读
  auth-store，仅在本卡片划转成功后同步一次。钱包页与概览页的卡片装配目前是两份实现
  （钱包页未改动以降低回归风险），后续如需收敛可抽公共面板 + 共享 query。合规被撤销但
  `aff_quota` 仍大于 0 的历史场景下，概览页与钱包页都会依据同一标记禁用划转，行为一致。

### Z013 模型广场按分组倍率展示折扣与原价

- 需求与原因：模型广场的价格按分组倍率折算（例如 DeepSeek 分组 ×0.6），但卡片与表格只显示折算后的
  单一价格，用户看不到「标准价 vs 当前分组价」，也无法判断自己选的计价分组打了多少折。交付方要求
  按**分组倍率**展示折扣徽标，并在卡片与表格补删除线原价；详情抽屉只补徽标（抽屉主价格区本身就是
  ratio=1 的基准价口径，挂折扣会自相矛盾）。
- 变更内容（前端）：
  - 新增 `web/src/features/pricing/lib/display-discount.ts`：`getDisplayDiscount` 复刻
    `getDisplayGroupRatio`（`lib/model-helpers.ts`）的选取顺序——有显式选中分组用该分组，否则取
    `enable_groups` 中最小倍率的分组，同倍率按 `enable_groups` 顺序取第一个——返回
    `{ group, ratio, percent, kind, isBest }`；`percent = round((ratio - 1) × 100)`，
    `|ratio - 1| < 0.005` 视为无折扣；`getVisibleDiscount` 统一过滤已自带价格卡的 Seedance 视频模型
    与无法解析的计费表达式；`withBaseGroupRatio` / `getBasePriceOptions` 提供「同 options、倍率置 1」
    的原价口径——**不做除法反推**，因此货币符号、recharge 口径与小数位与现价完全一致。
  - 新增 `components/price-discount-badge.tsx`：复用 `@/components/group-badge` 的
    `GroupMultiplierBadge` 取色（倍率 <1 为 info、>1 为 warning），未选分组时文案为「最优分组 -40%」，
    `title`/`aria-label` 带实际分组名；倍率 >1 显示 `+50%` 且不画删除线。
  - 新增 `components/original-price.tsx`：`<del>` + `aria-label="Original price …"`。
  - `components/model-card.tsx`：价格区块 caption 行右端放折扣徽标；token / request / dynamic 三条价格
    分支各追加一行删除线原价（dynamic 分支用同一 evaluator 以 `groupRatioMultiplier: 1` 重算，
    按 `entry.key` 对齐基准价条目）。
  - `components/model-price-cell.tsx`：把动态定价 options 抽成 `dynamicOptions` 以便复算基准价；
    metric 增加 `original` 字段，原价渲染在现价正下方，沿用 `showCurrencySymbol: false`。
  - `components/cached-price-cell.tsx`：Cached 列同步原价，沿用 `stripTrailingZeros` 与默认符号。
  - `components/pricing-columns.tsx`：Type 列在计费模式徽标后放折扣徽标，列宽 `110 → 130`。
  - `components/model-details.tsx`：`ModelHeader` 第二行放折扣徽标；`ModelDetailsContentProps` 新增
    `selectedGroup`，独立详情页取 `search.group`。
  - `features/pricing/index.tsx`：`<ModelDetailsDrawer>` 透传 `selectedGroup={groupFilter}`，使抽屉
    徽标与用户点开的那一行一致。
  - `components/pricing-table.tsx`：`skeletonRowHeight='h-[68px]'`，让骨架行高匹配新增原价行后的真实行高。
  - i18n：7 个 locale 新增 `Best group`、`Original price`。
- 影响面：新增 `web/src/features/pricing/lib/display-discount.ts`、
  `web/src/features/pricing/components/{price-discount-badge,original-price}.tsx`、
  `web/src/features/pricing/__tests__/group-discount-display.test.tsx`、
  `web/src/features/pricing/lib/__tests__/display-discount.test.ts`；
  **上游自有文件**：`web/src/features/pricing/components/{model-card,model-price-cell,cached-price-cell,pricing-columns,pricing-table,model-details}.tsx`、
  `web/src/features/pricing/index.tsx`、7 个 `web/src/i18n/locales/*.json`。
- 与上游差异：上游只显示折算后的单一价格，没有原价与折扣；上游 Type 列只有计费模式徽标；
  上游卡片价格区块没有 caption 行容器；上游抽屉不接收模型广场的分组筛选。
- 开关与默认值：无开关，按分组倍率自动显示。倍率等于 1、Seedance 视频模型、无法解析的计费表达式、
  未配置价格都不显示；倍率 >1（溢价分组）只显示 `+xx%`，不画删除线。
- 验证：见 §6 的 Z013 小节。
- 风险与未覆盖：卡片示例价行（`≈ 示例价`）不加原价；溢价分组沿用 `GroupMultiplierBadge` 的 warning 配色，
  与「动态计费」徽标同为橙色，表格里两者同格时视觉略挤（未改共享组件以控制影响面）；
  侧边栏筛选项的 `x0.6` 后缀与徽标百分比来自同一倍率数据，两处表述不同但不会互相矛盾。

---

## 5. 上游自有文件改动清单（升级冲突重点关注）

以下文件在 `main` 中已存在，fork 对其做了修改。升级 `upstream/main` 时优先复核这些位置，
确认定制没有被上游实现静默覆盖。清单按 `git diff main zyy --name-status` 的 `M` 记录整理
（基线 `95287ef7d`，当时 28 个文件；含 Z012 后 30 个文件；含 Z013 后 35 个文件）：

| 区域 | 文件 | 关联条目 |
|---|---|---|
| 仓库规则与配置 | `AGENTS.md`、`.gitignore` | Z011、Z003 |
| 后端 controller / model | `controller/channel-test.go`、`controller/relay.go`、`controller/system_task_handlers.go`、`model/system_task.go`、`model/task.go` | Z003、Z006 |
| 服务层 | `service/error.go` | Z001 |
| Relay / 插件 | `relay/channel/openai/adaptor.go`、`relay/channel/task/jsplugin/adaptor.go`、`plugins/tasks/sora/plugin.js` | Z001、Z005 |
| 前端渠道 | `web/src/features/channels/api.ts`、`web/src/features/channels/components/dialogs/channel-test-dialog.tsx` | Z004 |
| 前端概览 | `web/src/features/dashboard/components/overview/overview-dashboard.tsx`、`web/src/features/dashboard/components/overview/__tests__/setup-guide.test.tsx` | Z012 |
| 前端定价 | `web/src/features/pricing/components/model-billing-mode-badge.tsx`、`model-card.tsx`、`model-details.tsx`、`model-details-api.tsx`、`model-price-cell.tsx`、`web/src/features/pricing/hooks/use-pricing-data.ts`、`web/src/features/pricing/lib/price.ts` | Z002 |
| 前端定价（折扣/原价） | `web/src/features/pricing/components/model-card.tsx`、`model-price-cell.tsx`、`cached-price-cell.tsx`、`pricing-columns.tsx`、`pricing-table.tsx`、`model-details.tsx`、`web/src/features/pricing/index.tsx` | Z013 |
| 前端系统信息 | `web/src/features/system-info/constants.ts` | Z007 |
| i18n | `web/src/i18n/locales/{en,zh,zh-TW,fr,ru,ja,vi}.json` | Z002 / Z004 / Z007 / Z012 / Z013 |

## 6. 验证快照

本节记录实测结果：Z004 修复前、后两次，以及 Z012、Z013（同日，随改动一并更新）。

**前端全量测试**：`cd web && ./node_modules/.bin/vitest run`

| 时点 | 结果 | 失败文件 |
|---|---|---|
| Z004 修复前 | 192 文件：3 失败 / 189 通过；2263 用例：1 失败 / 2262 通过（37.7s） | `seedance-channel-test.test.ts`、`seedance-quick-test.test.ts`（zyy 新增，运行器不匹配）、`markdown.test.tsx` |
| Z004 修复后 | 192 文件：1 失败 / 191 通过；2269 用例：1 失败 / 2268 通过（38.0s） | 仅 `markdown.test.tsx` |

**Z004 的定向验证**：
`./node_modules/.bin/vitest run src/features/channels/lib/__tests__/seedance-quick-test.test.ts src/features/channels/lib/__tests__/seedance-channel-test.test.ts`
→ `Test Files 2 passed (2)`、`Tests 6 passed (6)`（325ms）。

**`markdown.test.tsx` 失败的归属确认**：该文件相对 `main` 无差异，并且在一个干净的 `main`
工作树上单独运行同样失败（`Test Files 1 failed (1)`、`Tests 1 failed | 3 passed (4)`），
因此判定为既有/环境相关问题，与 zyy 定制无关；该临时工作树已删除，不影响本仓库。

**后端 Go 测试**：**本轮未执行**。本机 `go` 由 mise 管理且当前目录未固定版本
（`go env` 报 `No version is set for shim: go`），未擅自安装或切换工具链。因此 Z001/Z003/Z005/Z006
的 Go 测试结论仍以提交历史中的既有产物为准：待运行的用例为
`go test ./relay/channel/task/jsplugin/... ./service/... -run 'VideoURL|Reconcile'`、
`go test ./controller/... -run 'Seedance'`、
`go test ./plugins/... -run 'SoraPluginArkSeedanceUsage'`、`go build ./...`。
升级前应在具备 Go 1.26/1.25.1 的环境补跑并把结果写回本节。

### Z012 验证快照

**定向测试**：
`./node_modules/.bin/vitest run src/features/dashboard/components/overview/__tests__/referral-panel.test.tsx src/features/dashboard/components/overview/__tests__/setup-guide.test.tsx`
→ `Test Files 2 passed (2)`、`Tests 10 passed (10)`（3.42s）。覆盖：中文标题「邀请好友注册」与邀请链接、
邀请计数来自 self、仅有待划转奖励时才出现「转移到余额」、划转调用 `/api/user/aff_transfer` 后
弹窗关闭且 auth-store 余额同步为刷新后的值、邀请面板在概览内容栈中位于引导区与 `SummaryCards` 之前。

**前端全量测试**（`cd web && ./node_modules/.bin/vitest run`）：193 文件：1 失败 / 192 通过；
2273 用例：1 失败 / 2272 通过（37.7s），失败文件仍仅为 `markdown.test.tsx`
（上表 Z004 修复后的基线为 192 文件 / 2269 用例，失败文件相同）。

**类型检查与 lint**：`./node_modules/.bin/tsgo -b` 退出码 0；
`./node_modules/.bin/oxlint -c .oxlintrc.json` 针对 `referral-panel.tsx`、
`overview-dashboard.tsx`、`referral-panel.test.tsx` 无输出（无 error/warning）；
`setup-guide.test.tsx` 仅剩该文件既有的 `unicorn(prefer-query-selector)` warning
（`document.getElementById` 用法，非本次引入）。

**前端构建**：本机**未安装 `bun`**（`which bun` 失败），因此按包管理器约定改用
`./node_modules/.bin/rsbuild build` → 构建成功（产物 66592.3 kB / gzip 20454.2 kB，退出码 0）。
`web/dist` 已被 `.gitignore` 忽略，未进入工作区改动。

### Z013 验证快照

**定向测试**：`./node_modules/.bin/vitest run src/features/pricing`
→ `Test Files 15 passed (15)`、`Tests 292 passed (292)`（3.86s）。其中本次新增的两个文件单独运行：
`display-discount.test.ts` + `group-discount-display.test.tsx` → `Test Files 2 passed (2)`、
`Tests 22 passed (22)`。覆盖：折扣倍率与 `getDisplayGroupRatio` 在全输入矩阵上的一致性、
同倍率按 `enable_groups` 顺序 tie-break、epsilon 边界（0.999/1.004 视为无折扣）、
倍率 <1 渲染 `-40%` 与删除线原价（原价 = 现价 ÷ 倍率）、倍率 =1 两者都不渲染、
倍率 >1 渲染 `+50%` 且**无** `line-through`、未选分组渲染「最优分组」并在 tooltip 带分组名、
Seedance 视频模型与无法解析表达式不渲染折扣、表格 Type 列渲染徽标且列宽 130、
Cached 列同步原价、`PriceDiscountBadge` 在无折扣时渲染空。

**前端全量测试**：`cd web && ./node_modules/.bin/vitest run` → 197 文件：1 失败 / 196 通过；
2319 用例：1 失败 / 2318 通过（38.67s），唯一失败仍为既有的 `markdown.test.tsx`
（该文件本次未改动，单独运行同样失败，归属见本节上文说明）。

**类型检查与 lint**：`./node_modules/.bin/tsgo -b` 退出码 0；
`./node_modules/.bin/oxlint -c .oxlintrc.json` 针对本次新增与修改的 12 个文件无输出（无 error/warning）。
注意 `src/features/pricing` 目录内的 `constants.ts`、`components/model-details-apps.tsx`、
`lib/mock-stats.ts`、`lib/filters.ts` 仍存在与本次无关的既有 error（未改动这些文件）。

**格式化与版权头**：`node scripts/format-with-protected-headers.mjs --check` 无输出；
`node scripts/add-copyright.mjs --check` 退出码 1，列出 16 个**既有**文件需要更新头，
本次新增的 5 个文件均不在其中。

**前端构建**：本机**未安装 `bun`**（`which bun` 失败），按仓库约定改用
`./node_modules/.bin/rsbuild build` → 构建成功（`Total: 66893.8 kB / gzip 20532.2 kB`，退出码 0）。
`web/dist` 已被 `.gitignore` 忽略，未进入工作区改动。

## 7. 与升级流程的关系

- 升级前用 `git diff main zyy` 与 §4、§5 逐条对齐，确认每条定制都有归属、每个改动面都有解释。
- 冲突高发位置就是 §5 的清单；合并冲突解决后，必须回跑对应的验证（后端受影响包的
  `go test`、前端 `bun run test` / `bun run build`），并把结果更新到 §4 对应条目与 §6。
- 新增定制没有同步登记时，升级后极易被上游实现覆盖而不自知——这是本规则存在的直接原因。
