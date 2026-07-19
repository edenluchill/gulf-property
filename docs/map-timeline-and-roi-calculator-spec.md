# 地图时间轴 · 路网测距 · 蒙特卡洛收益模拟器 — 可行性与设计

日期：2026-07-19
参考对象：`m37.life/Dubai_Rent_Map.html`（年份时间轴 + 测距）、`m37.life/remc-cn.html`（收益模拟器）

> **状态（2026-07-19 收工时）**
> - ① 时间轴 —— **已实现，待部署验证**。后端 `GET /api/market/area-yearly`、
>   `frontend/src/lib/map/timeline.ts`、MapPage 时间轴模式 + collab 同步 + 5 语言。
>   实测：零 `setData`、paint 表达式正确切 key、三断点 UI 正常、tsc/i18n 巡检干净。
>   **未验证**：生产环境下的实际着色观感（本机 dev 的区域图层加载不出来，
>   与本改动无关 —— 关掉时间轴同样 0 个多边形，且本地/生产载荷逐字节相同）。
> - ② 路网测距 —— **后端已上线并验证**。自建 OSRM 跑在 API 机（容器 `osrm`，接
>   `pinzos_app-network`），`/api/routing/route` 实测：Marina→Downtown 22.03km/25.7min、
>   Marina→沙迦 45.5km/49.6min、图外坐标正确降级为 `estimate`。前端已接（虚线=估算、
>   实线=实测路线），待随前端一起发布。详见 memory `osrm-road-routing`。
> - ③ 蒙特卡洛模拟器 —— **已实现，未发布**。物业费改走三级链（项目级 → 片区 DLD
>   实测 → 1.5% 假设），因为 `service_charge_per_sqft` 全库 46 个项目**都是 NULL**。
>
> 实际数据比下文预估的好：每年 88–115 个区有成交中位数、91–100 个区有租金中位数
> （下文「只有 47 个区」说的是「五年每年都同时满足两个门槛」的更严口径）。

---

## TL;DR 判决

| 功能 | 数据有吗 | 技术难度 | 判决 |
|---|---|---|---|
| **① 年份时间轴** | ✅ 2021–2025 五整年 + 2026 YTD | 中（当前着色架构不适合 scrub，要改） | **做，优先级最高** |
| **② 路网测距** | ✅ 不需要自有数据 | 中（要自建 OSRM，公共 demo 服务器不能商用） | **做，但排最后** |
| **③ 蒙特卡洛模拟器** | ⚠️ 一半有，一半必须承认没有 | 低（算法 200 行已完整拿到） | **做，但必须缩范围** |

对手 m37 用的是**和我们同一份 DLD 开放数据**，年份范围也是 2021–2026。他没有我们没有的东西；我们有他没有的（项目级、户型级、服务费）。

---

## ① 年份时间轴

### 数据现状（实测，非估算）

`dld_rent_contracts` 和 `dld_transactions` **最早都只到 2021-01-01**，最新到 2026-07。所以时间轴只能是 **2021 / 2022 / 2023 / 2024 / 2025 + 2026(YTD)**，六格。

**租金侧充裕：**

| 年 | 有数据区 | ≥30 份 | 总份数 |
|---|---|---|---|
| 2021 | 112 | 106 | 551,874 |
| 2023 | 115 | 106 | 686,166 |
| 2025 | 115 | 110 | 789,968 |

**成交侧偏薄：**

| 年 | 有数据区 | ≥30 笔 | 总笔数 |
|---|---|---|---|
| 2021 | 86 | 50 | 51,047 |
| 2023 | 88 | 56 | 114,878 |
| 2025 | 91 | 66 | 189,495 |

**同时满足「2021–2025 每年 成交≥30 且 租约≥30」的只有 47 个区。**

> ⚠️ 另有一张 `dubai_area_yearly_metrics`，带 `year` 列覆盖 1975–2026，看着正是要的东西 —— **别用**。
> `median_unit_price` 只有 2025/2026 有值；2020 年之前的租金**无法从现有原始表复算也无法校验**（源快照已不存在），
> 2024 及更早的行 `updated_at` 停在 2026-02。属于孤儿数据。

### 两个必踩的口径坑

1. **成交必须 `trans_group='Sales'`** —— 22% 是 Mortgages/Gifts。参见 [[dld-transaction-group-trap]]，之前因此得出过完全反向的结论。
2. **成交表没有 `dubai_area_id`**，只有 int `area_id`，要经 `dld_areas` 映射，只覆盖 **169/232** 区；租金表自带 `dubai_area_id` 可直接用。

### 「不能卡」是这件事真正的难点

当前着色架构（`MapViewMapLibre.tsx:1373`）是：

```ts
'fill-color': ['get', 'color']          // paint 写死
// 颜色在 JS 算好 → 烤进 GeoJSON properties → useMemo 重建整个 FeatureCollection → setData 触发重绘
```

**这套架构拖动滑块必卡** —— 每一格都要重建 232 个多边形的 FeatureCollection 并整包上传给 GL。

**方案：一次烤好所有年份的颜色，切年只换 paint 表达式。**

```ts
// 加载时：每个 feature 的 properties 烤进六列颜色
properties: { ..., c2021:'#f7e6c4', c2022:'#e8b04a', ..., c2026:'#7c3a1d',
                   v2021: 62000, v2022: 69777, ... }   // 原值给 hover/tooltip

// 切年：一次调用，零数据上传
map.setPaintProperty('area-fill', 'fill-color', ['get', `c${year}`])
```

代价 O(1)，60fps 拖动无压力，播放动画也能跑。**这是唯一能达到「smooth」的路子**，别试图优化现有的 setData 路径。

配色阈值必须**跨年份统一**（用全部六年的合并分布算 P25/P50/P75），否则每年各自分位数 → 颜色会自己漂，时间轴就失去意义。现有 `getHeatmapColor` / `getMetricRawValue`（`lib/map/metrics.ts`）逻辑可复用，只是调用时机从「渲染时」提前到「加载时批量」。

### 后端

新增 `GET /api/market/area-yearly?metric=medianRent|medianPrice`，返回：

```json
{ "years": [2021,...,2026], "ytdYear": 2026,
  "areas": { "<areaId>": { "2021": {"v": 62000, "n": 88}, ... } } }
```

体积极小：232 区 × 6 年 × 2 数 ≈ **25KB**（对手整页 1.16MB 里指标只占 176KB，剩下全是几何 —— 我们的几何已经在地图里了，不用重发）。做成物化表或带日缓存，源数据一天才更一次。

`n < 30` 的格子返回 `null` → 渲染成灰色「样本不足」，**不要插值也不要沿用上一年的值**。

### 前端改动清单

| 文件 | 改什么 |
|---|---|
| `pages/MapPage.tsx` | `timelineYear` state + localStorage（仿 `areaMetric` L383-398）；底部时间轴条 |
| `components/MapViewMapLibre.tsx` | 加 `timelineYear` prop；改 `setPaintProperty` 切换路径 |
| `luna-tour/collab/useCollabMapState.ts` | 加进 `CollabMapState` |
| `MapPage.tsx:887` + `:908` | `applyRemoteMapState` 和 broadcast **两处都要加**，否则带看时经纪和客户看到不同年份 |
| `i18n/locales/{en,zh-CN,ar,ru,fr}/map.json` | 五语言，完了跑 `frontend/scripts/i18n-key-check.mjs` |
| `MapViewMapLibre.tsx:1817` | `chromeless` 门 —— Luna Tour 播放时隐藏时间轴 |

**UI 位置：放地图底部居中**（同对手），**不要塞进右上控制卡**。右上两卡有硬耦合：下卡 `top-[124px]/[164px]` 是按上卡高度硬算的，加一行就得同步改并截 414/1180/1440 三档（代码注释写明栽过两次）。底部是干净的新空间。

现成件：`components/ui/slider.tsx`(radix)、`components/PeriodSelector.tsx`(chip 范式)。

**注意**：时间轴的「年」和现有指标周期选择器的「周期」是两个正交维度，UI 上必须让人看懂区别，否则会互相打架。建议开时间轴时把周期选择器置灰。

### 工作量

后端 0.5d（含物化表）+ 前端 1.5d + collab/i18n/三档截图 0.5d ≈ **2.5 天**

---

## ② 路网测距

### 对手怎么做的

```js
const u = `https://router.project-osrm.org/route/v1/driving/${A.lng},${A.lat};${B.lng},${B.lat}?overview=full&geometries=geojson`
// 成功 → 画真实路线，duration × 1.15（补高峰）
// 失败 → 直线 × 1.35 绕行系数，50km/h 估算，虚线
```

**`router.project-osrm.org` 是官方 demo 服务器，ToS 明确禁止生产/批量使用。** 对手在违规用，我们不能照抄。

### 我们的现状

`MapViewMapLibre.tsx` 里是纯 haversine（`lib/map/tiles.ts:36`），且是**放射状 hub-spoke** 模型：第 0 点是中心，其余每点各连一条线到中心 —— 不是折线累加。已接 collab 同步和 Luna 语音调用。

### 三个选项

| 方案 | 成本 | 问题 |
|---|---|---|
| 自建 OSRM | €0（跑在现有 worker cpx32/8GB） | 一次性搭建 ~0.5d；UAE 的 OSM extract 只有 ~100MB，预处理后内存占用 1–2GB，worker 扛得住 |
| Mapbox Directions | 免费 10万/月 | 我们用 MapLibre + Esri 瓦片，**目前没有 Mapbox token**，要新开账号 |
| OpenRouteService | 免费 2000/天 | 够用但有外部依赖和限流 |

**推荐自建 OSRM**：零边际成本、无 ToS 风险、无限流，且 worker 机器现成。

### 设计要点

- hub-spoke 模型下，N 个辐条 = N 次路由请求 → 必须并发 + 缓存（同一对坐标结果永久缓存，路网不会变）
- **保留 haversine 作为立即反馈**：点下去先显示直线距离（0ms），路网结果回来再替换。别让用户对着 spinner 等。
- 车程时间要标「非高峰」并注明高峰 +30–50%（对手的做法是对的，迪拜早晚高峰差异极大）
- collab 同步的 payload 要加上路网 geometry，否则客户端看到的还是直线

### 判决

**真实价值有**：买家问的是「到 Downtown 多远」，直线 12km 而实际开 18km / 22 分钟 —— 后者才是决策依据。
**但不紧急**：这是对已有功能的精度升级，不是新能力。排在 ① 和 ③ 之后。

工作量：OSRM 搭建 0.5d + 后端代理/缓存 0.5d + 前端 0.5d ≈ **1.5 天**

---

## ③ 蒙特卡洛收益模拟器

### 算法已完整拿到（`remc-cn.html` 明文，~200 行纯 JS，零后端）

```js
// 抽样：Box-Muller 正态 / 三角分布 / Beta(用 Marsaglia-Tsang gamma 合成)
房价年涨幅 g ~ Normal(μ, σ)
租金收益率 y ~ Triangular(min, mode, max)
空置率     v ~ Beta(α, β)

// 单次现金流
CF_0 = -首付
CF_t = 房值_t × y × (1-v) − 房值_t × 维护费率 − 年供      // t = 1..H
CF_H += 房值_H − 剩余本金                                  // 卖出
IRR = 二分法求 NPV=0（先 0.05 步长扫描找变号区间，再 70 次二分）

// 跑 10,000 次 → 均值/中位/标准差/亏钱概率/超10%概率 + 7 档分位数
// 图：直方图(60 bin) / CDF / 持有年限敏感性(共用同一批抽样) / 涨幅-IRR 散点(2000 点)
```

移植到 React 完全无障碍。1 万次 × 7 年 ≈ 十几万次 IRR 二分，主线程约 200–400ms —— **放 Web Worker**，避免卡 UI。

**没有图表库**（package.json 实测）。别为这个引 Chart.js（~180KB）：直方图/CDF/柱状图手写 SVG 各 30 行，代码库里已有手写 SVG investment chart 的先例；只有 2000 点散点图值得用 `<canvas>`。

### 「上面的信息迪拜都有对吧」—— 一半有，一半必须承认没有

这是整个功能最关键的一段，请仔细看。

| 参数 | 我们有吗 | 来源 |
|---|---|---|
| 购房总价 | ✅ | `project_unit_types.price`（选户型直接带出） |
| 户型面积 / 单价 | ✅ | `area`, `price_per_sqft` |
| **物业费（维护费率）** | ✅ **真实值** | `residential_projects.service_charge_per_sqft` —— **对手只能让用户瞎填 1.5%，我们有逐项目实测值** |
| 租金收益率 | ✅ | 区域中位新签租金 ÷ 区域中位成交价（现有 `netYield` 链路） |
| 房价年涨幅 μ | ⚠️ **有数但有毒**，见下 | 2021–2025 区域涨幅 |
| **空置率** | ❌ **完全没有** | Ejari 只记签了约的，签不出去的房子不会进数据库 |
| 贷款利率 / 年限 / 首付 | ❌ 用户输入 | — |

**房价涨幅这个坑必须正面处理。** 我们只有 2021–2025，而这恰好是迪拜史上最猛的一段后疫情暴涨。拿这五年的均值当未来先验，会系统性高估，而且是**朝着让客户下单的方向**高估。

这个项目已经在同类问题上栽过 —— [[luna-tour-audit-2026-07-12]]：ROI 数字（73/6.5/15）全是编的，AI 还当事实播报。**同样的错误在一个自称"精算"的模拟器上会更致命**，因为蒙特卡洛的输出长得极其权威（IRR 5.81%、亏钱概率 0.01%），而它的可信度完全取决于输入先验，用户一眼看不出来。

**必须做的三件事：**
1. 涨幅先验**默认给保守值**（如 3%，而非历史 8%+），并在旁边明写「历史 2021–2025 为 X%，属特殊繁荣期，不建议外推」
2. **空置率不许编默认值** —— 标成「市场假设，我们没有这项数据」，给一个明确标注为假设的默认区间，别伪装成数据
3. 每个自动带出的数字标来源徽章（🔵 DLD 实测 / ⚪ 你的假设），跟现有 [[quality-telemetry]] 的做法一致

**做到这三条，这个功能才是我们的护城河而不是负债** —— 对手的所有输入都是用户瞎填，我们能把总价/物业费/租金回报三项换成真实数据，剩下三项诚实标为假设。这个对比本身就是最好的营销。

### 「放在首页」—— 需要更正

**`/` 不是 landing page，是全屏地图。** `App.tsx:112-115` 明确把 `/`、`/map`、`/v/:code`、`/t/:code` 排除在 `<Routes>` 之外，MapPage 常驻挂在 `Layout.tsx:85`（`display:none` 隐藏不卸载）。

真正的营销页是 **`/about`**（`pages/AboutPage.tsx`，424 行，Hero → Luna 视频 → 数据管线 → FOR BUYERS bento → FOR AGENTS → 定价）。

**建议落位（三处，同一个组件）：**
1. 独立路由 `/roi` —— 可分享、可做 SEO 落地页、经纪可以直接把链接发客户
2. `/about` 的 FOR BUYERS 区块嵌一个**简化版**（三个滑块 + 一个结果数字 + 「展开完整模拟」）
3. 项目详情页 `UnitTypesSubPage` 选中户型后，加一个「模拟这套的收益」入口 —— **这是转化价值最高的位置**，因为参数全是预填好的真实值

### 「选 project → 选户型」

**没有现成的选择器组件，得新建。** 选项目的逻辑在三个页面各写了一遍（`AgentTours.tsx:168-210` 最完整、`AgentReport.tsx:76-88`、`AgentClients.tsx:472`），都是 250–300ms 防抖 + 本地 `picked[]`，唯一共享件是 `luna-tour/lunaApi.ts:142` 的 `searchProjectsForCompare(q)`。

**建议顺手抽一个共享 `<ProjectUnitPicker>`**，把四处收敛成一处：

```
GET /api/luna/agent/projects/search?q=   → 项目自动补全（⚠️ 需 agent 鉴权，公开页要开匿名/限流版）
GET /api/residential-projects/:id        → project.units（⚠️ key 是 units 不是 unitTypes，snake_case，
                                            bathrooms/area 是 string 因为 pg NUMERIC 回传文本）
```

户型选择契约直接抄 `UnitTypesSubPage.tsx` 的受控模式（`selectedUnitId` + `onUnitSelect`），那是现有最干净的一个。

⚠️ 若要给未登录买家用，项目搜索接口必须开一个匿名版并限流 —— 参考 [[map-metering-tiered-pricing]] 的数据层 429 做法，别把 agent 接口直接暴露。

### 工作量

模拟引擎 + Worker 0.5d / SVG 图表 1d / ProjectUnitPicker 抽取 1d / 数据先验接线 + 来源徽章 1d / 落位三处 + i18n 0.5d ≈ **4 天**

---

## 排期建议

**① 时间轴 → ③ 计算器 → ② 路网测距**

理由：地图是目前**唯一被真实反复使用的功能**（见 [[activation-crisis-2026-07-17]]，52 注册里真正建过 tour 的外部用户只有 1 人，而地图是被反复用的那个）。时间轴落在已被验证的界面上，边际获客成本为零。

计算器是**新界面、需求未验证** —— 所以第一版就该小：`/roi` + 项目详情页入口，先看有没有人用，别一上来铺三处。

路网测距是精度升级，不是新能力，排最后。

---

## 附：三条不要踩

1. **别用 `dubai_area_yearly_metrics`** 的 2020 年前数据 —— 无法复算、无法校验的孤儿数据
2. **别照抄 OSRM demo 服务器** —— 对手在违反 ToS，我们自建
3. **别让蒙特卡洛的权威外观掩盖先验的脆弱** —— 这是三个功能里唯一可能真正伤害客户信任的
