# 7.20 客户反馈处理报告 —— 成交查询 + 租金回报率

> 2026-07-21 · 反馈来源：经纪客户微信 5 条 + 3 张截图
> 本轮范围（用户选定「先救火」）：①部署 ⑤回报率 ④户型选项。②③ 及 ④ 的 property_type 未做。

---

## 一句话结论

5 条反馈里 **3 条是真 bug 且已修复上线**，1 条是**数据源根本没有的字段（做不了，需回绝客户）**，1 条是新功能待排期。
另外在排查中发现一个**定时炸弹**：迪拜盒子上的预计算脚本是旧副本，每天 02:00 会把修复覆盖回去 —— 这解释了 7-20 那次修复"改了却没生效"。

---

## ① 成交记录查不到社区（Damac Lagoons Santorini / Nice 别墅）

**状态：已修复上线 ✅**

### 现象
经纪搜 Damac Lagoons，只能搜到 Lagoon Views 系列（公寓），Santorini / Nice / Malta /
Portofino / Marbella 等**别墅联排社区一个都搜不出来**。

### 根因（两层，缺一不可）
1. **DLD 把这些期房联排登记成 `property_type = 'Land'`**，而我们的住宅口径 `RES_PT`
   只放行 `Unit`/`Villa` → 全被过滤掉。这一层 7-20 的 commit `72b8788` 已经改对了。
2. **但那次修复从未真正生效**：
   - API 服务器没部署（生产还跑着旧镜像）；
   - 迪拜盒子 `38.54.8.9:/opt/dubai-sync/scripts/market-precompute.ts` 是**手工拷贝的副本，不是 git**，
     里面的 `TX_BASE` 仍是旧的 `property_type IN ('Unit','Villa')`。
     即使本地重跑了预计算，**第二天 02:00 定时任务又会把 `market_cache` 覆盖回旧口径**。

### 修复
- 部署 API（tag `20260721-225013`）；
- 本地重跑 `market-precompute.ts`；
- **把新版 `market-precompute.ts` scp 到迪拜盒子**（旧版备份为 `.bak-20260721`）。

### 验证（生产实测）
```
GET /api/market/transactions/projects?q=damac lagoons
→ PORTOFINO 1299 · MALTA(1) 1064 · IBIZA 1007 · VALENCIA 979 · MARBELLA 828
  · COSTA BRAVA(1) 816 · NICE 1 816 · SANTORINI(1) 806 · NICE 2 645 …（共 23 个）

GET /api/market/transactions/summary?project=DAMAC LAGOONS - SANTORINI (1)
→ 806 笔，中位总价 2,108,000，中位单价 12,096/㎡
最新一条成交：2026-07-20
```

### ⚠️ 遗留副作用（需告知客户）
这批 Land 型记录**DLD 不填 `rooms`**（明细里户型显示"—"）。
所以经纪一旦选了「3 房」之类的户型筛选，**Damac Lagoons 别墅会再次全部消失**。
这不是 bug 是数据缺失，但界面上没有任何提示 → 建议后续在选中户型且结果里有
Land 型社区被排除时给一行说明。

---

## ⑤ 租金回报率大量区域不显示

**状态：已修复上线 ✅ —— 有 2 年回报率的区域 76/176 → 115/176**

### 现象
客户圈出 Sobha Heartland、Azizi Rivera at Maydan One、Dubai Residence complex、
Villanova、Arabian Ranches 3 五个区没有回报率。实际排查发现**176 个区里 100 个都没有**。

### 根因
这些都是**手绘自定义区**，没有 DLD `area_id` bridge，所以 `dld_rent_contracts.dubai_area_id`
永远是 NULL。而计算回报率的租金查询**只走 bridge**：

```sql
WHERE rc.usage_type = 'Residential' AND rc.dubai_area_id IS NOT NULL   -- ← 手绘区永远取不到
```

→ 租金序列全 null → `yield = null`，**哪怕这些区成交上千笔**
（Dubai Residence complex 2 年 13,051 笔、Sobha Heartland 2,870 笔）。

关键在于**成交侧上次修「地图≠dialog 不匹配」时已经补过 spatial 分支，租金侧漏了**，
代码注释里甚至白纸黑字写着"自定义区拿不到 → 其回报在地图上为 null（可接受）"。
一年后客户直接圈图打脸。这是 [[map-dialog-metric-path-parity]] 的同款复发。

### 修复
给两个入口都补上 spatial 租金分支（口径与 `/area-insights` 的 `rentJoin` 完全一致）：

| 入口 | 影响 |
|---|---|
| `loadAllAreaAppreciation` | 区域着色 / 周期指标（1m…5y） |
| `loadAreaMonthly` | **年份时间轴** —— 客户截图 #5 正是这个模式 |

性能：spatial 聚合实测 **2.4s**，与其余三条查询并行 + 6h 缓存 + 预热，不影响请求路径。

### 验证（生产实测，与修复前预估完全一致）
| 区域 | 1y | 2y | 3y |
|---|---|---|---|
| Azizi Rivera at Maydan One | 6.53% | 6.49% | 7.10% |
| Dubai Residence complex | 4.63% | 4.74% | 4.70% |
| Sobha Heartland | 6.39% | 6.37% | 6.49% |
| Villanova | 5.33% | 5.47% | 5.74% |

全部落在 1–15% 合理带内，成交样本也都过 `MIN_YIELD_SALES=30` 门槛。

### ⚠️ 遗留：Arabian Ranches 3 仍然没有任何数据
它**不在返回里**，跟租金无关 —— 它的边界内**一个 geocoded project 都没有**，
所以连成交都匹配不上。

量化：**232 个可见区 → 108 个手绘区 → 其中 54 个边界内 0 个 geocode 点**，这些区
在地图上任何指标都是灰的。

根因：`daily-cron` 第 ⑥ 步 `geocode-dld-projects.ts` **盒子上压根没有这个脚本，一直静默跳过**
（见 `docs/daily-jobs-overview.md` 自己的注释）。→ 下一步待办。

---

## ④ 户型 / 物业类型筛选

**状态：能做的已做 ✅；客户要的细分做不了 ❌**

### 已做：补全被砍掉的户型
`ROOM_OPTIONS` 原来只到 `5 B/R`，导致顶豪户型一条都筛不出来。现已补到：
```
Studio · 1–5 B/R · 6 B/R · 7 B/R · PENTHOUSE
```
（两处常量必须同步：`routes/market.ts` 是筛选白名单，`scripts/market-precompute.ts` 是下拉数据源。）

### 做不了：1.5房 / 2房中 / 2+1保姆房 / 3+1 / 4+1
**DLD 源数据不记录这个维度。** `dld_transactions.rooms` 的全部取值就是：

| 值 | 笔数 |
|---|---|
| 1 B/R | 246,886 |
| 2 B/R | 151,905 |
| Studio | 128,205 |
| 3 B/R | 72,371 |
| (null) | 53,422 |
| 4 B/R | 32,599 |
| 5 B/R | 4,550 |
| 6 B/R | 281 |
| PENTHOUSE | 248 |
| Single Room / 7 B/R / Shop / 9 B/R / Office | < 60 各 |

**没有任何带 +1 / .5 的取值。** 靠面积倒推"这套 3 房应该带保姆房"就是编数据 ——
Luna Tour 审计里已经栽过一次（ROI 数字全是编的还被 AI 当事实播报），不能再犯。
→ **建议直接回绝客户这一条，并说明原因。**

### 未做：property_type 三档过滤（apartment / townhouse+villa / office+retail）
可以做，但同样要先跟客户对齐口径 —— **DLD 也没有 townhouse 和 semi-detached 的独立类型**：

| property_type | sub_type | 笔数 |
|---|---|---|
| Unit | Flat | 568,983 |
| Land | (null) | 74,436 |
| Villa | Villa | 68,286 |
| Villa | (null) | 19,535 |
| Unit | Office | 17,076 |
| Unit | Hotel Apartment | 12,194 |
| Unit | Shop | 5,988 |
| Unit | Stacked Townhouses | 123 |

Damac Lagoons 的联排在 DLD 里就是 `Land`。所以最多能给
「公寓 / 别墅·联排 / 商业」三档，**给不了客户列的 6 类**。

---

## ② 搜索框统一（社区/楼盘/楼栋一个框搜，同名分栋可单查可合并）

**状态：未做，但数据已确认可行 ✅**

`building_name` 填充率 **82.4%**（569,106 / 690,597），结构正是客户要的：

| project_name | building_name | 笔数 |
|---|---|---|
| Sobha Creek Vistas Heights | Sobha Creek Vista Heights - Tower A | 715 |
| Sobha Creek Vistas Heights | Sobha Creek Vista Heights - Tower B | 801 |
| CREEK EDGE | CREEK EDGE Tower 1 | 566 |
| DAMAC HILLS (2) - ELO 2 & ELO 3 | DAMAC HILLS (2) - ELO 2 | 563 |

→ `project_name` = 社区/楼盘，`building_name` = 栋。客户截图里的
「Lagoon Views 2 (all buildings)」这种交互完全可以实现。

**现状问题**：目前是「区域下拉 + 项目搜索框」两个割裂控件，且**楼栋根本不能筛**
（`buildTxFilter` 没有 building 参数）。

**改动面**：后端加统一 suggest 接口（区域/项目/楼栋混合返回 + 类型标记）+ `building` 筛选参数；
前端筛选区重构成单一搜索框 + 已选 chips。

---

## ③ 区域页 / 地图弹窗内直接搜成交

**状态：未做**

现状：全站**没有任何一处链接指向 `/transactions`**（除了导航栏）。区域弹窗里看到一个区
不错，想看它的成交明细只能自己去成交页重新选一遍区域。

最低成本方案：区域弹窗 / AreaInsightsPage 加一个「查看该区全部成交」按钮，
带 `?areaId=` 深链跳成交页（`buildTxFilter` **已经支持 `areaId` 参数**，后端零改动）。

---

---

## 追加：回归核查中挖出的三个既有 bug（第二、三轮）

起因是 Eden 问「这个数据修复会不会影响其他 area」。核查结论是**不会**（证据见下），
但顺着「地图有回报率、点开 dialog 没有」查下去，挖出三个**与本次修改无关的既有 bug**。

### 回归证据（原问题的答案）

| 检验 | 结果 |
|---|---|
| 官方区/自定义区两条租金查询的 id 有无重叠 | **0 个重叠**（不会互相覆盖） |
| 修复前后逐字段 diff（176 区 × 3 口径 × 7 周期） | 价格/涨幅/成交量**逐位不变**；原有回报率**一个没改、一个没丢**；纯新增 612 处 |
| 后续两次部署后再 diff 地图侧 3696 个窗口 | 均**逐位相同** |

### bug ⑥：dialog 的 `seg === 'all' ? rent63 : null`

地图 bulk 侧早已改成三口径共用租金基数，dialog 侧漏改。后果：只要区域默认落到
期房/现房口径（新盘几乎必然），`metricsByPeriod.yield` 就是 null。
**抽样 40 个区，32 个的 2 年周期回报率是空的**，其中 25 个栽在这里。
与手绘区无关 —— 官方区一样中招。已修。

### bug ⑦：dialog 租金聚合缺 `租金/㎡ BETWEEN 100 AND 6000` 护栏

bulk 侧一直有。真正被救回的是 **Al Layyan**（2 年 1876 笔成交、价 14,370/㎡，
而污染后的租金中位 14,145/㎡ → 前端画出 ~98% 的回报率曲线）。已修。

> ⚠️ 我第一次汇报时说「9 个区的曲线是劳工宿舍算出来的」，**这是错的**。
> 其中 Madinat Hind 3 / Grayteesah / Jebel Ali Industrial / Muhaisnah 2 住宅成交
> 只有 0-55 笔、**根本没有分母**，曲线本来就是空的。我按「租金偏差」排序就下了
> 结论，没检查分母存不存在。教训：**查这类问题必须同时看分子偏差和分母是否存在。**

### bug ⑧：顶层 `rentalYield` 曲线两道护栏全无 —— 32 个区在画假数

`metricsByPeriod.yield` 有双重护栏（成交量≥30 + 1-15% 带），但**前端直接拿去画图的
那条顶层序列一道都没有**。越是给客户看的越没护栏。

峰值 **20125%**（Wadi Al Amardi）。根因不在租金而在分母：该区每月只成交 1-3 笔，
且全是 Building / Land / Villa（整栋楼、地块），其中一笔单价 **8 迪拉姆/㎡** 的地块
—— 拿它当分母去除正常公寓租金就是 20125%。

**修法：只加 1-15% 合理带，故意不加分母样本门槛。**
第一版跟着时间轴抄了 `roll3(pps, cnt, 30)`，属于过度杀伤。阈值扫描实测：

| 分母样本门槛 | 越界区清干净 | 正常区被砍 | 成熟区曲线整条抹光 |
|---|---|---|---|
| **0（仅合理带）** | **32** | **0** | 1（Al Twar 1，53/53 点本就全是假数） |
| 10 | 32 | 24 | 12 |
| 30（第一版） | 32 | 31 | 21（Al Barsha Second / Al Satwa / Al Manara / Al Bada …） |

收益恒为 32、代价随门槛单调上升 → **门槛毫无价值**。原因：分母只有一两笔成交的
后果**必然是比值离谱**，而离谱本身就会被合理带挡掉，不需要再数一遍样本。
周期指标那层的 `MIN_YIELD_SALES=30` 是**周期窗口**口径，不能往 3 个月窗口上套；
这些老城区本地人自住、季度成交不足 30 笔，但租赁市场很活跃，曲线是真实有效的。

生产验证：

| 区 | 修复前 | 修复后 |
|---|---|---|
| Wadi Al Amardi | 峰值 20125% | 曲线空（正确） |
| Al Layyan | 峰值 287% | 31 点，6.02~11.95%，越界 0 |
| Al Aweer | 峰值 182% | 4 点，5.89~14.49%，越界 0 |
| Al Barsha Second | 正常 | **44 点完整保留** |
| Al Satwa | 正常 | **48 点完整保留** |
| Al Manara | 正常 | **37 点完整保留** |

顺带把散在三处的 1~15% 合理带提成共享常量 `YIELD_BAND_MIN/MAX`（周期指标 /
年份时间轴 / 详情曲线）—— 这个值已经因为各写各的栽了三次。提取后地图侧
3696 个窗口逐位相同，零行为变更。

### ⚠️ 我在核查中造成的一次污染

扫全站 rentalYield 时用 API 逐区请求，**打爆了匿名地图额度**，而扫描脚本
`if (!res.ok) continue` 把 429 静默跳过 → 那次「0 个区越界」是**假结果**
（正是本报告批评的静默失败模式）。额度按 visitorId + IP 计，只影响该出口 IP、
迪拜时间次日重置，**真实客户未受影响**；但给 `map.quota.exhausted` 计数器灌了
一批假事件，会污染「想用却用不了」的转化漏斗信号。

后续改用直连 DB 复现算法扫描（不走 API、不烧额度）。
**教训：批量扫生产接口前先确认豁免路径**（`x-visitor-id` 内部号 / `x-share-code`），
且扫描脚本**绝不能静默跳过非 200**。

---

## 本次改动清单

| 文件 | 改了什么 |
|---|---|
| `backend/src/routes/market.ts` | `loadAllAreaAppreciation` / `loadAreaMonthly` 各加一条 spatial 租金查询并合并；`ROOM_OPTIONS` 补 6/7 B/R + PENTHOUSE |
| `backend/scripts/market-precompute.ts` | `ROOM_OPTIONS` 同步 |
| 迪拜盒子 `38.54.8.9:/opt/dubai-sync/scripts/market-precompute.ts` | **scp 覆盖**（旧版备份 `.bak-20260721`）—— 修掉每日覆盖回滚 |
| `backend/src/routes/market.ts`（第二轮） | dialog 的 `metrics` 三口径共用租金基数；dialog 租金聚合补 100~6000 护栏 |
| `backend/src/routes/market.ts`（第三轮） | 顶层 `rentalYield` 加 1~15% 合理带；提取共享常量 `YIELD_BAND_MIN/MAX` + `MIN_YIELD_SALES` |

commits：`64eb846`（手绘区租金）· `e863e51`（dialog 两处对齐）· `5b77f25`（更正夸大描述）· `7d8d7c2`（回报率曲线合理带）
部署：tag `20260721-225013` → `20260721-230707` → `20260721-232816`

---

## 待办（按价值排序）

1. **补 geocode → 救活 54 个手绘区**（Arabian Ranches 3 等整区无数据）。
   盒子上缺 `geocode-dld-projects.ts`，daily 第⑥步一直静默跳过。
2. **② 统一搜索框 + 楼栋筛选** —— 客户明确画图要的，数据现成。
3. **③ 区域→成交深链** —— 后端已支持 `areaId`，纯前端一个按钮。
4. **① 的副作用提示** —— 选了户型时提示 Land 型别墅社区被排除。
5. **④ property_type 三档过滤** —— 先跟客户对齐"DLD 没有 townhouse 类型"。
6. **回绝客户 1.5房/+1保姆房** —— 数据源没有，不编。
