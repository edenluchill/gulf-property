# 地图颜色 ≠ dialog + price/sqft 地块污染 —— 根因与修复

日期：2026-07-17
触发：Shell/Eden 报「地图区域颜色跟 dialog 不匹配」+「很多区 3 年没成交,不信」

## 两个独立问题

### 1. 地图颜色 ≠ dialog（回归）
地图的**周期着色**读 `/area-appreciation`(`loadAllAreaAppreciation`),该端点结构上
**只算官方区**(JOIN `dld_areas` bridge)。**107 个可见手绘自定义区**拿不到 →
地图上一律灰;但 dialog 走 `/area-insights` 的 **spatial 匹配** → 有数。灰 vs 有数 = 不匹配。
这是周期功能(2026-07-15)引入的回归:之前地图走 `get_dubai_area_metrics`(12 个月,
覆盖自定义区),切到周期端点后自定义区全灰。

### 2. price/sqft 地块污染
`/area-insights` 与 `/area-appreciation` 的价格中位**不过滤 property_type** → 把
**Land/Building** 算进住宅单价。沙漠地块(便宜/巨大)拉垮 price/sqft:
- Shharrj(沙漠自定义区):24 笔成交,中位 1,058㎡、最大 32,874㎡,几乎全是地块 →
  ₫262/sqft 是地价,对买家毫无意义。近 3 年 Unit/Villa 只有 **1 笔**。

### (未修,Eden 暂缓)非市场区
`Sharjah`(官方区)近 3 年仅 **1 笔**成交 —— 因为 **DLD 是迪拜土地局,不记录沙迦
酋长国**。这个区本不该当迪拜市场展示。留待后续做「隐藏非市场区」判定。

## 修复(backend/src/routes/market.ts,已部署)

### Fix 1 — 自定义区进地图周期着色
`loadAllAreaAppreciation` 加**第二条 spatial 查询**(与 `/area-insights` 同口径):
`ST_Covers(da.boundary, loc.geom)` 匹配自定义区的 geocode 成交,官方+自定义合并进
同一 `byArea`(id 互斥不冲突)。实测空间聚合 ~0.7s(走 GiST 索引),6h 缓存+预热。

### Fix 2 — 住宅价格口径 Unit/Villa
新增顶部常量 `RES_PT = dt.property_type IN ('Unit','Villa')`,抽出共享列生成器
`apprMonthlyCols(areaIdSql)`(官方/自定义两条 spatial 路共用),给**所有价格中位**
(pps/up/median_unit_price,含 offplan/ready)加 `FILTER (WHERE ${RES_PT})`。
**成交量 count 不加**(全口径=活跃度信号,与既有 volumeAll 约定一致)。
同一过滤同步应用到 `loadAreaInsightsData`(dialog)与 `loadCityAppreciation`(全市基准),
保证**地图/对话框/全市三处口径一致**。

## 验证(生产,登录态直连)

- Sobha Heartland(真住宅自定义区)3 年:
  - 地图 `/area-appreciation`.priceSqm = **21,381** == 对话框 `/area-insights` = **21,381** ✅
  - growth 11.8% == 11.8% ✅ —— **地图与对话框逐位相等**。
- 地图覆盖区数 **124 → 176**:52 个有住宅成交的自定义区现在着色;
  其余无 Unit/Villa 成交的(Shharrj 等沙漠地块)诚实缺席/灰。
- price 已是住宅价(21381/sqm ≈ ₫1,986/sqft),地块排除。

## 已知残留(可接受)

- **地图回报(yield)对自定义区仍为 null**:bulk rent 查询走 `rc.dubai_area_id` bridge,
  自定义区拿不到。价格/涨幅(本次着色项)已修;dialog 仍走 spatial 出回报。要修需再加
  一条 spatial rent 聚合。
- **薄样本自定义区**(如 Shharrj 仅 1 笔 Unit/Villa):价格基于极少成交,偏抖 —— 但已是
  住宅价非地价,且 growth 因样本不足自然 null。

## 元教训

**同一个"区域指标"在地图(bulk 聚合)与对话框(per-area)是两条数据路径,必须同口径**:
覆盖面(官方 vs 自定义)、property_type 过滤、count 基准三者都要对齐,否则必然出现
「地图 ≠ dialog」。共享 SQL 列生成器(`apprMonthlyCols`)是防漂移的关键。
相关 [[area-metrics-global-period-anchor-trap]] [[rolling-metrics-size-includes-land]] [[area-units-sqft-default]]。
