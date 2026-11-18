# 数据看板「本月速览」行 设计方案（v3 · 定稿）

> 位置：数据看板 → 模型调用分析 tab → **「总数 / 总额度」统计卡片行的正下方**（独立一行，4 张卡片）
> 口径：全部为**自然月**（本月 1 日 00:00 → 现在），与页面顶部所选周期无关。

---

## 1. 需求确认（最终结论）

| # | 结论 |
|---|---|
| 1 | 「最常用模型」**包含免费模型**调用 |
| 2 | 金额**使用系统设置的币种**（`quotaDisplayType`：USD / CNY / TOKENS / CUSTOM） |
| 3 | 放在「总数 / 总额度」这一行统计**下面**（独立一行，非消耗分布 panel 内） |
| 4 | 共 **4 张卡片** |
| 5 | 卡片名：**本月花费金额**、**本月花费积分**、**最常用模型**、**最烧钱秘钥**；后两者同样统计本月 |
| 6 | 「金额」= 系统真实消耗的法币，**与本页「总额度」同源**（`quota_data`），只是统计本月 |
| 7 | **仅 root** 看全量（所有用户）；admin / 普通用户看自己 |
| 8 | 「积分」卡保持**纯积分**数字（不折算 ¥） |
| 9 | 「最烧钱秘钥」按**积分**维度统计（`point_call_billing`） |

---

## 2. 数据源与口径（核心）

本 fork 有两套消耗记录：

- **`quota_data` 表**（`model/usedata.go`）：小时级聚合，**记录所有调用**（含免费模型，免费调用 `count=1, quota=0`），每 5 分钟落库（`DataExportEnabled`）。字段含 `user_id / model_name / token_id / created_at(秒) / count / quota`。现有「总额度」卡片、消耗分布图、Top 模型图都读它（`/api/data`）。
- **`point_call_billing` 表**（`model/point_call_billing.go`）：逐次积分计费，`state: reserved→charged→refunded`，`Points`=实扣积分，`created_at` 为**毫秒**，含 `user_id / token_id / model / points`。只有它带「积分」。

**4 张卡片的数据源（对称：2 卡走 quota_data，2 卡走积分表）：**

| 卡片 | 数据源 | 计算 | 展示 |
|---|---|---|---|
| 本月花费金额 | `quota_data` | `SUM(quota)`（本月） | `formatQuota()` → 系统币种（与「总额度」一致） |
| 本月花费积分 | `point_call_billing`（`state='charged'`） | `SUM(points)`（本月） | `formatNumber()` + 「积分」 |
| 最常用模型 | `quota_data` | `GROUP BY model_name ORDER BY SUM(count) DESC`（含免费） | 模型名 + 次数 + 占比 |
| 最烧钱秘钥 | `point_call_billing`（`state='charged'`） | `GROUP BY token_id(>0) ORDER BY SUM(points) DESC` | 秘钥名 + 积分 + 占比 |

> 说明：
> - 「金额」与「总额度」同源同口径，只是时间窗换成自然月 → 满足需求 6。
> - 「最常用模型」按**调用次数**（`count`），含免费模型 → 满足需求 1。
> - 「最烧钱秘钥」按**积分**（`points`），与「积分」卡同口径（烧钱=烧积分）→ 满足需求 9。免费调用不产生积分行，天然不计入。
> - 「积分」卡 = 本月实扣积分总和 → 满足需求 8。
> - 范围：root 不限定 `user_id`（全量）；admin / 普通用户限定 `user_id = 当前用户` → 满足需求 7。

---

## 3. 后端设计

### 3.1 响应结构（新文件 `model/monthly_summary.go`）

```go
type MonthlySummary struct {
    TotalQuota  int64     `json:"total_quota"`   // quota_data: SUM(quota) 本月
    TotalCount  int64     `json:"total_count"`   // quota_data: SUM(count) 本月（金额卡描述用）
    TotalPoints int64     `json:"total_points"`  // point_call_billing: SUM(points) 本月
    TopModel    *TopModel `json:"top_model,omitempty"` // quota_data 按次数
    TopToken    *TopToken `json:"top_token,omitempty"` // point_call_billing 按积分
}

type TopModel struct {
    ModelName string `json:"model_name"`
    Count     int64  `json:"count"`
    Quota     int64  `json:"quota"`
}

type TopToken struct {
    TokenID   int64  `json:"token_id"`
    TokenName string `json:"token_name,omitempty"`
    Points    int64  `json:"points"`
}
```

### 3.2 查询函数

```go
// GetMonthlySummary 聚合自然月消耗。
// startTimestamp / endTimestamp 为【秒】（与 /api/data 一致）。
// userID=0 表示全量（root）；>0 表示限定该用户。
func GetMonthlySummary(startTimestamp, endTimestamp int64, userID int64) (*MonthlySummary, error) {
    s := &MonthlySummary{}

    // ---- quota_data（秒级 created_at）----
    // 用闭包每次新建，避免 GORM 条件累积串味
    baseQD := func() *gorm.DB {
        q := DB.Table("quota_data").
            Where("created_at >= ? AND created_at <= ?", startTimestamp, endTimestamp)
        if userID > 0 {
            q = q.Where("user_id = ?", userID)
        }
        return q
    }

    // 1) 金额 + 次数
    var totals struct {
        Quota int64 `gorm:"column:quota"`
        Count int64 `gorm:"column:count"`
    }
    if err := baseQD().
        Select("COALESCE(SUM(quota),0) AS quota, COALESCE(SUM(count),0) AS count").
        Scan(&totals).Error; err != nil {
        return nil, err
    }
    s.TotalQuota, s.TotalCount = totals.Quota, totals.Count

    // 2) 最常用模型（按次数，含免费）
    var topModel TopModel
    if err := baseQD().
        Select("model_name, COALESCE(SUM(count),0) AS count, COALESCE(SUM(quota),0) AS quota").
        Group("model_name").Order("count DESC, quota DESC").Limit(1).
        Scan(&topModel).Error; err != nil {
        return nil, err
    }
    if topModel.ModelName != "" {
        s.TopModel = &topModel
    }

    // ---- point_call_billing（毫秒级 created_at）----
    basePB := func() *gorm.DB {
        q := DB.Model(&PointCallBilling{}).
            Where("state = ?", PointCallStateCharged).
            Where("created_at >= ? AND created_at <= ?", startTimestamp*1000, endTimestamp*1000)
        if userID > 0 {
            q = q.Where("user_id = ?", userID)
        }
        return q
    }

    // 3) 本月积分总和
    var points int64
    if err := basePB().Select("COALESCE(SUM(points),0)").Scan(&points).Error; err != nil {
        return nil, err
    }
    s.TotalPoints = points

    // 4) 最烧钱秘钥（按积分，排除无 key 的调用）
    var topToken TopToken
    if err := basePB().Where("token_id > 0").
        Select("token_id, COALESCE(SUM(points),0) AS points").
        Group("token_id").Order("points DESC").Limit(1).
        Scan(&topToken).Error; err != nil {
        return nil, err
    }
    if topToken.TokenID > 0 {
        var token Token
        if err := DB.Select("name").First(&token, "id = ?", topToken.TokenID).Error; err == nil {
            topToken.TokenName = token.Name
        }
        s.TopToken = &topToken
    }

    return s, nil
}
```

> 注意：`PointCallStateCharged` 常量、`Token` 结构需从对应包引入；`created_at` 单位换算（秒→毫秒）在 `basePB` 内完成。

### 3.3 Controller（`controller/usedata.go`，沿用「全量 / self」双 handler 模式）

```go
// GetMonthlySummary 仅 root，全量
func GetMonthlySummary(c *gin.Context) {
    start, end, ok := parseMonthlyRange(c)
    if !ok {
        common.ApiError(c, errors.New("invalid time range"))
        return
    }
    summary, err := model.GetMonthlySummary(start, end, 0) // 0 = 全量
    if err != nil {
        common.ApiError(c, err)
        return
    }
    c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": summary})
}

// GetMonthlySummarySelf 任意登录用户，仅自己
func GetMonthlySummarySelf(c *gin.Context) {
    start, end, ok := parseMonthlyRange(c)
    if !ok {
        common.ApiError(c, errors.New("invalid time range"))
        return
    }
    summary, err := model.GetMonthlySummary(start, end, int64(c.GetInt("id")))
    if err != nil {
        common.ApiError(c, err)
        return
    }
    c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": summary})
}

// parseMonthlyRange 解析并校验自然月区间（秒）。自然月 ≤31 天，做轻量上界校验。
func parseMonthlyRange(c *gin.Context) (int64, int64, bool) {
    start, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
    end,   _ := strconv.ParseInt(c.Query("end_timestamp"),   10, 64)
    if start <= 0 || end <= start || end-start > 40*24*3600 {
        return 0, 0, false
    }
    return start, end, true
}
```

### 3.4 路由（`router/api-router.go`，`dataRoute` 组）

```go
dataRoute.GET("/monthly-summary", middleware.RootAuth(), controller.GetMonthlySummary)
dataRoute.GET("/monthly-summary/self", middleware.UserAuth(), controller.GetMonthlySummarySelf)
```

> 权限：`RootAuth` 仅放行 role=100（root）→ 全量；`UserAuth` 放行所有登录用户 → 自己。admin（role=10）访问 `/monthly-summary` 会被 403，前端对 admin 走 `/self`。

### 3.5 性能 / 索引

- `quota_data` 已有 `created_at`、`user_id`、`token_id`、`model_name` 索引 → 月度聚合无需新索引。
- `point_call_billing` 现有 `user_id / state` 索引，**无 `created_at` 索引**：
  - 普通用户（`user_id=?`）：走 `user_id` 索引，OK。
  - root（全量）：`state='charged' AND created_at BETWEEN` 近似全表扫描 → **新增复合索引 `(state, created_at)`**（在 `migratePointCallBilling` 里 `CREATE INDEX IF NOT EXISTS`），避免大流量站点 root 看板卡顿。

---

## 4. 前端设计

### 4.1 类型（`web/src/features/dashboard/types.ts`）

```ts
export interface MonthlySummary {
  total_quota: number
  total_count: number
  total_points: number
  top_model?: { model_name: string; count: number; quota: number } | null
  top_token?: { token_id: number; token_name?: string; points: number } | null
}
```

### 4.2 API（`web/src/features/dashboard/api.ts`）

```ts
export async function getMonthlySummary(
  params: { start_timestamp: number; end_timestamp: number }, // 秒
  isRoot = false
) {
  const endpoint = isRoot
    ? '/api/data/monthly-summary'
    : '/api/data/monthly-summary/self'
  const res = await api.get<{ success: boolean; data: MonthlySummary }>(
    endpoint,
    { params }
  )
  return res.data
}
```

### 4.3 组件（新文件 `web/src/features/dashboard/components/models/monthly-overview.tsx`）

**布局**（独立 panel，放在「总数/总额度」行下方）：

```
┌──────────────────────────────────────────────────────────────┐
│ 本月速览                                                      │
│ 按自然月统计，直接回答最关心的四件事；下方图表仍为所选周期口径。      │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐│
│ │ 本月花费金额  │ │ 本月花费积分  │ │  最常用模型  │ │ 最烧钱秘钥  ││
│ │   ¥12.34    │ │  12,340 积分 │ │   gpt-4o    │ │   my-key  ││
│ │ 2026年11月·  │ │  2026年11月   │ │ 128次·占34% │ │ 1.2万积分·  ││
│ │ 362 次请求   │ │             │ │             │ │ 占 66%     ││
│ └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘│
└──────────────────────────────────────────────────────────────┘
```

- 外层：`general-card`（与「总数/总额度」行同款卡片容器）。
- 卡片网格：`grid grid-cols-2 lg:grid-cols-4 gap-3`（移动端 2×2）。
- 单卡：`rounded-xl border bg-muted/40 p-4`；上=标题（`text-xs text-muted-foreground`）、中=数值（`text-2xl font-bold font-mono`）、下=描述（`text-xs text-muted-foreground`）。
- 空态：数值「暂无数据」；描述「本月还没有调用记录 / 本月还没有消耗记录」。

**各卡片取值：**

| 卡片 | 数值 | 描述 |
|---|---|---|
| 本月花费金额 | `formatQuota(total_quota)`（系统币种，与「总额度」一致） | `{year} 年 {month} 月 · {formatNumber(total_count)} 次请求` |
| 本月花费积分 | `{formatNumber(total_points)} 积分` | `{year} 年 {month} 月` |
| 最常用模型 | `top_model.model_name` 或「暂无数据」 | 空：`本月还没有调用记录`；有：`{formatNumber(count)} 次调用 · 占 {pct}%` |
| 最烧钱秘钥 | `top_token.token_name`（空则「已删除的秘钥」）或「暂无数据」 | 空：`本月还没有消耗记录`；有：`{formatNumber(points)} 积分 · 占 {pct}%` |

> 占比 `pct`：最常用模型 = 该模型 `count` ÷ `total_count`；最烧钱秘钥 = 该秘钥 `points` ÷ `total_points`；保留 1 位小数。

**数据获取与刷新：**
- 组件内独立 `useEffect` 拉取（与所选周期解耦）。
- 自然月区间用 `dayjs`（**秒**）：`start = Math.floor(dayjs().startOf('month').valueOf() / 1000)`，`end = Math.floor(Date.now() / 1000)`。
- 挂载时拉取；轻量定时器（约 30s）检测「是否跨月」，跨月重拉；`visibilitychange` 恢复可见时也重拉。
- 加载中：4 张骨架卡；失败：数值 `--`。
- `isRoot` 由 props 传入（`userRole >= ROLE.ROOT`），决定端点。

**接入点（`index.tsx`，models tab）：** 在 `<LazyLogStatCards>` 之后、`{isAdmin && <LazyPerformanceOverview>}` 之前插入：

```tsx
<FadeIn delay={0.05}>
  <Suspense fallback={<MonthlyOverviewFallback />}>
    <LazyMonthlyOverview isRoot={isRoot} />
  </Suspense>
</FadeIn>
```

（新增 `LazyMonthlyOverview` lazy import + `MonthlyOverviewFallback` 骨架，风格对齐现有 `LogStatCardsFallback`。`isRoot` 在 `index.tsx` 由 `userRole` 计算。）

---

## 5. i18n 文案（7 个语言文件都要加）

英文为源 key，需同步 `en / zh / zh-TW / fr / ru / ja / vi`：

| Key (en) | zh |
|---|---|
| `This Month at a Glance` | 本月速览 |
| `Statistics by calendar month; the charts below still use the selected range.` | 按自然月统计，直接回答最关心的四件事；下方图表仍为所选周期口径。 |
| `This Month's Spend` | 本月花费金额 |
| `This Month's Points` | 本月花费积分 |
| `Most Used Model` | 最常用模型 |
| `Most Expensive Key` | 最烧钱秘钥 |
| `No data` | 暂无数据 |
| `No calls this month yet` | 本月还没有调用记录 |
| `No consumption this month yet` | 本月还没有消耗记录 |
| `{{month}} {{year}} · {{count}} requests` | {{year}} 年 {{month}} 月 · {{count}} 次请求 |
| `points` | 积分 |
| `{{count}} calls · {{percent}} of calls` | {{count}} 次调用 · 占 {{percent}} |
| `{{points}} points · {{percent}} of spend` | {{points}} 积分 · 占 {{percent}} |
| `Deleted key` | 已删除的秘钥 |

> 月份名用 `Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })` 本地化（en→"November 2026"，zh→"2026年11月"）。

---

## 6. 边界情况

| 场景 | 处理 |
|---|---|
| 本月无数据 | 4 卡空态（暂无数据 + 描述）；金额/积分显示 `¥0.00` / `0 积分` |
| 免费模型调用 | 计入「最常用模型」次数（`quota_data` 含免费）；`quota=0` 不影响金额；不产生积分行，不计入「积分/最烧钱秘钥」 |
| 秘钥已删除 | `token_name` 空 → 「已删除的秘钥」或 `秘钥 #{id}` |
| playground 调用（`token_id=0`） | 「最烧钱秘钥」`token_id>0` 过滤 |
| 跨月（页面挂置过 0 点） | 定时器检测跨月自动重拉 |
| `DataExportEnabled=false` | `quota_data` 不更新 → 金额/最常用模型卡可能滞后或缺失；积分/最烧钱秘钥卡不受影响（`point_call_billing` 实时）。默认 `true`，正常无感 |
| admin（role=10） | 走 `/self`，只看自己；`/monthly-summary` 对其 403 |
| root（role=100） | 走 `/monthly-summary`，看全量 |
| 时区 | 前端按浏览器本地时区算自然月，传**秒** |
| 积分体系未启用/无付费调用 | 积分/最烧钱秘钥卡 `0 积分`/空态；金额/最常用模型卡正常（基于 `quota_data`） |

---

## 7. 改动文件清单

**后端**
- `model/monthly_summary.go`（新）：`MonthlySummary` / `TopModel` / `TopToken` + `GetMonthlySummary`
- `controller/usedata.go`：`GetMonthlySummary` / `GetMonthlySummarySelf` / `parseMonthlyRange`
- `router/api-router.go`：2 条路由（`RootAuth` + `UserAuth`）
- （建议）`model/point_call_billing.go` 迁移：`(state, created_at)` 复合索引

**前端**
- `web/src/features/dashboard/types.ts`：`MonthlySummary`
- `web/src/features/dashboard/api.ts`：`getMonthlySummary`
- `web/src/features/dashboard/components/models/monthly-overview.tsx`：**新组件**（4 卡 + 拉取 + 跨月刷新）
- `web/src/features/dashboard/index.tsx`：models tab 在 `LogStatCards` 下插入 `<LazyMonthlyOverview isRoot>` + lazy import + fallback + `isRoot` 计算
- `web/src/i18n/locales/{en,zh,zh-TW,fr,ru,ja,vi}.json`：新增 key

---

## 8. 已定决策（无遗留）

- 全量仅 **root**（`RootAuth`）；admin / 普通用户看自己（`/self`）。
- 「积分」卡保持**纯积分**数字，不折算 ¥。
- 「最烧钱秘钥」按**积分**维度（`point_call_billing`）。
