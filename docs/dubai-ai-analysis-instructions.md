# AI 使用说明 —— Dubai 投资分析函数(给 Luna / Gemini)

> 这些是 Postgres 函数,基于真实 DLD 数据(154 万成交 + 978 万租约)。
> 接入方式:在 voice tools executor(`/api/voice/tools/execute`)里把它们注册成工具,
> 每个工具内部执行对应 SQL(`SELECT <fn>(...)`),把返回的 JSON 给模型。
> 下面「System prompt 片段」可直接放进 AI 的 system instruction。

---

## System prompt 片段(可直接用)

```
你能调用以下迪拜房产分析工具(数据来自迪拜土地局 DLD 真实成交/租约)。
所有金额单位 AED,面积单位 ㎡。每个结果都带 confidence(样本量),你必须据此措辞:
- confidence=high → 正常给结论
- medium → "根据近两年约 N 笔成交,参考来看…"
- low / none → 明确说"该区/该户型样本有限,仅供参考"或"暂无足够数据",不要编造
预测(projection_5y)一律说成"指示性预测,非保证收益"。
没有的数据不要假装:DLD 没有浴室数(bath)、楼龄;租金按平米算(无卧室数细分)。

工具(已接入 Luna voice tools,实际名字):
1) recommend_by_budget(budget, goal, property_type, bedrooms) —— 客户给预算/目标时用
   goal: 'yield'(收益优先) | 'growth'(增长优先) | 'balanced'
   返回若干区(area_name+中位价+毛收益%+3年CAGR%+confidence)
2) get_investment_breakdown(area, property_type, bedrooms, offplan) —— 客户问某区某户型的 ROI/收益时用
   返回中位价/毛收益/CAGR/5年ROI预测/回本年数 + 置信度
3) compare_market(vary, property_type, bedrooms, area) —— 做"对照/控制变量"分析时用
   vary = 被观察变量(is_offplan / bedrooms / area_name / ptype / size_band / year),其余 = 控制变量
   例:期房vs现房溢价、按卧室数看价、跨区对比
4) (已有)get_area_info / compare_areas / search_projects / analyze_area_amenities —— 区域概况/对比/找盘/周边配套

property_type 取值:'apartment' | 'villa' | 'townhouse'
bedrooms:0=studio,1,2,3,4,5(不传 = 不限)
```

---

## 工具详细定义(给后端 executor 实现)

### 1. recommend_for_budget
- 何时:客户说"我有 X 预算,想要高收益/增值/平衡"
- 调用:`SELECT recommend_for_budget($budget, $goal, $ptype, $bedrooms, $limit)`
- 参数:budget(numeric,AED)· goal('yield'|'growth'|'balanced',默认 balanced)· ptype(默认 'apartment')· bedrooms(int|null)· limit(默认 5)
- 返回(数组):`[{block_id, area_name, median_price_aed, median_price_sqm, sales_count, gross_yield_pct, cagr_3y_pct, confidence}]`
- 例:`recommend_for_budget(1500000,'yield','apartment',1)` → 150 万内 1 居公寓收益最高的区

### 2. block_analysis(地图区块)
- 何时:客户点了地图某区,或你有 block_id
- 调用:`SELECT block_analysis($block_id::uuid, $ptype, $bedrooms, $is_offplan)`
- 返回:`{block_id, area_name, median_price_aed, median_price_sqm, avg_size_sqm, gross_yield_pct, cagr_3y_pct, projection_5y:{future_price_aed, rental_income_5y_aed, total_roi_pct, payback_years}, sample:{sales_count,rent_count,confidence}}`

### 3. investment_analysis(文字区名)
- 何时:客户口语说区名("Business Bay 的一居怎么样")
- 调用:`SELECT investment_analysis($area_text, $ptype, $bedrooms, $is_offplan)`
- 返回:同 block_analysis(无 block_id)

### 4. market_stats(受控对照,高级)
- 何时:客户问对比类("期房比现房贵多少""哪个区最贵""不同卧室差价")
- 调用:`SELECT market_stats($filters::jsonb, $group_by::text[], $measures::text[])`
- filters(全部可选,固定的 = 控制变量):
  `ptype, bedrooms, area_name, block(=dubai_area_id), is_offplan, has_parking, size_min, size_max, date_from, date_to`
- group_by(被观察变量):`area_name | block | ptype | bedrooms | size_band | is_offplan | year`
- measures:`txn_count, median_price_aed, median_price_sqm, avg_price_sqm, p25_price_sqm, p75_price_sqm, avg_size_sqm`
- 例(期房溢价):
  `market_stats('{"ptype":"apartment","bedrooms":1,"area_name":"Marsa Dubai"}','{is_offplan}','{txn_count,median_price_sqm}')`
- 例(按卧室看价):
  `market_stats('{"ptype":"apartment","date_from":"2024-01-01"}','{bedrooms}','{txn_count,median_price_aed,median_price_sqm}')`

### 5. 数据覆盖
- `SELECT * FROM v_block_coverage WHERE area_name ILIKE '%xxx%'` → 该区 data_quality(high/medium/low/none)
- 用于先判断"这个区有没有足够数据再下结论"

---

## 回答客户的范式(示例)
- 客户:"我有 200 万,想买公寓投资,哪里好?"
  → `recommend_for_budget(2000000,'balanced','apartment',null)` → 用返回的区名+收益+增长组织成 2-3 个推荐,标注 confidence。
- 客户:"Business Bay 一居能回本几年?"
  → `investment_analysis('Business Bay','apartment',1)` → 报 中位价/毛收益/回本年数/5年ROI,加"指示性"。
- 客户:"这个区期房值不值?"
  → `market_stats({ptype,bedrooms,area},['is_offplan'],['median_price_sqm','txn_count'])` → 对比期房vs现房单价差,说明溢价/折价。

## 红线
- 不编数字;low/none 数据如实说"样本有限"。
- 预测=indicative,不承诺。
- 没有的维度(浴室/楼龄)不假装能分析。
