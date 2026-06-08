# Dubai 投资分析 DB 设计(v2 · 精简版)

> 日期:2026-06-08(v2:自评后精简) · 设计稿 · 作者:Claude
> 数据源:data.dubai API(`docs/reports/2026-06-08-dubai-api-accessible-datasets.md`)
> 现状基础:`dubai_areas` / `dld_transactions` / `dld_rent_contracts` / `calculate_area_*`

---

## 0. TL;DR

让 AI 高自由度做"控制变量"分析,**不需要**新建一堆表和层。核心只要三样:
1. 给现有 `dld_transactions` / `dld_rent_contracts` **加几列规范化维度**(bedrooms / size_band / property_type / is_offplan);
2. 两个干净 **view**(`v_sales` / `v_rent`)做口径统一 + 异常值过滤;
3. **一个万能函数** `market_stats(filters, group_by, measures)` —— 它本身就是"受控对照":固定其余、只 group by 要变的那个变量。

其余(fact 表、语义目录表、预聚合缓存、人群画像、hedonic OLS)**按需再加**,不是现在。

---

## 1. 先定义:什么叫"好用"(评估维度)

| # | 维度 | "好"长什么样 | 权重 |
|---|------|------------|------|
| D1 | **AI 取数准确 & 可信** | AI 拿到的数对、知道样本量、不编;低样本会降级措辞 | ★★★ |
| D2 | **变量控制自由度** | 能任意"固定 A、B,只变 C";期房溢价/地段效应等可隔离 | ★★★ |
| D3 | **响应速度** | 适配语音 Live,常见查询 < ~300ms | ★★ |
| D4 | **实现 & 维护成本** | 单人可建可维护、一天一次刷新;层数/表数/函数数与价值匹配(不 overengineer) | ★★★ |
| D5 | **数据诚实** | 只承诺 DLD 真有的(bed/size/type/offplan ✓;bath/楼龄 ✗) | ★★ |
| D6 | **可演进** | 加数据集/维度不返工 | ★★ |
| D7 | **对客户真有用** | 答得了客户真正问的(预算买哪、收益、增长、适配) | ★★★ |

---

## 2. 现版(v1)自评

| 维度 | 评分 | 说明 |
|------|------|------|
| D1 准确可信 | A− | 置信度/中位数/过滤都有 ✔ |
| D2 变量自由 | A | 甚至过度(两个函数其实一个) |
| D3 速度 | B+ | 预聚合有用但带来刷新+陈旧+`-1`哨兵复杂度 |
| D4 **实现成本** | **D** | ❌ **overengineer**:4 张新表 + 6 函数 + 动态SQL语义目录 + 独立 fact 层 + 人群评分,单人 demo 阶段太重 |
| D5 诚实 | A | bath/楼龄都标注了 ✔ |
| D6 可演进 | A | ✔ |
| D7 客户有用 | B+ | persona 评分偏主观/思辨 |

**结论:用户价值(D1/D2/D7)其实只靠少数几样就能拿到;v1 把一半篇幅花在 D4 拖后腿的过早优化上。**

### 具体哪里 overengineer(及精简理由)
1. **独立 `fact_property_txn` 表** → 砍。它 1:1 复制 `dld_transactions`,白白多一张几百万行表 + 一个刷新 job。直接在 `dld_transactions` 上**加规范化列** + 一个 `v_sales` view 当事实表用即可。
2. **语义目录表 `analytics_dimension/measure` + 动态校验** → 砍(改静态)。你的维度就 ~8 个、度量 ~10 个,基本不变。把白名单**写死在函数常量里**,把维度/度量清单作为**一段静态 markdown 注入 LLM system prompt**。省两张表 + 一套动态拼 SQL 的复杂度,自由度不减。
3. **`compare_controlled` 独立函数** → 并入 `market_stats`。"受控对照"= `market_stats(filters=固定项, group_by=[要变的项])`,同一个函数。
4. **预聚合缓存 `area_segment_metrics`** → 先不做。DLD 销售约几百万行,带复合索引的 view 上算个 median 通常几十~百毫秒。**先量,真慢了再加物化视图**,别先背刷新+陈旧的债。
5. **`area_profile` 人群评分表** → 先不做。persona 适配先在函数/AI 里用 `product_mix + price_tier` 现算;等拿到 DSC 人口再正经做。
6. **`hedonic_margins` 多元 OLS** → 延后。初期"同质 cohort 差分"(就是 `market_stats`)够用。

---

## 3. 精简版设计(现在就建这些)

### 3.0 数据不丢失原则(三层分离,别混)——优先级最高
"以后能做任何处理/扩展、永不丢数据"靠的是把**三件本质不同的事分开**:

| 层 | 是什么 | 放哪 | 目的 |
|----|--------|------|------|
| 查询库 | AI 实际查的 typed 表 | Postgres(热) | 快 |
| **原始归档 raw** | 每次 API 拉回的完整原文 | **R2 对象存储(单独)** | 重算/扩展/不丢 |
| **备份 backup** | 整库快照 | **离库(R2/异地)** | 灾难恢复 |

- **原始归档 → R2**:每次同步把原始 API 页 JSON 落 R2(`dubai-sync/<dataset>/<date>/page-N.json`),**不可变、便宜、与查询库隔离**。这是"将来想用任何今天没映射的字段、或改口径重算"的安全网,**无需重拉 API**。(引擎 `--dump` 已是雏形,改写 R2。)
  → **不在热表上放 `raw JSONB`**:会撑宽行、拖慢扫描(DLD 单行 JSON ~1-2KB 可能不触发 TOAST,留主堆里拖累 seq scan)。没必要冒这个 perf 险。
- **查询库 = 精简 typed 表**:把 DLD 有用的列(英文名+数值+id+主键)建成正经列 → 对你查的字段**无损**且**无 JSON 最快**;阿拉伯文 `_ar` 等不进库(真要从 R2 取)。
- **备份离库**:`pg_dump`/托管快照定期丢 R2/异地。**绝不与查询库同处**。
- **只增不减 + 幂等**:同步只 `INSERT … ON CONFLICT DO UPDATE`,生产禁 `--fresh` 清空;`sync_runs` 审计 → 重复/补跑安全。
- **派生可重算**:规范化列/`v_sales`/`market_stats`/metrics 都从 typed 表(必要时回 R2 原文)推导,写错重跑即可,**不是丢数据**。
- 可选:可变记录要留变更史 → append-only 事件表(SCD);交易类不可变不需要。
- 备选:若更想"用 SQL 直接重算"而非读 R2 文件 → 库内建**单独冷表 `dld_*_raw`(JSONB)**;它几乎不查,不拖累热表,但占库空间。默认推荐 R2。

> 一句话:**查询库(typed,快)+ R2 原始归档(不丢、能重算)+ 离库备份(灾备),三者分开。** 唯一拿不到的是"从没采集过的数据"(如 bath),靠定期同步让归档持续积累。

### 3.1 规范化列(加到现有表;整个设计的地基)
同步时一次性归一(原文已落 R2,可随时回溯重算)。**保留**,这是 D1/D2 的根。
```sql
ALTER TABLE dld_transactions
  ADD COLUMN IF NOT EXISTS bedrooms      SMALLINT,   -- rooms_en: Studio→0,'N B/R'→N,其它→NULL
  ADD COLUMN IF NOT EXISTS size_band     VARCHAR(4), -- size_sqm 派生: XS<50,S 50-100,M 100-200,L 200-400,XL>400
  ADD COLUMN IF NOT EXISTS ptype         VARCHAR(20),-- property_type_en 归一: apartment/villa/townhouse/...
  ADD COLUMN IF NOT EXISTS is_offplan    BOOLEAN,    -- reg_type_en 含 'Off'→true
  ADD COLUMN IF NOT EXISTS load_timestamp TIMESTAMPTZ;
-- dld_rent_contracts 同理加 bedrooms / ptype / is_free_hold / load_timestamp
CREATE TABLE IF NOT EXISTS norm_property_type (raw TEXT PRIMARY KEY, normalized TEXT NOT NULL); -- 可维护映射
CREATE INDEX IF NOT EXISTS ix_sales_ctrl ON dld_transactions
  (ptype, bedrooms, area_id, is_offplan, instance_date) WHERE trans_group='Sales' AND meter_sale_price>0;
```
> ⚠️ 先统一现有 `dld_rent_contracts` 两版列名冲突(`property_area` vs `actual_area`、`start_date` vs `contract_start_date`)。

### 3.2 两个干净 view(口径统一,当"事实表"用)
```sql
CREATE OR REPLACE VIEW v_sales AS
SELECT t.transaction_id, t.instance_date AS txn_date,
       dla.dubai_area_id, t.area_name, t.ptype, t.bedrooms, t.procedure_area AS size_sqm,
       t.size_band, t.is_offplan, t.has_parking, t.project_name,
       t.actual_worth AS price_aed, t.meter_sale_price AS price_sqm
FROM dld_transactions t
LEFT JOIN dld_areas dla ON dla.area_id = t.area_id
WHERE t.trans_group='Sales' AND t.meter_sale_price>0 AND t.property_usage='Residential';

CREATE OR REPLACE VIEW v_rent AS   -- 沿用现有异常值过滤
SELECT r.contract_id, r.dubai_area_id, r.area_name, r.ptype, r.bedrooms,
       r.property_area AS size_sqm, r.annual_amount AS annual_rent,
       r.annual_amount / NULLIF(r.property_area,0) AS rent_sqm, r.start_date
FROM dld_rent_contracts r
WHERE r.ptype IN ('apartment','villa','townhouse') AND r.property_area>=20
  AND r.annual_amount<=500000 AND (r.annual_amount/NULLIF(r.property_area,0))<=3000;
```

### 3.3 一个万能函数 = 自由聚合 + 受控对照(D2 核心)
```sql
-- group_by 留空的维度 + filters 固定的维度 = 受控变量;group_by 的 = 被观察变量
market_stats(
  p_filters  JSONB,    -- {"ptype":"apartment","bedrooms":1,"is_offplan":false,
                       --  "size_min":45,"size_max":85,"area_id":["…"],"date_from":"2023-01-01"}
  p_group_by TEXT[],   -- ['area_name']  ← 只变地段 = 纯地段效应
  p_measures TEXT[]    -- ['median_price_sqm','gross_yield_pct','txn_count','cagr_3y']
) RETURNS JSONB
```
- 内部:`p_group_by`/`p_measures`/`p_filters` 的 key **比对函数内写死的白名单常量**(防注入),再拼安全 SQL,over `v_sales`(+ 必要时 join `v_rent` 求 yield)。
- **受控对照举例**:`market_stats({ptype:'apartment',bedrooms:1,area:'Marina'}, ['is_offplan'], ['median_price_sqm','txn_count'])` → Marina 同质 1 居的**期房 vs 现房溢价**。
- 每个分组结果带 `txn_count` + `confidence`(high≥50/med 10-49/low<10)。

### 3.4 两个成品函数(D7,薄封装)
```sql
investment_analysis(area, ptype, bedrooms, is_offplan) RETURNS JSONB
-- 调 market_stats 拿 price/yield/cagr + 套 §4 公式 → {gross_yield, cagr_3y, projection_5y:{...}, confidence}
recommend_for_budget(budget_aed, goal 'yield'|'growth'|'balanced', ptype?, bedrooms?, limit) RETURNS TABLE
-- market_stats group_by area,套预算过滤 + 按 goal 排序
```

### 3.5 给 LLM 的静态语义说明(不是表)
一段 markdown(进 system prompt):列出可用维度(area/ptype/bedrooms/size_band/is_offplan/has_parking/date)、可用度量(txn_count/median_price_aed/median_price_sqm/p25/p75/median_annual_rent/gross_yield_pct/yoy/cagr_3y)及取值,并说明"调 `market_stats` 做任意受控分析"。

---

## 4. 公式 & 置信度(保留)
- 毛收益 `= median_rent_sqm / median_price_sqm * 100`
- 回本年数 `= price / annual_rent`;预测增长 `g = clamp(cagr_3y, -10%, +20%)`
- 5 年:`future_price=price*(1+g)^5`;`roi=(Δprice+Σ rent*(1+rg)^t)/price`
- 指标用**中位数 + p25/p75**(抗离群);低样本 → AI 用"参考/样本有限",预测一律"指示性(indicative)",不承诺收益
- 净收益、bath、楼龄、人口:数据不支持,**先不假装能算**(见 §6)

---

## 5. 落地顺序(精简)
1. 规范化列 + `norm_property_type` + 同步映射(transactions/rent/valuation)
2. `v_sales` / `v_rent` + `market_stats`(D2 就绪 —— AI 可做受控分析)
3. `investment_analysis` + `recommend_for_budget` + 静态语义说明 → 接投资图表/语音
4. **量速度**:若 `market_stats` 常见查询 > 300ms,再加物化视图缓存

---

## 6. 明确不做 / 等条件(避免过度承诺)
| 项 | 何时做 |
|----|--------|
| 预聚合缓存(物化视图) | 实测慢了才加 |
| 人群画像表 / persona 评分 | 拿到 DSC 人口数据后正经做;之前用 product_mix 现算 |
| hedonic 多元 OLS(边际值) | 客户真要"每多1卧值多少钱"且 cohort 差分不够时,node 层跑 |
| 独立 fact 表 / 语义目录表 | 维度爆炸或多数据源融合时再上 |
| 净收益率 | PROD 接 `dld_oa_service_charges` |
| 供给/交付管线 | PROD 接 `dld_projects` |
| bath 过滤 | 另接挂牌源(Bayut/Property Finder),DLD 没有 |

---

## 7. v1→v2 变化一句话
**砍掉 4 张表 + 1 套动态语义目录 + 1 个重复函数 + 2 个过早优化**;用户能感知的能力(受控变量分析、ROI、预算推荐、置信度)**一个没少**,但建设量约降到 1/3,单人可维护。

## 来源
- LLM text-to-SQL / 语义层:[Aubergine](https://www.aubergine.co/insights/optimizing-database-schema-design-for-large-language-models) · [k2view](https://www.k2view.com/blog/llm-text-to-sql/)
- OBT vs star:[Fivetran](https://www.fivetran.com/blog/star-schema-vs-obt)
- Hedonic(控制变量:bed/bath/size/age/location):[IMF WP/16/213](https://www.imf.org/external/pubs/ft/wp/2016/wp16213.pdf)
