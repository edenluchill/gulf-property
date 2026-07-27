# Pinzos 使用数据报告

**数据截至**：2026-07-18
**数据来源**：生产数据库（`lt_agents` / `lt_subscriptions` / `lt_demo_sessions` / `app_events` / `dld_transactions`）
**统计口径**：除特别说明外，行为数据统计窗口为最近 30 天

---

## 一、一句话结论

> 平台已有 **52 个注册经纪**、**36 个开通了完全免费的试用**（无需绑卡），
> 但**外部用户创建的 tour 数量为 0**。
> 唯一由"外部账号"创建的 tour，来自合伙人本人的账号。

---

## 二、注册与试用漏斗

| 环节 | 人数 | 占上一环节 |
|---|---:|---:|
| 注册经纪（累计，自 2026-05-31） | 52 | — |
| 完成 onboarding | 52 | 100% |
| 开通免费试用 | 36 | 69% |
| 创建过 ≥1 个 tour 的账号 | 3 | 8% |
| └ 内部账号（demo + owner） | 2 | — |
| └ 合伙人账号 | 1 | — |
| **真正的外部用户创建的 tour** | **0** | **0%** |

### 注册时间分布（近 25 天）

| 日期 | 新注册 |
|---|---:|
| 06-24 | 1 |
| 07-03 | 1 |
| 07-06 | 2 |
| 07-08 | 1 |
| 07-10 | 4 |
| 07-13 | 10 |
| 07-14 | 2 |
| **07-15** | **18** |
| 07-16 | 1 |
| 07-17 | 9 |
| 07-18 | 0 |

> 07-13 与 07-15 两次集中注册来自社群推广。**推广带来了注册，但没有带来使用。**

---

## 三、留存

### 注册经纪的留存

| 指标 | 数字 |
|---|---:|
| 注册总数 | 52 |
| **注册当日之后再也没回来** | **41 人（79%）** |
| 有过回访 | 11 人（21%） |
| 回访用户的平均存活天数 | 8.5 天 |

### 登录用户活跃深度（45 天窗口）

| 活跃天数 | 人数 |
|---|---:|
| 仅 1 天 | 27（55%） |
| ≥2 天 | 22 |
| ≥3 天 | 8 |
| ≥7 天 | 4（8%） |
| 平均活跃天数 | 3.29 |

### 全站访客（含匿名）

| 指标 | 数字 |
|---|---:|
| 独立访客 | 1,066 |
| **一次访问后再也没回来** | **996（93.4%）** |
| 活跃 ≥5 天 | 11 |

---

## 四、付费

| 状态 | 来源 | 数量 |
|---|---|---:|
| trialing | free_trial（免费试用） | 36 |
| active | comp（赠送） | 2 |
| **active** | **stripe（真实付费）** | **1** |
| past_due | stripe | 1 |
| canceled | stripe | 1 |

**30 天内点击结账（checkout_start）次数：1**

### 定价表与实际成交

| 计划 | 月价（USD） | 年价 | 当前付费客户 |
|---|---:|---:|---:|
| Starter | $25 | $249 | 0 |
| **Agent** | **$49** | $490 | **1** |
| Agency | $699 | $6,990 | 0 |
| **Developer** | **$999** | $9,990 | **0** |

---

## 五、功能实际使用情况（30 天）

| 事件类型 | 触发次数 | 独立用户 | 说明 |
|---|---:|---:|---|
| page_view | 8,712 | 1,060 | 页面浏览 |
| area_detail | 3,295 | 127 | 查看区域详情 |
| property_view | 776 | 208 | 查看房源 |
| tab_switch | 672 | 39 | 切换标签 |
| search | 264 | 46 | 搜索 |
| api_error | 242 | 33 | 接口报错 |
| luna_open | 98 | 50 | 打开 Luna |
| map_gate_hit | 85 | 12 | 触发地图免费额度上限 |
| pricing_view | 76 | 48 | 查看定价页 |
| plan_select | 40 | 35 | 选择套餐 |
| trial_start | 39 | 35 | 开通试用 |
| share_action | 9 | 2 | 分享 |
| report_action | 4 | 3 | 报告操作 |
| contact_attempt | 2 | 2 | 尝试联系 |
| favorite_toggle | 1 | 1 | 收藏 |
| checkout_start | 1 | 1 | 点击结账 |

> ⚠️ **重要说明**：`area_detail` 的 3,295 次中，**2,061 次来自 owner 本人账号**。
> 剔除内部账号后，外部用户中只有 2 人有深度使用（其中 1 人为合伙人）。

### 累计产出物

| 对象 | 数量 |
|---|---:|
| Tour（含内部账号） | 15 |
| Tour 脚本 | 15 |
| 客户档案（lt_clients） | 5 |
| 客户报告 | 9 |
| 项目报告 | 5 |
| 收藏 | 6 |
| Luna 会话 | 45 |
| Leads | 11 |

---

## 六、与行业基准对比

| 指标 | Pinzos | 行业中位 | 优秀水平 |
|---|---:|---:|---:|
| 激活率（注册→用过核心功能） | **2%** | 37% | 60%+ |
| 免绑卡试用→付费 | **2.8%** | 8.9% | 15–25% |
| 7 天留存 | **8%** | 30–40% | — |
| 首日后回访 | 45% | 55–65% | — |
| **定价页→开通试用** | **73%** ✅ | 20–30% | — |

**唯一超出行业水平的是最后一项。**

这说明：**产品的价值主张、定价、落地页是有说服力的 —— 看到定价页的人里有 73% 愿意开试用，远高于行业的 20-30%。**
所有流失都发生在"开通试用之后、第一次产生价值之前"。

基准来源：
- [Free Trial Conversion Benchmarks 2025 (1Capture, 10,000+ SaaS)](https://www.1capture.io/blog/free-trial-conversion-benchmarks-2025)
- [SaaS Average Conversion Rate (Userpilot, 62 家)](https://userpilot.com/blog/saas-average-conversion-rate/)
- [User Activation Rate Benchmarks 2025](https://www.agilegrowthlabs.com/blog/user-activation-rate-benchmarks-2025/)

---

## 七、市场背景：这不全是产品的问题

同期迪拜市场数据（来自 DLD 官方数据，本地库同步至 2026-07-17）：

| 月份 | 期房首次登记 | 同比 | 现房二手成交 | 同比 |
|---|---:|---:|---:|---:|
| 2026-02 | 10,579 | +18% | 6,494 | −7% |
| 2026-03 | 9,631 | +7% | 4,219 | **−33%** |
| 2026-04 | 10,008 | −2% | 4,087 | **−46%** |
| 2026-05 | 7,087 | −30% | 3,360 | **−60%** |
| **2026-06** | **9,754** | **+1.5%** | **4,033** | **−42%** |

> **期房（开发商渠道）基本没跌；现房二手（独立经纪的主场）腰斩。**
>
> 时间线与战争完全吻合：2026-02-28 中东冲突开始，2 月同比尚为正，3 月起二手转负并持续恶化。

**⚠️ 统计口径说明**：DLD 的 "transaction" 包含抵押登记（Mortgages）和赠与过户（Gifts），
2026-06 的 17,813 笔中只有 13,787 笔是真实成交。用总数计算会虚高约 23%。

---

## 八、结论与判断

### 数据支持的两个可能解释

**解释一：经纪现在没有客户可用**
- 二手市场同比 −42%（5 月 −60%），经纪的成交分母大幅萎缩
- 一个帮助"促成交易"的工具，在没有交易的时候无法产生价值
- 支持证据：定价页转化率 73%（说明想用），但试用后使用率 0（说明用不上）

**解释二：这个功能不是经纪的核心痛点**
- 即使在市场好的时候，经纪的核心痛点可能是"找到客户"而非"展示房源"
- 支持证据：行业内经纪的获客预算（线索采购）远大于工具预算
- 迪拜单条线索成本约 AED 250–500；本产品定价 $49/月 ≈ AED 180

**两种解释都指向同一个行动：在验证真实付费需求之前，不应继续增加功能。**

### 一个尚未测试的方向

数据显示**期房与开发商渠道是目前唯一没有下滑的市场**（6 月同比 +1.5%）。
而 Developer 计划（$999/月）至今**零次销售对话**。

1 个 Developer 客户 = 20 个 Agent 客户。

---

## 九、下一步建议

| 优先级 | 动作 | 需要写代码 |
|---|---|---|
| 1 | 与 2–3 家**开发商**进行销售对话 | ❌ |
| 2 | 核实经纪真实的线索采购支出（预算科目在哪） | ❌ |
| 3 | 暂停新功能开发，仅维护数据同步 | ❌ |
| 4 | 修复首页漏斗（727 访客 → 87 人进地图） | ✅ |

---

## 附：数据复现方法

```bash
cd backend

# 注册与试用漏斗
npx ts-node -T scripts/db-query.ts "SELECT count(*) agents, count(*) FILTER (WHERE free_trial_started_at IS NOT NULL) trials FROM lt_agents"

# 各账号真实 tour 创建数
npx ts-node -T scripts/db-query.ts "SELECT a.email, a.created_at::date joined, (SELECT count(*) FROM lt_demo_sessions s WHERE s.agent_id=a.id) tours FROM lt_agents a ORDER BY tours DESC"

# 留存
npx ts-node -T scripts/db-query.ts "WITH d AS (SELECT user_email u, count(DISTINCT created_at::date) days FROM app_events WHERE user_email IS NOT NULL AND created_at>now()-interval '45 days' GROUP BY 1) SELECT count(*) users, count(*) FILTER (WHERE days=1) one_and_done, count(*) FILTER (WHERE days>=7) d7 FROM d"

# 功能使用分布
npx ts-node -T scripts/db-query.ts "SELECT event_type, count(*) n, count(DISTINCT COALESCE(user_email,visitor_id)) uniq FROM app_events WHERE created_at>now()-interval '30 days' GROUP BY 1 ORDER BY 2 DESC"

# 迪拜市场（⭐ 必须按 trans_group 过滤，否则结论会反）
npx ts-node -T scripts/db-query.ts "SELECT to_char(instance_date,'YYYY-MM') mon, count(*) FILTER (WHERE trans_group='Sales' AND procedure_name ILIKE '%Pre registration%') offplan_new, count(*) FILTER (WHERE trans_group='Sales' AND procedure_name NOT ILIKE '%Pre registration%') resale FROM dld_transactions WHERE instance_date>='2025-01-01' GROUP BY 1 ORDER BY 1"
```
