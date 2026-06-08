# 测试报告:AI 投资分析工具 vs 买家评分卡

> 日期:2026-06-08 · 评分卡见 `docs/dubai-buyer-personas-report-rubric.md`(满分14,及格≥10)
> 测试方式:对 4 类买家场景实跑工具(真实 DLD 数据),按 R1–R6 打分。

## 工具清单(本轮新增,全部 live 验证)
- `area_investment_report(area,ptype,bedrooms)` —— 复合全维报告(默认用)
- `check_affordability(income|cash,…)` —— 收入/现金 → 可买总价 + 推荐区
- `recommend_by_budget` / `get_investment_breakdown` / `compare_market`(前几轮)

## 场景打分

| 场景 | 拿到的真实数据 | R1切人 | R2完整 | R3有据 | R4诚实 | R5对比 | R6行动 | 总分 |
|------|--------------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| ①现金流 150万要收益 | International City 58万/收益7.7%/CAGR18.4%(高置信) | 2 | 1.5 | 2 | 2 | 2 | 2 | **11.5** |
| ②增值 200万要涨 | Damac Lagoons CAGR42%、Motor City40%(高置信) | 2 | 1.5 | 2 | 2 | 2 | 2 | **11.5** |
| ③首次 月入2.5万 | 可买225万、首付45万、月供1万 + 推荐区 | 2 | 2 | 2 | 2 | 2 | 2 | **14** |
| ④自住家庭 Arabian Ranches 3居别墅 | 472万、336㎡、14,511/㎡(修复后) | 1.5 | 1.5 | 2 | 2 | 1.5 | 1.5 | **10** |

**平均 ~11.75 / 14 — 全部及格**,R3(有据)R4(诚实)全满(无编造、缺口都标注)。

## 各 persona 的真实短板(诚实)
- ①现金流:**净收益率缺失**(物业费数据,PROD)——对"要现金流"的人这是最关键的一项,毛收益≠净收益。
- ②增值:**供给管线缺失**(未来交付压价,PROD projects)——增值判断少了关键变量。
- ④家庭:配套/学校要单独调 `analyze_area_amenities`;空间/社区有,**人口/社区氛围缺**(DSC)。

## 测试中发现并修复的真问题
1. **`townhouse` 不是 DLD 顶级类型** → 选它必 no_data。改成 no_data 时返回 `available_in_area`(该区实有类型),AI 可改口。
2. **营销名 vs 地籍名**:客户说 "Arabian Ranches"/"Dubai Marina",DLD 存 "Wadi Al Safa…"/"Marsa Dubai"。→ 报告先解析 `dubai_areas` 区块(认营销名)再退回 ILIKE。**修复后 Marina/Arabian Ranches 都能出报告。**
3. **JVC 无别墅成交**(数据真相,非 bug)→ no_data 现在附 `available_in_area:[apartment …]`,AI 会说"JVC 没有别墅成交,但公寓数据是…"。
4. 垃圾未来日期(2205)、`round(double,2)` 已在前序修掉。

## 结论
**能做出及格以上(平均11.75/14)的完整技术分析,且诚实标注缺口。** 让分析"满分完整"还差的三块——**净收益、供给管线、人口需求**——分别等 PROD 凭证 / DSC 申请,不是代码能补的。对客户级 demo:**已足够好用**。
