# Dubai data.dubai API — PROD 可用数据集(实测）

> 日期:2026-06-22 · 环境:**PROD** `https://apis.data.dubai` · App `PUBLIC-USR-UID-4057946`
> 经 UAE proxy 实测(本地走 `DUBAI_API_PROXY_URL`,或在迪拜 VPS 直连)。
> 探测工具:`backend/src/sync/dubai/probe/probe-many.ts`(批量) + `cli.ts discover <entity> <dataset>`(单个,带字段+filter语法)。
>
> ⚠️ **本报告取代** `2026-06-08-dubai-api-accessible-datasets.md`(那份是 STG,值假、且把 dsc/rta/projects 误判为 403/422)。

## 关键结论

- **STG 报告的 403/422 在 PROD 基本不成立。** `dsc`(统计)、`rta`(交通)**无需门户单独授权**即可拉;STG 报 422 的 `projects/buildings/land_registry/oa_service_charges` 在 PROD 全部正常。
- filter 语法:`col>'value'`(值要单引号);增量锚点 `load_timestamp`。

## 已在同步(每日,迪拜 VPS)

| 表 | 行数(2026-06-22) | 最新 load_timestamp |
|---|---|---|
| dld_transactions | ~963k | 2026-06-21 |
| dld_rent_contracts | ~5.54M | 2026-06-19 |
| dld_valuations | ~5k | 2026-06-17 |

⚠️ VPS 的每日 sync **不写本仓库的 `sync_runs`/`sync_cursors` 审计表**(停在 2026-06-18)→ 可观测性断层,出问题不易发现。待修。

## PROD 实测可拉(未同步,可接入)

| entity/dataset | 列 | 亮点字段 | 价值 |
|---|---|---|---|
| dld/`dld_projects-open-api` | 38 | project_status, **percent_completed**, completion_date, **escrow_agent_name**, no_of_units, project_start/end_date, developer_name | ⭐⭐⭐ 期房管线:进度/交付/托管/开发商 |
| dld/`dld_oa_service_charges-open-api` | 20 | **service_cost**(AED/sqft，按 category 拆行), project_name, master_community, budget_year | ⭐⭐⭐ Net Yield（SUM per project,year） |
| dld/`dld_units-open-api` | 47 | actual_area, floor, parking, is_free_hold | ⭐⭐ 供给/库存 |
| dld/`dld_buildings-open-api` | 46 | floors, elevators, swimming_pools, car_parks, flats/shops/offices | ⭐⭐ 配套 |
| dld/`dld_developers-open-api` | 23 | license, legal_status, expiry | ⭐ 背调 |
| dld/`dld_land_registry-open-api` | 32 | land parcels, is_free_hold | ⭐ |
| dsc/`dsc_population-open-api` | 8 | gender, year, nationality | ⭐⭐ 人口增长（投资逻辑），免授权 |
| rta/`rta_metro_stations-open-api` | 10 | lng/lat, line_name, opening_date | ⭐⭐ 官方地铁站，地图"到地铁距离" |
| dld/`dld_real_estate_permits-open-api` | 21 | 广告/展会许可 | — |

## 404（slug 名不对，可能存在，需登 data.dubai 门户查真名）

`dld_rent_index` / `rera_rent_index`（官方租金指数，价值⭐⭐⭐）、`dld_oqood`（期房合同登记）、
`dld_escrow_accounts`（独立托管表，projects 里已有 escrow_agent 可先用）、`dld_master_projects`、`dld_mortgaged_properties`。

## 推荐落地优先级

1. **`dld_oa_service_charges` → Net Yield**：接入 → SUM(service_cost) per project/budget_year → 项目详情显示物业费、区域指标加净回报。用户已确认要做。
2. **`dld_projects` → 项目可信度/进度**：完工%、交付日、托管方、开发商——直接强化"真实数据"卖点，也回应外部 AI 的"缺托管状态"。
3. **`rta_metro_stations`**：用官方地铁坐标替换/校准地图测距。
4. **`dsc_population`**：区域人口增长趋势,投资叙事。
5. 登门户找 `rent_index` 真 slug（官方租金指数对回报分析价值最高）。
