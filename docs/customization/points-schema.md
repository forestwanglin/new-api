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

| code | 名称 | 优先级（小值优先） | 初始模型规则 |
|---|---|---:|---|
| `GENERAL` | 通用积分 | 100 | `PATTERN` / `*` |
| `GPT` | GPT 专用积分 | 10 | `PATTERN` / `gpt-*` |

初始化在事务中创建积分类型及对应规则，仅首次创建该类型时插入默认规则。重复启动不修改名称、优先级、启用状态或已有规则，也不恢复人为删除的规则。新积分类型不自动创建用户账户；首次创建积分类型与初始模型规则失败时回滚。

`EXACT` 表示完整模型名；`PATTERN` 的契约为区分大小写的完整字符串 Glob，其中 `*` 匹配零个或多个字符，`?` 匹配一个字符。多条启用规则之间为 OR，无匹配规则时该类型积分不可消费。使用平台对外模型标识判定，之后才做上游路由映射。`o3` 等具体模型需显式配置，不属于默认 `gpt-*` 规则。

`PointModelMatchValue` 是底层为 string 的 ORM 类型；MySQL 使用列级 `utf8mb4_bin`，避免数据库默认大小写不敏感排序规则阻止保存 `Model-X` 和 `model-x` 两条不同规则。SQLite/PostgreSQL 使用普通 `varchar(255)`，不修改共享数据库方言或全库排序规则。`enabled` 没有 `default:true` 标签，显式 false 会被保留；初始化显式设置 true。

## 单位与后续业务边界

`PointsPerRMB = 1000`，最小单位为 1 积分；消费换算契约为使用精确十进制计算 `ceil(本次最终人民币消费金额 × 1000)`，一次结算只取整一次。其他场景的取整须按各自业务契约。积分不是已有 `users.quota`，本次没有定义两者映射或改变当前扣费链路。

本次只提供表结构、默认配置和 ORM。未实现模型匹配执行、消费、冻结/解冻、充值、退款、管理 API 或前端配置界面。以下约束必须由后续业务服务在同一数据库事务中保证，不能把有这些字段误认为已实现：

- 可用积分与冻结积分非负，冻结积分不可用于普通消费；余额不足时整笔失败。
- 同一业务事件使用稳定幂等键，重试内容一致；积分变化与流水原子提交。
- 账户冻结余额等于对应未关闭冻结记录剩余金额之和。
- 流水前后余额与变化量相符，每次变更递增账户版本；流水不可修改或删除，纠错追加补偿记录。

不依赖三库行为不同的 CHECK 执行机制来宣称这些业务约束已经得到完整保护。

## 验证与部署边界

`model/point_test.go:TestPointsDatabaseMatrix` 使用隔离数据库验证六表新建、重复迁移不产生 DDL、唯一约束、大小写规则、64 位正负值、可空引用、配置保留和并发初始化。SQLite 使用临时文件；MySQL/PostgreSQL 分别由 `TEST_MYSQL_DSN`、`TEST_POSTGRES_DSN` 配置。测试拒绝使用已存在积分表的数据库；测试库不能指向生产数据。

`existing_schema` 场景在已有余额示例表旁新增积分表并检查原记录不变，属于代表性升级检查；不是最新正式发行版完整数据库的升级证明。实际引擎版本与执行结果记录在定制登记中；没有配置 DSN 的引擎会明确 skip。

代码回滚时保留新增表及数据，不自动删表。此次不访问或迁移生产数据库；应用后续启动才会在其配置的主库建表。
