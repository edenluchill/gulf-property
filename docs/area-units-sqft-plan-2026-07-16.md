# 面积单位收口计划 —— 全站默认 sqft

日期：2026-07-16 · 决策已定 · 桶① 已上线并验证

盘点报告见 [`reports/2026-07-16-area-unit-sqft-vs-sqm-audit.md`](reports/2026-07-16-area-unit-sqft-vs-sqm-audit.md)。
本文只记**决策**和**接手清单**。

---

## 决策

**全站默认 sqft，DLD 的 m² 数据在展示边界换算。切换开关留到桶③，先不做 UI。**

理由：迪拜是两套单位并行，**由数据来源决定，不由场景决定**——

- **市场端**（开发商、经纪、Property Finder / Bayut、brochure、floorplan、payment plan）→ **sqft**。
  "AED 2,000/sqft" 是行业通用语言，经纪张口就是这个，客户拿它比价。
- **官方端**（DLD 成交/租约/Dubai Pulse 公开数据集）→ **m²**。政府登记口径，改不了。

我们的用户是经纪和买家，不是政府统计员。锚点是 sqft。

❌ **不选全站 m²**：跟迪拜市场的日常语言脱节。
⏸️ **切换开关**：接口预留（`lib/units.ts` 是唯一换算点），俄语/欧洲客户想要 m² 时再上 UI。

---

## 收口点（唯一真相源）

```
frontend/src/lib/units.ts     ← 新建
backend/src/lib/units.ts      ← 新建（镜像）
```

暴露 `SQFT_PER_SQM = 10.7639` + `sqmToSqft` / `sqftToSqm` /
`pricePerSqmToPerSqft` / `pricePerSqftToPerSqm`。

> **单价换算是反的**：AED/m² **÷** 10.7639 = AED/sqft。
> 乘除写反是 116 倍误差，而且**换出来的数字仍然长得像个合理房价**——所以函数名写死方向，别在调用点手算。

**铁律：不许再在调用点硬编码 `10.764` / `0.092903`。** 收口前全站有 4 处各自硬编码，
其中两处（地图 `10.764` vs 面板不换算）直接造成同一字段差 10.76 倍。

---

## 桶① 止血 —— ✅ 已完成并上线（2026-07-16）

修的是**确认错的数**，不是观感问题。

| # | 病灶 | 现象 | 修法 |
|---|---|---|---|
| 1 | `UnitTypesTab.tsx:167-178` | 中文用户看到「120㎡ · AED 2,650/sqft」——**两个数除不通**。有人当初好心给中文做了面积适配，漏了单价 | 面积统一 sqft，m² 进 tooltip；顺带清掉变死的 `zh` 变量 |
| 2 | `map/metrics.ts:63` vs `AreaInsightsPanel.tsx:370` | 同一个 `medianPriceSqm` 字段，地图 ÷10.764 显示 sqft、面板直接显示 m² → **同区域两个 UI 差 10.76 倍** | 面板改 sqft，两处共用 `pricePerSqmToPerSqft` |
| 3 | `AreaInsightsPanel.tsx:371` | 值是 per-m²，info 却复用了地图的 `map:explain.medianPriceSqft` → **tooltip 是错的** | 随 #2 自动正确 |
| 4 | `AreaInsightsPanel.tsx:598,641` | **改 #2 时暴露的**：tile 变 sqft 后，同面板成交列表还是 `66 m²` → 矛盾从跨页面挪进了同一个面板 | 列表一起换 sqft |
| 5 | `GuidedTour.tsx:182` | 自己自洽（m² 标签配 m² 值），但展示的就是地图那同一个区域指标 → 地图讲 sqft 它讲 m² | 改 sqft |
| 6 | luna-tour 三处 | `tour-generator:106` 喂 `from 750 sqft`、`area-context:178` 喂 `median 16084/sqm`、提示词 `:349` 写 "per sqm" → **AI 在同一场导览里混播两种单位** | facts + 提示词全统一 sqft |

i18n：`priceM` → `priceSqft`（areaInsights / gate × 5 语言）。

### 验证（不是"看起来对"）

- **地图 ↔ 面板对齐**：Arjan 地图气泡 `1,553` == 面板 `Price/sqft 1,553`（改前面板是 `Price/m² 16,7xx`）。
  用 `frontend/scripts/_shot-area-panel.mjs`（gitignored 临时脚本）真点开面板截图。
- **中文卡片能除通**：`754.76` × `2,650/sqft` = `AED 2,000,000` ✓；整页无 `㎡/m²` 残留。
- **Luna 生产环境改前/改后对照**（`lt_tour_scripts`）：

  | 时间 (UTC) | 版本 | 讲 sqm | 讲 sqft | 泄漏黑话 |
  |---|---|---|---|---|
  | 07-17 00:46 | 改前 | **是** ← bug | 否 | 否 |
  | 07-17 02:26 | 5 行 ⛔ 版 | 否 | 是 | **是** ← 自造回归 |
  | 07-17 02:32/02:34 | 瘦身版 | 否 ✓ | 是 ✓ | 否 ✓ |

  改前原话：「Motor City，房屋均价达到**每平米 2.02万** 迪拉姆」
  改后原话：「Motor city，**每平方英尺**中位单价高达 1880 迪拉姆」（20,200 ÷ 10.7639 = 1,877 ✓）

### ⚠️ 桶① 踩的坑（别重犯）

1. **提示词里加 ⛔ 大块会挤掉旁边的禁令。**
   最初把单位规则写成 5 行 ⛔ 段落插在「NEVER 念黑话」附近 → **历史 11 场 tour 零泄漏，我改完 3 次跑 2 次泄漏「地理套利」**。
   压成挂在数字规则后的一句话就回基线了。
   **教训：单位约束该靠数据（facts 已标 `/sqft`），提示词只留一句兜底，别再开一个 ⛔ 去抢权重。**

2. **改一个 tile 会把矛盾挪进同一个面板**（上表 #4）。改 per-area 单位时，
   **同屏的面积列表/成交列表必须一起改**，否则只是把跨页面矛盾换成同页面矛盾。

3. **`tour-e2e.ts` 本身是飘的**：同一份代码跑三次出过 `3/5`（Gemini 吐坏 JSON）、`30/31`、`31/31`。
   **判断回归必须多跑几次 + 拉历史基线**，单次红不能定罪、单次绿不能免罪。

4. **`tour-e2e` 的 24 条体检里没有一条查单位** —— 全绿不代表单位对。得直接查 `lt_tour_scripts` 正则。

---

## 桶② 全量收口 —— 待办

把剩余约 40 个展示点迁到 `lib/units.ts`。**每迁一个页面，同屏所有面积/单价一起迁**（见坑 #2）。

### 前端

| 文件 | 现状 | 备注 |
|---|---|---|
| `pages/TransactionsPage.tsx` | `AED/m²`、`Size m²`、`Average Size (m²)` | **面最大**，表头 + KPI + 表格列 + `Price range` 那行副文案都要动 |
| `pages/TransactionsPage/RentView.tsx` | 同上 | `misc:avgSizeM` 键要改名 |
| `pages/ProjectDetailPage/TransactionsTab.tsx` | m² | 与同页户型 sqft 打架 |
| `pages/ProjectDetailPage/RecentDealsCompact.tsx` | m² | |
| `pages/ProjectDetailPage/PriceCheckModule.tsx` | AED/m² | |
| `pages/ProjectDetailPage/LocationTab.tsx` | m² | |
| `pages/ClientReportPage.tsx` | m² | 客户看的报告，优先级高 |
| `pages/ProjectReportPage.tsx` | m² | 经纪品牌报告，对外 |
| `luna-tour/pages/FactSheet.tsx`、`overlays/OverlayLayer.tsx` | 混用 | |
| `components/favorites/*`、`property-editor/*`、`ComparePage.tsx` | sqft（多数已对） | 核对即可 |

i18n：`transactions.json` / `misc.json` 里 `(m²)` 字面量共 5 语言。

### 后端

| 文件 | 现状 |
|---|---|
| `routes/market.ts:19,70`、`projectInsights.ts:212` | 已有 ×10.7639（psf→psm），方向与新默认**相反**，收口时反转 |
| `luna-tour/evidence.ts:22` | 本地 `SQM_TO_SQFT` 常量 → 改用 `lib/units.ts` |
| `routes/market-rent.ts`、`dubai-areas-landmarks.ts` | 裸 sqm 透传 |

### 不在本轮范围

- **`luna-tour/overlays/EvidenceCard.tsx`** —— 整卡硬编码中文（`本楼盘`/`● 真实成交`/`核验 →`/`中位 AED/sqft`），
  5 语言全泄漏。但**它的单位本来就是对的**，这是 i18n 债不是单位债 →
  归入 [i18n worklist](i18n-multilang-framework-spec.md)，别混进单位改动里。
- `project_unit_types.area` 的 sqft 语义没在 schema 声明（`residential-projects-schema.sql:106` 只写 `-- Total area`）
  → 加注释 + 考虑改名 `area_sqft`。**这是整条链最大的隐性风险**。

---

## 桶③ 单位切换 —— 未开工

用户级偏好（localStorage 或 profile）+ 全站切换 UI。前提是桶②做完（否则切换只会切到一半）。
`lib/units.ts` 已经是唯一换算点，接上去不难。

---

## 🧨 数据地雷（已查明，未引爆）

**`dubai_area_rolling_metrics.avg_sale_size_sqm` 口径是错的，但目前没人用。**

- 跨区均值 **880.6**，住宅不可能这么大 → 查明原因：`usage='residential'` 这个切片
  **混进了 55,405 条 Land（均值 1,994 m²，最大 2,000 万 m²）和 1,607 条整栋 Building（均值 2,798 m²）**。
  Flat 中位 77.2 m²（≈831 sqft）本身是正常的。
- **单位没错**（确实是 sqm），**是口径错**。
- **为什么现在没事**：`get_dubai_area_metrics()` 的返回签名里根本没有这一列 —— precompute 一直在写、UI 从来没读。
- **/transactions 页那个「Average Size 115 m²」是对的**，它走另一条路（`market.ts:376`），
  过滤器 `market.ts:215` 有 `property_type IN ('Unit','Villa')` 挡掉了地块和整栋。

**谁要是哪天把这列接进 UI，先加上 `property_type IN ('Unit','Villa')` 过滤，否则直接展示一个假数字。**
