# 项目详情页 + 管理员审核页 现代化改版设计稿

> 创建:2026-06-17 · 定位:迪拜期房 **投资决策**网站(Pinzos)
> 目标:把"房源展示页"升级成"投资决策页";把审核页升级成能放大验图的工作台。
> 原则:**复用现成资产**(ImageLightbox / money.ts / DirhamSymbol / leaflet / framer-motion),不造轮子;每个 tab 干净可复用组件;移动/平板/桌面三断点。

---

## 0. 核心洞察(为什么这样改)

1. **最大金矿:已算好但没展示的数据。** 后端 `GET /api/ai/projects/:id/detail`(`ai-projects.ts:317`)已经算了 `investment_5yr`、`nearbyPOIs`、`nearbyLandmarks`、`areaYieldPct/areaGrowthPct`、最近地铁。详情页却走 `fetchResidentialProjectById`(不含这些)。→ **新增一个 insights 接口把它们搬上来。**
2. **lightbox 已存在。** `components/ImageLightbox.tsx`(612 行,键盘/缩略图/惯性滚动全有)。审核页 + 户型图都接它即可。
3. **户型数据被浪费。** `project_unit_types` 有 orientation / floor_level / view_type / price_per_sqft / built_up_area / balcony_area / features,现在只显示卧室/浴室/面积。
4. **定位决定信息优先级。** 投资买家四个问题排序:**①值不值得投(yield/ROI/回本/vs市场)→ ②能买啥多少钱(户型/单价/付款)→ ③在哪周边啥(位置/地铁/成交对比)→ ④数据可信吗(DLD佐证/截止日)**。现版本把①几乎没展示,这是最大改进点。

---

## 1. 复用清单(先确认不造轮子)

| 资产 | 文件 | 改版里怎么用 |
|------|------|-------------|
| ImageLightbox | `components/ImageLightbox.tsx` | 审核页点图放大;户型平面图放大 |
| 金额格式 | `lib/money.ts` `formatMoneyCompact/Full` + `DirhamSymbol` | 所有价格(禁硬编码) |
| 投资计算 | `services/investment-calculator.ts` `calculateInvestment5yr` | 项目级 + **每户型级** ROI |
| 价格体检 | `PriceCheckModule.tsx` + `fetchPriceCheck` | Overview 投资卡内嵌 |
| 区域成交 | `fetchAreaInsights` | Location 的"附近成交对比"+ Overview 区域走势 |
| 地图 | react-leaflet + OSM | Location 多 marker |
| 动画 | framer-motion | hero / tab 切换 |
| 图表 | 无库 → inline SVG(沿用 analytics 做法) | 5yr 收益条 / 付款时间轴 / 区域走势 mini |

---

## 2. 后端改动(把金矿接出来)

新增 **`GET /api/residential-projects/:id/insights`**(瘦路由 + service),并行于现有 `/:id`。返回:

```
{
  investment: {                      // 项目级(用 starting_price/min unit price)
    purchase_price, rental_income_5yr, appreciation_5yr,
    total_profit_5yr, annualized_return_pct, payback_years,
    area_yield_pct, area_growth_pct
  },
  area: {                            // dubai_area_rolling_metrics 最新
    name, median_price_sqm, rental_yield_pct, price_growth_pct,
    sales_transaction_count, data_through
  },
  nearby: {
    metro:   [{name, distance_m}],
    pois:    [{category, name, distance_m}],   // 学校/医院/商场/超市/公园…
    landmarks:[{name, type, distance_m}]
  },
  commute: [{ hub: 'Downtown'|'DIFC'|'Marina'|'DXB Airport', distance_m, mins_est }],
  priceCheck: <复用 /market/price-check 结果>   // 可前端单独拉,二选一
}
```

复用 `ai-projects.ts:317` 里那段 POI/investment 查询逻辑,抽到 `services/projectInsights.ts`。
**每户型 ROI**:前端用 `unit.price + area.rental_yield_pct + area.price_growth_pct` 直接套 `calculateInvestment5yr`(纯函数也给前端一份,或加 `/insights` 里按 unit 批量算)。

---

## 3. 页面结构总览(桌面)

```
┌───────────────────────────────────────────────────────────────────────┐
│  ← 返回   项目名   开发商 · 区域            [收藏] [分享] [对比]          │  顶栏(精简)
├───────────────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────┐  ┌────────────────────────────┐ │
│ │                                   │  │  投资速览(sticky 侧卡)     │ │
│ │     HERO 大图(点开 lightbox)     │  │  起价  AED 1.85M           │ │
│ │   ┌────┐ 浮层: 起价/回报/年化/交付 │  │  租金回报  6.8% ●●●●○      │ │
│ │   └────┘                          │  │  5yr 年化  14.2%           │ │
│ └───────────────────────────────────┘  │  回本  ~9 年               │ │
│ ┌───┬───┬───┐  +14 查看全部           │  价格 vs 区域  ✓ 持平       │ │
│ └───┴───┴───┘                          │  [预约看房 / 要资料]        │ │
│                                         └────────────────────────────┘ │
│ ┌─ Tabs ───────────────────────────────────────────────────────────┐ │
│ │ 概览 │ 户型 │ 付款计划 │ 配套 │ 位置                                │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│   <tab 内容,见下>                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

移动端:hero 全宽 → 投资速览变成 hero 下方横向卡 → tabs 吸顶 → 底部固定 CTA 条。

---

## 4. 各 Tab 改版设计

### 4.1 概览 Overview —— 投资优先

```
┌─ 投资评估(本页主角)──────────────────────────────────────────────┐
│  ┌──────────┬──────────┬──────────┬──────────┐                     │
│  │ 租金回报  │ 5yr 年化  │ 回本年限  │ 价格 vs 区域 │                  │
│  │  6.8%    │  14.2%   │  ~9 年   │  ✓ 持平     │                  │
│  └──────────┴──────────┴──────────┴──────────┘                     │
│  5 年收益拆解(以起价 1.85M 估算):                                  │
│  ▏租金收入 ████████░░ 63万   增值 ██████░░░░ 48万   合计 +111万      │ ← inline SVG 堆叠条
│  价格体检:本项目 AED 18,200/m² · 区域中位数 18,500/m²(持平)        │ ← 复用 PriceCheckModule
│  ⓘ 数据基于该区域近 12 个月 DLD 成交,截止 2026-05。非投资承诺。      │
└────────────────────────────────────────────────────────────────────┘
┌─ 关键信息 ──────────────────────────────────────────────────────────┐
│ 开发商 Emaar │ 区域 Dubai Creek │ 状态 在建 │ 交付 2027 Q4           │
│ 户型 Studio–3BR │ 总单元 420 │ 起价 1.85M │ 单价 16,800–21,400/m²   │
│ 工程进度 ████████░░░░ 62%                                            │
└────────────────────────────────────────────────────────────────────┘
┌─ 区域走势(mini)────────────┐ ┌─ 关于本项目 ───────────────────────┐
│ 中位价 ╱╲╱ · 成交量 ▁▃▅▇    │ │ <描述文本,折叠>                    │
│ [查看完整区域洞察 →]         │ │                                    │
└──────────────────────────────┘ └────────────────────────────────────┘
```

要点:投资卡用 `/insights`;价格体检复用现成 module;区域 mini 走势用 `fetchAreaInsights` 画 inline SVG;"查看完整区域洞察"跳 `/areas`。

### 4.2 户型 Unit Types

```
┌─ 工具条 ────────────────────────────────────────────────────────────┐
│ [全部▾] 卧室: 工作室 1 2 3   排序: 价格↑ 面积↑ 回报↑      共 12 种   │
└────────────────────────────────────────────────────────────────────┘
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│ [户型图] │ │ [户型图] │ │ ...     │ │ ...     │   网格卡(点开=lightbox 户型图 + 详情)
│ Type A  │ │ Studio  │ │         │ │         │
│ 1BR·1BA │ │ 0BR·1BA │ │         │ │         │
│ 720 sqft│ │ 420 sqft│ │         │ │         │
│ 🌊海景   │ │ 高层    │ │         │ │         │   ← view_type / floor_level 徽章
│ 1.85M   │ │ 1.1M    │ │         │ │         │
│ 18,200/m²│ │ ...     │ │         │ │         │   ← price_per_sqft
└─────────┘ └─────────┘ └─────────┘ └─────────┘
```

点开单户型(sub page / sheet):

```
┌──────────────────┬──────────────────────────────────────────────┐
│                  │  Type A · 1BR        AED 1.85M  (18,200/m²)   │
│   [大户型平面图]  │  面积 720 sqft · 建筑面积 680 · 阳台 60        │
│   点击 = lightbox │  朝向 西南 · 楼层 高层 · 景观 🌊海景           │
│                  │  features: 阳台 / 步入式衣帽间 / 智能家居       │
│                  │  ┌─ 这套的投资估算 ──────────────────────┐    │
│                  │  │ 租金回报 6.8% · 5yr 年化 14% · 回本 9yr │    │ ← 每户型套 calculateInvestment5yr
│                  │  └────────────────────────────────────────┘    │
│                  │  ┌─ 这套的付款节奏(按 1.85M)────────────┐    │
│                  │  │ 订金20% 37万 · 建设期40% 74万 · 交付40% │    │ ← 把 payment_plan % 乘到本户型总价
│                  │  └────────────────────────────────────────┘    │
│                  │  [要这套的资料 / 预约]                          │
└──────────────────┴──────────────────────────────────────────────┘
```

### 4.3 付款计划 Payment Plan —— 可视化时间轴

```
现版本:纵向卡片列表(纯数字)
改版:横向里程碑时间轴 + 累计进度

  订金        建设期 1     建设期 2     交付        交付后
   ●───────────●───────────●───────────●───────────●
  20%         10%          10%         40%         20%
 签约时      6个月后      12个月后    2027 Q4    交付后2年
 ▓▓▓▓        ▓▓           ▓▓          ▓▓▓▓▓▓▓▓     ▓▓▓▓
 累计 ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 100%

 [按户型估算金额 ▾ Type A 1.85M] → 每节点显示实际 AED(订金 37万…)
```

里程碑节点=`payment_plan[]`;节点高度/标签=`percentage`;时间=`interval_months/date`;选户型后把 % 乘到该户型总价显示实际金额。

### 4.4 配套 Amenities —— 分组 + 图标

```
现版本:一堆无序圆点芯片
改版:按类目分组,每类一个图标

🏊 休闲泳池   无边泳池 · 儿童池 · 日光甲板
💪 健身健康   健身房 · 瑜伽室 · 跑道 · SPA
👨‍👩‍👧 家庭       儿童乐园 · BBQ 区 · 多功能厅
🔒 安全服务   24h 安保 · 礼宾 · 代客泊车
🛍 生活配套   零售街 · 超市 · 咖啡
🚗 交通       访客停车 · 充电桩
```

实现:关键词 → 类目 + 图标的映射表(`amenityCategory.ts`),未命中归"其他"。纯前端,数据不变。

### 4.5 位置 Location —— 从"一个图钉"到"位置情报"

```
┌─ 交互地图(leaflet,多 marker)───────────────────────────────────┐
│   ★项目   Ⓜ地铁  🏫学校  🏥医院  🛍商场  🌳公园   [图层切换]        │
│   (点 marker 显示名称+距离;复用 /insights.nearby)                  │
└────────────────────────────────────────────────────────────────────┘
┌─ 通勤时间 ──────────────────┐ ┌─ 周边(按距离)──────────────────┐
│ Downtown   12 min           │ │ Ⓜ 地铁 X 站      450 m  步行6min   │
│ DIFC       15 min           │ │ 🏫 国际学校       1.2 km           │
│ Marina     22 min           │ │ 🏥 医院           2.0 km           │
│ DXB 机场   18 min           │ │ 🛍 Mall          800 m            │
└─────────────────────────────┘ └────────────────────────────────────┘
┌─ 附近真实成交(投资佐证)──────────────────────────────────────────┐
│ 2026-04 · 同区 2BR · 1,180 sqft · AED 2.1M · 17,800/m² · 现房       │ ← fetchAreaInsights.recentTransactions
│ 2026-03 · 同区 1BR · ...                                            │
└────────────────────────────────────────────────────────────────────┘
```

通勤:用项目坐标到几个 hub 的直线距离估算(后端 `/insights.commute`)。

---

## 5. 管理员审核页 Gallery(先做,最快)

```
现版本:缩略图网格,拖拽排序,眼睛图标隐藏/显示,但点图没反应
改版:
┌─ 项目图片(18 可见 / 共 20)  [网格密度 ▦▦] ──────────────────────┐
│ ┌──────┐ 每张 hover 浮出操作:                                      │
│ │[图]🔍│  🔍看大图(开 ImageLightbox 到该张)                       │
│ │  👁 ⠿ │  👁 隐藏/显示   ⠿ 拖拽   ★设为封面                        │
│ └──────┘  隐藏的图:半透明 + "已隐藏"角标                            │
└────────────────────────────────────────────────────────────────────┘
点🔍 → 全屏 lightbox:大图 + 键盘←→翻 + 缩放 + 顶部"第N/总 · 文件名"
        + 底部条:[隐藏这张] [设为封面](直接改 formData,所见即所得)
```

实现:把现成 `ImageLightbox` 接进 `VisualContentSection`(在 PropertyWorkspace 里);点缩略图传 index 打开;lightbox 底部加审核态操作(可选,二期)。**一期只要"点击放大"就解决了核心诉求。**

---

## 6. 分期执行(慢慢来,每期可单独上线)

| 期 | 内容 | 影响面 | 价值 |
|----|------|--------|------|
| **P1** | 审核页 gallery 接 ImageLightbox(点击放大验图) | 仅审核页 | 立刻可验图 ⭐ |
| **P2** | 后端 `/insights` 接口 + service(投资/POI/区域/通勤) | 新增,隔离 | 解锁后面所有数据 |
| **P3** | Overview 投资评估卡 + 5yr 收益 SVG + 关键信息重排 | 详情页 | 投资定位落地 ⭐ |
| **P4** | 户型卡丰富(view/floor/单价)+ 单户型 ROI + 付款拆解 | 详情页 | 户型可用性 |
| **P5** | 付款计划可视化时间轴 | 详情页 | |
| **P6** | 配套分组 + 图标 | 详情页 | |
| **P7** | 位置情报(多marker地图 + 周边 + 通勤 + 附近成交) | 详情页 | 差异化 ⭐ |
| **P8** | Hero 投资浮层 + sticky 投资侧卡 + 移动底部 CTA | 详情页 | 收口体验 |

每期:改完 `tsc --noEmit` → push 前端(自动 deploy);P2 需 `quick-deploy.ps1 -SkipWorker`。

---

## 7. 技术约束(改版必须遵守)

1. 图片:`getImageUrl(img,'large'/'medium'/'thumbnail')` + `getImageSrcSet()`。
2. 金额:一律 `formatMoneyCompact/Full` + `DirhamSymbol`,中文用万/亿。
3. i18n:文本走 `useTranslation(['project','common'])`,新增 key 补 locales。
4. 三断点:mobile/tablet/desktop,不是二分。
5. `area` 可空(坐标在已知区域外)→ 投资/区域数据要有 fallback("该区域暂无足够成交数据")。
6. `project_images` 可空 → Building2 占位。
7. 地图 leaflet + OSM(非 Google)。
8. 不引入图表库,inline SVG。
9. 投资数字必须带免责声明(非承诺),用真实 DLD 数据,数据截止日期可见。

---

## 8. 新增/改动文件清单(预估)

**后端**
- 新增 `services/projectInsights.ts`(抽 ai-projects 的 POI/investment 逻辑)
- 新增 `routes` 里 `/:id/insights`(挂在 residential-projects router)

**前端 — 新增可复用组件 `components/project/`**
- `InvestmentScorecard.tsx`(P3)· `ReturnsBar.tsx`(SVG 收益条)
- `UnitCard.tsx` / `UnitDetail.tsx`(P4)· `PaymentTimeline.tsx`(P5)
- `AmenityGroups.tsx`(P6)· `amenityCategory.ts`(映射表)
- `LocationIntel.tsx` / `NearbyList.tsx` / `RecentSalesList.tsx`(P7)
- `AreaTrendMini.tsx`(SVG)

**前端 — 改动**
- `lib/api.ts`(加 `fetchProjectInsights`)
- `pages/AdminTaskReviewPage` / `property-workspace` 的 VisualContentSection(P1 接 lightbox)
- `ProjectDetailPage/*` 各 tab 接新组件
- locales `project`/`common` 补 key

**复用不改**:ImageLightbox、money.ts、DirhamSymbol、PriceCheckModule、investment-calculator。
