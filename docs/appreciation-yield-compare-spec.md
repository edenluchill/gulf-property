# 增值率对比 + 租金回报率对比 — 设计 Spec

> 状态：设计定稿待评审 · 日期：2026-07-15 · slug：`appreciation-yield-compare`
> 面向：迪拜房产 App（买家 + 经纪双视角）
> 需求来源：
> 1. （项目 / 区域）**增值率对比**，可选周期 1月 / 3月 / 半年 / 1年 / 2年 / 3年 / 自选，AreaBlock 和地图都能控制
> 2. 看单个 project 时对比**区域租金回报率**，让客户看到这个盘比区域平均好还是差，并给原因

---

## 0. 一句话结论

两个功能**共用一台"区域中位价/中位租金"引擎**：增值率和回报率只是它的两个视图。
- **增值率做到区域级**（原料齐：`dld_transactions` 97 万行带成交日+area_id）；**项目级增值率放弃**（29 个策展项目 + 匹配不准 + 单盘样本太薄 = 噪声/编数），项目页改成"落到所在区域的增值率 + 该盘真实近期成交明细"。
- **租金回报对比已基本就绪**（`projectInsights.ts` 三级 tier + `/:id/insights` 已回 `area_yield_pct`），差的是**把隐性对比变成显式"优/劣于均值 + 原因"**。
- 新控件只有一个：`PeriodSelector`，一个组件两处挂载（AreaBlock + 地图），地图侧不加卡行。

---

## 1. 产品判断（买家 / 经纪视角）

### 1.1 为什么增值率只能做区域级
| 事实 | 来源 |
|---|---|
| 策展项目仅 **29 个 / 19 区**，且只有开发商挂牌价、无自身成交时间序列 | `residential_projects` 表 |
| DLD `project_name` 3090 个多为阿语脏串，`similarity≥0.45` 匹配丢一大半 | `docs/reports/2026-06-24-transaction-rent-matching-accuracy.md` |
| 单盘拆到月/季度做增值序列 → 样本个位数 → 纯噪声 | `getProjectTransactions` 仅取最近 40 行 |

**决策**：项目页的"增值率"= **本项目所在区域的增值率（tier 感知）+ 该盘真实近期成交明细**。绝不生成"本楼盘涨了 X%"这种伪项目级数字（对齐 [[luna-tour-audit-2026-07-12]] 的教训：编的 ROI 当事实播报）。

### 1.2 为什么短周期要护栏，不是直接给
- 区域级 1月/3月 中位价样本薄，户型结构（公寓/别墅混合）一变就失真，点对点比值会剧烈抖动。
- **设计策略**（已定：全部周期都摆出来，不藏）：
  - 全档位平铺可选：**1月 / 3月 / 半年 / 1年 / 2年 / 3年 / 5年 + 自定义日期**，默认近1年。
  - 短周期（1月/3月/半年）**不隐藏**，但挂一个小 ⓘ「短周期样本波动大，仅供参考」，用诚实提示替代隐藏。
  - 增值率一律用**滚动窗口中位价之比**（非点对点）；任一端点窗口样本不足 → 自动加宽窗口或返回"样本不足"，**绝不硬报抖动数**（护栏对短周期尤其重要）。

### 1.3 对比要回答的买家问题
1. 这个区域/项目**过去 X 时间涨了多少**？（增值率）→ 附全市基准："JLT +12% · 全市 +8% · 高于均值 4pp"
2. 这个项目的**租金回报比区域平均高还是低**？高/低多少？→ verdict + gap（pp）
3. **为什么**高/低？→ 数据分解的主导因子（溢价 / 户型 / 期房 / 物业费），不是 AI 空话
4. 这个数**可信吗**？→ 匹配 tier（本开发体/本社区/区域）+ 样本量 + 数据截止

---

## 2. 数据层现状与新建

### 2.1 现状（可直接用）
| 能力 | 来源 | 备注 |
|---|---|---|
| 区域租金回报率 | `get_dubai_area_metrics()`（`offplan-segment-metrics.sql:217`） | 口径=中位新签租金/㎡ ÷ 中位成交价/㎡ ×100，见 [[area-metric-conventions]] |
| 项目 vs 区域 三级 tier | `projectInsights.ts:164-246` | development(≥30 笔) → area → area_name |
| `/:id/insights` 已回区域基准 | `lib/api.ts:979` | `area.rental_yield_pct` / `investment.area_yield_pct?`（已预留）/ `area_growth_pct?` |
| 区域**年度**增值序列 1997–2026 | `dubai_area_yearly_metrics`（`area-analytics-schema.sql:12`） | ⚠️ 3 个坑见下 |
| 全市月度价格趋势 24 月 | `market_cache` | 分区不可用 |
| 原始成交（增值率原料） | `dld_transactions` 97 万行 `instance_date` 2021→2026 | 每行带 `area_id`+`is_offplan`+`meter_sale_price` |
| 原始租约 | `dld_rent_contracts` 560 万行 `start_date` | `registration_type` New/Renew |

**`dubai_area_yearly_metrics` 三坑**（P1 用它前必处理）：
1. YoY 用 `avg_price_sqm` 不是 median → 口径与展示的 median 不一致；**自己用 median 列重算 YoY**。
2. 只覆盖官方 area_id 桥接区（~100 个），**不含手绘区**。
3. 不在每日任务刷，当前年可能偏旧且是部分年 → **展示必须标数据截止**。

### 2.2 新建：`AreaSeries` 预计算表（P2 核心）

灵活周期增值率的唯一新增数据资产。现算全表扫 97 万行冷查 6–14s（`projectInsights.ts:54` 已印证是 HIGH_LATENCY 报警主源），必须物化。

```sql
-- backend/src/db/create-area-price-monthly.sql
CREATE TABLE dld_area_price_monthly (
  dubai_area_id   int      NOT NULL,
  month           date     NOT NULL,          -- date_trunc('month', instance_date)
  usage           text     NOT NULL,          -- 'all'|'residential'|'commercial'|...
  segment         text     NOT NULL,          -- 'all'|'offplan'|'ready'
  median_price_sqm  numeric,                   -- 成交中位价/㎡
  price_sqm_p25     numeric,
  price_sqm_p75     numeric,
  tx_count          int    NOT NULL DEFAULT 0,
  median_rent_sqm   numeric,                   -- 年租金/㎡ 中位（新签优先）
  rent_count        int    NOT NULL DEFAULT 0,
  PRIMARY KEY (dubai_area_id, month, usage, segment)
);
CREATE INDEX idx_apm_area_month ON dld_area_price_monthly (dubai_area_id, month DESC);
```

口径铁律（沿用 [[offplan-segment-metrics]]）：
- 价格 / 成交量按 segment 取（散客默认 offplan）；
- **租金/收益率只挂 `segment='all'`**（期房价格做分母无意义）；
- 分桶按业务日期 `instance_date` / `start_date`，**绝不用 `load_timestamp`**（那是入库时间）；
- 租金序列兜底 `start_date <= CURRENT_DATE`（防未来起租日"假装有新数据"，见 [[dld-freshness-load-timestamp-index]]）。

刷新：
- **一次性全量回填**（2021→今，脚本 `backfill-area-price-monthly.ts`）。
- **每日增量**接进 `dubai-daily.ts`（只重算最近 ~40 个月 + 当月），后台批量必须 `await yieldToLiveTraffic()`（见 [[warmer-starves-live-traffic]]）。
- 手绘区历史序列走空间 `ST_Covers` 版（更贵），**P2 只覆盖官方区**，手绘区留 P3。

### 2.3 计算模块 `appreciation()`（纯函数，读 AreaSeries）

```
appreciation(areaId, period, segment=<当前 marketSegment>, usage='residential') -> {
  pct,            // endMedian / startMedian - 1
  fromMonth, toMonth,
  startMedian, endMedian,
  startN, endN,   // 两端点窗口成交量
  confidence,     // 'high'|'medium'|'low'|'insufficient'
  series,         // 窗口内逐月中位价（给 sparkline）
  cityPct         // 同周期全市基准（去掉 area 过滤）
}
```
规则：
- 端点用**滚动窗口中位价**平滑：≥1 年周期用 3 个月滚动窗；<6 月用 1 个月窗。
- `period` = `{kind:'preset',months}` 或 `{kind:'custom',from,to}`。
- 护栏：任一端点窗口 `N < 阈值`（区域建议 20，可按区域活跃度缩放）→ 先加宽窗口，仍不足 → `confidence='insufficient'`，前端显示"样本不足"不报数。

---

## 3. 模块架构（三层，边界清晰）

```
┌── 数据层 ────────────────────────────────────────────────┐
│  AreaSeries (dld_area_price_monthly)  ← 单一真相源         │
│    ├─ appreciation(area, period, seg, usage)  纯函数       │
│    └─ yield(area, seg, usage) = get_dubai_area_metrics    │
└──────────────────────────────────────────────────────────┘
            │                                   │
┌── API 层 ─┼───────────────────────────────────┼───────────┐
│  GET /market/area-insights?areaId&usage&segment&period    │
│     → { ...现有月度序列, appreciation:{...} }              │
│  GET /projects/:id/insights                               │
│     → { ...现有, yield_comparison:{...}, area_growth:{...}}│
└──────────────────────────────────────────────────────────┘
            │                                   │
┌── 前端层 ─┼───────────────────────────────────┼───────────┐
│  共享:  PeriodSelector + useMetricPeriod(localStorage)     │
│         ComparisonRuler (泛化自 PriceCheckModule)          │
│  F1:    AreaBlock(AreaTrendGrid) / MapPage 周期控制        │
│  F2:    YieldVsAreaModule (ProjectDetailPage/OverviewTab)  │
└──────────────────────────────────────────────────────────┘
```

**共享原语（两功能复用，模块化关键）**
| 模块 | 新/改 | 说明 |
|---|---|---|
| `AreaSeries` 表 + `appreciation()` | 新 | 增值率与回报率共用同一台引擎 |
| `PeriodSelector` + `lib/metricPeriod.ts` | 新 | 唯一新控件；state 照抄 `marketSegment.ts`（localStorage+collab+透传） |
| `ComparisonRuler` | 泛化 | 从 `PriceCheckModule` 抽出：主体值 vs 基准分布 + 越高越好 → 标尺+落点+verdict+"为什么"抽屉 |
| `useAreaInsights` | 改签名 | 增 `period` 参数 |

---

## 4. Feature 1 — 增值率对比 + 周期选择

### 4.1 `PeriodSelector`（唯一新控件）
- **全档位平铺**（不藏短周期）：`1月 · 3月 · 半年 · 1年 · 2年 · 3年 · 5年 · 自定义`，默认近1年。
  - 桌面/AreaBlock：pill 行两排换行（wrap）铺满；移动端窄处：横向可滚动 pill 行（`overflow-x-auto`，不换行避免占高）。
  - 短周期（1月/3月/半年）pill 上挂一个小 ⓘ `InfoHint`：「短周期样本波动大，仅供参考」——**诚实提示，不隐藏**。
  - `自定义` = popover（复用 `components/ui/popover.tsx` + `date-picker.tsx`）选任意日期区间。
- **值模型**：`type MetricPeriod = {kind:'preset', months:number} | {kind:'custom', from:string, to:string}`。
- **持久化**：`lib/metricPeriod.ts`（镜像 `marketSegment.ts`）→ localStorage；进 collab `mapStateSync` payload；像 `segment` 一样透传。
- **视觉**：套用 `USAGE_FILTER` pill 范式，选中态主题色、`active:scale-90`、`rounded-full`。

### 4.2 挂载点 A：AreaBlock
- `AreaDetailDialog.tsx:199` usage pill 行下方新增一行 `PeriodSelector`。移动端 `MobileBottomSheet` 顶部同放。
- 驱动 `useAreaInsights(areaId, usage, segment, period)` → 拉 `appreciation`。
- 展示复用 `AreaTrendGrid` 的 **capitalGrowth StatCard**（`AreaInsightsPanel.tsx:322`）：
  - 大数 `+12.4%` + 周期副标 `近1年`
  - `SparkLine` 画窗口内中位价序列
  - **对比行**：`本区 +12.4% · 全市 +8.1% · 高于均值 4.3pp`（`cityPct`）
  - `InfoHint` 挂口径：滚动窗口中位价之比 + 样本量 + 数据截止 + 免责

### 4.3 挂载点 B：地图（不加卡行，守工具卡 top 铁律）
- **不**往 148px 控制卡塞 7 选项。
- 当 `areaMetric === 'capitalGrowth'`：把底部"当前指标"标签（`MapPage.tsx:2001-2019`）变为可点 → `资本增值 · 近1年 ▾`，点开同一个 `PeriodSelector` popover。
- 选定周期 → 重算 `appreciation` 给热力图上色（`getHeatmapColor` capitalGrowth 走正负绿红，`lib/map/metrics.ts:125`）。
- **零新行、零卡高变化** → 不触发 `MapViewMapLibre.tsx:1789` 工具卡 top 重排（见 [[map-mobile-chrome-layout]] 铁律）。

### 4.4 项目页的"增值率"（诚实版）
- 不做项目级增值率。展示：`本项目所在区域 [Area] · 近[period] +X% · 高于全市 Ypp`（tier 感知）。
- 下附**该盘真实近期成交明细**（`getProjectTransactions`），≥ 足够点数时画一条 per-sqm 散点/趋势，明确标"本盘真实成交"而非计算率。

---

## 5. Feature 2 — 项目 vs 区域 租金回报对比 + 原因

### 5.1 挂载点
`ProjectDetailPage/OverviewTab.tsx`：`InvestmentScorecard` 之后、`PriceCheckModule` 之前，新增 `YieldVsAreaModule`。

### 5.2 数据（大部分已就绪）
`/:id/insights` 扩返回：
```
yield_comparison: {
  project_yield_pct,        // 本项目（gross）
  project_net_yield_pct,    // 扣物业费
  area_yield_pct,           // 区域基准（已预留 investment.area_yield_pct）
  gap_pp,                   // project - area
  verdict: 'above'|'inline'|'below',
  tier: 'development'|'area'|'area_name',   // 匹配层级（沿用现状）
  confidence, sample_n, data_through,
  factors: Factor[]         // 见 5.4
}
```

### 5.3 UI（复用 `ComparisonRuler` = PriceCheckModule 范式）
- 一条标尺：区域回报分布（min..avg..max），项目回报按比例落点。
- verdict chip：`高于区域均值 +0.8pp` / `与区域持平` / `低于区域 0.6pp`，配色 above=emerald / inline=slate / below=amber。
- 匹配 tier 徽章（`本开发体/本社区/区域` + 置信度，`InvestmentScorecard.tsx:89` 现成）**必须带上**——可信度取决于匹配层级。
- 底部"为什么?"抽屉 = 因子分解 + 口径（照抄 PriceCheck 的 `methodology` 诚实叙述）。

### 5.4 原因引擎（数据驱动，非 AI 编）
回报率 = 年租金/㎡ ÷ 价格/㎡。项目偏离区域必来自可算因子，按贡献排序取主导 1–2 个：

| 因子 key | 判定（数据） | 文案示例 |
|---|---|---|
| `price_premium` | 项目 price/sqm vs 区域中位（PriceCheckModule 已算出溢价%） | "本项目溢价 12%，摊薄回报约 0.7pp" |
| `unit_size` | 项目户型均面积 vs 区域均面积（小户型租金/㎡更高） | "户型偏小，租金/㎡ 更高，抬升回报" |
| `offplan` | `is_offplan` | "期房阶段，回报以区域现房口径估算" |
| `service_charge` | 净回报差（物业费差异，`fetchAreaInvestment` 有物业费） | "物业费高于区域，净回报再降 0.3pp" |
| `building_age` | 楼龄（若可得，P3） | "楼龄新，租金溢价支撑回报" |

- 输出结构化 `Factor[]`，前端渲染因子 chip。**已定：只做数据分解，不接 AI 小结**（彻底规避编造）。

---

## 6. 接口契约变更清单

| 接口 | 变更 | 兼容性 |
|---|---|---|
| `GET /market/area-insights` | 入参加 `period`；出参加 `appreciation:{...}` | 不传 period 默认近1年，向后兼容 |
| `GET /projects/:id/insights` | 出参加 `yield_comparison:{...}`、`area_growth:{pct,period,cityPct,tier}` | 纯新增字段 |
| `lib/api.ts` 类型 | `AreaInsights` 加 `appreciation`；`ProjectInsights` 加 `yield_comparison` | — |

---

## 7. 必须遵守的既有铁律（防回归）

- 金额一律 `lib/money.ts` + `DirhamSymbol`，中文"万/亿"（[[money-format-conventions]]）。
- segmented / pill 是标准切换范式，选中态主题色 + `active:scale-90` + `rounded-2xl bg-white/95 ... backdrop-blur` 白卡。
- **数字诚实**：每个指标带 `InfoHint`（怎么算的）+ 样本量 + 数据截止 + 免责；对比必须标口径与 tier，否则跟别家数字对不上掉信任。
- 改控制卡高度 → 同步挪 `MapViewMapLibre.tsx:1789` 工具卡 top，并 **414/1180/1440 三档截图验证**（`frontend/scripts/screenshot.mjs`，[[map-screenshot-harness]]）。
- i18n：文案加在 map/project namespace 的 en + zh-CN 两份；短标签走内联 `(i18n.language||'en').startsWith('zh')` 三元（项目惯例）。
- 高频值禁入 React state → GL paint（[[map-hover-paint-perf]]）；周期切换重算热力图走 `setFilter`/图层，不整页重渲染。
- 新增后台批量 DB 任务必 `await yieldToLiveTraffic()`（[[warmer-starves-live-traffic]]），并加 `NODE_ENV` 门防本地残留连生产库（[[local-dev-ghost-processes]]）。

---

## 8. 分期落地

### Phase 1 — 回报对比 + 年度增值（零新表，快，ROI 高）
- F2 完整：`yield_comparison` + 因子分解（`area_yield_pct` 已就绪）+ `YieldVsAreaModule`（复用 PriceCheck 范式）。
- F1 区域增值率用现成 `dubai_area_yearly_metrics`，先支持 **1年/3年/5年**（median 重算 YoY，标数据截止）。
- 交付"帮客户做决策"的核心价值，不等新预计算。

### Phase 2 — 灵活周期增值率（核心新建）
- 建 `dld_area_price_monthly` + 回填 + 每日增量。
- `appreciation()` + `/market/area-insights?period`。
- `PeriodSelector` + `lib/metricPeriod.ts` 上 AreaBlock 和地图。
- 打开完整 1月–5年 + 自选，含短周期护栏。

### Phase 3 — 打磨
- 区域 vs 区域对比选择器（挑两个区并排）。
- 项目真实成交趋势图（原因保持纯数据分解，不加 AI）。
- 周期 collab 同步、手绘区历史序列（空间版）。

---

## 9. 验证 / 埋点

- **数据正确性**：`appreciation()` 抽 3 个活跃区（Marina/JVC/Business Bay）人工核 1Y/3Y 与 DLD 公开报告量级一致；短周期护栏用小区域触发"样本不足"路径。
- **UI 回归**：地图 414/1180/1440 三档截图；AreaBlock 桌面/移动 bottom sheet 两态。
- **埋点**（走既有 telemetry，[[telemetry-system]]）：`period_change`（哪个周期被选）、`yield_compare_view`（verdict 分布）、`appreciation_insufficient`（多少查询命中样本不足 → 反推护栏阈值是否过严）。
- **诚实校验**：随机抽项目，人工确认因子文案与数据一致，无脱离数据的 AI 编造。

---

## 9b. 实现记录 — Feature 2（2026-07-15 已上线后端 + 前端就绪）

- **粒度现实**：29 个策展项目里,能出 `yield_comparison` 的是 **7 个**（development 层且区域有 residential/all 基准）。其余 22 个是全新社区无 DLD 历史 → 诚实不渲染（模块 `return null`）。
- **两种 basis**（对原设计的重要演进）：
  - `measured` — 开发体自身有租赁记录 → 真实项目回报 + 精确价格×租金分解。
  - `price_adjusted` — 有成交价但暂无稳定租赁（新盘常态）→ 回报按「以本盘成交价买入、按区域租金出租」**估算**,整段差值即溢价对回报的拖累(新盘买家最该知道的数)。前端加「估算」标 + `≈`。
- **精确自洽**（诚实关键）：先 round 两个回报再派生 gap 与因子,`价格 pp + 租金 pp == 显示差值`,且 `本项目 − 区域 == gap`。曾因各自独立 round 漂 0.1(4.4 vs 5.2 却报 −0.9),已修为「租金取残差」。
- **附带修既有 bug**：tier-1 `areaMetrics` 查询原来不带 `usage/segment` 过滤,同月 12 行里随机抓到 null-yield 行 → development 层项目的区域涨幅/回报/中位价一直可能是错的。已加 `usage='residential' AND segment='all'`。
- **文件**：后端 `services/projectInsights.ts`(`buildYieldComparison`);前端 `pages/ProjectDetailPage/YieldVsAreaModule.tsx`(复用 PriceCheck 范式,因子文案前端按语言组装);挂载 `OverviewTab` InvestmentScorecard 之后。
- **前端待推**:改动已 type-check + 本地视觉验证通过(The Wilds 截图),CF Pages 需 `git push` 才上线。

## 9c. 实现记录 — Feature 1（2026-07-15 已上线后端 + 前端就绪）

**架构比原计划更简单：没建新预计算表。** `/market/area-insights` 本就按区算 37 个月中位价/㎡ 序列(三口径,cached 6h + 全 210 区预热,官方区+手绘区都覆盖)。增值率只是它的派生量:

- **后端**(`routes/market.ts`):
  - sales 序列 lookback 37→**63 个月**(支持到 5 年 + 平滑窗口)。
  - `computeAppreciation(smoothed, counts)`:滚动窗口中位价之比,全周期(1m–5y)一次算齐;护栏=端点 3 月窗口 ≥10 笔,且**合理带 −80%~+400%**(超出=户型/地块结构漂移假信号,如稀疏工业区 +2063%,判 null)。
  - `appreciation` 塞进 area-insights 响应的 variants(跟随 segment);`loadCityAppreciation` 全市基准注入 `appreciationCity`(同口径,「本区 vs 全市」)。**全周期都在响应里 → 前端切周期零请求**。
  - 地图上色:新端点 `GET /market/area-appreciation` 一次返回**全官方区 × 各周期 × 三口径**增值率(一条聚合查询),cached+预热。手绘区天然不在(synthetic 900000+ 桥不匹配真实 area_id)。
  - **1 年增值率 == 既有 YoY `growth[-1]`**(实测自洽,验证计算正确)。
- **前端**:
  - `lib/metricPeriod.ts`(周期单点配置,localStorage 持久化,**AreaBlock 与地图共用同一 key → 天然同步**)+ `components/PeriodSelector.tsx`(全档位平铺 wrap,短周期挂 ⓘ + 选中时「样本波动大」提示)。
  - **AreaBlock**(`AreaInsightsPanel.tsx`):grid 上方加「资本增值周期」选择器;资本增值卡改用 `appreciation[period]`,附「全市 +X% · 高于/低于 Ypp」对比 + sparkline。
  - **地图**(`MapPage.tsx`):控制卡底部「增长」标签变可点「增长·近1年 ▾」→ 开周期 popover(**不加行高,不触发工具卡 top 铁律**);`mapAreas` 派生数组把 `capitalAppreciation` 覆盖成所选周期值只喂地图层(弹窗 selectedArea 仍取原数组,不受影响);414/1180/1440 三档截图已验证。
- **前端待推**:全部 type-check + 实机截图通过;CF Pages 需 `git push` 才上线。

## 11. Phase 4 — 周期扩到全指标 + 项目对比分析 tab（2026-07-15 追加）

### 11.1 周期 → 全指标（统一时间窗口，已定「全套」）
周期从"只驱动资本增值"升级为**全局时间窗口**，所有指标按所选窗口重算：

| 指标 | 窗口口径 | 精度 |
|---|---|---|
| 成交量 | 窗口内笔数(∑月度 count) | 精确 |
| 增值率 | 窗口端点中位价之比 | 已做 |
| 中位价/㎡、中位总价 | 窗口内中位价 | **近似**=成交量加权的月度中位均值(避免 63×percentile 重查);标「近N期」 |
| 租金回报 | 窗口内中位租金/㎡ ÷ 窗口内中位价/㎡ | 近似(同上) |
| 租赁稳定率 | 保持全口径(与窗口无关) | 不变 |

- **诚实铁律**:长周期的价格/回报是跨年成交合并,UI 必须标「近3年」而非「当前」,`InfoHint` 说明"把窗口内所有成交合并算,不是现价"。
- **后端**:
  - area-insights 的月度查询已取 median pps + count(63 月);**补 median 总价 + median 租金/㎡ 月度序列**,派生各窗口加权值 → 塞进 `appreciation` 同款结构(每指标一份 per-period map)。
  - all-area 端点(`/market/area-appreciation` → 改名/扩为 `/market/area-metrics-by-period`)同样返回**每区×每周期×每指标**窗口值,给地图全指标按周期上色。
- **前端**:
  - 周期选择器不再只在 `capitalGrowth` 显示 → **任意指标选中都显示**(地图控制卡底部标签统一变「<指标>·近1年 ▾」)。
  - `mapAreas` override 从只覆盖 `capitalAppreciation` → 覆盖当前指标对应字段(medianUnitPrice/medianPriceSqm/rentalYield/transactionCount/capitalAppreciation)。
  - AreaBlock 六张卡全部读窗口值;周期选择器标题从「资本增值周期」→「指标时间范围」。
  - 短周期护栏 + 样本不足 `—` 一致复用。

### 11.2 项目 vs 区域 + 附近项目 —— 新「对比分析」tab
现状:项目 vs 区域对比散在「概览」(YieldVsAreaModule 回报 + PriceCheckModule 价格)。用户要更直观 + 独立 tab + 能比附近项目。

**新增 tab `对比分析`**(`ProjectDetailPage` 加 tab,`AGENT_TABS`/路由风格一致):
- **区块 A:本盘 vs 所在区域(全维度记分卡)** — 一屏看齐:回报率 / 价格/㎡(溢价%) / 增值率 / 5年年化,每行一条对比条(复用 `YieldVsAreaModule` 标尺 + `PriceCheckModule` 标尺 + `ReturnsBar`),右侧 verdict chip(高于/低于区域 + pp)。把散落的对比收敛成一个"体检报告"。
- **区块 B:附近同类项目横评** — 按经纬度取最近 4–6 个 project,表格列:起价 / 回报率 / 溢价 / 增值率(区域级) / 交付时间 / 匹配置信,本盘高亮置顶。帮买家做"这盘 vs 隔壁那盘"的横向决策。数据:`residential_projects` 空间近邻 + 各自 `getProjectInsights`(已缓存预热)。
- **诚实**:附近项目多为新盘→回报/增值走各自区域级(带 tier 徽章);缺数据的项目列「—」不编。

**接口**:`GET /residential-projects/:id/nearby-compare?radius=` → `{ subject, area, nearby[] }`,复用现有 insights 缓存,新增仅空间近邻查询。

### 11.3 建议顺序
先 **11.1 周期全指标**(已定、延续已上线的地图/AreaBlock,改动集中在增值率基础设施的泛化)→ 再 **11.2 对比 tab**(新 tab + 近邻查询,独立可增量)。

## 10. 已定决策（2026-07-15 用户拍板）

1. **周期全档位平铺，短周期不藏**：`1月/3月/半年/1年/2年/3年/5年/自定义` 全部可选，默认近1年；短周期挂"样本波动大"ⓘ 提示替代隐藏。（见 §4.1）
2. **增值率 segment 跟随地图市场口径**（综合/期房/现房）：`appreciation()` 的 `segment` 参数默认取当前 `marketSegment`，口径与地图/AreaBlock 一致。租金回报仍固定 `segment='all'`（期房价格做分母无意义，见 §2.2 铁律）。
3. **原因只做数据分解**：`YieldVsAreaModule` 的"为什么"只渲染数据驱动的因子 chip（§5.4），**不接 AI 小结**（含 P3 也不做），彻底规避编造。
