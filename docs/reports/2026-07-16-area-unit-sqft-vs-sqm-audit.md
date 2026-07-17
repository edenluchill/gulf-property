# 面积单位（sqft vs sqm）全栈盘点

日期：2026-07-16 · 只做盘点，未改任何代码

## 一句话结论

**单位由数据来源决定，不由用户决定。** 开发商侧（`project_unit_types`）全是 **sqft**，
DLD 市场侧（成交/租约/区域指标）全是 **sqm**。两者在同一个页面并排显示，
没有任何统一收口、没有换算、没有单位切换。全站只有 **4 处**换算常量。

## 1. 数据库层：真值存的是什么

### 开发商侧 —— sqft（实测确认）

| 表.列 | 单位 | 证据 |
|---|---|---|
| `project_unit_types.area` | **sqft** | Studio 均 509.8 / 1BR 748.8 / 2BR 1304.3 → 只能是 sqft |
| `project_unit_types.balcony_area` | sqft（推定，同源） | |
| `project_unit_types.built_up_area` | sqft（推定，同源） | |
| `project_unit_types.price_per_sqft` | AED/sqft | 1BR 均 2543 |
| `residential_projects.service_charge_per_sqft` | AED/sqft | **全表 0 行，未启用** |

⚠️ **`project_unit_types.area` 的 sqft 语义没有任何地方声明。**
`backend/src/db/residential-projects-schema.sql:106` 只写了 `-- Total area`，
不带单位。sqft 全靠 `price_per_sqft` 配对和 `ai-projects.ts:362`
（`area as area_sqft`）的隐式约定撑着。这是最大的隐性风险点。

⚠️ **命名撞车**：`residential_projects.area` 是**区域名（varchar，如 "Dubai Marina"）**，
`project_unit_types.area` 是**面积（numeric sqft）**。同名不同义。
（`residential-projects-schema.sql:19` vs `:106`）

### DLD 侧 —— sqm（实测确认）

| 表.列 | 单位 | 证据 |
|---|---|---|
| `dld_transactions.procedure_area` | **sqm** | Studio 39.3 / 1BR 73.1 / 2BR 121.0 / 3BR 191.9 |
| `dld_transactions.meter_sale_price` | **AED/sqm** | 1BR 均 18,363；`dubai-analytics-schema.sql:41,45` 注释确认 |
| `dld_transactions.actual_area` | sqm | 基本为 NULL |
| `dld_transactions.meter_rent_price` | AED/sqm | |
| `dld_rent_contracts.property_area` | **sqm** | Flat 均 95.7 / Villa 328.2 |
| `dld_valuations.actual_area` | sqm | |

### 区域指标 —— 全 sqm，**唯一例外是物业费**

`dubai_areas` / `dubai_area_metrics` / `dubai_area_current_metrics` /
`dubai_area_rolling_metrics` / `dubai_area_yearly_metrics`：
`avg_price_sqm`、`median_price_sqm`、`median_new_rent_sqm`、`median_renew_rent_sqm`、
`avg_sale_size_sqm`、`avg_rental_size_sqm`、`price_sqm_p25/p75` —— **全部 per sqm**。

`get_dubai_area_metrics()` 返回签名确认：`avg_price_sqm`、`median_price_sqm`、
`median_new_rent_sqm` 全是 **per sqm**；`median_unit_price` 是整套价。

视图：`v_sales.size_sqm` ← `procedure_area`；`v_sales.price_sqm`；
`v_rent.size_sqm` ← `property_area`；`v_rent.rent_sqm` —— 全 sqm。

**唯一的 per-sqft 例外**（DLD 侧）：
- `v_service_charge_by_area.median_service_charge_sqft` —— **AED/sqft**，均值 16.83（迪拜典型区间 10–25，合理）
- `v_service_charge_latest.annual_service_charge_sqft`
- `v_area_net_yield.service_charge_sqft`

所以 `backend/src/db/service-charge-rollups.sql:71,77` 必须 `× 10.764` 才能和
`med_price_sqm` 相除算净回报 —— 这是全库唯一一处「per-sqft 指标 ÷ per-sqm 指标」的接缝。

### 一个待查的数字

`dubai_area_rolling_metrics.avg_sale_size_sqm` 跨区均值 **880.6** —— 若真是 sqm，
对住宅明显偏大（DLD 公寓 73–121 sqm）。可能是 `segment='all'` 混入了地块/整栋，
也可能是口径问题。**本次未定论，建议单独查。**

## 2. 后端 API 层：返回什么单位

**默认：原样透传，不换算。** market 路由把 DLD 的 sqm 直接吐给前端：

- `backend/src/routes/market.ts:422,437` — `sizeSqm`、`pricePerSqm`（原始 sqm）
- `backend/src/routes/market.ts:376,401` — `avgSizeSqm`
- `backend/src/routes/market.ts:661-716` — 各 tab 的 `size_sqm` / `price_per_sqm` / `rent_per_sqm`
- `backend/src/routes/market-rent.ts:164-227` — `median_sqm`、`avgSizeSqm`、`sizeSqm`、`rent_per_sqm`
- `backend/src/routes/dubai-areas-landmarks.ts:131,200` — `medianPriceSqm`、`avgPriceSqm`
- `backend/src/routes/ai-areas.ts:98-101` — 5 年预测用 `median_price_sqm × 75sqm`

**全站只有 3 处后端换算，方向都是 sqft → sqm 或 sqm → sqft：**

| 位置 | 换算 | 用途 |
|---|---|---|
| `backend/src/routes/market.ts:19,70` | `median_pps × 10.7639` | 户型 AED/sqft → AED/sqm，好和 DLD 区域价比（价格体检） |
| `backend/src/services/projectInsights.ts:212,218` | `med × 10.7639` | 同上，与价格体检同源 |
| `backend/src/luna-tour/evidence.ts:22,115,119` | `meter_sale_price ÷ 10.7639` | DLD AED/sqm → **AED/sqft**（唯一反向的） |

## 3. 前端展示层

### 显示 sqft / ft² 的（读开发商侧数据，几乎都不换算）

| file:line | 显示 | 换算 | 字段 | 串 |
|---|---|---|---|---|
| `lib/map/metrics.ts:63,101` | 值 | ✅ `÷10.764` | `medianPriceSqm` | — |
| `pages/MapPage.tsx:97` | Price/sqft | — | 卡片标签 | t() |
| `ProjectDetailPage/UnitTypesTab.tsx:175` | sqft(en) / **㎡(zh)** | ✅ `×0.092903` | `unit.area` | 硬编码 |
| `UnitTypesTab.tsx:187` | `/sqft` | ❌ | `price_per_sqft` | 硬编码 |
| `UnitTypesSubPage.tsx:86,118,128,129,141` | `ft²`、`/ft²` | ❌ | `area`/`balcony_area`/`built_up_area`/`price_per_sqft` | 硬编码 |
| `UnitTypeDetailModal.tsx:62,109,117,125` | sq ft、perSqft | ❌ | area/suite/balcony | t() |
| `UnitTypeDetailSheet.tsx:50` | `ft²` | ❌ | `unit.area` | 硬编码 |
| `favorites/FavoriteUnitList.tsx:122,255,261,284` | sqft、AED/sqft | ❌ | area/balcony/psf | 硬编码 |
| `favorites/UnitComparePanel.tsx:146` | sqft | ❌ | `unit.area` | 硬编码 |
| `pages/FavoritesPage.tsx:270` | sqft | ❌ | `unit.area` | 硬编码 |
| `pages/ComparePage.tsx:680,687` | sqft、Price/sqft | ❌ | `prop.size`、`pricePerSqft` | 硬编码 |
| `property-editor/UnitTypesSection.tsx:106` | sqft | ❌ | `unit.area` | 硬编码 |
| `developer-upload/UnitTypeCard.tsx:136,394,410,423` | sqft | ❌ | area 输入 | 硬编码 |
| `developer-upload/ExtractedPricingSection.tsx:127,133` | AED/sqft、sqft | ❌ | `pricePerSqft`、`area` | 硬编码 |
| `project/InvestmentScorecard.tsx:124` | `/sqft` | ❌ | `service_charge_sqft` | 硬编码 |
| `AreaInsightsPanel.tsx:468` | `/sqft` | ❌ | `serviceChargeSqft` | 硬编码 |
| `property-workspace/PropertyWorkspace.tsx:251` | AED/sqft | ❌ | — | 硬编码 |
| `voice-assistant/VoiceAssistantButton.tsx:251` | `ft²` | ❌ | `minAreaSqft` | 硬编码 |
| `pages/ClientReportPage.tsx:183` | `ft²` | ❌ | `u.area` | 硬编码 |
| `luna-tour/pages/FactSheet.tsx:181,263,271` | sqft、AED/sqft | ❌ | `area_sqft`、`median_psf`、`c.psf` | 混（t()+硬编码） |
| `luna-tour/overlays/OverlayLayer.tsx:302` | sqft | ❌ | `hero.area_sqft` | t() |
| `luna-tour/overlays/EvidenceCard.tsx:42,51` | `中位 AED/sqft` | ❌ | — | **硬编码中文** |
| `pages/LangGraphTestPage.tsx:306` | sqft | ❌ | `unit.area` | 硬编码 |

### 显示 m² / ㎡ 的（读 DLD 数据，全不换算）

| file:line | 显示 | 换算 | 字段 | 串 |
|---|---|---|---|---|
| `AreaInsightsPanel.tsx:370` | Price/m² | ❌ | `medianPriceSqm` | t() |
| `AreaInsightsPanel.tsx:595,638` | `m²` | ❌ | `sizeSqm` | 硬编码 |
| `pages/TransactionsPage.tsx:421,422` | `m²`、`/m²` | ❌ | `sizeSqm`、`pricePerSqm` | 硬编码 |
| `TransactionsPage/RentView.tsx:247,274,275` | AED/m²、`m²` | ❌ | `rps.*`、`sizeSqm` | 硬编码 |
| `ProjectDetailPage/TransactionsTab.tsx:117,126,135,144` | `m²`、`/m²` | ❌ | `sizeSqm`、`pricePerSqm` | 硬编码 |
| `ProjectDetailPage/RecentDealsCompact.tsx:46,60` | AED/m²、`m²` | ❌ | `pricePerSqm`、`sizeSqm` | 硬编码 |
| `ProjectDetailPage/PriceCheckModule.tsx:103` | AED/m² | ❌ | 项目 psm | 硬编码 |
| `ProjectDetailPage/LocationTab.tsx:221,234` | `m²`、`/m²` | ❌ | `sizeSqm`、`pricePerSqm` | 硬编码 |
| `pages/ProjectReportPage.tsx:112,178` | `/sqm` | ❌ | `median_price_sqm`、`sizeSqm` | t() |
| `pages/ClientReportPage.tsx:245,246` | AED/sqm / AED/㎡ | ❌ | `yoy.*_year_sqm` | t() |
| `components/GuidedTour.tsx:212` | `m²` | ❌ | `sizeSqm` | 硬编码 |
| `luna-tour/overlays/OverlayLayer.tsx:372-376` | Price/m² | ❌ | `r.price_sqm` | t() |
| `luna-tour/pages/FactSheet.tsx:202` | 值 | ❌ | `n.price_sqm` | t() |

## 4. 有没有统一收口 / 单位切换？

**没有。明确的 NO。**

- `frontend/src/lib/` 有 `money.ts`（金额收口），**没有 `units.ts` / `area.ts`**。
- grep `formatArea|useUnit|unitPreference|areaUnit|UnitContext` 全仓只有 **2 处命中**，
  且都是一个文件里的私有 helper：
  `frontend/src/lib/generateProjectNotes.ts:27`（`function formatArea(area, lang)`，
  未 export，只在 :263 用过一次）。
- 全前端只有 **4 处**换算常量：`lib/map/metrics.ts:60,63,101` + `UnitTypesTab.tsx:171`。

即：**约 40 个展示点各自硬编码后端字段碰巧的单位**。这正是 `money.ts` 当年要解决的那类问题，
面积这条线一直没做。

## 5. i18n

**大部分单位串是硬编码的**（上表约 2/3 硬编码）。走 t() 的键：

| 命名空间 | 键 | en | zh-CN |
|---|---|---|---|
| `common` | `units.sqft` / `units.pricePerSqft` | "sq ft" / "Price/sqft" | "平方英尺" / "每平方英尺价格" |
| `map` | `metric.medianPriceSqft`、`explain.medianPriceSqft`、`explain.rentalYield/netYield/capitalGrowth` | per sqft | 每 sqft |
| `filter` | `price.priceSqft`、`propertySize` | Price per Sq.Ft | 每平方英尺价格 |
| `about` | `sqft` | "$/sqft" | "价/sqft" |
| `upload` | `pricePerSqft`、`areaPlaceholderSqft` | Price/sqft、Area (sqft) | 单价/sqft |
| `project` | `unitDetail.perSqft` | — | 每平方英尺 |
| `factSheet` | `units.sqftFrom` / `nearby.cols` | from {{n}} sqft / price/m² | {{n}} 尺起 / 单价/㎡ |
| `lunaTour` | `tourOverlay.sqftFrom` / `colPriceSqm` | sqft onwards / Price/m² | 尺起 / 单价/㎡ |
| `areaInsights` | `priceM`、`growthNote` | Price/m² | 均价/m² |
| `gate` | `priceM` | Price/m² | 均价/m² |
| `misc` | `medianRentM`、`avgSizeM`、`rentMAnnual`、`rentM` | …/m² | …/㎡ |
| `transactions` | `medianPps`、`avgSize`、`ppsRange`、`cols.size`、`cols.pps` | AED/m²、Size m² | AED/m²、面积 m² |
| `projectReport` | `stat.areaAvgSqm`、`deals.sqm`、`chart.*` | / sqm | /㎡ |
| `clientReport` | `evidence.yoy` | AED/sqm | AED/㎡ |
| `compare` | `formula`、`methodology`、`aedWindow` | /㎡、AED/m² | AED / m² |
| `components` | `pricePerSqm` | "$/sqm" | — |

**en/zh 用的物理单位始终一致**，zh 只换字形（`㎡` vs `m²`，`平方英尺`/`尺` vs `sqft`）。
`map:metric.medianPriceSqft` 和 `about:sqft` 在 zh/ar/ru/fr 里保留 ASCII "sqft" 未译。

## 6. 同页混用（要害）

1. **项目详情页 —— 跨 tab 混用。**
   户型 tab `UnitTypesTab.tsx:175` 显示 sqft，同一项目的成交 tab
   `TransactionsTab.tsx:117` 显示 m²，`PriceCheckModule.tsx:103` 显示 AED/m²。
   同一个盘，三个数字三种口径，页面上无任何说明。

2. **🔴 同一张卡片内混用（zh 用户）。** `UnitTypesTab.tsx`：
   line 175 中文用户看到面积 **㎡**，line 187 同卡片单价却是 **AED/sqft**。
   → 中文用户拿到「120㎡ · AED 2,650/sqft」，两个数字**根本除不通**。
   这是全站最严重的一处。

3. **🔴 标签说 m²，tooltip 说 sqft。** `AreaInsightsPanel.tsx:369-371`：
   `label = t('areaInsights:priceM')` = "Price/m²"，值是 `medianPriceSqm` 未换算（m² 正确），
   但 `info = t('map:explain.medianPriceSqft')` = "…per **sqft**"。
   **tooltip 是错的**（值确实是 per-m²）。这是地图卡（sqft）的解释串被复用到了 m² 卡上。

4. **AreaInsightsPanel 自身混用。** :370 价格 Price/m²，:468 物业费 `/sqft`
   —— 这个其实**忠实反映了底层**（物业费真的是 per-sqft），但用户看不出来。

5. **地图 vs 区域面板对不上。** 地图 `metrics.ts:63` 把 `medianPriceSqm ÷ 10.764`
   显示成 **AED/sqft**；`AreaInsightsPanel.tsx:370` 同一个字段直接显示成 **AED/m²**。
   **同一个区域、同一个真值，两处 UI 差 10.76 倍**。

6. **luna-tour 内部混用。** `evidence.ts` 把 DLD 换算成 sqft（FactSheet:263 显示 AED/sqft），
   `area-context.ts:160,178` 却用 `/㎡` 喂 AI，`tour-generator.ts:349` 提示词写 "per sqm"，
   `client-fit-analyzer.ts:226` 用 `/ft²`。→ **AI 在同一段话里可能混着 sqft 和 sqm 播报。**

7. `luna-tour/overlays/EvidenceCard.tsx:42` 硬编码中文 `中位 AED/sqft`，5 语言全泄漏。

## 建议优先级（未实施）

- **P0** `UnitTypesTab.tsx:175/187` —— zh 用户面积㎡ + 单价/sqft，数字自相矛盾。
- **P0** `AreaInsightsPanel.tsx:371` —— tooltip 单位与标签/真值矛盾，换成 m² 版解释串。
- **P1** 地图 sqft vs 区域面板 m²（差 10.76 倍）—— 先定一个全站口径。
- **P1** 给 `project_unit_types.area` 补单位声明（注释/重命名 `area_sqft`）。
- **P2** 做 `lib/units.ts` 收口 + 单位偏好开关（对标 `money.ts`）。
- **P2** luna-tour AI 侧统一喂同一个单位。
