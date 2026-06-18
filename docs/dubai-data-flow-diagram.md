# 迪拜 DLD 数据流 — 结构图

> 2026-06-18 · DDA iPaaS(官方 data.dubai)→ 落库 → 分析/前端展示 的完整结构。
> 配套:`docs/dubai-data-api-sync-spec.md`(同步设计)、`docs/dubai-sync-architecture.md`。

## 1. 总览

```
            UAE-only API                    UAE 代理(LightNode 38.54.8.9:8888)
        ┌──────────────────┐                  ┌───────────────┐
        │  DDA iPaaS        │ ◀──HTTPS隧道──── │  tinyproxy     │ ◀── 德国 worker / 本地
        │  apis.data.dubai  │   (端到端加密,    │  CONNECT only  │      (无 UAE IP,故走代理)
        │  PROD ✅          │    代理看不到密钥) │  *.data.dubai  │
        └────────┬─────────┘                  └───────────────┘
                 │ open/dld/<dataset>?page&pageSize&filter&order_by
                 │ auth: getAccessToken (x-DDA-SecurityApplicationIdentifier, token 1h)
                 ▼
        ┌─────────────────────────────────────────────────────────────┐
        │  backend/src/sync/dubai/  (client: auth / httpClient 限速60/min /│
        │  dataApi 分页 / proxyAgent;config: env + datasets 注册表)       │
        └───────┬──────────────────────────────────┬───────────────────┘
                │                                   │
   ┌────────────▼─────────────┐        ┌────────────▼──────────────────┐
   │ A. 全量 framework sync    │        │ B. 增量补 / 重抓(实际在用)     │
   │   core/syncEngine + sinks │        │   scripts/dubai-*.ts          │
   │   ⚠️ upsert 需唯一键,现   │        │   • catchup-transactions:      │
   │   有 bulk-CSV 表是 serial │        │     instance_date>max 纯INSERT │
   │   id+业务键有重复 → 跑不了 │        │   • refetch-window:staging→    │
   │   (待键位 reconciliation) │        │     sanity→原子 删窗口+换新      │
   └──────────────────────────┘        │     (无重复;rent 补 area_id)   │
                                        └────────────┬──────────────────┘
                                                     ▼
```

## 2. 落库 + 分析层

```
   ┌──────────────────────── PostgreSQL(生产)─────────────────────────┐
   │  dld_transactions (154万→现155万, instance_date→2026-06-15)         │
   │  dld_rent_contracts (978万, start_date, 有 dubai_area_id)           │
   │  dld_valuations (主键已修=procedure_year+procedure_number)          │
   │       │                                                            │
   │       │  桥接:dld_areas(area_id ⇄ dubai_area_id)                  │
   │       ▼                                                            │
   │  分析视图/函数:v_sales / v_rent(规范 bedrooms/ptype/size)          │
   │   + dubai_area_rolling_metrics(区域 yield/growth/median/volume)     │
   │   + market_stats / investment_analysis / area_investment_report…   │
   │  审计:sync_runs / sync_run_errors / sync_cursors                   │
   └───────┬───────────────────────────────┬───────────────────────────┘
           │                               │
           ▼                               ▼
```

## 3. API → 前端展示

```
   ┌─ /api/market ──────────────┐     ┌─ /api/residential-projects ─────┐
   │ transactions/{filters,      │     │ /:id/insights                   │
   │   summary,list,projects}    │     │  (投资 ROI + 附近 POI/通勤 +     │
   │ rent/{filters,summary,list} │     │   区域指标,复用 v_sales/metrics) │
   │  (market.ts / market-rent.ts)│    └──────────────┬──────────────────┘
   └──────────────┬──────────────┘                    │
                  ▼                                    ▼
        ┌───────────────────────┐          ┌────────────────────────┐
        │ /transactions 页       │          │ /project/:id 详情页      │
        │  [成交 | 租金] 切换      │          │  投资评估卡 + 位置情报    │
        │  KPI + 24mo趋势 + 明细  │          │  + 户型 ROI + 付款时间轴  │
        └───────────────────────┘          └────────────────────────┘
```

## 4. 每日自动补(cron)

```
   德国 worker(经 UAE 代理)  crontab:
     30 3 * * *  scripts/dubai-daily-refresh.sh
        └─ refetch-window transactions  [今天-45d .. 明天]   (滚动窗口)
        └─ refetch-window rent          [今天-45d .. 明天]
     为什么滚动 45 天:DLD 近几个月会持续补登(late registration),
     固定重抓最近窗口 = 既补迟到的、又加新日子,且 staging 换新零重复。
   ⚠️ 增量锚点用日期列(instance_date / start_date),不用 load_timestamp
      (后者是 DDA 整库刷新时间戳,每次刷新会让全表"看起来都更新")。
```

## 5. 关键约束与坑(务必记住)

- **仅 UAE IP 可访问** → 必走 UAE 代理(密钥不落代理盒子)。
- **STG 假数据 / PROD 真数据** → `.env` 必须 `DUBAI_API_BASE_URL=https://apis.data.dubai`。
- **filter 值要单引号** `col>'value'`(不带引号 = 400 InvalidFilter)。
- **业务键不一定唯一**:transactions `transaction_id` 有少量重复;valuations `procedure_id` 是常量(真键 year+number,已修);rent 一约多 line。→ framework upsert 要先做键位 reconciliation;现用 staging-swap 重抓规避。
- **bulk CSV 表 = serial id 主键,无业务唯一约束** → 不能 ON CONFLICT,只能"删窗口+重灌"或纯 INSERT 新数据。
- 限速 60/min、1000 行/页、token 1h、30s 超时。
- 历史回填 2023-2026:以后做(分窗口跑 refetch-window 即可,天然无重复)。
```
