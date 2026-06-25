# 成交/租约匹配精度 — 调查与提案

> 2026-06-24。触发:用户与同事(Dubai Shell)反馈 transaction/rent 数据"感觉很不准",
> 典型案例 **Sobha Hartland 搜不到数据**,怀疑"数据没更新/计算有问题"。
> 结论先行:**数据又多又新,问题 100% 出在匹配口径(naming + granularity),不是数据缺失或计算错误。**

---

## 1. 证据:数据是新的、全的(以 Sobha Hartland 为例)

DLD 把 Sobha Hartland 记在官方社区 **`area_name = 'Al Merkadh'`**(`area_id = 412`),
开发体名 **`master_project = 'SOBHA HARTLAND'`**:

- 成交:`master_project='SOBHA HARTLAND'` 名下 20+ 子盘,单盘数千条,最新 `2026-06-19`
  (The Crest 2228、Creek Vistas Heights 1547、Crest Grande 1216 …)。
- 租约:`area_name='Al Merkadh'` 过去一年 **11,978 条**,avg 119,184 AED/yr,最新 **2026-06-30**。

但在前端搜"Sobha Hartland"→ 零结果。`dubai_areas` 里只有 **"Sobha Hartland 2"**(另一个子社区),
没有 "Al Merkadh";`dld_areas`(桥接)里有 Al Merkadh(412)且 link 到某个 `dubai_area_id`,
但那个 dubai_area 的**名字不是 "Sobha Hartland" 也不是 "Al Merkadh"** → 营销名/官方名/我们的区名三套对不上。

**→ 不是没更新,是匹配不上 + 颗粒度太粗。**

---

## 2. 现状匹配怎么做的(以及 4 个硬伤)

数据链:`dubai_areas`(展示区) ↔ `dld_areas`(桥接表,有 `area_id` + `dubai_area_id`) ↔
`dld_transactions.area_id` / `dld_rent_contracts.area_id`。

桥接靠 **区域名级联字符串匹配**(`backend/src/db/area-resolver.ts`):
精确 → 归一精确(去非字母数字) → 双向包含 → 人工别名表 `AREA_ALIASES` → 模糊 `area-matcher`。

**硬伤:**
1. **全是区域级(area-level)**。一个项目的"comp"用的是整个官方社区的中位数。
   而官方社区是异质的(`Al Merkadh` = Sobha Hartland + 其它;`Business Bay` 跨度极大)→
   即便匹配上,区域中位数 ≠ 这个具体项目 → 用户感觉"不准"。
2. **项目级 price-check 用 `UPPER(project_name)` / `UPPER(area_name)` 完全相等**
   (`market.ts` ~L230/239)。名字差一个词/分期/大小写就 miss,命中率极低。
3. **`master_project`、`building_name` 完全没用上** —— 这俩是 DLD 最干净的开发体/楼栋标识,
   恰恰是匹配 Sobha Hartland 这种 master development 的正解。
4. **`latitude/longitude` 有但没用于匹配**;且部分项目坐标是错的(几个 "Sobha City/Yas island"
   项目坐标落在阿布扎比 ~24.49/54.6),`residential_projects.area` 字段脏("Scantury Sobha")。

---

## 3. 现有数据盘点(决定哪些方案可行)

| 表 | 有用于匹配的字段 | 坐标? |
|---|---|---|
| `dld_transactions` | area_id, area_name, **building_name, project_name, master_project**, nearest_landmark/metro/mall, rooms, is_offplan | ❌ 无 |
| `dld_rent_contracts` | area_id, **dubai_area_id(uuid)**, area_name, project_name, nearest_* | ❌ 无 |
| `dubai_areas` | name, **boundary(polygon)** | 多边形 ✅ |
| `residential_projects` | project_name, developer, area(脏), **latitude/longitude/location(geom)** | 点 ✅(部分错) |
| `dld_areas` | area_id ↔ dubai_area_id 桥接 | — |

**关键约束:成交/租约没有坐标。** → 无法用经纬度直接匹配成交。
经纬度只能用在**项目侧**(项目点 → 官方社区多边形)。成交侧的最强标识是 DLD 的
`master_project + project_name + building_name`(文本,但 DLD 自身规整、权威)。

---

## 4. 方案(排序 + 基于现有数据的评价)

### P1 — 分层 comp 匹配(核心推荐,精度★★★★★)
对一个项目,按"由细到粗"取**样本量达标的最细一层**作为 comp,并回传用了哪层 + 置信度:
1. **同 `building_name`**(同一栋)——最精准。
2. **同 `master_project`**(如 SOBHA HARTLAND)——开发体级,Sobha Hartland 的正解。
3. **同官方 `area`**(经 P3 空间归属拿到的 area_id)——邻里兜底。
每层要求最小样本(如 sales ≥ 30 / rent ≥ 30),不够则降一层。UI 标注"基于本楼/本开发体/本社区 + N 套"。
> 评价:字段全部已有,纯查询改造。直接消除"区域中位数太粗"的不准感。

伪代码:
```
tiers = [ building_name=?, master_project=?, area_id=? ]
for t in tiers:
   rows = dld where t and window=24m and property_type match
   if rows.count >= MIN_SAMPLE: return {median, count, tier, confidence}
return area_tier (low confidence)
```

### P2 — master_project → area 数据驱动别名(推荐先做,精度★★★★)
从 DLD 自身派生:每个 `master_project` 取**最常出现的 `area_name`/`area_id`**,生成
`master_project → area_id` 映射 + 可搜索别名("Sobha Hartland" → Al Merkadh / area_id 412)。
比手工 `AREA_ALIASES` 自维护、覆盖全。
> 评价:纯 SQL 派生(`mode() WITHIN GROUP`),小工作量,**立刻让 Sobha Hartland 能搜到/出数**。

### P3 — lat/long 空间归属项目→官方社区(精度★★★★)
`ST_Contains(dubai_areas.boundary, residential_projects.location)` 精准把每个项目落进官方社区,
取代脏 `area` 字符串 + 名称级联;顺带揪出落在阿布扎比/海里的错误坐标做数据清洗。
> 评价:项目有点、区有多边形,PostGIS 直接可做。修掉"项目挂错区"的系统性不准。

### P4 — 名称 trigram 模糊兜底(精度★★★)
装 `pg_trgm`,exact 打不中时用 `similarity()` 兜底匹配 project_name/building。
> 评价:便宜的兜底,降低 P1 第1/2层的 miss。

### P5 — 给 DLD 楼盘做地理编码 → 半径 comp(精度★★★★★ 理论 / 可行性★)
逐 building geocode 后可做"半径 500m 内真实成交"。
> 评价:DLD 无坐标,需大规模 geocode + 维护,**当前不划算**,列为远期。

---

## 5. 推荐落地顺序

- **Phase 0(立刻)**:price-check 的项目匹配加上 `master_project`/`building_name` join(不再只靠 exact project_name)。
- **Phase 1**:P2 master_project→area 别名表 + 让搜索/区域指标认这些营销名。
- **Phase 2**:P1 分层 comp + UI 置信度标注(本楼/本开发体/本社区)。
- **Phase 3**:P3 空间归属重算项目→area,清洗错误坐标;P4 trigram 兜底。

每一步都用 Sobha Hartland 当回归用例:期望"搜 Sobha Hartland 出 Al Merkadh / 本开发体的真实租金+增值"。

---

## 5b. 已实现(2026-06-24 上线)

`backend/src/db/development-metrics.sql` + `projectInsights.ts` + 前端
`InvestmentScorecard`:

- **`resolve_project_development(name, lng, lat)`**:`ST_Covers` 把项目点落进官方社区多边形
  (必须有坐标,否则不进精准层,走区域兜底,避免全表 trigram 扫描),再用 `pg_trgm` 在该区内
  把项目名匹配到 `master_project`。
- **`get_development_metrics(master, area_id)`**:**完全照搬** `calculate_area_rolling_metrics`
  的口径(yield=新签中位 rent-psm / 成交中位 sale-psm;growth=中位 price-psm YoY,带护栏),
  只是把过滤从 area 换成 master_project;租约因无 master_project,用该 master 的 `project_name`
  集合(归一化)匹配。
- **分层**:development(开发体)→ area(空间归属的官方社区)→ area_name(脏名兜底)。
  新 offplan 开发体保留自己的精准成交中位,但 yield/growth 在自身样本不足时借用所在社区。
- **按需实时解析**:项目详情每次请求现算 → **以后上传的项目一打开即自动匹配**,无需回填/重建。
- 前端显示精度徽章(本开发体/本社区/区域)+ 口径感知文案;头条 yield 优先用开发体精准值。

**实证**:同一区 Al Merkadh 内 Sobha Hartland 单价中位 1.72M vs Meydan One 813K(区域混合值抹平);
Palm Central → Palm Jabal Ai(sim 0.80,204 成交)。当前 13 个有迪拜坐标的项目中 12 个能落到
正确社区(tier 2),3 个进精准开发体层。

**遗留/下一步**:① 项目坐标质量(部分落在阿布扎比)需清洗 → 提升匹配率;② P2 让 master_project
本身可搜索(无需先有项目即可看 Sobha Hartland 数据);③ 名称匹配率可加 `developer` 信号增强。

## 6. 附:复现实证的查询

```sql
-- 数据在哪(area/master)
SELECT area_name, master_project, project_name, COUNT(*) n, MAX(instance_date)
FROM dld_transactions
WHERE master_project ILIKE '%hartland%' OR project_name ILIKE '%sobha%'
GROUP BY 1,2,3 ORDER BY n DESC;

-- 租约有多新
SELECT COUNT(*), ROUND(AVG(annual_amount)), MAX(start_date)
FROM dld_rent_contracts WHERE area_name ILIKE 'Al Merkadh' AND start_date > '2025-06-01';
-- → 11978, 119184, 2026-06-30
```
