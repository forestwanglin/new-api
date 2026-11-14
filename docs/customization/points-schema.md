# 积分持久化结构

积分结构位于 `model/point.go`，由主库启动迁移 `model/main.go:migrateDB` 调用 `migratePoints` 创建。首次部署需要由执行迁移的主节点启动；从节点沿用现有不执行建表的逻辑。

## 六张表与 ORM

| 表 | GORM 类型 | 主要字段与约束 |
|---|---|---|
| `point_types` | `PointType` | `code` 唯一；`name`、`consume_priority`；创建与更新时间 |
| `point_model_rules` | `PointModelRule` | `point_type_id`、`match_type`、`match_value` 三元组唯一；`enabled`；创建与更新时间 |
| `point_accounts` | `PointAccount` | `user_id`、`point_type_id` 唯一；`available_points`、`frozen_points`、`version` 默认 0 |
| `point_transactions` | `PointTransaction` | `user_id`、`event_key` 唯一；`action`、`biz_type`、`biz_id`、`points`、操作人与说明；可空的原业务单 ID、计费快照及操作人 ID |
| `point_ledger` | `PointLedger` | `account_id`、`account_version` 唯一；业务单 ID、可空冻结 ID；可用与冻结积分各自的变化量及前后余额 |
| `point_freezes` | `PointFreeze` | 账户与冻结业务单 ID；初始与剩余冻结积分、原因、状态；可空关闭时间 |

各表主键为 GORM 生成的 `int64` ID。积分、变化量、版本、关联 ID 使用有符号 `int64`；SQLite 主键由其原生 INTEGER 机制生成。时间戳使用 Unix 毫秒，创建与更新时间由 GORM 维护；`closed_at` 由后续业务明确写入。

业务来源、用户业务时间、流水业务单、流水冻结记录、冻结账户状态和冻结业务单均有查询索引。引用使用标量 ID，不创建自动级联删除或软删除字段。

## 初始配置与模型规则

| code | 名称 | 优先级（大值优先） | 初始模型规则 |
|---|---|---:|---|
| `GENERAL` | 通用积分 | 100 | `PATTERN` / `*` |
| `GPT` | GPT 专用积分 | 10 | `PATTERN` / `gpt-*` |

初始化在事务中创建积分类型及对应规则，仅首次创建该类型时插入默认规则。重复启动不修改名称、优先级、启用状态或已有规则，也不恢复人为删除的规则。新积分类型不自动创建用户账户；首次创建积分类型与初始模型规则失败时回滚。

`EXACT` 表示完整模型名；`PATTERN` 的契约为区分大小写的完整字符串 Glob，其中 `*` 匹配零个或多个字符，`?` 匹配一个字符。多条启用规则之间为 OR，无匹配规则时该类型积分不可消费。使用平台对外模型标识判定，之后才做上游路由映射。`o3` 等具体模型需显式配置，不属于默认 `gpt-*` 规则。

`PointModelMatchValue` 是底层为 string 的 ORM 类型；MySQL 使用列级 `utf8mb4_bin`，避免数据库默认大小写不敏感排序规则阻止保存 `Model-X` 和 `model-x` 两条不同规则。SQLite/PostgreSQL 使用普通 `varchar(255)`，不修改共享数据库方言或全库排序规则。`enabled` 没有 `default:true` 标签，显式 false 会被保留；初始化显式设置 true。

## 模型调用积分计费（Z057）

全部新付费模型调用统一使用适用积分准入，钱包 `users.quota` 继续记账并允许负数；旧 `billing_preference` 和订阅额度不再提供新调用的资金来源。自定义订阅积分发放和服务排期不变；无积分标识的存量任务继续按原来源完成，不追扣历史消费。

按对外模型名匹配启用规则，同类型去重，保存类型名称、code、优先级及换算快照。消费按 `consume_priority DESC, id ASC`，即大值优先，同值小 ID 先。默认 GENERAL=100、GPT=10 保持原数值，因此初始配置下通用积分先消费；管理员自行调整，不自动迁移配置。账户锁按类型 ID 升序，不能按消费优先级加锁。

`PointsPerRMB = 1000`，最小单位为 1 积分。请求开始保存 `USDExchangeRate` 与 `QuotaPerUnit` 的十进制值，以精确有理数计算 `P(q)=ceil(q × USDExchangeRate ×1000 / QuotaPerUnit)`。Realtime 分段、附加费和异步修正按累计应付 quota 的 `P(new)-P(old)` 结算，最终整次只取整一次。人民币 0/0.0001/0.001/0.0011 元分别为 0/1/1/2 积分，不受展示币种、模型广场参考汇率或后续配置修改影响。

准入按适用账户的带符号 `available_points` 总和判断，必须覆盖完整预估积分；负数不能夹成0，available 已排除冻结，不能重复减冻结。付费零估计也需要有效匹配及已有账户；真正免费且无正附加费能力的路径不建冻结。

主库事务同时预留有限 API Key 预算和积分，按本次独占 `MODEL_CALL` 冻结从 available 转入 frozen。实际费用保留钱包记账，积分先消费本次冻结，再消费剩余可用；已有业务冻结及其他请求冻结始终不可用。实际超额允许最后实际消费的已持有账户为负；零估计首次发生费用且无既有扣减时，使用快照中最后一个已持有的适用账户，绝不凭空创建欠额账户。退款按原分摊逆序补回，保留独立应收附加费，不按当前优先级或汇率重算。例如先 GPT10、通用5，实际20 → GPT0、通用−5；通用充值100 →95，不跨类型还债。

积分变化、流水、账户版本、原始 quota 和 Key 账务同事务提交；冻结必须非负，账户及流水前后值一致，纠错追加补偿事件。充值允许负 available 并自然抵债，冻结非负、溢出、版本和支付幂等约束保留。新二进制的全部 Key 预算写入（含旧任务退款、管理员编辑）以主库为准，不再向旧 token 批量队列追加，Redis 仅为提交后缓存。

## 持久计费与恢复

`migratePoints` 同时迁移三张主库表：

| 表 | GORM 类型 | 主要职责 |
|---|---|---|
| `point_call_billings` | `PointCallBilling` | 请求字符串ID、用户/Key、模型、汇率/单位/类型及分摊快照、原始及附加 quota、冻结/已记账额度、累计积分、revision、state、dispatch |
| `point_call_events` | `PointCallEvent` | 稳定事件ID、call_id、不可变 payload/积分贡献、quota_delta、revision、最小日志 payload、log/cache 状态、retry_at；同事件同参数幂等，冲突拒绝 |
| `point_call_operations` | `PointCallOperation` | 同步累计目标意图ID、call_id、target、final、fee、state、retry_at；先持久化已知目标再执行账务；同类新目标使未提交旧目标失效，base 与 fee 分开 |

调用ID不超过64字符，事件ID不超过128字符。异步任务的已接受版本事实代替通用 operation，恢复必须继续携带任务版本 guard，不能以无 guard 的通用目标重放。

`model_points_recovery` 每分钟最多处理100个同步目标和100个副作用事件，按 retry_at、ID 轮转并条件领取60秒持久重试租约；失败队首不会长期饿死后面的记录，多节点竞争不重复领取。Task/Midjourney 同样保存 outcome_version、applied_outcome_version、poll lease/fence、settlement_retry_at；普通旧轮询不能覆盖终态，修正必须有新一轮独占取证。失败重启后依据这些主库事实恢复。

财务提交后的缓存或日志失败不能触发全额退款，日志关闭不影响财务流水。独立日志库使用稳定事件 request_id 和主库事件串行发布，恢复先查现存投影再补写；日志费用是本条 quota 差额，积分是本条贡献，避免 Realtime/任务末条重复累计。对外仅提供 `points_billing={version:1,call_id,event_id,status,total_points,items:[{point_type_id,code,name,points}]}`，积分和类型ID为十进制字符串，items 永不为 null，状态为 committed/pending/error。退款贡献为负，旧无明细为“—”，已确认免费为0。

传输超时、空/无法解析响应等无法确认结果的请求停止自动重试并保留冻结；接受任务后客户端取消时，继续以独立限时 context 保存任务和结算。调度只报告超过10分钟的未知 dispatch 数量，绝不按超时猜测退款；没有可核实结果时仍需运维按调用/事件/上游证据对账，本次不增加修复 API 或界面。

## 验证与部署边界

`model/point_test.go:TestPointsDatabaseMatrix` 使用隔离数据库验证六表新建、重复迁移不产生 DDL、唯一约束、大小写规则、64 位正负值、可空引用、配置保留和并发初始化。SQLite 使用临时文件；MySQL/PostgreSQL 分别由 `TEST_MYSQL_DSN`、`TEST_POSTGRES_DSN` 配置。测试拒绝使用已存在积分表的数据库；测试库不能指向生产数据。

`existing_schema` 场景在已有余额示例表旁新增积分表并检查原记录不变，属于代表性升级检查；不是最新正式发行版完整数据库的升级证明。实际引擎版本与执行结果记录在定制登记中；没有配置 DSN 的引擎会明确 skip。

`TestPointCallFinancialLifecycle` 在隔离三库验证精确换算/匹配、并发预留、业务冻结隔离、负钱包/积分及同类型补足、幂等/冲突、主库失败回滚/恢复、日志插入后未确认去重及坏队首公平重试。实际验证结果见定制清单 Z057。

切换必须先形成可验证的旧账务基线：

1. 停止所有旧节点准入、轮询/重算、管理编辑及其他 user/token quota 写入，盘点每节点未刷批量队列和进行中的 SQL。
2. 持久确认每笔旧 user/token 批量变化已成功应用一次并与主库对账。旧 `batchUpdate` 先换走内存缓冲再执行 SQL，失败只记日志；等批次周期、缓冲为空或 finished 日志均不能证明排空。
3. 旧版本若不能提供可信排空证据，阻止启用，先由运维建立对账基线，或另行部署可可靠确认排空的准备版本；不能用可能陈旧的 Redis 数值覆盖主库。
4. 确认 Key 缓存已失效/刷新，统一升级所有准入及后台写入节点后开放流量。混用旧节点会绕过积分准入，不支持滚动混跑。

回滚前停止新积分调用，排空并对账新冻结、任务和待处理财务/副作用；保留九张表与流水，不能直接回旧二进制丢弃冻结。此次无生产数据库访问、历史换算、优先级改写或部署脚本变更。

日志读取：独立 ClickHouse 可能在插入成功/确认失败后留下物理重放副本；所有公开列表、count、分页、Key 日志、导出和费用/token 聚合先按 user_id + points_billing.event_id 选一条 committed 贡献，legacy/pending/无效元数据保留原条数。已用 ClickHouse 26.8.37.168 真实红绿验证。该读取增加 JSON/排序成本，未执行生产规模压测。Task/MJ 终态尚未完成财务应用时显示 pending，保留原已提交金额；超时/本地give-up/404/410不是上游明确失败，不能退款。


## 管理员用户积分调账（Z058）

管理员用户编辑抽屉保留原额度行，在其下方列出全部数据库积分类型。每行是该类型的只读可用积分输入框和独立调整按钮；冻结积分单独显示。尚未开户的类型显示零值，查看不会创建账户。弹窗固定为点击的类型，仅增加/扣减，没有类型选择器或覆盖操作。金额直接使用整数积分，不做货币或 quota 换算。

会话限定 `GET /api/user/:id/points` 读取全部类型，`POST /api/user/:id/points` 接收 `{point_type_id,mode,amount,request_id}`，其中类型 ID、金额为十进制字符串，mode 为 add/subtract。服务端使用 AdminAuth 和原用户管理的目标角色限制，PAT 不可调用；读取失败不能当作零余额。

写入锁顺序为用户后账户，与调用积分预留/结算一致；账户、交易和账本在主库同一事务提交。成功实际调整才创建缺失账户；交易来源 ADMIN_ADJUST，增加 CREDIT、扣减 REVOKE，记录管理员身份、请求 ID、类型/方向/金额快照和前后余额。冻结积分、冻结归属、原 quota 不变。可用积分允许负数，增加自然先抵欠额；int64 数量或版本溢出整体失败。

前端对未知结果保留同一请求身份重试，服务端仅重放相同管理员/用户/请求 ID 和相同载荷；同 ID 不同载荷及大小写排序碰撞安全拒绝，避免误认另一笔调账。成功后重新读取当前余额，不将重放返回的历史余额冒充当前值。已用隔离 SQLite 3.50.4、MySQL 8.4.13、PostgreSQL 17.11 验证大整数、债务、冻结隔离、权限、幂等、溢出/故障回滚、首次开户并发及调账与真实模型预扣/最终结算并发；未操作生产积分或部署。

### 管理员积分调整的使用日志与审计（Z060）

每次新提交的管理员积分增加/扣减，在目标用户的使用日志中新增 `LogTypeTopup` 记录，同时在实际操作者的审计日志中新增 `user.points_add` / `user.points_subtract` 操作。类型不硬编码，适用于全部已登记积分类型。记录包含类型 ID/code/name、目标用户及名称、方向、整数积分数量、可用积分前后值和调账请求 ID；管理员身份仍放 `admin_info`，普通用户日志视图按既有规则剥离。

前后积分在主库事务内取不可变快照，作为内部结果字段返回控制器，不新增 HTTP 字段。日志积分始终十进制字符串，支持负值和超过 JavaScript 安全整数的数值，不进入 quota 或货币格式化。使用日志与审计日志的摘要、详情复用同一积分操作描述，七种语言同步更新。

相同请求重放不新增使用日志，也不重复记录成功调账事件；单独审计为 `user.points_replay`，明确“未再次变更积分”，原始前后值来自历史账本。无效、冲突、越权及数据库失败产生失败审计（无法解析方向时 `user.points_adjust`），没有成功使用日志及已提交前后值。显式标记已审计，防止中间件额外写 generic 审计。

沿用额度调整的提交后日志写入机制。主库财务和独立日志库不承诺跨库原子性；日志库故障不会回滚已提交积分，也不会因重试再变更账户。此功能不补历史日志、不引入 outbox，也不改变既有积分交易、账本、冻结或 quota。
