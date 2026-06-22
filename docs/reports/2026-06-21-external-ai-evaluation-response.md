# 对外部 AI 评估报告的回应（2026-06-21）

来源：用户在 Google 让某 AI 分析 pinzos.com 公开站点，产出《Pinzos 深度评估报告》。
本文是对该报告的准确度核对 + 功能建议判断。

## 该报告的根本局限

那个 AI **只访问了公开的买家端地图**，没看到 Pinzos 的 B2B 核心：
Luna 实时带看、自建导览（Build Your Own Tour）、买家意向报告、AI 楼书解析。
（这些需登录/进经纪台）→ 它把 Pinzos 当「C 端找房宏观筛选工具」评估，
建议"用 Pinzos 粗筛、去 DLD/Property Finder 核实"。**此定位框架错误，不应采纳。**
护城河是经纪带海外客户成交的闭环，不是房源数据库广度。

## 逐条准确度

| 报告论点 | 准确度 | 说明 |
|---|---|---|
| 3D地图/期房筛选/横向对比/价格走势 | 准 | 公开功能描述基本对 |
| 数据滞后（DLD 签约→注册时间差） | 准 | 行业通病；已用 `data_as_of` 截止日缓解 |
| 缺持有成本/净回报 Net ROI | **准，真缺口** | `residential_projects.service_charge_per_sqft` 字段存在但 **0 填充**；现"租金回报"是 gross |
| 中介匹配利益偏向、强推高佣金楼盘 | **错** | Pinzos 是经纪付费 SaaS，经纪是客户非抽佣引流；Luna 反编造、数字带来源 |
| 让用户去 DLD/Property Finder 核实 | 片面 | 把 Pinzos 降级成粗筛工具，忽视 B2B 价值 |

## 持有成本 / Net Yield —— 值得做

理由：
- 迪拜 Service Charge 差异巨大（Marina/Downtown 高塔 ~15–25 AED/sqft，郊区别墅 ~3–8），
  直接吃掉 1–2% 净回报。
- 买家真正关心 Net Yield 而非 gross；现在只显示 gross = 藏了最关键决策变量。
- Property Finder/Bayut 都不按区做净回报 → 差异化点，契合"真实数据"人设。

数据来源（门槛）：
1. 官方：RERA 通过 Mollak 系统监管 Service Charge，有官方 Index（按项目/楼栋 AED/sqft）。
   理论可得，但 data.dubai「无数据集目录、STG 假数据」的坑未解 → 须先确认数据集是否开放。
2. 退路（更现实）：AI 楼书解析 pipeline 提取开发商楼书里的 estimated service charge，
   填入 `service_charge_per_sqft`。

优先级建议：
- **先做项目级 Net Yield**（项目详情页），用楼书提取的 service charge（项目级更准更易得）。
- 区域级"每区持有成本中位数"作为第二步，等项目数据攒够再聚合。
- 转售限制（付满 30–40% 才能转）：优先级低，数据零散；可顺手在详情页加"开发商转让条款"
  （楼书提取），不值得专门立项。

## 结论

听取报告对的部分（数据滞后、缺净回报）；**Net Yield 是真正该补的功能**，
从 AI 楼书提取 service charge 切入最务实。拒绝其"粗筛工具"定位 —— 那源于它没看到 B2B 核心。
