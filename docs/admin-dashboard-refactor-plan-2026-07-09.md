# Admin Dashboard 重构 Plan（2026-07-09)

承接审查报告 `docs/reports/2026-07-09-admin-dashboard-audit.md`。用户要求:整个 dashboard 太烂、信息不够、垃圾多 → 重组 + 增强,逐个做完为止。

## 目标 tab 结构:12 → 9

| # | 新 tab | 来源 | 说明 |
|---|--------|------|------|
| 1 | 概览 | overview(增强) | 加商业化 KPI:订阅数/付费客户/MRR预估/转化 |
| 2 | 客户 | 访客明细 + 流失(合并) | C 端买家/访客。左侧分区:全部 / 流失 |
| 3 | 搜索 & 项目 | search(保留) | 略优化 |
| 4 | **功能记录**(新) | Luna对话 + 实时带看 + 新增 | 左侧 5 分区:Luna导览生成 / Luna对话 / 实时带看 / Sales Offer / 买家报告 |
| 5 | **订阅**(新) | 经纪审批(弱化)+ 新增订阅列表 | B 端。谁付费/套餐/真付费vs赠送/到期/积分;待审批降为小区 |
| 6 | 分成对账 | revenue(优化) | 0 营收也有信息:订阅 MRR 预估/订阅数/口径说明 |
| 7 | 错误监控 | errors(保留) | 已修内部排除 |
| 8 | 看护 | guardian(保留) | 接时间范围 |
| 9 | 性能负载 | perf(保留) | — |

**删除**:经纪客户(agentclients,lt_clients 仅 2 条,无意义)。
**合并消失的独立 tab**:访客明细/流失→客户;Luna对话/实时带看→功能记录;经纪审批→订阅。

## 数据源

- Luna导览生成 = `lt_tour_scripts`(7)；Luna对话 = `luna_sessions`(34)；实时带看 = `collab_rooms`(27)；Sales Offer = `lt_payment_shares`(13)；买家报告 = `lt_client_reports`(4)+`lt_project_reports`(3)
- 订阅 = `lt_subscriptions` JOIN `lt_agents` JOIN `lt_subscription_plans`；真付费 = stripe_subscription_id 非空;积分用量 = `lt_usage_counters`

## 执行阶段(每阶段独立 type-check + 部署 + 截图验证)

- [ ] **P1 后端数据层**:新增 订阅列表查询(getSubscribers)+ 功能记录各分区查询(getTourScripts/getSalesOffers/getBuyerReports;luna/collab 已有)。加 analytics 路由端点 + 前端 analyticsApi。
- [ ] **P2 「订阅」tab**:前端新建 Subscriptions 组件(付费列表主角 + 待审批小区,合并 AgentApprovals),接 getSubscribers。删「经纪客户」tab + AgentClientsOverview。
- [ ] **P3 「功能记录」tab**:前端新建 FeatureLog 组件(左侧 5 分区切换),移除 Luna对话/实时带看独立 tab(内容搬进去)。
- [ ] **P4 「客户」tab**:合并 Visitors + LostCustomers 为一个组件(左侧分区 全部/流失)。
- [ ] **P5 概览增强**:加商业化 KPI 行(订阅数/付费/试用/MRR预估/本月新订阅)。
- [ ] **P6 分成对账优化**:0 营收态显示订阅 MRR 预估 + 订阅数 + 口径,不再一片空。
- [ ] **P7 审查 P2 修复**:quickScore hasContact 要真实信号;getAgentClientsOverview 热度 SUM→MAX(若保留);结算加 livemode 守卫;短码前后端统一;经纪客户/看护 tab 时间范围。

## 原则
- 每阶段独立可部署,做完即部署验证,不攒大爆炸。
- 后端 `quick-deploy.ps1 -SkipWorker`;前端 push 触发 Cloudflare Pages 自动部署。
- 所有面向客户的新查询必须带 `internalVisitorIds()` 排除(现含注册经纪)。
