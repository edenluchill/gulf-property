# 「买家找经纪帮忙」功能 —— 数据核实 + 竞品研究 + 建议顺序

2026-08-09。起因：owner 提出「客户看到好项目、想让真经纪帮他下 offer，应该有个显眼的
入口；我们有这么多经纪，得像 Uber 那样均衡派单」。

**结论先行：方向对（使用确实集中在买家侧），但三个前提都不成立，所以顺序要反过来 ——
先把已有的死按钮接上并人工响应，不要现在建派单系统。**

---

## 一、供给侧核实：能摆到买家面前的经纪是 2 个，不是 58 个

生产库，已排除内部号（`lzp6529` / `shelldubai26` / `admin@yesir.ai`）：

| 口径 | 人数 |
|---|---|
| `lt_agents` 总行数 | 86 |
| `user_profiles.role` 真是经纪侧 | 58 |
| ↳ 填了手机号（能被联系） | **5** |
| ↳ 传了头像 | 15 |
| ↳ 填了 **RERA 牌照号（`rera_brn`）** | **0** |
| ↳ 有生效订阅 | 33（含免费试用；真实付费仍为 0，见 [[activation-crisis-2026-07-17]]） |
| **档案完整到敢摆给买家看** | **2 个真人** + 1 个 demo 号 |

完整档案的三个人：
- `yangwanglin123@gmail.com` — Aileen Young — +971585596008
- `l13541347198@gmail.com` — 李加惠 — 971508957557
- `demo-agent@luna.tour` — Pinzos Demo（我们自己的）

> ⚠️ 86 这个数字是假的：每次登录都往 `lt_agents` 插一行且 `role` 默认 `'agent'`
> （见 [[lt-agents-role-is-fake]]）。谈「我们有多少经纪」必须用
> `user_profiles.role`，并且再按档案完整度过滤。

### 🔴 RERA 牌照 0 个是法律问题，不是数据问题

迪拜 **Bylaw 85**：未在 RERA 经纪名册注册者不得从事经纪活动；每个个人经纪必须持有
BRN 经纪身份卡（含注册号、有效期、所属持牌经纪公司）。撮合方把无牌人员作为「经纪」
推荐给买家去签 Form B / 下 offer，责任落在撮合方。

**这一条必须在任何派单逻辑之前解决** —— 而不是解决之后再补。

来源：Al Tamimi《Brokers 101》、DLD/RERA 持牌流程（DREI 培训 + RERA 考试 + Trakheesi）。

---

## 二、需求侧核实：几乎不存在

30 天窗口，已排除内部号 + 已注册经纪：

| 指标 | 数值 |
|---|---|
| 独立访客 | 1,024 |
| 看过房源详情的访客 | **188** |
| 人均看几套 | **2.2**（94 人只看 1 套；看 10 套以上的**只有 4 人**） |
| 回访（1,091 访客） | **944 个只来 1 天（86.5%）**；4 天以上仅 40 |
| `contact_attempt` 事件 | **90 天共 2 次**，最近 2026-06-29 |
| `favorite_toggle` | 30 天 **4 次** |

与 [[lead-tool-direction-verdict]] 2026-07-24 的口径一致（当时 1,429 会话 / 15 个回访 /
人均 1.7 套）。**半个月过去，需求侧没有任何改善。**

真买家会回来、会比价、会看十几套。人均 2.2 套 + 86.5% 只来一天 = 路过流量。

---

## 三、这个功能其实已经存在了一半 —— 而且是坏的

`frontend/src/pages/ProjectDetailPage/ProjectInfoCard.tsx:236`

```jsx
<Button onClick={() => trackEvent('contact_attempt', { contact_type: 'form_request' }, ...)}>
  {t('common:buttons.requestInfo')}
</Button>
```

**只发埋点，没有任何后续** —— 不弹表单、不发通知、没人收得到。
那 2 次 `contact_attempt` 就是两个真人点了它，然后什么也没发生。

（`ProjectReportPage.tsx:101` 那个 WhatsApp/电话链接是**经纪自己的品牌报告**里的，
指向该经纪本人，不是公开的「找个经纪」入口，两回事。）

---

## 四、别人怎么做的

| 模式 | 代表 | 机制 | 已知问题 |
|---|---|---|---|
| 按邮编卖 lead | Zillow Premier Agent | 预算份额制，出价高拿该邮编更大份额 | **同一条 lead 卖给 2–3 个经纪抢**；门户 lead 成交率仅 **0.4–1.2%** |
| 成交抽佣 | Zillow Flex、Redfin Partner | lead 免费给，成交后抽佣（Redfin 常 30%+） | 经纪要接受高抽成 |
| 预筛后转交 | Realtor.com ReadyConnect | 轻度资格审查再交付 | 仍是共享 lead |
| 「你的房源你的 lead」 | Homes.com | 询盘直接归挂盘经纪 | 针对卖方经纪的反弹设计 |
| 本地门户 | Bayut / Property Finder / Dubizzle | 卖 lead，AED 30–200/条 | Bayut 流量最大；PF 偏高端国际买家 |

**路由方式**（Zillow 团队后台的四种，行业通用）：
1. 指定人 2. 按百分比 3. **round robin**（顺序轮流）4. **broadcast**（最多 10 人手机同时响，先接先得）

**行业共识**：round robin **只适合经验/水平相近的团队**；它不保证 lead 给到最合适的人。
主流是**混合**：地理范围内 round robin + 高价位段单独覆盖规则。
（Robert Slack 团队 600 经纪 / 月均 25,000 lead —— 量到那个级别才轮不过来，才必须按邮编分。）

---

## 五、为什么 Uber 式均衡派单现在不适合我们

**1. Uber 的司机是同质的，经纪不是。**
有车有照即可，服务标准化。经纪的差异在语种、片区、价位段、专长、是否持牌 ——
round robin 会把唯一那几个真买家随机丢给一个没电话、没头像、没牌照的人，一次性烧掉。

**2. Uber 的前提是需求过剩、供给排队。我们正好相反。**
供给 58 人（合格 2 人），需求每月 2 次点击。**给每月 2 次点击建调度中心，是在解一个
还不存在的问题。**

---

## 六、建议顺序

### 第 0 步（这周，唯一要写代码的）— 把死按钮接上
唯一有真实数据支撑的改动：**有人点过，什么都没发生**。
现在只有 2 个可展示经纪，所以**先接到 owner + 合伙人，人工响应**。
这正是 Uber 早期的人工派单阶段 —— 先证明有人叫车，再写调度算法。
实现最省的形态：点击 → 一个 3 字段表单（联系方式 / 预算 / 什么时候看房）→ 落库 + 发邮件。

### 第 1 步 — 设准入门槛（零代码，先当成运营标准）
进「可被推荐」池必须齐：**RERA BRN + 手机 + 头像 + 真名**（不是邮箱前缀）。
按现在的数据 **0 人合格** —— 这个结果本身就是最有用的信息。

### 第 2 步 — 有量了再谈路由
触发门槛：**≥10 个合格经纪 且 每周 ≥5 条真询盘**。
到那时首选也不是 round robin，而是 **broadcast + 响应时限**：
同时解决公平与速度，且不需要人为判断谁更合适。

### 真正属于我们的差异化
Zillow / Bayut 没有的是：**我们手里有 DLD 成交数据和 tour 引擎**。
所以接入点不该是「留个电话」，而是**带着东西去找人**：
买家点「找经纪帮忙」→ 即时生成该项目的成交对比 + 报价单草稿 →
经纪收到的不是一个手机号，而是**一个已经带好上下文的会话**。
这就是 Perspective AI 那类 "qualification layer" 在做的事，而我们已经有原料。

---

## ⚠️ 元层面的提醒

[[build-instead-of-sell-pattern]] 记录着：**11 份报告都写着「去打电话」，之后接下来全是
在写代码。** 这个提议正好落在那个模式上（新功能 + 新一轮研究）。

所以本报告的建议里**只有第 0 步涉及写代码，而且是修一个已经存在的坏按钮**，
其余两步都是等数据。若第 0 步上线三周后仍是 0 条询盘，派单系统的讨论自动作废。

---

## 数据来源

生产库（本机 5432 不通，走 `ssh root@46.224.149.244 'docker exec -i pinzos-api node'`，
见 [[local-db-unreachable-use-ssh]]）。表：`lt_agents` / `user_profiles` / `app_events`
（23,403 行）/ `leads`(30) / `lt_clients`(6)。

竞品研究来源：
- [Real Estate Lead Generation Companies in 2026 — Perspective AI](https://getperspective.ai/blog/real-estate-lead-generation-companies-2026-10-compared)
- [Routing Leads to Team Members — Zillow](https://www.zillow.com/agents/lead-routing-teams)
- [Lead Distribution for Real Estate Brokers — Follow Up Boss](https://www.followupboss.com/blog/lead-distribution-for-real-estate-brokers)
- [Real Estate Lead Routing Best Practices — Pipedrive](https://www.pipedrive.com/en/blog/real-estate-lead-routing)
- [Brokers 101: What Every Property Purchaser Must Know — Al Tamimi & Company](https://www.tamimi.com/law-update-articles/brokers-101-what-every-property-purchaser-must-know-about-real-estate-agents-in-dubai)
- [How to Get Leads for Real Estate in Dubai 2026](https://theprimeads.com/real-estate-lead-generation-dubai-uae)
