# zyy 分支定制清单

本文是 **zyy fork 定制改动的唯一登记处**。分支模型见
[deploy/sync-upstream.md](../deploy/sync-upstream.md)：`main` 是纯上游镜像（只做
`git merge --ff-only upstream/main`），`zyy` 是交付分支（所有定制代码与部署构建都从它出）。

因此 **`git diff main zyy` 的每一处差异都是一条定制**，都必须登记在本文。

- 盘点基线：`main` = `058c8231b`，`zyy` = `56a5ee183`，盘点日期 2026-10-20
- 差异规模：84 个文件（43 新增 / 40 修改 / 1 删除），47 个提交（`main..zyy`，含 Z018）；
  本文件（Z018 登记）提交后为 48 个提交、文件数不变。行数与提交数会随后续提交变化，
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

### Z014 模型广场折扣与原价统一红色、划线原价对齐现价字号

- 需求与原因：Z013 上线的折扣展示里，删除线原价用 `text-muted-foreground text-xs`、折扣徽标用
  `GroupMultiplierBadge` 的 info 蓝，交付方要求：卡片模式下删除线原价与现价**同字号**，删除线与
  折扣信息用**红色**；表格模式下折扣信息与删除线沿用卡片模式**同一个红色**。
- 变更内容（前端）：
  - `components/original-price.tsx`：删除线原价 `text-muted-foreground text-xs` →
    `text-destructive text-sm`，字号对齐卡片/表格现价（两者均为 `text-sm`），并在所有调用点统一为红色。
  - `components/price-discount-badge.tsx`：`discount.kind === 'discount'`（倍率 <1）时在共享
    `GroupMultiplierBadge` 上覆写 `border-destructive/30 bg-destructive/10 text-destructive`；
    溢价分组（`+xx%`）保持 warning 橙。卡片、表格 Type 列、详情抽屉共用该组件，三处同步变红。
  - `__tests__/group-discount-display.test.tsx`：新增「卡片折扣与原价红色 + 原价与现价同字号」用例，
    并在表格价格单元与 Type 列断言上补 `text-destructive` / `text-sm`。
- 影响面：无新增文件；**上游自有文件**：
  `web/src/features/pricing/components/{original-price,price-discount-badge}.tsx`、
  `web/src/features/pricing/__tests__/group-discount-display.test.tsx`。
- 与上游差异：上游没有折扣/原价展示（Z013 引入）；本次只在 Z013 的基础上调整配色与字号，未改共享
  `@/components/group-badge.tsx`，因此密钥页等其它 `GroupMultiplierBadge` 用法不受影响。
- 开关与默认值：无开关；无折扣与溢价分组维持原配色，删除线原价仍只在 Z013 的显示条件下出现。
- 验证：见 §6 的 Z014 小节。
- 风险与未覆盖：红色取自主题 `destructive` 变量，深浅色与主题预设下会随之变化；未在真实浏览器截图
  核对红色与卡片背景的对比度。

### Z015 模型广场折扣徽标中文文案改为「最高」

- 需求与原因：卡片模式未选分组时的折扣徽标显示「最优分组 -40%」，交付方要求「最优分组」改为「最高」，
  即呈现为「最高 -40%」。
- 变更内容（前端）：`web/src/i18n/locales/zh.json` 的 `Best group` 由「最优分组」改为「最高」。
  仅中文；其余 6 种语言保持 Z013 的译文不变。
- 影响面：无代码改动；**上游自有文件**：`web/src/i18n/locales/zh.json`
  （同 Z002 / Z004 / Z007 / Z012 / Z013）。
- 与上游差异：该 key 是 Z013 新增，上游没有这条文案。
- 开关与默认值：无。
- 验证：见 §6 的 Z015 小节。
- 风险与未覆盖：仅在 `isBest`（未选中分组、取最小倍率分组）时出现；测试默认英文环境，
  断言 `Best group -40%` 不受影响。

### Z016 折扣徽标前缀按正负号区分「最高 / 最少」

- 需求与原因：Z015 把「最优分组」改成「最高」后，未选分组时的前缀不再区分方向——溢价分组会显示
  「最高 +50%」。交付方要求按后面数字的正负号选词：负数（折扣）显示「最高」，正数（溢价）显示「最少」。
- 变更内容（前端）：
  - `components/price-discount-badge.tsx`：`isBest` 时的前缀改为按 `discount.percent < 0` 选择
    `Best group`（中文「最高」）或新增的 `Lowest premium`（中文「最少」）；显式选中分组仍只显示百分比。
  - i18n：7 个 locale 新增 `Lowest premium`，插在字母序位置 `Lowest median first-token latency` 之后
    （en / en、zh 最少、zh-TW 最少、fr Minimum、ru Минимум、ja 最小、vi Thấp nhất）。
  - `__tests__/group-discount-display.test.tsx`：新增「最优分组仍为溢价时渲染 `Lowest premium +50%`」用例。
- 影响面：无新增文件；**上游自有文件**：
  `web/src/features/pricing/components/price-discount-badge.tsx`、
  `web/src/features/pricing/__tests__/group-discount-display.test.tsx`、
  7 个 `web/src/i18n/locales/*.json`。
- 与上游差异：该徽标与 `Best group` / `Lowest premium` 均为 Z013 / Z015 / Z016 引入，上游没有。
- 开关与默认值：无；仅在 `isBest`（未选中分组、取最小倍率分组）时带前缀。
- 验证：见 §6 的 Z016 小节。
- 风险与未覆盖：其余 6 种语言的 `Lowest premium` 为本次新增译文，未做母语校对；
  显式选中分组时不带前缀（与 Z013 一致）。

### Z017 Seedance 视频测活按渠道分组计费，并支持指定计费分组

- 需求与原因：Z003 的视频测活用「执行测试的管理员账号分组」计费（如 `business` 倍率 1.0），
  但渠道 22（`Seedance mini 企业`，倍率 0.5）根本不分发该分组，真实流量永远不会按 1.0 计价。
  实测同一条 87300 token 的任务：上游收 $1.0039（0.5x），本网关向 admin 收 ¥2.0079（1.0x），
  正好差 2 倍，测活成本与真实成本不具可比性。
- 变更内容（后端，`controller/seedance_channel_health.go`）：
  - 新增 `seedanceTestBillingGroup`：优先用查询参数 `billing_group`（必须已在分组倍率表配置，
    否则报 `seedance_test_billing_group`）；未指定时取渠道自身第一个分组；渠道未配置分组时才回退到
    测试账号分组。结果同时写入 `ctx.Set("group")` 与 `ctx.Set("token_group")`，因此预扣、结算
    （`task.Group`）与日志分组口径一致。
  - `seedanceTestTaskResult` 在 `task.Group` 非空时返回 `billing_group`，让轮询阶段也能看到计费分组。
  - 系统日志消息增加 `billing_group={{group}}`。
  - 删除死代码 `ctx.Set("specific_channel_id", ...)`（全仓库无读取方；真正锁渠道靠
    `seedance_test_channel` → `relayInfo.LockedChannel`），随之删除 `strconv` 导入。
- 变更内容（前端）：
  - `lib/seedance-channel-test.ts`：`runSeedanceChannelTest` 新增可选 `billingGroup` 参数，仅在提交
    时携带 `billing_group`（轮询不携带），并把响应的 `billing_group` 透到 `SeedanceTestUpdate`。
  - `api.ts`：`testChannel` 参数增加 `billing_group`。
  - `channel-test-dialog.tsx`：`seedance-video` 端点新增「Billing group」选择器，选项来自渠道自身
    分组（`currentRow.group` 逗号拆分），默认即渠道第一个分组；测试结果行同时显示计费分组。
  - i18n：7 个 locale 新增 `Use the channel first group` 与
    `The test is billed as this group, matching what real traffic to this channel pays. Defaults to the channel first group.`。
- 影响面：无新增文件；**上游自有文件**：`web/src/features/channels/api.ts`、
  `web/src/features/channels/components/dialogs/channel-test-dialog.tsx`、
  7 个 `web/src/i18n/locales/*.json`；fork 自有文件：`controller/seedance_channel_health.go`、
  `controller/seedance_channel_test_test.go`、`web/src/features/channels/lib/seedance-channel-test.ts`
  及其测试。
- 与上游差异：上游没有 Seedance 测活（Z003 引入）；本次把计费分组从「测试账号分组」改为
  「渠道分组」，并开放 `billing_group` 覆盖。
- 开关与默认值：无开关。默认取渠道第一个分组；`billing_group` 指定值必须存在于分组倍率配置中。
  渠道无分组时仍回退到测试账号分组，保持旧行为。
- 验证：见 §6 的 Z017 小节。
- 风险与未覆盖：多分组渠道默认只测第一个分组，其余分组需要手动选；`billing_group` 只校验倍率表
  是否存在，不校验该分组是否真的被这条渠道服务（便于验证「假如按该分组计费」的场景）；
  历史任务的 `task.Group` 仍是旧口径，不会被回溯修正。

### Z018 放行 type 55 中转渠道的 Seedance mini/fast 模型，并加构建期守卫

- 需求与原因：`doubao` 任务插件声明 Seedance 视频模型后，`POST /v1/videos` 的请求会被 pin 到该插件，
  并追加 `task_plugin_identity` 渠道过滤器；该过滤器只放行 VolcEngine(45)/DoubaoVideo(54)，或显式
  绑定 `doubao` 的 NewAPI(60)/TaskPlugin(61) 渠道。本部署的 Seedance 渠道全部是 type 55（Sora 兼容
  中转，指向 zhongkeyu），因此启用 doubao 后一律返回
  `model_not_found ... 该模型由任务插件认领，但当前没有启用的渠道可服务此模型`。实测日志：
  `task_plugin subsystem=distribution event=no_available_channel group="Seedance mini 企业"
  model="doubao-seedance-2-0-mini-260615" plugins="doubao" reason=no_eligible_channel`；禁用 doubao 后
  同一请求由渠道 22 走 `type 55 → sora` 链路成功。
- 变更内容：
  - `plugins/tasks/doubao/plugin.js`：新增
    `RELAY_VIDEO_MODEL_PATTERN = /^doubao-seedance-.*-(?:mini|fast)-/`，用它过滤出仍由插件认领的
    `OWNED_VIDEO_MODELS`，并同时用于 `meta.models`、`meta.usageProfiles` 与
    `protocols.openai_video.models`（三者必须一致，只改其一要么启动时 `ValidateV1Meta` panic，要么
    `/v1/videos` 仍被认领）。`VIDEO_MODELS` 保留全部能力条目与用法画像，恢复某个家族只需收窄正则。
    插件版本 `1.3.0` → `1.3.1`。
  - `plugins/doubao_responses_test.go`：新增 `TestDoubaoRelayVideoModelsStayUnclaimed`（两个家族不在
    `meta.models`、`/v1/videos` 与 `/v1/responses` 均不绑定、不出现在任何 usage profile；
    `doubao-seedance-2-0-260128` 与 `2-5-260628` 仍被认领）与 `TestDoubaoRelayVideoModelPattern`
    （从插件源码提取正则，用 `2.0 mini/fast`、`2.1 mini`、`3.0 fast`、`2.0`、`2.5`、`1.5 pro`、
    `fastest` 断言命中与不命中）；`TestDoubaoSeedanceUsageFacts` 的 family 列表相应去掉 mini/fast。
  - 新增 `scripts/check-doubao-plugin-patch.sh`：逐个校验 4 个锚点（正则规则、`meta.models`、
    `meta.usageProfiles`、`openai_video` claim），并要求 `OWNED_VIDEO_MODELS` 恰好出现 4 次；任一缺失
    即以非 0 退出并打印具体锚点。
  - `makefile`：新增 `check-plugin-patch` target，并让 `test` 依赖它（CI 的 `make test` 因此覆盖）。
  - `Dockerfile`、`Dockerfile.dev`：在 `go build` 前执行同一脚本，补丁缺失时镜像构建直接失败。
- 影响面：**上游自有文件**：`plugins/tasks/doubao/plugin.js`、`plugins/doubao_responses_test.go`、
  `makefile`、`Dockerfile`、`Dockerfile.dev`；fork 自有文件：新增
  `scripts/check-doubao-plugin-patch.sh`。不改路由、计费规则、渠道表结构与数据库结构。
- 与上游差异：上游把 Seedance 2.0 mini/fast 全部算作 doubao 插件模型；本 fork 让这两类模型保持
  “无人认领”，从而继续走 `type 55 → sora 插件` 的旧适配链路。仅被正则命中的模型名受影响。
- 开关与默认值：无运行时开关，规则在插件编译期生效。前置条件：`sora` 插件必须保持启用
  （type 55 的 adaptor 由 `relay/relay_adaptor.go` 的 `55 → sora` 映射解析），且
  `TaskPluginDisabledFactoryKeys` 中不含 `doubao`。若通过插件管理上传 override 而非重建镜像：新版本
  默认 inactive，必须手动激活，且不要使用插件市场的“更新”（会装上未打补丁的官方源码并自动激活）。
- 验证：见 §6 的 Z018 小节。
- 风险与未覆盖：上游更新 `plugins/tasks/doubao/plugin.js` 时需重放补丁，锚点校验负责拦截漏改（更新
  规则时须同步修改脚本里的正则锚点行）；正则只覆盖 `mini`/`fast` 家族，其它新家族（如 `pro` 变体）
  仍会被插件认领；这两个模型在插件侧不再提供 usage profile，定价仍按中转链路（sora，seconds/size）
  口径，`model price not found` 的兜底不在本条目处理；价格页因此缺少这两个模型的
  `billing_usage_schema`（与插件禁用时一致），Z002 未移植的 `ArkVideoPrice` 卡片仍是缺失状态（见
  [zhongke-customization-port.md](zhongke-customization-port.md) §3.4）；override 路径存在
  “镜像升级但 override 未更新”的漂移风险。

---

### Z019 概览客户端填法复制完整 API 密钥

- 需求与原因：概览页「客户端填法」的 API 密钥行此前直接复制展示用的掩码，无法用于客户端鉴权。
- 变更内容：密钥行复用接入卡现有的完整密钥复制回调，点击时请求所选密钥的 `/api/token/:id/key`，成功后复制带 `sk-` 前缀的完整密钥；请求期间禁用按钮，失败沿用统一错误提示。页面继续展示掩码。
- 影响面：fork 自有文件 `web/src/features/dashboard/components/overview/access-guide/{index,code-samples}.tsx` 及其 `__tests__/access-guide.test.tsx`；上游自有文件无。
- 与上游差异：扩展 fork 的概览接入卡；不修改后端接口或通用复制组件。通用 `CopyButton` 只接受同步字符串，密钥行组合已有 `Button` 与卡片异步复制回调，端点和模型行继续复用 `CopyButton`。
- 开关与默认值：无开关，当前选中密钥生效，完整密钥按点击获取。
- 验证：新增用例先复现未调用完整密钥接口的失败，再验证剪贴板内容为完整测试密钥；`cd web && ./node_modules/.bin/vitest run src/features/dashboard` → 7 文件、76 用例通过；`./node_modules/.bin/tsgo -b` 和改动 TSX 文件的 `oxlint -c .oxlintrc.json` 均退出码 0。
- 风险与未覆盖：未做真实浏览器与线上剪贴板验证，未发布；本机未安装 Bun，使用现有依赖中的工具执行验证。

---

### Z020 A1 用户端页面设计基础（代表页接入）

- 需求与原因：参考新版 Demo 的留白与视觉层级，为后续用户端改版建立兼容的页面骨架，先在 API 密钥与普通使用日志验证，不扩大到业务流程重构。
- 变更内容：`SectionPageLayout` 新增显式 `variant='user'` 与可选 `Description` 插槽；仅当前账号角色为普通用户时启用局部页头、间距、可换行标题和表头层级。分页保留现有 portal 容器，移动端操作可换行；管理员、超级管理员（包括日志“仅我的”）和未接入页面保持默认布局。
- 影响面：**上游自有文件** `web/src/components/layout/components/section-page-layout.tsx`、`web/src/features/keys/index.tsx`、`web/src/features/usage-logs/index.tsx`、`web/src/styles/index.css`；新增 `web/src/styles/user-page.css` 和 layout 专属 `__tests__/section-page-layout.test.tsx`。升级上游时重点复核 variant、角色保护和局部样式导入。
- 与上游差异：扩展现有布局而非重建页面；仅 `/keys` 和 `/usage-logs/common` 请求新 variant，任务/绘图/审计和公共页不接入；列、筛选、请求、权限、弹层与业务操作保持原契约。
- 开关与默认值：组件默认仍为旧布局；非普通用户即使请求 user variant 也不启用。没有全局主题或持久化开关；颜色、字体、字号与圆角继承现有主题偏好，不固定 Demo 蓝色。body portal 弹层仍使用既有全局主题。
- 验证：新增用例先观察到缺少 user 外观的失败，实现后骨架 7 用例通过（默认隔离、角色隔离、账号切换、标题/说明、分页与键盘）；相关 8 文件测试在追加键盘用例前共 60 用例通过；`bun run typecheck`、`bun run build` 通过，改动 TSX 的定向 oxlint 及改动文件的 oxfmt 检查通过。最终全量测试为 215 文件通过、1 文件失败，2574 用例通过、1 超时：`detail-preview.test.tsx` 的 `task log prices use localized unit labels from pricing metadata`；未修改 HEAD 临时副本单独复跑同样超时。全量 lint/format 均有既有失败，HEAD 副本也失败，本次不修无关问题。
- 风险与未覆盖：Chrome 访问本地 `/keys` 重定向到登录页，当前没有可用登录会话；未完成真实普通用户/管理员页面截图、多屏宽、深浅/预设主题、焦点恢复及真实业务闭环验收。不宣称 A1 已完成全部视觉验收；需有授权会话后补验。未修改 Demo、Compose、后端或部署配置。

---

### Z021 A1 剩余普通用户控制台页面接入

- 需求与原因：用户确认在代表页之后，将 A1 基础外观扩展到剩余普通用户控制台内容页，公共页与聊天/Playground 另批处理。
- 变更内容：概览、数据看板、任务/绘图日志、审计日志、钱包、安全与访问显式接入既有 user variant；个人资料保留 ProfileHeader 和原卡片结构，仅按普通用户角色应用同一局部留白。管理员与超级管理员继续旧视觉，审计“仅我的”不例外。
- 影响面：**上游自有文件** `web/src/features/dashboard/index.tsx`、`web/src/features/dashboard/components/overview/overview-dashboard.tsx`、`web/src/features/profile/index.tsx`、`web/src/features/security/index.tsx`、`web/src/features/usage-logs/index.tsx`、`web/src/features/usage-logs/audit/index.tsx`、`web/src/features/wallet/index.tsx` 及 overview/security/audit 对应既有测试；fork 自有 `web/src/styles/user-page.css` 增加个人资料内容留白。上游合并时复核 opt-in 和角色隔离。
- 与上游差异：复用 Z020 的局部骨架，不修改表格列、筛选、统计、支付、资料字段、安全验证、权限、路由或接口；个人资料不增加重复页头。
- 开关与默认值：只有普通用户生效，继承原主题偏好；管理员、公共页、认证页、聊天和 Playground 不改变。
- 验证：新增概览/安全/个人资料接入断言实现前 3 个失败，实现后通过；包含管理员隔离及审计个人范围回归。`bun run test -- src/features/security src/features/profile src/features/wallet src/features/dashboard src/features/usage-logs/audit src/features/usage-logs/__tests__ src/components/layout/components/__tests__` → 28 文件、288 用例通过；`bun run test` → 216 文件、2581 用例全部通过（存在既有 JSDOM scrollTo/canvas 提示）；`bun run typecheck`、`bun run build`、改动 TSX 定向 oxlint 和改动文件 oxfmt 检查通过。
- 风险与未覆盖：Chrome 访问本地 `/profile` 仍重定向登录，缺少可用会话；真实账号下多屏宽、主题、业务操作、焦点恢复未验收，不宣称视觉验收全部完成。未调整部署或后端。

---

### Z022 已接入 A1 页面统一所有账号角色，并更新页面计划

- 需求与原因：用户明确所有用户都用新布局，并要求把已完成代码进度同步到 `c-dev/frontend-phase-one-page-plan.md`。
- 变更内容：取消 Z020/Z021 的 ROLE.USER 样式限制，`variant='user'` 仅表示视觉类型，普通用户、管理员、超级管理员在已接入页面统一新外观；个人资料同样统一。未接入的管理页保持默认布局，接口和权限不变。页面计划记录已接入页面、提交、验证与尚未完成的浏览器验收，不将 A1 标成全部验收通过。
- 影响面：**上游自有文件** `web/src/components/layout/components/section-page-layout.tsx`、`web/src/features/profile/index.tsx`、`web/src/features/security/__tests__/page.test.tsx`、`web/src/features/usage-logs/audit/__tests__/viewer.test.tsx`；fork 骨架测试和 `c-dev/frontend-phase-one-page-plan.md`。该决策覆盖 Z020/Z021 中“管理员旧视觉”的历史边界。
- 与上游差异：页面显式 opt-in 机制保留，仅移除外观的角色条件，不更改认证、角色、个人/全量查询及服务端权限。
- 开关与默认值：已接入页面所有角色一致；组件默认 variant 仍不改变未接入页面。
- 验证：更新预期后实现前 6 用例失败；取消限制后定向 3 文件/49 用例通过；typecheck、build 与改动文件 lint/format 通过。全量 215 文件通过、1 文件失败，2580 用例通过、1 超时；失败仍是已在干净 HEAD 副本复现过的 `detail-preview.test.tsx` 中 `task log prices use localized unit labels from pricing metadata`，上一批该用例曾通过，存在不稳定性，不修改超时阈值或测试断言。
- 风险与未覆盖：缺少授权登录会话，真实账号视觉验收未完成；任务仍待补验，不声称管理页像素级无变化。

---

### Z023 微信可选资料同步与通用用户头像

- 需求与原因：接入 wechat-server 可选 `profile`，为微信用户补齐昵称并在账号入口显示头像，兼容无资料的原登录链路。
- 变更内容：用户增加 `avatar_url` / 内部 `avatar_source`；新用户使用有效微信资料，已有登录仅补齐空/默认昵称及空/微信来源头像，绑定仅补齐空头像；空资料不清空已有值。资料失败不绕过二次验证或阻断有效登录/绑定。共享 self DTO 返回头像，桌面菜单和移动入口复用头像图片/默认降级。
- 影响面：**上游自有文件** `controller/wechat.go`、`controller/user.go`、`model/user.go`、`web/src/stores/auth-store.ts`、`web/src/components/profile-dropdown.tsx`、`web/src/components/layout/components/mobile-drawer.tsx`；新增 `model/wechat_profile.go`、`controller/wechat_profile_test.go`、`web/src/components/__tests__/account-avatar.test.tsx`。
- 与上游差异：扩展原 OpenID-only 微信资料和字母头像；OpenID 身份、注册开关、封禁、绑定安全证明和会话策略不变；资料更新使用绑定标识和当前字段所有权条件，不保存过期整用户快照。
- 开关与默认值：无新增开关；无头像默认空，来源不对外序列化；头像仅接受 HTTPS、无 URL 凭据、最长 2048 字节；昵称移除控制字符并限制 20 个 Unicode 字符；不代理下载图片。外部头像设置 no-referrer。
- 验证：定向 `go test ./controller -run '^TestWeChat' -count=1` 通过，含解析/策略/绑定安全证明/二次验证及资料更新失败；SQLite 3.50.4、Docker MySQL 8.4.13、临时 Docker PostgreSQL 17.11 新建、旧结构升级和重复迁移通过（使用独立一次性测试库或容器，完成后清理，不修改开发库）。前端头像 6 用例、`bun check -b`、定向 oxlint、生产构建通过；`go build ./...`、`go vet ./controller ./model` 通过。
- 风险与未覆盖：数据库验证覆盖上述具体版本，未覆盖最低支持版本；旧结构升级用当前用户表去除新增两列构造，不代表所有历史版本升级组合。`go test ./...` 的采样兼容 4 用例及 advancedcustom 代理错误用例失败；采样失败已用 HEAD 文件 overlay 复现，后者未修改且定向复跑仍失败。前端全量 216 文件通过、1 文件失败（2586 通过、1 超时），为 Z022 已记录的日志详情超时，单文件 30 用例通过。不更改无关断言或超时。未做真实账号浏览器验收或真实微信接口验证。遵循 OWASP Authentication / Session Management Cheat Sheets 的绑定再认证、会话不降级、无敏感日志原则；未宣称完整 ASVS 合规。未部署；回滚可保留新增列，不删除用户资料。

---

### Z023 页面计划新增 A1.5 顶部菜单视觉对齐

- 需求与原因：用户要求在 A1 与 A2 之间补充按 `ZYY-AI-demo.html` 修改顶部菜单样式的计划，并列出需保留的语言、主题、公告功能。
- 变更内容：页面总览、详细步骤与实施顺序增加 A1.5；列出语言、主题/外观、公告/通知、账号、搜索、系统更新及组件插槽/显隐契约，明确只做视觉、保留权限及真实数据，不代替 A2 的导航业务调整。
- 影响面：`c-dev/frontend-phase-one-page-plan.md`；上游自有文件无，未修改运行代码。
- 与上游差异：仅更新 fork 改版规划，不引入运行行为。
- 开关与默认值：无新增开关；A1.5 尚未实施。
- 验证：核对 Demo 顶栏选择器与现有 app/public header 的组件调用；`git diff --check` 通过，人工核对 A1.5 位于 A1 与 A2 之间，未执行前端测试（本次仅文档）。
- 风险与未覆盖：最终菜单布局和移动端表现需在实施阶段验证，本文不宣称功能或视觉已交付。

---

### Z024 A1.5 顶部菜单视觉对齐及移动端功能保留

- 需求与原因：实施 A1.5，以 Demo 通栏与圆角导航视觉取代公共滚动胶囊，保留语言、主题、公告及原有账号/搜索/更新能力。
- 变更内容：公共顶栏 64px 固定通栏、1200px 内容容器，右侧工具桌面/移动共用；移动导航复用现有 Sheet，关闭时不保留隐藏可聚焦链接，支持 Escape/焦点恢复，保留工作台/登录入口。控制台 Header 添加背景/底边并同步高度，TopNav 移动下拉不再被外层隐藏，导航增加语义色 hover/active。公共头部插槽及显隐参数保留。
- 影响面：**上游自有文件** `web/src/components/layout/components/{header,app-header,public-header,top-nav}.tsx`、`web/src/styles/theme.css`（高度变量）；新增 layout `__tests__/{public-header,app-header}.test.tsx`；更新 fork 页面计划。升级时重点复核顶栏结构、移动 Sheet 和高度变量与侧栏/内容区消费者的一致性。
- 与上游差异：改变顶部菜单视觉与移动端可达性，不改导航目的地、动态配置优先级、账号数据、通知读取逻辑、认证和后端；未新增依赖。
- 开关与默认值：沿用 show*、rightContent/leftContent、navContent、mobileLinks 等配置；所有角色视觉一致，搜索、更新、账号等仍受现有权限/显隐控制。--app-header-height 为 4rem，SidebarInset/Sidebar 继续依赖同一变量。
- 验证：新增公共入口/移动菜单回归实现前失败（调试中修正 notice fixture 类型）；最终顶栏及主题定向 4 文件/23 用例通过，typecheck/build/修改文件 format 通过，定向 lint 无 error（TopNav 有既有 self-closing warning）。最终全量 218 文件通过、1 失败，2591 用例通过、1 超时；仍为已在历史干净 HEAD 副本复现的 detail-preview.test.tsx / task log prices use localized unit labels from pricing metadata，未弱化断言或提高超时。Chrome 公共模型页检查 360/390px 移动端工具和菜单截图、1440px 深色与滚动高度稳定，页面无横向溢出。
- 风险与未覆盖：受保护工作台缺登录会话；768/1280px、长品牌/昵称、真实公告数据交互和更新权限尚未完成浏览器验证。工作台移动下拉和 showSearch 显隐已有组件测试，但不替代真实布局验收。本地为验收启动前端 dev server，未改部署配置。

---

### Z025 同步 A1.5 计划完成状态

- 需求与原因：用户要求更新页面计划状态，避免已交付代码仍全部显示待办。
- 变更内容：同步文档开头的 A1/A1.5 状态、A1.5 提交号与已实现检查项，补充最终测试结果和剩余运行态验收；不将未验证项标为完成。
- 影响面：`c-dev/frontend-phase-one-page-plan.md`；上游自有文件无。
- 与上游差异：仅 fork 规划进度记录，不变更运行行为。
- 开关与默认值：无。
- 验证：核对提交 `1a0deb03b` 与 Z024 验证记录，`git diff --check` 通过；纯文档未重跑前端测试。
- 风险与未覆盖：完整浏览器验收仍待补，任务未归档。

---

### Z026 订阅页面前端演示

- 需求与原因：在模型广场后增加订阅入口，按 `c-dev/ZYY-AI-demo.html` 还原订阅页面；用户确认本次只做前端演示，不接后端 API。
- 变更内容：新增公开 `/subscription` 页面、月付/年付三档套餐、自动续费和单次购买演示、确认弹窗、规则、订单/发票空态；入口复用 `useTopNavLinks`，置于 Model Square 后。演示不会支付、授权、改余额、改订阅或生成订单。
- 影响面：`web/src/features/subscription-demo/`、`web/src/routes/subscription/`、`web/src/styles/subscription-demo.css`、`web/src/hooks/use-top-nav-links.ts`、前端翻译文件、生成路由树；新增 `c-dev/subscription-page-implementation.md`。
- 与上游差异：全部为 fork 前端页面和文案，不修改后端、接口、部署及真实钱包订阅功能；未新增依赖。静态价格/积分规则不是后端契约。
- 开关与默认值：入口为前端固定入口；页面状态只存在组件内，刷新清空。沿用公共布局、主题、语言、Dialog、Button、Switch、Tabs、Checkbox、Select。
- 验证：订阅/顶栏定向 5 文件/18 用例、typecheck、build 通过；Chrome 1440px 中文浅色、390px 深色、360px 弹窗检查无横向溢出。全量 2597 通过、1 个已知日志详情超时；完整多角色和全部语言人工校对未覆盖。
- 风险与未覆盖：未来真实接入前必须重新确认套餐、价格、支付授权、订单、发票、积分和权益契约，不能将演示确认回调直接视为支付成功。

---

### Z027 自定义订阅隔离与反馈修正

- 原因：用户要求自定义订阅独立命名、仅中文、规则UI对齐 Demo、补 Footer 和客服弹窗。
- 内容：feature 改为 `subscriptions-custom`，保留 `/subscription`；移除首版新增全局语言 key/static-keys，改 feature 内中文文案；规则恢复分隔线/字号/间距和蓝色强调；复用公共 Footer；客服 Dialog 复用 CopyButton 展示并复制 Demo 微信/邮箱。
- 影响：自定义 feature/样式、公开路由 import、导航中文文案、全局资源撤销新增项、实施文档；不改原生订阅、后端或真实支付。
- 默认与兼容：页面固定中文，公共布局仍使用既有语言设置；URL和演示边界不变；不新增依赖。Demo 联系方式未核实线上可用性。
- 验证：定向2文件7用例、typecheck、定向 lint、build、diff 检查通过；浏览器确认规则11条/8处强调/Footer及客服弹窗内容，无横向溢出；本轮未重跑全量。

---

### Z028 自定义订阅 Footer 对齐 Demo

- 原因/内容：用户要求 Footer 颜色、线长和内容完全参考 Demo；新增 feature 内 Footer、独立CSS及 Demo 常见报错数据。背景#fafbfc/线#e8ebf0，1200px/28px容器、帮助/合作和品牌介绍；移出公共 main 容器以实现通栏顶线/内容区版权线。
- 兼容/边界：仅自定义订阅页，不改全局 Footer/后端/原生订阅；客服共用原弹窗，常见报错使用本地 Dialog，无不存在文档链接。额外保留 new-api 版权归属，不删许可证标识。
- 验证：定向2文件8用例、typecheck/lint/build通过；浏览器桌面版权线1144px、390px设备334px且无横向溢出。未重跑全量。

---

### Z029 自定义页脚版权行排版

- 需求/内容：保留完整 New API 归属信息，桌面版权行使用 flex 两端对齐，600px以下归属单独换行；维持12px可读字号、颜色及原分割线。不隐藏、删改归属文字。
- 影响：仅 `subscriptions-custom-footer.css` 与实施文档，无后端/全局Footer改动或新依赖。
- 验证：修改CSS格式及 diff 检查通过；订阅定向测试通过。浏览器复验因无可用页面未完成；未重跑全量或构建（纯CSS排版）。

---

### Z030 人民币与积分业务规则

- 需求/内容：在 `.agents/rules/billing.md` 新增自定义业务兑换基准 `1 RMB = 1,000积分`、正反换算公式、基础/赠送区分及业务积分与底层 quota 的边界。
- 影响/兼容：仅 Agent 规则与本登记；不修改后端、QuotaPerUnit、美元计价、现有数据或运行行为。不据此推断取整规则或提现能力。
- 验证：核对公式与¥29/29,000积分示例，`git diff --check` 通过；纯文档未运行测试或构建。

---

### Z031 积分规则独立文件

- 需求/内容：将 Z030 的人民币/积分规则原文从 `.agents/rules/billing.md` 迁至 `.agents/rules/points.md`；在 `AGENTS.md` 增加按任务触发的完整阅读入口，不重复存放兑换规则。
- 影响/兼容：仅规则文档及登记，无运行行为变化，billing 原有约束保留。
- 验证：迁移内容完整、阅读入口路径存在、`git diff --check` 通过；纯文档未运行构建或测试。

---

### Z032 消费积分进一法规则

- 需求/内容：`points.md` 明确消费人民币金额转积分使用 `ceil(amountRMB × 1000)`，最小单位1积分；零消费为0，正数不足1积分计1，整数不额外加1，并提供边界示例和精确十进制要求。
- 影响/兼容：仅规则文档，不修改实际扣费实现；不扩展为充值、赠送或退款取整规则。
- 验证：核对三组边界示例和零值语义，`git diff --check` 通过；纯文档未运行测试或构建。

---

### Z033 Agent 目录跟踪范围

- 需求/内容：`new-api/.agents/` 仅 `rules/` 纳入 Git，`.gitignore` 忽略其他直接子项；已跟踪的 `github/`、`skills/` 共16文件取消索引跟踪，保留本地文件。
- 影响/兼容：新克隆不再携带上述本地助手文档/技能，AGENTS 中既有相关引用需由开发者本地提供；规则文件继续跟踪。不修改根仓库、子模块指针、产品代码或后端。
- 验证：`git ls-files .agents` 仅剩 billing.md/points.md；`git check-ignore` 确认 github/skills 被忽略，本地文件仍存在，diff 检查通过；无运行代码变更，未运行测试/构建。

---

### Z034 积分六表与 GORM 持久化模型

- 需求与原因：为 GENERAL 与 GPT 积分提供独立账户、模型适用规则、业务幂等记录、变化流水及冻结记录，为后续积分业务准备持久化结构。
- 变更内容：新增六个 GORM 模型，接入主库启动迁移；初始化 GENERAL（优先级 100、`*`）和 GPT（优先级 10、`gpt-*`），后续启动保留管理员修改及删除的规则。详见 [points-schema.md](points-schema.md)。
- 影响面：新增 `model/point.go`、`model/point_test.go`、`docs/customization/points-schema.md`；**上游自有文件**：`model/main.go` 增加积分主库迁移调用。
- 与上游差异：在原有 quota 账户之外增加独立业务积分表；没有接入或替换原有扣费、充值、Redis 或日志库逻辑。
- 开关与默认值：由现有主节点启动迁移执行，无新增环境开关；积分使用 int64，时间使用毫秒；默认规则只在对应类型首次创建时插入；MySQL 模型规则值使用列级大小写敏感排序规则。
- 验证：隔离真实数据库 SQLite 3.50.4、MySQL 8.4.13、PostgreSQL 17.11；配置 `TEST_MYSQL_DSN` / `TEST_POSTGRES_DSN` 后执行 `go test ./model -run '^TestPointsDatabaseMatrix$' -count=5` 全通过（MySQL 同时启用 `clientFoundRows=true`），`go test ./model -count=1` 全通过。覆盖空库、代表性既有表升级、重复迁移无 DDL、配置保留、大小写规则、并发初始化、唯一约束及 64 位往返。`go build ./...`、`go vet ./model`、`gofmt` 与 `git diff --check` 通过；本机 Go 1.27.3，未修改模块声明的 Go 1.26.10。
- 补充验证：`go test ./model -run '^TestPoints' -count=1` 三库聚合通过；包含 SQLite 故障注入测试，验证初始规则写入失败时类型与规则回滚、错误上抛并可重试。
- 风险与未覆盖：本次只建表与 ORM，尚未实现真实消费、模型匹配、冻结或管理接口；没有完整最新发行版数据库 fixture，升级测试为代表性既有余额表样本；未实测最低支持版本 MySQL 5.7.8 / PostgreSQL 9.6；不声称仅靠表结构保证余额一致性和流水不可变性。

---

### Z035 管理员积分类型与模型规则配置

- 需求与原因：在 Admin 菜单 Users 下方增加积分入口，动态查看数据库中全部积分类型，并管理每种类型支持的模型规则。
- 变更内容：新增 `/points` 页面与 `/api/points/types` 管理接口；类型名称、编码与消费优先级只读，模型规则支持 EXACT/PATTERN、新增、编辑、启停及删除。类型新增/删除仍通过脚本或数据库完成，没有类型写接口。
- 权限与兼容：全部接口要求管理员，控制台页面有角色守卫，PAT 不可调用；旧侧栏配置缺少 points 项时继承默认值，显式关闭继续生效。规则按父类型隔离，唯一约束处理重复，更新保留 `enabled=false`，严格拒绝越权字段。
- 规则语义：区分大小写、完整字符串；PATTERN 仅 `*`、`?` 为通配符，其他字符为字面值。允许未来模型名，多条启用规则为 OR，允许清空规则。这里只保存配置，未接入实际模型匹配、积分扣费、冻结或充值，不修改 quota。
- 影响面：新增积分管理 model/controller 与前端 feature/route；**上游自有文件**：`router/api-router.go`、`middleware/access_token_routes.go`、前端侧栏数据/默认配置、maintenance 配置/侧栏设置、生成路由树、七种语言文件及相关既有测试。无新依赖、无 schema 或部署变更。
- 与上游差异：扩展原有管理员菜单与接口目录，为独立积分表增加管理入口；复用现有控制台组件、管理员鉴权和会话机制，不修改原有计费路径。
- 验证：`go test ./model -run '^TestPointRulesAdminDatabaseMatrix$' -count=1 -v` 在隔离真实 SQLite、MySQL 8.4.13（`clientFoundRows=true`）、PostgreSQL 17.11 全通过，覆盖 CRUD、false/no-op 更新、大小写、归属与并发重复；`go test ./model ./controller ./router ./middleware -count=1` 中 model/router/middleware 三包全通过，真实路由覆盖管理员/Root、普通用户、匿名、PAT、受保护字段及类型写接口不存在；`go build ./...` 与四包 `go vet` 通过。前端定向 Vitest 6 文件/46 用例、`tsgo -b`、改动文件 oxlint/oxfmt、生产构建与 diff 检查通过；独立全范围检查通过。
- 浏览器验证：隔离 Chrome + 独立 SQLite 服务验证桌面 EXACT 新增/编辑/停用/确认删除、390px 移动端 PATTERN 新增、重复错误保留表单、加载/空列表/失败重试、DB 插入 DS 类型后动态显示；无 JS 异常、无页面横向溢出。
- 既有问题与限制：扩大到 `go test ./controller -count=1` 时，`TestOpenAIChatSamplingCompatibility` 的 4 个子例因缺少 `reasoning_effort:none` 失败；通过 Go overlay 移除本次唯一新增 controller 文件后同样复现，未改动该计费/协议路径。全仓版权检查另有 34 个既有文件缺少或不符合标准头，本次仅补齐 12 个新增前端文件。未实测最低 MySQL/PostgreSQL 版本；本次不实现配置的运行时匹配或实际积分扣费。

---

### Z036 管理员用户列表积分列

- 需求与原因：管理员在余额列之后直接查看各用户持有的积分类型、可用积分和冻结积分，区分用途与冻结状态。
- 变更内容：分页和搜索列表为当前页用户批量读取积分账户，附加只读 `point_balances`；按通用、GPT、其他类型稳定展示，双零隐藏，无账户显示 `—`。前端一列最多两行，更多类型通过现有明细弹层展开；冻结积分单独标示。
- 与上游差异：在原有用户列表增加独立积分账户信息，不将 points 与 quota 换算，不修改原有余额操作、排序或筛选。保留现有管理员和 PAT 鉴权；积分查询失败使列表报错，不当作零积分。
- 兼容与精度：只为列表添加响应字段，积分以十进制字符串传输，前端通过 BigInt 精确格式化 int64，保留现有数字格式语义；不扩展全局 User ORM 或单用户响应。无新依赖、schema、部署、账户写入、实际积分消费或冻结操作。
- 影响面：新增用户积分批量查询/响应 DTO、积分单元格及回归测试；**上游自有文件**：`controller/user.go`、前端 users API/类型/列配置、公共数字格式化、共享 QuotaDetailsPopover（长名称换行与高度限制/滚动）、七种 locale 及对应既有测试。复用现有表格、Tooltip、QuotaDetailsPopover。
- 验证：SQLite、MySQL 8.4、PostgreSQL 17 真实数据库矩阵均通过；列表/搜索真实鉴权、PAT、分页、只读、批量查询、错误响应与 int64 精度定向测试通过。前端 users/data-table 相关 9 文件 60 用例通过；移动端修复后定向 38 用例、修改文件 lint/format、生产构建通过。tsgo 在并行流水文件出现前通过，最终检查被并行新增 `features/point-ledger/index.tsx:64` 的 TS2740 阻断；Go build 和受影响包 vet 通过，model/middleware 整包通过。扩大 router 整包时，并行积分流水功能的 `TestPointLedgerAPI` 出现 404，未修改该并行功能。隔离 Chrome 桌面/390px 移动端验证多类型、冻结、大整数、长名称、弹层滚动、键盘/触摸、搜索/分页/刷新及中文切换，无 JS 异常或页面横向溢出。

### Z037 积分流水只读查询

- 需求与原因：积分记账记录需要独立可发现的查询入口，用户查看本人积分变动，管理员查看全体或指定用户，避免与调用日志、管理审计和异步任务记录混淆。
- 变更内容：新增个人 `/point-ledger` 菜单和 `/api/points/ledger/self`；管理员积分管理增加流水 Tab，通过 `/api/points/ledger` 查询。支持时间（起含止不含）、类型、动作、分页及管理端用户 ID 筛选；详情显示流水快照、账户/交易/业务标识和备注。不存在真实流水时显示空态，不生成数据或虚构跳转。
- 与上游差异：在现有控制台和独立积分表基础上增加只读查询，复用现有表格、分页、Dialog、Tabs、React Query 和会话鉴权。64 位 ID、版本、积分和余额使用十进制字符串传输、BigInt 格式化，冻结和可用余额分别展示，不将业务总积分重复分摊到每条账户流水。
- 影响面：新增 `model/point_ledger_query.go`、`controller/point_ledger.go`、`router/point_ledger_test.go`、前端 `features/point-ledger/`、个人路由及管理员 Tab 测试；**上游自有文件**：`router/api-router.go`、`middleware/access_token_routes.go`、侧栏数据/默认配置/既有测试、maintenance 配置与开关、七种 locale、`i18n/static-keys.ts` 和生成路由树。现有 `features/points/index.tsx` 增加 Tab。无新依赖、schema、账务写入或部署变更。
- 开关与默认值：新增 `console.point_ledger` 默认开启；旧配置缺失时继承默认值，显式关闭保留。self 接口仅接受登录身份，拒绝 user_id；管理接口要求管理员；两者均 session-only，PAT 拒绝。数据库同时约束交易与账户归属，异常跨用户或缺失关联不可见。
- 验证：`go test ./router -run '^TestPointLedgerDatabaseMatrix$' -count=1 -v` 在隔离真实 SQLite、MySQL 8.4.13、PostgreSQL 17.11 全部通过；API 定向测试以及 model/router/middleware 整包通过。前端最终受影响 8 文件/66 用例通过（`bun run test src/features/points src/features/point-ledger src/hooks/__tests__/points-sidebar.test.tsx src/hooks/__tests__/sidebar-config.test.tsx`）；类型检查、改动文件 oxlint、生产构建和 diff 空白检查通过，覆盖语言切换、时间边界与键盘详情操作。Chrome 隔离服务验证个人流水与分页、管理员按用户筛选和跨类型分摊、空态、冻结变化、精确大整数、详情快照和 Escape 关闭；390px 窄屏页面宽度保持390px，表格在容器内滚动，无控制台错误。
- 风险与未覆盖：不实现实际消费、发放、退款、撤销或冻结链路，不修改 quota，不承诺跨页并发快照。未实测最低支持数据库版本。扩大检查发现已有 `TestOpenAIChatSamplingCompatibility` 4 个子例失败（移除新 controller 的 Go overlay 仍复现）；全量前端 2665 用例通过，既有 `detail-preview.test.tsx` 的本地化单位用例在整套与单文件重跑均超时；全仓 lint 存在无关既有错误，未改动这些路径。项目声明的 shadcn-ui 技能文件缺失，已按详细前端规则检索和复用现有业务组件。

### Z038 自定义订阅套餐管理

- 需求与原因：独立维护 Demo 对应的自定义订阅套餐，实付积分、常规赠送和自动续费赠送分别引用现有 `point_types`，避免与旧订阅和 quota 账务混用。
- 变更内容：主库增量迁移 `custom_subscription_plans`、`custom_subscription_orders` 两表；管理员 `/custom-subscriptions` 提供套餐分页、搜索、周期/启用筛选、新增、详情、编辑、启停与删除。订单本期仅建表；自动续费仅保存配置，不接支付、发放、排期或退款，不预置套餐。
- 数据契约：人民币分和积分使用 signed int64，API 的 ID/版本/金额/积分使用十进制字符串。三个积分类型独立配置，零赠送规范化为 NULL；自动续费开关与奖励配置独立，关闭时仍可维护并展示奖励，切换开关保留比例与类型。正奖励仍校验类型和潜在总额溢出，零比例才清空其类型。额外赠送按 floor 取整并检查总额溢出。编码唯一、version 条件更新；有订单引用拒绝删除。详情见 [custom-subscriptions.md](custom-subscriptions.md)。
- 权限与菜单：五个接口均使用现有管理员会话鉴权并列入 session-only，拒绝 PAT；前端路由和菜单限制管理员。旧侧栏配置缺项继承默认开启，显式 false 保留。复用现有管理表格、分页、Sheet、详情和确认弹窗，不新增运行依赖。
- 合规限制对齐：自定义订阅与原订阅共用 `usePaymentCompliance`（确认标记为真且条款版本匹配）；新建、编辑、启停、删除及已打开表单/删除框均受限，复用原订阅提示文案，读取不受影响。后端三类写接口复用 `requirePaymentCompliance`。仅补齐管理限制，无 schema、订单和支付流程变化。新增共享 hook；本轮额外触及的**上游自有文件**为 `web/src/features/subscriptions/components/subscriptions-provider.tsx`，仅将原判定移到共享 hook，原行为保持不变。
- 合规回归验证：先观察到前端3个新增用例失败及后端写接口绕过，再修复。`bun run test src/features/custom-subscriptions` 6文件53用例通过；`go test ./router -run '^TestCustomSubscriptionAdminAPI$' -count=1`、`go vet ./controller ./router`、1496文件typecheck、改动文件lint/format及前后端生产构建通过。测试覆盖未确认、过期版本、只读可用、打开后失效的保存/删除禁用以及重新确认恢复。Go使用本地1.27.3工具链，未改go.mod；无数据库语句或表结构变更。
- 奖励配置解耦验证：未开启自动续费也可新建并保存正比例奖励；开关切换保留比例/类型，列表与详情展示不受开关影响。实际 router 回归、前端6文件49用例、typecheck、改动lint/format、Go vet和生产构建通过；Chrome隔离实例确认未开启时1000基点/GPT类型保存及回填，29,000积分对应2,900额外积分，控制台未捕获error。表结构和订单范围不变。
- 影响面：新增模型、controller、router/model 测试、前端 `features/custom-subscriptions/` 及路由/测试；**上游自有文件**：`model/main.go`、`router/api-router.go`、`middleware/access_token_routes.go`、侧栏数据/默认配置、maintenance 配置与开关、七种 locale、`i18n/static-keys.ts` 和 `routeTree.gen.ts`。
- 验证与边界：前端相关9文件/74用例、typecheck、改动文件lint/format、生产构建通过；分页使用与用户/渠道相同的默认完整组件，覆盖每页条数、数字页码、首末页及服务端参数。Chrome隔离实例验证空态、新增、详情、精确9,007,199,254,740,993积分、两类积分类型、编辑清零/禁用、搜索空态/恢复、删除取消、键盘关闭以及每页20→50；390px页面与详情均宽390px，表格在容器内滚动，未观察到console error。主题/语言切换和真实多页数据的浏览器交互未逐项实测，语言/多页行为由回归测试覆盖。隔离真实 SQLite 3.50.4、MySQL 8.4.13、PostgreSQL 17.11 的新建/代表性旧库、重复迁移、索引/NULL 唯一键、精确整数和 CRUD 测试通过；实际 router 权限与无账务写入检查通过。后端 vet/build 与 model/router/middleware 包测试通过。项目声明 Go 1.26.10 下载失败，本机使用 Go 1.27.3 验证，未改 go.mod。controller 整包存在既有 `TestOpenAIChatSamplingCompatibility` 四个子例失败，恢复本次集成文件至 HEAD 的 overlay 仍复现，未改无关路径。未验证最低数据库版本或完整发行版数据库升级；回滚代码保留新增表和数据。

---

### Z039 根 README 结构总览与 fork 定制摘要

- 需求与原因：根 `README.md` 此前与上游完全一致，其“Development and extensions”结构表只覆盖
  `router/`、`relay/`、`service/`、`model/`、`relaykit/`、`plugins/tasks/`、`web/`、`electron/`，
  未体现 `setting/`、`common/`、`pkg/`、`tokenkit/`、`oauth/`、`i18n/` 等目录，也未说明本 fork
  相对上游新增的能力。用户要求“分析总体结构并更新根 README”，让 README 准确描述当前代码布局与
  fork 定制。
- 变更内容（纯文档，`README.md`，英文，与文件既有语言一致）：
  - 补全结构表：新增 `setting/`、`common/`、`pkg/`、`tokenkit/`、`oauth/`、`i18n/`、`logger/`、
    `constant/`、`dto/`、`types/`、`docs/` 行；为 `relay/` 补 `relay/channel/` 渠道适配器说明、
    为 `web/` 补 `web/src/features/` 功能模块说明。
  - 新增 `## Fork customizations (zyy)` 小节（含 TOC 锚点 `#fork-customizations`）：一句话说明本
    fork 身份，5 条高层定制摘要（积分、自定义订阅、Seedance 渠道测试、模型广场定价、控制台改版），
    并指向 `docs/customization/zyy-customization.md`（权威登记）与 `docs/deploy/`（部署/升级）。
  - 顶部 TOC 增加 `Fork customizations` 链接。
- 影响面：**上游自有文件** `README.md`（结构表 + 新增小节 + TOC）。无后端、前端、部署、配置或
  运行行为改动；不改动受保护的 new-api / QuantumNous 品牌与归属信息。
- 与上游差异：上游 README 结构表无上述目录行、无 fork 定制小节；本 fork 增补以准确描述当前代码
  布局与定制。属“面向用户的文档”差异。
- 开关与默认值：无（纯文档）。
- 验证：`git diff README.md` 复核三处改动（TOC、结构表、fork 小节）；链接目标
  `docs/customization/zyy-customization.md`、`docs/deploy/`、`tokenkit/README.md`、`web/AGENTS.md`
  均存在。纯文档，未运行构建或测试。
- 风险与未覆盖：`README.md` 属上游文件，下次 `git merge upstream/main` 可能冲突，升级时按 §5
  复核；fork 定制摘要为高层概述，逐项细节以 `docs/customization/zyy-customization.md` 为准，
  后续新增定制需同步更新该登记（本条不重复登记各定制细节）。

## 5. 上游自有文件改动清单（升级冲突重点关注）

以下文件在 `main` 中已存在，fork 对其做了修改。升级 `upstream/main` 时优先复核这些位置，
确认定制没有被上游实现静默覆盖。清单按 `git diff main zyy --name-status` 的 `M` 记录整理
（基线 `95287ef7d`，当时 28 个文件；含 Z012 后 30 个文件；含 Z013 后 35 个文件；含 Z018 后 40 个文件）：

| 区域 | 文件 | 关联条目 |
|---|---|---|
| 自定义订阅套餐管理 | `model/main.go`、`router/api-router.go`、`middleware/access_token_routes.go`、侧栏数据/配置、maintenance 配置/开关、七种 locale、`i18n/static-keys.ts`、`routeTree.gen.ts` | Z038 |
| 仓库规则与配置 | `AGENTS.md`、`.gitignore` | Z011、Z003 |
| 后端 controller / model | `controller/channel-test.go`、`controller/relay.go`、`controller/system_task_handlers.go`、`model/system_task.go`、`model/task.go` | Z003、Z006 |
| 积分主库迁移 | `model/main.go` | Z034 |
| 积分管理权限与路由 | `router/api-router.go`、`middleware/access_token_routes.go` | Z035、Z037 |
| 积分流水控制台集成 | `web/src/features/points/index.tsx`、侧栏数据/配置/测试、maintenance 配置/开关、七种 locale、`web/src/i18n/static-keys.ts`、`web/src/routeTree.gen.ts` | Z037 |
| 用户列表积分 | `controller/user.go`、`web/src/components/quota-details-popover.tsx`、`web/src/features/users/api.ts`、`web/src/features/users/types.ts`、`web/src/features/users/components/users-columns.tsx`、`web/src/lib/format.ts`、七种 `web/src/i18n/locales/*.json` | Z036 |
| 积分管理控制台集成 | `web/src/hooks/use-sidebar-data.ts`、`use-sidebar-config.ts`、`web/src/features/system-settings/maintenance/config.ts`、`sidebar-modules-section.tsx`、`web/src/routeTree.gen.ts`、七种 `web/src/i18n/locales/*.json` | Z035 |
| 服务层 | `service/error.go` | Z001 |
| Relay / 插件 | `relay/channel/openai/adaptor.go`、`relay/channel/task/jsplugin/adaptor.go`、`plugins/tasks/sora/plugin.js` | Z001、Z005 |
| Relay / 插件（doubao 中转放行） | `plugins/tasks/doubao/plugin.js`、`plugins/doubao_responses_test.go` | Z018 |
| 构建与 CI | `Dockerfile`、`Dockerfile.dev`、`makefile` | Z018 |
| 前端渠道 | `web/src/features/channels/api.ts`、`web/src/features/channels/components/dialogs/channel-test-dialog.tsx` | Z004 |
| 前端概览 | `web/src/features/dashboard/components/overview/overview-dashboard.tsx`、`web/src/features/dashboard/components/overview/__tests__/setup-guide.test.tsx` | Z012 |
| 前端定价 | `web/src/features/pricing/components/model-billing-mode-badge.tsx`、`model-card.tsx`、`model-details.tsx`、`model-details-api.tsx`、`model-price-cell.tsx`、`web/src/features/pricing/hooks/use-pricing-data.ts`、`web/src/features/pricing/lib/price.ts` | Z002 |
| 前端定价（折扣/原价） | `web/src/features/pricing/components/model-card.tsx`、`model-price-cell.tsx`、`cached-price-cell.tsx`、`pricing-columns.tsx`、`pricing-table.tsx`、`model-details.tsx`、`web/src/features/pricing/index.tsx` | Z013 |
| 前端控制台基础扩展 | `web/src/features/dashboard/index.tsx`、`web/src/features/dashboard/components/overview/overview-dashboard.tsx`、`web/src/features/profile/index.tsx`、`web/src/features/security/index.tsx`、`web/src/features/usage-logs/audit/index.tsx`、`web/src/features/wallet/index.tsx` 及相关测试 | Z021 |
| 前端用户端基础 | `web/src/components/layout/components/section-page-layout.tsx`、`web/src/features/keys/index.tsx`、`web/src/features/usage-logs/index.tsx`、`web/src/styles/index.css` | Z020 |
| 前端系统信息 | `web/src/features/system-info/constants.ts` | Z007 |
| i18n | `web/src/i18n/locales/{en,zh,zh-TW,fr,ru,ja,vi}.json` | Z002 / Z004 / Z007 / Z012 / Z013 |
| 根 README | `README.md` | Z039 |

## 6. 验证快照

本节记录实测结果：Z004 修复前、后两次，以及 Z012–Z018（随改动一并更新）。

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

### Z014 验证快照

**定向测试**：`./node_modules/.bin/vitest run src/features/pricing`
→ `Test Files 15 passed (15)`、`Tests 293 passed (293)`（3.78s）。新增/加强的断言：卡片折扣徽标
文案元素带 `text-destructive`、两条删除线原价同为 `text-sm` + `text-destructive`；表格价格单元的
原价、Type 列折扣徽标同为 `text-destructive`。

**前端全量测试**：`cd web && ./node_modules/.bin/vitest run` → 197 文件：1 失败 / 196 通过；
2320 用例：1 失败 / 2319 通过（37.64s），唯一失败仍为既有的 `markdown.test.tsx`
（与本次改动无关，归属见本节上文）。

**类型检查与 lint**：`./node_modules/.bin/tsgo -b` 退出码 0；
`./node_modules/.bin/oxlint -c .oxlintrc.json` 针对本次修改的 2 个组件与 1 个测试文件无输出（无 error/warning）。

**前端构建**：本机**未安装 `bun`**，按仓库约定改用 `./node_modules/.bin/rsbuild build`
→ 构建成功（`Total: 66893.9 kB / gzip 20532.2 kB`，退出码 0）。

### Z015 验证快照

**定向测试**：`./node_modules/.bin/vitest run src/features/pricing`
→ `Test Files 15 passed (15)`、`Tests 293 passed (293)`（5.09s）。

**中文文案校验**：`node -e` 读取 `src/i18n/locales/zh.json` 后解析得到
`/translation/Best group => 最高`，JSON 可正常解析且值已更新；未改其它 locale。

### Z016 验证快照

**定向测试**：`./node_modules/.bin/vitest run src/features/pricing`
→ `Test Files 15 passed (15)`、`Tests 294 passed (294)`；新增用例锁定最优分组为溢价时渲染 `Lowest premium +50%`。

**i18n 校验**：`node -e` 读取 7 个 locale 的 `Lowest premium` →
`en Lowest premium / zh 最少 / zh-TW 最少 / fr Minimum / ru Минимум / ja 最小 / vi Thấp nhất`，均可正常解析。

**前端全量测试**：`cd web && ./node_modules/.bin/vitest run` → 197 文件：1 失败 / 196 通过；
2321 用例：1 失败 / 2320 通过（39.08s），唯一失败仍为既有的 `markdown.test.tsx`。

**类型检查与 lint**：`./node_modules/.bin/tsgo -b` 退出码 0；
`./node_modules/.bin/oxlint -c .oxlintrc.json` 针对 `price-discount-badge.tsx` 与
`group-discount-display.test.tsx` 无输出（无 error/warning）。

**格式化**：`format-with-protected-headers.mjs --check` 列出 27 个未格式化文件，其中包含本次未改动的
`web/src/features/pricing/components/pricing-columns.tsx`，且 `group-discount-display.test.tsx` 的 import
顺序差异在 Z013 提交版本上同样存在，因此属于**既有格式漂移**，非本次引入；本次新增代码行本身无格式问题。

### Z017 验证快照

**后端定向测试**：`go test ./controller/ -run 'TestSeedance' -count=1` → `ok github.com/QuantumNous/new-api/controller`。
新增/加强的断言：单分组渠道默认取渠道分组、多分组渠道取第一个、`billing_group` 覆盖生效、
未配置的分组被拒绝、`seedanceTestTaskResult` 在 `task.Group` 非空时返回 `billing_group`、
历史任务无该字段。

**前端定向测试**：`./node_modules/.bin/vitest run src/features/channels`
→ `Test Files 31 passed (31)`、`Tests 365 passed (365)`（20.99s）；其中
`seedance-channel-test.test.ts` 新增「仅在提交时携带 billing_group」与「未选择时省略」两个用例。

**前端全量测试**：`cd web && ./node_modules/.bin/vitest run` → 209 文件：1 失败 / 208 通过；
2435 用例：1 失败 / 2434 通过（36.34s），唯一失败仍为既有的 `markdown.test.tsx`
（`does not load math resources when trust is inherited from a polluted prototype`，与本次无关）。

**类型检查与 lint**：`./node_modules/.bin/tsgo -b` 退出码 0；`go vet ./controller/` 通过；
`./node_modules/.bin/oxlint -c .oxlintrc.json` 针对本次改动的 3 个前端源文件无输出；
`seedance-channel-test.test.ts` 仅剩既有第 39 行 `curly` error，在 HEAD 版本同样存在。

**前端构建**：本机**未安装 `bun`**，按仓库约定改用 `./node_modules/.bin/rsbuild build`
→ 构建成功（`Total: 66981.3 kB / gzip 20560.2 kB`，退出码 0）。

### Z018 验证快照

**补丁锚点校验**：`make check-plugin-patch` → `check-doubao-plugin-patch: ok (4 anchors)`。
另在只含空壳 `plugin.js` 的临时目录验证失败路径 →
`check-doubao-plugin-patch: RELAY_VIDEO_MODEL_PATTERN rule is missing or changed`，退出码 1；
从 `/` 等任意工作目录调用同样通过（脚本按自身路径定位仓库根）。

**Go 测试**：`go test ./plugins/... -count=1` → ok；`go test ./plugins -run 'TestDoubao' -v` →
`TestDoubaoRelayVideoModelsStayUnclaimed`、`TestDoubaoRelayVideoModelPattern` 均 PASS；
`go test ./middleware -run 'TaskPlugin|Distributor' -count=1` → ok；
`go test ./service -run 'TaskPlugin|ChannelSelect' -count=1` → ok；`go build ./...` 退出码 0。
本机 `go` 由 mise 管理但未设全局默认版本，使用 `~/.local/share/mise/installs/go/1.26.8/bin/go`
绝对路径执行，未切换全局工具链；`gofmt` 检查无差异。

**插件元数据**：`node --input-type=module` 直接 import `plugins/tasks/doubao/plugin.js` →
`meta.models` 12 个、`openai_video` claim 6 个、mini/fast 均不在其中、`version=1.3.1`，导出面与
改动前一致（未新增引擎 hook）。

**构建期守卫**：`Dockerfile` / `Dockerfile.dev` 在 `COPY . .` 后执行同一脚本；`.dockerignore`
未排除 `scripts/`，golang:alpine 构建阶段可读取。本轮**未实际执行 `docker build`**，镜像构建链路的
验证仅覆盖脚本本身与上下文可达性。

## 7. 与升级流程的关系

- 升级前用 `git diff main zyy` 与 §4、§5 逐条对齐，确认每条定制都有归属、每个改动面都有解释。
- 冲突高发位置就是 §5 的清单；合并冲突解决后，必须回跑对应的验证（后端受影响包的
  `go test`、前端 `bun run test` / `bun run build`），并把结果更新到 §4 对应条目与 §6。
- 新增定制没有同步登记时，升级后极易被上游实现覆盖而不自知——这是本规则存在的直接原因。
