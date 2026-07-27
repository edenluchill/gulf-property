# 产品使用率分析 vs SaaS 市场基准

日期：2026-07-17
数据来源：生产库（lt_agents / lt_subscriptions / lt_demo_sessions / app_events），截至 2026-07-17

---

## 一、真实使用情况

### 注册漏斗

| 环节 | 数字 |
|---|---|
| 注册经纪（lt_agents，自 2026-05-31） | 52 |
| 其中最近 7 天注册 | 40 |
| onboarding_done | 52 |
| 开了免费试用（free_trial_started_at） | 36 |
| **做过 ≥1 个 tour 的账号** | **3** |
| 其中是自己人的账号 | 2（`demo-agent@luna.tour` 12 个 + `lzp6529@gmail.com` 2 个） |
| **真实外部经纪创建的 tour** | **1 人 · 1 个**（`shelldubai26@gmail.com`） |

### 付费状态（lt_subscriptions）

| status | source | count |
|---|---|---|
| trialing | free_trial | 36 |
| active | comp | 2 |
| active | stripe | **1** |
| past_due | stripe | 1 |
| canceled | stripe | 1 |

30 天内 `checkout_start` 事件：**1 次**。

### 留存（app_events，45 天窗口）

**登录用户（49 人）**
- 只活跃 1 天：27 人（55%）
- 活跃 ≥2 天：22 人
- 活跃 ≥3 天：8 人
- 活跃 ≥7 天：**4 人**
- 平均活跃天数：3.29

**全量访客（1066 人）**
- 一次就再没回来：996 人（**93.4%**）
- 活跃 ≥5 天：11 人
- 首次访问 7 天后仍有活动：13 人

### 注册当日之后是否回访（近 20 天各 cohort）

| 注册日 | 注册数 | 次日及以后回访 |
|---|---|---|
| 07-03 | 1 | 0 |
| 07-06 | 2 | 1 |
| 07-08 | 1 | 1 |
| 07-10 | 4 | 1 |
| 07-13 | 10 | 3 |
| 07-14 | 2 | 0 |
| 07-15 | 18 | 4 |
| 07-16 | 1 | 1 |
| 07-17 | 9 | 1 |

### 功能使用分布（30 天事件量）

| event_type | 事件数 | 独立用户 |
|---|---|---|
| page_view | 8725 | 1061 |
| **area_detail** | **3295** | **127** |
| property_view | 785 | 208 |
| tab_switch | 672 | 39 |
| search | 264 | 46 |
| api_error | 242 | 33 |
| luna_open | 98 | 50 |
| map_gate_hit | 85 | 12 |
| pricing_view | 75 | 48 |
| luna_close | 67 | 15 |
| plan_select | 40 | 35 |
| trial_start | 39 | 35 |
| share_action | 9 | 2 |
| referral_click | 6 | 5 |
| report_action | 4 | 3 |
| contact_attempt | 2 | 2 |
| favorite_toggle | 1 | 1 |
| checkout_start | 1 | 1 |

**全库对象数**：tours 15 · clients 5 · client_reports 9 · project_reports 5 · favorites 6 · luna_sessions 45 · collab_rooms 351（多为测试产生）

---

## 二、与市场基准对比

| 指标 | 本产品 | 市场中位 | 优秀 |
|---|---|---|---|
| 注册 → 激活（用过核心功能） | **~2%**（1/49 外部） | 37%（Userpilot 62 家）／PLG 30-45% | 60%+ |
| 免费试用 → 付费（免绑卡） | **~2.8%**（1/36） | 8.9%（ChartMogul 200 产品） | 15-25% |
| 首日后回访 | 45% | ~55-65% | — |
| 试用用户 7 天内仍活跃 | **8%**（4/49） | 30-40% | — |
| **pricing_view → trial_start** | **73%**（35/48） | 20-30% | — |

参考来源：
- [Free Trial Conversion Benchmarks 2025 (1Capture)](https://www.1capture.io/blog/free-trial-conversion-benchmarks-2025)
- [SaaS Average Conversion Rate (Userpilot)](https://userpilot.com/blog/saas-average-conversion-rate/)
- [What is a good activation rate (Lenny's Newsletter)](https://www.lennysnewsletter.com/p/what-is-a-good-activation-rate)
- [User Activation Rate Benchmarks 2025 (AgileGrowthLabs)](https://www.agilegrowthlabs.com/blog/user-activation-rate-benchmarks-2025/)

---

## 三、判断

### 1. 这不是"使用率低"，是激活率约等于零
2% 激活是"产品根本没被打开过"的水平，而不是"用得不够多"。36 个人主动点了试用，35 个人一个 tour 都没建。

### 2. 断点唯一确定的位置：试用开始之后
定价页 → 试用的转化 73%，**远超行业中位**。获客、落地页、定价、价值主张都不是问题。所有流失集中在"注册完成之后、首次产生价值之前"这一段。

### 3. 最可疑的原因：首次价值路径太长（未经验证）
当前建 tour 路径：建客户 → 选房 → 生成大纲 → 审稿 → 确认渲染 → 分享。
市场"优秀" time-to-first-value 基准是 **<10 分钟**。两段式生成在成本控制上是正确设计（见 [[luna-tour-two-stage-generation]]），但它把"我想看看这玩意长什么样"变成了多步骤作业。经纪注册后看到的是空白工作台，没有任何 30 秒内看到成品的路径。

**注意：这一条是推断，不是结论。需要用户访谈证实。**

### 4. 拉新目前是往漏桶里倒水
7/15 单日 18 人注册（社群推广痕迹），次日回访 4 人，建 tour 0 人。按当前转化率，每多拉 100 个经纪 ≈ 多 2 个激活、0.5 个付费。

### 5. 反直觉信号：被真实使用的是地图，不是 Luna Tour
`area_detail` 127 人 / 3295 次，是全站第二大事件，也是唯一有真实重复使用的功能。
而近期全部工程投入（tour 运镜、抖动修复、字幕、语音、i18n）服务的核心对象是**总共 1 个真实用户**。

数据倾向于：市场当前想要的是"迪拜区域数据工具"，而非"AI 带看视频"。

---

## 四、建议（按 ROI 排序）

1. **先做 5 个用户访谈，别写代码。**
   从 36 个试用用户中挑 5 个，问一个问题："你注册那天点开之后，卡在哪了？"
   目前所有关于流失原因的推断（包括本报告第 3 条）都是猜测。这是唯一能把猜测变成事实的动作。

2. **暂停拉新**，直到激活率 > 20%。继续推广只会放大漏桶。

3. **建一条零步骤样板路径。**
   新经纪首次登录第一屏 = 一个已渲染好、挂着他自己名字和头像的示范 tour，点一下就播。
   把"证明这东西值钱"从 6 步压缩到 0 步。

4. **重新评估产品重心。**
   认真考虑把地图/区域数据作为主产品、Luna Tour 作为增值功能。数据在为这个方向投票。

---

## 复现查询

```bash
cd backend

# 注册漏斗
npx ts-node -T scripts/db-query.ts "SELECT count(*) agents, count(*) FILTER (WHERE created_at>now()-interval '7 days') a7, count(*) FILTER (WHERE free_trial_started_at IS NOT NULL) trial_started FROM lt_agents"

# 每个经纪的真实使用
npx ts-node -T scripts/db-query.ts "SELECT a.email, a.created_at::date joined, (SELECT count(*) FROM lt_demo_sessions s WHERE s.agent_id=a.id) tours FROM lt_agents a ORDER BY tours DESC"

# 留存
npx ts-node -T scripts/db-query.ts "WITH d AS (SELECT user_email u, count(DISTINCT created_at::date) days FROM app_events WHERE user_email IS NOT NULL AND created_at>now()-interval '45 days' GROUP BY 1) SELECT count(*) users, count(*) FILTER (WHERE days=1) one_and_done, count(*) FILTER (WHERE days>=7) d7 FROM d"

# 功能使用分布
npx ts-node -T scripts/db-query.ts "SELECT event_type, count(*) n, count(DISTINCT COALESCE(user_email,visitor_id)) uniq FROM app_events WHERE created_at>now()-interval '30 days' GROUP BY 1 ORDER BY 2 DESC"
```
