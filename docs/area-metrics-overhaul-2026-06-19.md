# 区域指标口径改版 — 2026-06-19

依据用户/ChatGPT 反馈,调整区域市场指标的计算口径并在前端加「如何计算」提示(带证据)。

## 改了什么

| 指标 | 旧口径 | 新口径 |
|---|---|---|
| 租金回报 rentalYield | `AVG(全部租约 年租/sqm) / AVG(成交价/sqm)` | **`median(新签租约 年租/sqm) / median(成交价/sqm)`** —— 新签=今天能租出的价,中位数抗离群 |
| 增值 capitalGrowth | `(近12月 AVG价 − 前12月 AVG价)/前12月` | **改用中位数**(本期 vs 前 12 月,样本≥20 守卫不变) |
| **稳定性 rentStability(新增)** | — | **`median(续租租约) / median(新签租约) * 100`**。≈100=老租客接近市场价(稳定);低=区域租金涨得快 |

口径全部 per-sqm,避免户型面积差异带偏(studio 回报虚高)。房价一直用 DLD 成交价(非挂牌)。

`registration_type` 字段(`New`/`Renew`,各约 280万/270万行)使新签/续租区分成为可能。

## 数据层

- 迁移 `backend/src/db/add-rent-stability-and-median-yield.sql`(已应用到生产 DB):
  - `dubai_area_rolling_metrics` 加列:`median_new_rent_sqm`、`median_renew_rent_sqm`、`new_contract_count`、`renew_contract_count`、`rent_stability_pct`。
  - 重建 `calculate_area_rolling_metrics`(新 yield/stability/median-growth)。
  - `get_dubai_area_metrics()` 暴露新字段。
  - 重算当前 period。
- 源同步:`area-analytics-schema.sql`(函数+表)、`update-area-metrics-function.sql`(get 函数)—— 防止下次 data.dubai rebuild 用回旧函数(同 median_unit_price 那次的坑)。

实测样例(2026-06):JVC 回报 6.72% / 稳定性 77.5%(新签18016·续租11139);Deira 稳定性 94.4%(成熟);Maritime City 72.5%(涨得快)。

## API

`/api/dubai/areas`(`dubai-areas-landmarks.ts`)新增返回:`rentStability`、`medianNewRentSqm`、`newContractCount`、`renewContractCount`。

## 前端

- `DubaiArea` 类型加上述字段。
- 地图新增第 6 个指标切换 **「租赁稳定性」**(`AreaMetric` + `METRIC_OPTIONS` + `formatMetricValue`/`getMetricRawValue`/heatmap;ShieldCheck 图标,% badge,分位数着色:高=绿)。
- 区域详情面板(`AreaInsightsPanel` 的 `AreaTrendGrid`):
  - 新增**稳定性卡片**(% + 绿色进度条 + 稳定/上涨快 chip)。
  - 各指标标签旁加 **ⓘ「如何计算」弹窗**:点开显示公式;租金回报/稳定性还附**证据**(「基于近12个月 N 新签 + M 续租合约」)。
- i18n:en/zh `map.json` 加 `metric.rentStability` + `explain.*`(公式+证据文案)+ `areaDialog.rentStability`。
- 验证脚本 `scripts/area-panel.mjs`(配套 screenshot.mjs)。

## 未做(可选后续)

- 年化 CAGR(现状已是年度滚动,可横向比;CAGR 仅多年-从开盘时更优)。
- 回报×增值 二维象限图(明星/成长/现金流区域)—— 适合放分析页,纯展示功能。

## 部署

- DB 函数已在生产生效。
- **后端需部署**(`cd backend; .\quick-deploy.ps1`)才能让生产 API 返回新字段。
- 前端 push 后 Cloudflare Pages 自动 deploy。
