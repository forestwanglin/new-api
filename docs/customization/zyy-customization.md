# zyy 分支定制清单

本文是 **zyy fork 定制改动的唯一登记处**。分支模型见
[deploy/sync-upstream.md](../deploy/sync-upstream.md)：`main` 是纯上游镜像（只做
`git merge --ff-only upstream/main`），`zyy` 是交付分支（所有定制代码与部署构建都从它出）。

因此 **`git diff main zyy` 的每一处差异都是一条定制**，都必须登记在本文。

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

在 §4 的表格里追加一行；改动较复杂时，在表格后用一节展开。

| 列 | 说明 |
|---|---|
| 编号 | `Z` + 三位递增序号（`Z001`、`Z002`…），一经分配不再复用 |
| 定制项 | 一句话说清对外可见的行为差异 |
| 影响面 | 主要文件/模块；上游自有文件可用 `*` 标注，完整清单见 §5 |
| 关键提交 | `git log` 短哈希，多个用逗号分隔；已回退的写成 `A → revert B` |
| 备注 | 明细文档链接、开关、限制、已知风险 |

改动复杂时的展开模板：

```markdown
### Z0xx <定制项>

- 需求与原因：
- 变更内容：（后端/前端/部署分别说明）
- 影响面：文件列表；上游自有文件：<列表或"无">
- 与原上游行为的差异：
- 开关与默认值：<配置项、默认关闭/开启>
- 验证：<执行的命令 + 观察到的结果>
- 已知风险 / 未覆盖项：
```

## 3. 范围说明

- 本清单只覆盖 **本仓库（`new-api` fork）** 的定制。`zyy-ai-gateway/`（含 `deploy/` 下的
  Nginx 与远程部署控制器）属于另一个仓库，其受保护入口与部署顺序规则见该仓库的
  `deploy/deploy.md` 与 `.trellis/spec/zyy-ai-gateway/deployment/`。
- `main` 与 `zyy` 的合并提交本身不登记；被合并进来的具体改动按其原始提交登记。
- `git diff main zyy` 是最终事实来源；本文是它的可读版本。两者不一致时以代码为准，并立即修正本文。

## 4. 登记表

> 初始盘点依据 `git log --oneline main..zyy`（`main` = `7de10f2c6`，`zyy` = `cc09f74ab`，
> 2026-10-18）。后续每条改动按 §1.1 追加。

| 编号 | 定制项 | 影响面 | 关键提交 | 备注 |
|---|---|---|---|---|
| Z001 | 中科发行包后端定制移植：OpenAI 通道 thinking 参数剥离、上游错误信息透传、Sora 视频 URL 转 base64 内联 | `service/error.go`\*、`relay/channel/openai/adaptor.go`\*、`relay/channel/task/jsplugin/adaptor.go`\*；新增 `relay/channel/task/jsplugin/video_url.go`(+单测) | `2673ab2b7` | 逐项对照见 [zhongke-customization-port.md](zhongke-customization-port.md)；Kimi K3 动态工具、Seedance Mini 视频计费判定为"上游已存在"故未改 |
| Z002 | 中科发行包前端定价移植：Seedance 按秒计费卡片 + "Per Second" 徽章、火山 Ark 视频请求示例、endpoint 归一化 | `web/src/features/pricing/components/*`\*、`web/src/features/pricing/hooks/use-pricing-data.ts`\*、`web/src/features/pricing/lib/price.ts`\*、7 个 `web/src/i18n/locales/*.json`\*；新增 `seedance-video-price.tsx`、`lib/ark-video-examples.ts`、`lib/ark-video-price.ts`、`lib/video-price.ts` 及前端测试 | `a7b0b0c49`, `b8b2b1b19` | 方案 A：只做前端展示层通用化，不重复后端 task 定价 |
| Z003 | 渠道测试接口新增 Seedance 快速测试与视频健康检查 | `controller/channel-test.go`\*、`controller/relay.go`\*、`.gitignore`\*；新增 `controller/seedance_channel_quick.go`、`controller/seedance_channel_health.go` 及两个后端单测 | `d127d476f` | 后端部分；前端入口见 Z004 |
| Z004 | 渠道测试弹窗新增 Seedance 快速/视频测试入口与参数 | `web/src/features/channels/api.ts`\*、`web/src/features/channels/components/dialogs/channel-test-dialog.tsx`\*、7 个 locale json\*；新增 `web/src/features/channels/lib/seedance-channel-test.ts` 及两个前端测试 | `94e72c40c` | 与 Z003 成对使用 |
| Z005 | Ark Seedance 任务按上游返回用量结算计费 token（替代原先的本地估算） | `plugins/tasks/sora/plugin.js`\*；新增 `plugins/sora_seedance_usage_test.go` | `30a7164b5` | 涉及计费：改动前必须读 `.agents/rules/billing.md` |
| Z006 | 新增 `task_billing_reconcile` 系统任务：按存储的上游用量回补历史账单 | `controller/system_task_handlers.go`\*、`model/system_task.go`\*、`model/task.go`\*；新增 `service/task_billing_reconcile.go`(+单测) | `4a02e077e` | 涉及计费：同上 |
| Z007 | 前端为 `task_billing_reconcile` 系统任务补充标签与 i18n | `web/src/features/system-info/constants.ts`\*、7 个 locale json\* | `81e6d5e1b` | 与 Z006 配套 |
| Z008 | 部署侧定制：zyy 分支 Docker Compose 部署文档、蓝绿零停机切流脚本、构建缓存配额与构建版本戳 | `docs/deploy/deploy-zyy-branch.md`、`docs/deploy/sync-upstream.md`、`docs/deploy/zero-downtime-update.md`、`docs/deploy/blue-green-switch.sh`、`docs/deploy/setup-build-builder.sh`（全部为新增文件） | `3d08cbeb4`, `2ff6afca6`, `5559e8535`, `051a4bc38`, `074292c72`, `cdb051df3`, `d3cf4439c`, `092a5400f`, `feff8fe13`, `db3785526`, `2b9c7b4ec`, `ac44905d3`, `7a078b7b6`, `55a7184ee` | 脚本受保护，改动前先读 `deploy/deploy.md` 与 `.trellis/spec/zyy-ai-gateway/deployment/`；每次改动需同步 `*.example`、部署顺序测试与 shell 语法检查 |
| Z009 | 定制文档归入 `docs/customization/`（中科移植文档从 `docs/zhongke/` 迁移），并建立本清单 | `docs/customization/**` | `2673ab2b7`（初版）、`8463cf429`、`cc09f74ab` | 本文 |
| Z010 | 模型广场分组筛选隐藏 `default` 用户分组 | `web/src/features/pricing/**`\* | `719529daf` → revert `f409dd330` | **已回退，非现存定制**；保留记录以说明该行为曾被尝试并撤销 |

## 5. 上游自有文件改动清单（升级冲突重点关注）

以下文件在 `main` 中已存在（上游自有），fork 对其做了修改。升级 `upstream/main` 时优先复核这些
位置，确认定制没有被上游实现静默覆盖。清单按 `git diff main zyy --name-status` 的 `M` 记录整理
（截至 `cc09f74ab`）：

| 区域 | 文件 |
|---|---|
| 后端 | `controller/channel-test.go`（Z003）、`controller/relay.go`（Z003）、`controller/system_task_handlers.go`（Z006）、`model/system_task.go`（Z006）、`model/task.go`（Z006）、`service/error.go`（Z001） |
| Relay / 插件 | `relay/channel/openai/adaptor.go`（Z001）、`relay/channel/task/jsplugin/adaptor.go`（Z001）、`plugins/tasks/sora/plugin.js`（Z005） |
| 前端 | `web/src/features/channels/api.ts`、`web/src/features/channels/components/dialogs/channel-test-dialog.tsx`（Z004）、`web/src/features/pricing/components/model-billing-mode-badge.tsx`、`model-card.tsx`、`model-details-api.tsx`、`model-details.tsx`、`model-price-cell.tsx`、`web/src/features/pricing/hooks/use-pricing-data.ts`、`web/src/features/pricing/lib/price.ts`（Z002）、`web/src/features/system-info/constants.ts`（Z007） |
| i18n | `web/src/i18n/locales/{en,zh,zh-TW,fr,ru,ja,vi}.json`（Z002 / Z004 / Z007） |
| 仓库配置与规则 | `.gitignore`（Z003）、`AGENTS.md`（本规则本身） |

## 6. 与升级流程的关系

- 升级前用 `git diff main zyy` 与 §4、§5 逐条对齐，确认每条定制都有归属、每个改动面都有解释。
- 冲突高发位置就是 §5 的清单；合并冲突解决后，必须回跑对应的验证（后端 `go test ./...` 中受影响
  包、前端 `bun run test` / `bun run build`），并在本文对应条目里更新验证结果。
- 新增定制没有同步登记时，升级后极易被上游实现覆盖而不自知——这是本规则存在的直接原因。
