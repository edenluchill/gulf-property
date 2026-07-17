# 地图「区域增值率不显示」根因 + 修复

日期：2026-07-17
触发：Shell 报「新交易数据发布后,Sobha Hartland / Azizi / Dubai Island B 的增值率在地图上没有了」
界面(Eden 确认):**地图上区域直接着色/标数字**(不是点开的详情面板)

## 结论

**真凶:`get_dubai_area_metrics()` 把每个区强行锚定到全局唯一的最新月
`MAX(period_end_month)`。任何区在那个精确月份没有行 → 整个从函数结果消失 →
地图着色层变灰。** 已修(改成每区自己的最新月),生产库已生效。

## 数据链(地图增值率着色)

`地图 capitalGrowth 指标` → `area.capitalAppreciation`(frontend/lib/map/metrics.ts)
→ 端点 `dubai-areas-landmarks.ts` `LEFT JOIN get_dubai_area_metrics(usage,segment)`
取 `capital_growth_pct`(= `dubai_area_rolling_metrics.price_growth_pct`,usage=residential,
segment=all,最新 period)。

⚠️ 注意:这条链与**详情面板**的 `/market/area-insights`(computeAppreciation,per-period,
支持手绘区)是**两套完全不同的数据路径**。面板那条一直正常。

## 为什么「新数据一发布」就触发

1. daily job **先算官方区**(`calculate_area_rolling_metrics`)**再算自定义区**
   (`calculate_custom_area_rolling_metrics`,源码注释白纸黑字 "Run after")。
2. 新批次触发重算,高成交量官方区先把全局 `MAX(period_end_month)` 推到 2026-07。
3. 这期间还没轮到、或成交太稀没产出 07 行的区(自定义区 + 低活跃官方区),因为
   函数按全局最新月硬匹配 → **它们从地图整体消失**,直到各自 07 行落库才回来。
4. 部分区某月成交为 0 → 自定义函数 `WHERE (curr.txn_count>0 OR rent.contract_count>0)`
   根本不产出该月行 → 在全局锚点下**永久消失**。

## 实测证据(2026-07-17)

- 全局最新月 = 2026-07。
- **20 个可见真实区卡在 2026-05/06**(Jumeirah Park、Town Square、Remraam、
  Pearl Jumeirah、Al Nahda、Nadd Al Sheba 3 …),没有 07 行 → **此刻全部灰在地图上**。
  不是瞬态,是持续灰着。
- Shell 点名的 3 个恰好已补上 07 行,所以现在显示:Sobha Hartland 2 = 3.7%、
  Azizi Rivera = 0.8%、Dubai Island B = 32.7%。另外 20 个还黑着。

## 修复

`backend/src/db/fix-area-metrics-per-area-period-anchor.sql`(已 apply 到生产库)。

把 `get_dubai_area_metrics` 的锚点从**全局最新月**改成**每区自己的最新月**,
带 **3 个月新鲜度上限**:

- `base` 从 `WHERE period_end_month = 全局pe` 改为
  `SELECT DISTINCT ON (dubai_area_id) ... WHERE period_end_month >= 全局pe - 3mo
   ORDER BY dubai_area_id, period_end_month DESC`。
- `seg`(非 all 口径 overlay)对齐到 base 的 per-area 月份
  (`ON s.dubai_area_id=b.id AND s.period_end_month=b.period_end_month`)。
- 签名/返回列/口径回退逻辑全不变。

**语义**:落后 1-2 个月的区显示自己上月的值而不是消失;只有真的 >3 个月无数据才
诚实留灰。改动只增不减:只会把被全局锚点误删的区加回来,绝不移除本来正常的区。

## 验证(修复后,生产库)

- `get_dubai_area_metrics('residential','all')`: **163 区,无重复**(修复前 ~143)→ 20 区回归。
- Shell 三区: 3.7 / 0.8 / 32.7 ✓。
- 正常高量区不变: Business Bay 10.9%、JVC 8.5% ✓。
- segment=offplan: 163 区无重复,96 走 offplan overlay + 67 回退 all,overlay 逻辑完好 ✓。

## 生效方式

纯 DB 函数改动,API 实时调用,**无需应用部署**。地图区域端点缓存 TTL 仅 5 分钟
(`AREAS_TTL_MS`,dubai-areas-landmarks.ts),用户 5 分钟内自动看到。

## 残留:增值率图层上的诚实留灰(非本 bug)

回归的 20 个区里,部分(Town Square 238 笔、Remraam 103、Jumeirah Park 54)的
`price_growth_pct` **存储行本身就是 null** → 在**增值率图层**上仍灰(但在中位价/
回报/成交量图层现在能显示)。原因是 growth 护栏要求前后两个 12 月窗口各 ≥20 笔且
涨跌 ≤120%,这些区的**上一年窗口太稀**。这是诚实的"算不出可靠涨幅",不是本次 bug。

## ⚠️ 附带发现(独立线索,未追):自定义区指标停更

Town Square / Remraam / Jumeirah Park 等自定义区**只有一个 2026-05 的
dubai_area_rolling_metrics 行,6 月起再没产出新行**。像是迪拜盒子上 daily 的
`calculate_custom_area_rolling_metrics` 对这些区停更了(或它们开始报错被跳过)。
本次 per-area 锚点修复让它们不再从地图消失,但根子是 daily job 为何不给它们出新行——
需上盒子查 `/opt/dubai-sync` 的 daily.log。相关 [[dubai-data-rebuild-box-sync]]。

## 元教训

1. **同一个「增值率」在地图和面板是两套数据路径**,别混。地图走
   rolling_metrics+get_dubai_area_metrics,面板走 area-insights+computeAppreciation。
2. **「按全局 MAX(period) 硬匹配」= 隐形的可见性开关**:任何多阶段/异步产出行的表,
   用全局最新时间戳做 JOIN 谓词,都会让"还没算到的行"= "不存在"。锚点应 per-entity。
3. 说「区域数字没了」先分清是**该区行缺失**(整个消失)还是**该字段为 null**(单指标灰),
   两者根因和修法完全不同。
