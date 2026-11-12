# 自定义订阅后台

本功能独立于旧版订阅和公开订阅 Demo。管理员在“自定义订阅”（`/custom-subscriptions`）维护套餐，用户、渠道管理页的布局和交互保持一致。

## 当前范围

仅新增主库 `custom_subscription_plans`、`custom_subscription_orders` 两张表，以及管理员套餐列表、新增、查看、编辑、启停和删除。订单表只有持久化结构，没有订单API或页面。自动续费开关与赠送比例仅保存配置，不发起真实签约或扣款。

不创建默认套餐、不写积分账户/业务单/流水，不处理购买、支付回调、服务排期、发票或退款。旧订阅 `/subscriptions` 和公开 Demo `/subscription` 不受影响。

## 套餐字段

| 字段 | 意义 |
|---|---|
| id / code / title / subtitle | 主键、唯一编码、名称、说明 |
| tier_code / tier_rank | 档位编码与等级；本期仅元数据，不执行升级或权益排期 |
| billing_cycle / duration_months | month对应1个月，year对应12个月 |
| currency / price_amount_minor | CNY与人民币分，整数保存 |
| paid_points / paid_point_type_id | 实付获得积分及现有point_types类型ID |
| bonus_points / bonus_point_type_id | 常规赠送数量与类型，零赠送类型为NULL |
| auto_renew_enabled | 自动续费是否启用；与用于展示的续费奖励配置独立 |
| auto_renew_bonus_bps / auto_bonus_point_type_id | 自动续费额外赠送基点比例及类型，1000为10%；未配置赠送时类型为NULL |
| benefits_json | 展示权益数组，不替代point_model_rules的使用范围配置 |
| enabled / sort_order | 是否启用、降序排列权重 |
| version | 版本号，更新时匹配并递增，拒绝覆盖其他管理员的新版本 |
| created_at / updated_at | Unix毫秒 |

未开启自动续费也可配置并展示续费奖励；关闭开关保留奖励比例和积分类型。奖励比例大于零时仍要求有效积分类型并检查潜在总积分溢出，比例为零时类型规范化为NULL。

额外赠送按 `floor((paid_points + bonus_points) × auto_renew_bonus_bps / 10000)` 计算，仅用于配置有效性和溢出检查，当前不会发放积分。积分类型从数据库读取，不写死GENERAL/GPT。金额及积分使用signed int64，API中ID、版本、金额和积分均使用十进制字符串，避免JavaScript精度损失。

## 订单字段

订单保留平台订单号、用户/套餐关联、成交版本与快照、档位/周期、应付/实付分、三类积分数量/类型、自动续费比例快照、支付方式/服务商/渠道交易号、预留授权与周期、支付/履约状态、既有积分业务单关联、退款汇总、脱敏渠道结果及毫秒时间。

唯一键为平台订单号、服务商与渠道交易号、授权与周期、积分业务单ID。未发生的渠道交易/授权/积分业务单使用NULL，可保留多条未支付记录。授权ID只是未来关联预留，本期不创建授权表。

存在订单引用的套餐不能删除，可停用。未来创建订单必须与删除操作使用同一套餐锁并保存成交快照；本次表结构不保证尚未实现的订单状态机和退款正确性。

## 管理接口

全部要求登录管理员，PAT拒绝。与订阅管理页共用支付合规确认判断：只有已确认且条款版本为当前版本时，才允许新建、编辑、启停和删除；未确认、版本过期或尚未读到确认配置时显示相同提示并禁用写操作，列表与详情仍可查看。后端 POST/PUT/DELETE 复用既有合规校验，直接调用接口也不能绕过；已打开的表单和删除确认框在确认失效后停止提交。路径前缀 `/api/custom_subscription/admin/plans`：

| 方法 | 路径 | 功能 |
|---|---|---|
| GET | 前缀 | 分页、keyword、enabled、billing_cycle筛选 |
| POST | 前缀 | 创建完整套餐配置 |
| GET | 前缀/:id | 查看详情 |
| PUT | 前缀/:id | 完整配置更新，携带version字符串 |
| DELETE | 前缀/:id | 无订单引用时删除 |

分页参数p默认1、page_size默认20且上限100；按sort_order、id倒序。keyword为名称/编码的字面包含匹配，%与_不作为通配符。返回标准success/message/data；列表data包含page、page_size、total、items与point_types目录。详情及写入返回单个套餐DTO，含三类积分的类型展示对象。

请求只接受配置字段；未知字段、尾随JSON、无效整数、未知类型、重复编码、过期版本和不匹配的周期均拒绝。显式false、0及NULL正确保存。套餐CRUD不会产生订单和账务记录。

## 迁移与回滚

启动主库迁移时增量建表，不改日志库，不访问生产数据。回退代码时保留新表及数据，不自动DROP。数据库验证使用隔离真实实例；代表性旧余额样本不是完整最新正式发行版数据库升级证明。实际验证命令、版本、覆盖限制见定制登记。
