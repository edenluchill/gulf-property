# 试用体系 Test Plan

日期：2026-07-11
覆盖：免绑卡试用（自助 7 天 / 200 分）+ 开发商验证试用（30 天 / 600 分）+ 商业化埋点

---

## 0. 一页总览：谁能拿到什么

| 身份 | 试用 | 积分池 | 功能 | 怎么拿 |
|---|---|---|---|---|
| 买家 (buyer) | — | — | 地图/数据免费，无经纪工具 | — |
| 经纪 (agent) | 7 天 | 200 | **Pro 全功能** | 自助，一键，不绑卡 |
| 经纪公司 (agency) | 7 天 | 200 | Pro 全功能（不含席位） | 自助 |
| 开发商 (developer)，未验证 | 7 天 | 200 | Pro 全功能 + 楼书上传 | 自助 |
| 开发商，**已验证** | **30 天** | **600** | 同上 | 提交公司信息 → owner 在 admin 批 |

**为什么自助一律 7 天**：`/choose-role` 上人人都能点"我是开发商"。如果开发商自助就能拿 30 天，所有经纪都会去点开发商。人工验证门是有意为之。

**试用发的是 Pro(`agent`) 档的功能权限，不是 Starter**：实时带看 / Luna 导览的 `minPlan='agent'`，发 Starter 的话旗舰功能试不到，试用等于没试。积分独立锁死（不吃 Pro 的 1200）。

**必须登录**：`/trial/start` 挂 `requireAuth`。试用要绑到账号才能记"一人一次"的戳，否则清 cookie 就能无限重开。未登录点 CTA → 先去登录页。

---

## 1. 自动化回归（已全过 32/32）

```bash
cd backend && npx ts-node --transpile-only scripts/verify-free-trial.ts
```

在真库上用临时 agent 走完整生命周期，跑完自清理。**改订阅 / 积分 / 试用相关代码后必须跑。**

| 组 | 覆盖 |
|---|---|
| **A** 自助试用 | 未订阅被拦 → 开试用 → 200 分 → Pro 功能门全解锁（报告/Luna 导览/实时带看/楼书）→ 烧完 → 402 `insufficient` 且带 `freeTrial` 标记 |
| **B** 跨月 | 试用跨自然月**不刷新积分**（见 §4 坑 1） |
| **C** 开发商验证 | 未验证也只有 200 分 → 批准 → 600 分 / 30 天 / 换发新行（只剩一行）/ 用量从批准日重算 |
| **D** 到期 | 惰性判定立即回落 explore（不等 sweep）→ 功能与楼书上传重新上锁 → sweep 翻 DB 状态 → 写审计 |
| **E** 转化 | 删试用行 → 只剩一行订阅 → 拿到 Pro 1200 分 → 试用消耗清零 → 负数补偿流水 |
| **F** 回归 | **comp 终身账户不被 sweep 干掉** / 真实 Stripe 订阅不受影响 / 试用戳还在（无法二次试用） |

---

## 2. 手工用例（自动化覆盖不到的 UI / Stripe 真实链路）

### 2.1 试用开通

| # | 场景 | 期望 |
|---|---|---|
| T1 | 未登录 → `/pricing` 点「免费试用 7 天」 | 跳登录页，不报错 |
| T2 | 登录（新号）→ `/choose-role` 选经纪 → `/agent/plans` 点主 CTA | 不跳 Stripe，直接进 `/agent`；地图解锁；审批门自动开；顶部试用条显示「还剩 7 天 · 200/200 积分」 |
| T3 | 同一账号再点一次试用 | 409 `trial_used` → 前端自动转去 Stripe 订阅（不把人卡住） |
| T4 | 已有生效订阅的人点试用 | 409 `already_subscribed` → 转订阅 |
| T5 | 买家角色点试用（直接打接口） | 403 `not_agent` |
| T6 | 试用中的人看定价页 | 主 CTA 变回「立即订阅」（`canTrial=false`） |

### 2.2 额度与到期

| # | 场景 | 期望 |
|---|---|---|
| T7 | 试用中生成 2 次 Luna 导览（100×2） | 第 3 次 402；弹窗文案是「**试用积分已用完 —— 订阅后积分立即恢复**」，不是「下月刷新」 |
| T8 | 402 弹窗 | **不静默 redirect**，弹窗内渲染 + 直达订阅按钮 |
| T9 | 手改 `current_period_end` 到过去 → 刷新经纪台 | 立即回落：地图重新锁（`requiresPlan` → `/agent/plans`），付费功能 402 |
| T10 | 剩余 ≤2 天 或 ≤40 积分 | 试用条转琥珀色警示 |

### 2.3 开发商

| # | 场景 | 期望 |
|---|---|---|
| T11 | 选开发商角色 → 自助开试用 | 7 天 / 200 分（**不是** 30 天）；经纪台顶部出现琥珀色「开发商可申请 30 天试用」卡 |
| T12 | 填公司名提交验证 | 卡片变「审核中」；owner 收到告警邮件；`/admin/analytics` →「开发商验证」tab 出现待审行 |
| T13 | owner 点「批」 | 试用换成 30 天 / 600 分（**从批准日起算**）；role 落 `developer`；楼书上传解锁；试用条更新 |
| T14 | owner 点「拒」 | **不动**他现有的 7 天试用（他仍是潜在付费用户，别赶走） |
| T15 | `/developer/plans` | 同时显示 **Pro $49** 和 **Developer $999** 两张卡 |
| T16 | ⚠️ **开发商买 Pro $49** | role **仍是 `developer`**，楼书上传权限**不丢**（见 §4 坑 2） |
| T17 | 开发商试用到期 | 楼书上传立即锁（`can-upload` 带过期谓词） |

### 2.4 转化与现有客户

| # | 场景 | 期望 |
|---|---|---|
| T18 | 试用中走 Stripe Checkout 付款 | Stripe **不再给 7 天免费期**（立即扣款）；回跳后只剩一行订阅；积分池刷新为套餐额度；使用记录里有「订阅生效 · 试用期积分清零」 |
| T19 | Checkout 需要 3DS 验证但最终失败 | 试用**不被删掉**（见 §4 坑 3） |
| T20 | Checkout 页点取消返回 | 试用还在；埋 `checkout_abandon` |
| T21 | **现有 5 个订阅**（2 comp 终身 + 3 Stripe 试用） | 部署前后逐行不变 —— 上线前后各跑一次快照比对 |

```bash
cd backend && npx ts-node scripts/db-query.ts "SELECT s.plan_id, s.status, s.source, a.email FROM lt_subscriptions s LEFT JOIN lt_agents a ON a.id=s.agent_id ORDER BY s.created_at"
```

### 2.5 埋点

| # | 场景 | 期望（`app_events` 里能查到） |
|---|---|---|
| T22 | 打开定价页 | `pricing_view` |
| T23 | 点某档 CTA | `plan_select`（`action: trial` 或 `subscribe`） |
| T24 | 开出试用 | `trial_start` |
| T25 | 跳 Stripe / 付款成功 / 取消 | `checkout_start` / `checkout_success` / `checkout_abandon` |
| T26 | 撞 402 / 撞地图 429 | `paywall_hit` / `map_gate_hit` |

**上线两周后回看这个数**：`checkout_start` 与 `checkout_success` 的差值 = 「绑卡这一步吓跑了多少人」。这是我们此前在数据上根本无法回答的问题。

---

## 3. 上线前必跑

- [ ] `cd backend && npx tsc --noEmit`
- [ ] `cd frontend && npx tsc --noEmit`
- [ ] `cd backend && npx ts-node --transpile-only scripts/verify-free-trial.ts` → 32/32
- [ ] 订阅快照比对（T21）
- [ ] 迁移已跑：`free-trial-migration.sql`、`developer-verification-migration.sql`

---

## 4. 四个坑（都已修，别再踩回去）

**坑 1 — 试用跨月会白送一遍积分。**
积分按自然月计（`lt_usage_counters.period_month`）。7 天试用从月底开始就跨月，一到月初 `credits_used` 归零 → 200 分白送第二遍；30 天的开发商试用**必然**跨月，600 直接变 1200。
→ 试用用量改按「试用开始至今」的逐笔流水累计（`credits.ts` 的 `usedFor`），与日历月脱钩。

**坑 2 — 开发商买 Pro 会丢掉楼书上传权限。**
webhook 的 `ROLE_BY_PLAN['agent'] = 'agent'` 会把 role 从 `developer` 改写成 `agent`，而 `can-upload` 要求 `role='developer'`。前端 `AgentBilling` 的兜底也有同样问题。
→ 两处都加守卫：plan 推出的 role 是 `agent` 时，只在当前身份为 null/buyer/agent 时才写；前端改成只在 `!me.role` 时兜底。

**坑 3 — 3DS 验证中删试用会两头空。**
`customer.subscription.created` 可能先带 `incomplete` 状态（3DS 验证中）。此时删掉试用行，若付款最终失败 → 试用没了、订阅也没有。
→ 只在 `active`/`trialing` 时删试用行。

**坑 4 — `stripe_subscription_id IS NULL` ≠ 本地试用。**
后台 comp 授予的**终身账户**（`agents.ts`，100 年期）该列也是 NULL。拿它做过期清理会把终身客户一起干掉。
→ 用显式 `source` 列（`stripe` / `comp` / `free_trial`），清理只作用于 `free_trial`。

---

## 5. 相关文件

| | |
|---|---|
| 计划 | `docs/no-card-trial-plan-2026-07-11.md` |
| 漏斗数据 | `docs/reports/2026-07-11-conversion-funnel-trial-gate-analysis.md` |
| 回归脚本 | `backend/scripts/verify-free-trial.ts` |
| 迁移 | `backend/src/db/free-trial-migration.sql`、`backend/src/db/developer-verification-migration.sql` |
| 积分单一真相源 | `backend/src/luna-tour/credits.ts` |
| 试用/验证端点 | `backend/src/routes/billing.ts` |
| 到期清理 | `backend/src/services/freeTrialSweep.ts` |
