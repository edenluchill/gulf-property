# Referral / Affiliate 归因的行业标准（查证报告）

> 2026-07-14 · 为 [经纪推荐计划 spec](../referral-program-spec.md) 做事实核查
> 查证对象：Rewardful、FirstPromoter、PartnerStack、Tapfiliate 官方文档 + Airbnb / Dropbox 公开条款

---

## 核心结论

**"cookie 窗口"和"客户绑定"是两段独立的机制** —— 主流平台全都这么设计：

```
点击链接 ──[cookie 窗口，30~90 天，last-click 覆盖]──▶ 注册/成为 customer
                                                            │
                                              此刻把 token 写进你自己的 DB
                                                            ▼
                                        基于 user_id 的持久绑定（lifetime attribution）
                                        ← cookie 过期、后续点别人的链接，都不再影响
```

---

## 1. Cookie / 点击归因窗口

| 平台 | 默认 | 备注 |
|---|---|---|
| Rewardful | **60 天** | 每 campaign 可改；官方未写上下限 |
| FirstPromoter | **60 天** | cookie `_fprom_tid` / `_fprom_ref` |
| PartnerStack | **90 天** | 再次点击会**重置**窗口 |
| Tapfiliate | **45 天** | 常用 30–90，最大 365 |

行业惯例三档：**30 / 60 / 90 天**。SaaS 偏 60–90（销售周期长）。

- https://help.rewardful.com/en/articles/2155812-how-long-are-referral-cookies-valid
- https://docs.firstpromoter.com/how-it-works
- https://support.tapfiliate.com/en/articles/1444510-how-does-tracking-work

---

## 2. 注册后是否「永久绑定」？——**是，SaaS 系的默认**

术语：**lifetime attribution / lifetime commissions / customer linking**

- **Tapfiliate** 原话：*"The customer is **permanently attributed** to the first affiliate, regardless of cookies or future links."*
  https://support.tapfiliate.com/en/articles/1462852-lifetime-commissions
- **Rewardful**：Lead 产生那一刻 customer 与 affiliate "linked"，此后所有 invoice 自动生成佣金（受 §4 期限约束）
  https://help.rewardful.com/en/articles/4202371-visitors-leads-conversions
- **FirstPromoter**：官方把 "Lifetime customer linking options" 列为核心配置项
- **PartnerStack**：签约窗口内 sign up 后，*"all activities and actions will be attributed to the partner"*

⚠️ **最容易踩的坑**：「注册了但没付费」的用户到底算不算已绑定，取决于**你有没有在注册时把 referral token 写进自己的 user 记录**。写进去了 = 永久绑定；只靠 cookie = 过期就没了。**这正是我们要做的事。**

---

## 3. First-touch vs Last-touch

| 平台 | cookie 阶段默认 |
|---|---|
| Rewardful | **First touch**（SaaS 场景更认"谁带来的客户"） |
| FirstPromoter | **Last click** |
| PartnerStack | **Last click** |
| Tapfiliate | **Last click** |

泛 affiliate 行业主流 = **last-click**；Rewardful 是显眼的例外。

**注册之后还会被后来的点击覆盖吗？**
- Rewardful first-touch / Tapfiliate lifetime 模式下：**不会**
- **last-click + 非 lifetime 配置下：会** ← 这是最经典的"抢单"漏洞，必须靠"注册即锁定"堵掉

https://www.rewardful.com/first-or-last-touch-attribution

---

## 4. 转化窗口 / 佣金有效期

**(a) 「注册后 X 天内付费才算」**
- **只有 Rewardful 有**这个独立字段：`days_before_referrals_expire`（referral 创建 → 转 customer 的最大天数）。API 文档示例值 30，**官方默认值查不到**。
- FirstPromoter / Tapfiliate / PartnerStack **没有等价字段** —— 它们是"cookie 窗口即转化窗口，之后 lifetime"。

**(b) recurring 佣金给多久**
- FirstPromoter 默认 **lifetime**，可砍到 12 个月
- Rewardful：`max_commission_period_months` + `max_commissions`（默认值查不到）
- **行业最常见的封顶 = 12 个月**。Rewardful 自家联盟计划就是 25% recurring / 仅前 12 个月

https://developers.rewardful.com/rest-api/campaigns/the-campaign-object
https://help.firstpromoter.com/en/articles/9273222-limiting-recurring-commissions-to-12-months-in-firstpromoter

---

## 5. 退款 / 拒付 clawback

- **Rewardful**：佣金先进 pending，`days_until_commissions_are_due` **= 30**（示例值）后转 due。官方建议**把 pending 期设成和退款政策一样长**。全额退款 → 佣金删除；部分退款 → 重算。
- **FirstPromoter**：靠 payout terms 实现 hold，**官方推荐 NET-30**（对应 30 天退款期）。退款与拒付自动作为**负佣金**冲抵。
- **行业基准：30 天**。整条链路（锁定 + 审核 + 结算）通常 30–60 天。ShareASale 每月 20 号锁定；impact.com ≈ 45–75 天。

https://www.rewardful.com/automated-refund-handling
https://help.firstpromoter.com/en/articles/9019492-how-payouts-work-in-firstpromoter

---

## 6. 老用户点了链接，算不算新推荐？

**没有一家默认排除。必须自己写逻辑。**

- **Tapfiliate** 官方明说：*"existing customers are **not excluded by default** … **You must implement custom logic** to prevent this."* 官方给的做法正是：注册时读 cookie，把来源**钉进你自己的 user 记录**，只对 source=affiliate 的用户触发 conversion。
  https://support.tapfiliate.com/en/articles/11495039-tracking-conversions-via-sources-identify-new-vs-existing-users
- **双边 referral 则是硬排除**：
  - Airbnb：被推荐人 *"Must not currently have an Airbnb account"*，且须在**注册后 180 天内**完成合格订单（链接本身 72 小时有效）https://www.airbnb.com/help/article/3613
  - Dropbox：必须 *"create and validate a **new** account"*，每推荐 500MB，Basic 上限 16GB

---

## 7. Stripe 本身

**Stripe 没有原生 affiliate/referral 归因系统。** Stripe Partner Program 是给 agency/platform 的生态项目，不是"拿链接赚佣金"。所有 Stripe 系 affiliate 能力都由第三方（Rewardful / FirstPromoter / Partnero / Trackdesk）通过 **webhook + customer metadata** 实现。

https://marketplace.stripe.com/categories/affiliate_and_referrals

**对我们的直接含义**：归因的真相源必须是**我们自己的 DB**（外加把 token 写进 Stripe customer 的 `metadata`，这正是 Rewardful 的做法），而不是 cookie。

---

## 明确「查不到」的项（未猜测）

1. Rewardful cookie window 的可配置上下限
2. Rewardful `days_before_referrals_expire` / `max_commission_period_months` 的**官方默认值**（文档只给示例）
3. FirstPromoter cookie life 的可配置范围
4. FirstPromoter "existing customer 排除规则"的默认行为
5. PartnerStack 的 existing-customer 处理与 post-signup 覆盖行为（support 站点 403）

---

## 落到我们的参数选型

| 参数 | 取值 | 依据 |
|---|---|---|
| cookie 窗口 | **60 天** | Rewardful / FirstPromoter 默认，SaaS 主流 |
| cookie 阶段归因 | **last-click** | 行业主流（3/4 家默认）；owner 已拍板 |
| 注册后 | **永久锁定，不被后续点击覆盖** | lifetime customer linking，四家一致 |
| 转化死线 | **注册后 180 天内首次付费** | 只有 Rewardful 有此机制；我们的奖励是**一次性**的，没有 recurring 的自然衰减，必须加死线。180 天参考 Airbnb 的合格期，且贴合迪拜长决策周期 |
| clawback hold | **30 天** | 行业基准，对齐退款政策 |
| 老用户排除 | **自己写**（从未付费 + 账号 ≤ 30 天） | 没有平台默认提供 |
