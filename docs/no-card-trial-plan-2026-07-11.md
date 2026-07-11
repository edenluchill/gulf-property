# 免绑卡试用 + 激活漏斗 — 实施计划

日期：2026-07-11
起因：老板观察「过去 7 天 400 访客只有 1 个试用订阅（0.25%）」，怀疑「7 天试用必须绑信用卡」挡死了经纪。
数据结论见：`docs/reports/2026-07-11-conversion-funnel-trial-gate-analysis.md`

---

## 0. 先纠正前提（重要）

绑卡门**没有**被证伪也没有被证实——因为几乎没人走到那扇门前。

| 步骤（30 天，已排除内部号） | 独立访客 |
|---|---|
| 独立访客 | 716 |
| 打开 /login | 36 |
| /choose-role | 22 |
| **看见定价页** | **12** |
| 开出试用 | 2–3 |

- 定价页 → 试用 ≈ **20%**，健康。
- 30 天真实外部注册 4 人（3 buyer + 1 agent）；`user_profiles` 全表 11 行。agency/developer 史上零人选。
- 唯一那个真实外部经纪**当天就绑卡开了试用**（1/1 = 100%）。
- **402 付费墙 30 天只触发 1 次**；`plan_change_log` 90 天零 cancel/downgrade。
- 那个付费经纪：21 个事件，**0 报告 / 0 报价单 / 0 客户 / 0 Luna**。

所以真正的病灶排序：
1. **顶端获客/定位**（吃掉 95%）——689/716 从没看见经纪入口。
2. **激活**——进来的经纪零产出。
3. 绑卡摩擦——理论上真实，但当前样本量下无法验证。

**免绑卡试用仍然值得做**，理由改为：它是**激活工具**（零摩擦让经纪玩到 aha），且能给我们一个真正可测的漏斗。但它不能是唯一动作。

---

## 1. 优先级

| 阶段 | 内容 | 工期 | 为什么排这里 |
|---|---|---|---|
| **P0** | 补齐商业化埋点 | 半天 | 没有它，任何定价改动都没有 before/after 基线。**必须先做。** |
| **P0** | 修 `/undefined` 路由 bug（19 个真人撞到） | 1h | 白捡的漏损 |
| **P1** | 免绑卡试用（本文档主体） | 2–3 天 | 降摩擦 + 激活 |
| **P1** | 经纪首日激活引导（试用开始后的 3 步任务） | 1–2 天 | 治「进来了什么也不干」 |
| **P2** | 顶端获客：经纪落地页可见性 / 定位 | — | 收益最大，但不是代码问题 |

---

## 2. P0：埋点（先做，别跳过）

`app_events` 30 天全量只有 15 种事件，**零** pricing/checkout/paywall 事件。

新增事件类型（**必须同时改两处白名单**，见 `[[favorites-and-tracking]]`）：
- `frontend/src/lib/track.ts` 的 `AppEvent` 联合类型
- `backend/src/routes/eventIngest.ts` 的 `ALLOWED_EVENTS`

| 事件 | 触发点 | 关键 props |
|---|---|---|
| `pricing_view` | PricingPage 挂载 | `variant`(agent/agency/developer/public), `from` |
| `plan_select` | 点某档 CTA | `plan_id`, `cycle` |
| `trial_start` | 免绑卡试用成功 | `plan_id` |
| `checkout_start` | 跳 Stripe 前 | `plan_id`, `cycle`, `had_trial` |
| `checkout_abandon` | 回跳 `?status=cancel` | `plan_id` |
| `checkout_success` | 回跳 `?status=success` | `plan_id` |
| `paywall_hit` | 前端收到 402 | `code`(subscription_required/insufficient_credits), `feature` |
| `map_gate_hit` | 前端收到 429 | `requiresPlan` |

**`checkout_start → checkout_success` 的差值，是「绑卡吓跑多少人」的唯一真答案。** 上线后攒两周再回头看要不要彻底砍掉绑卡付费路径。

---

## 3. P1：免绑卡试用 — 技术方案

### 3.1 目标行为

- 角色 = `agent` / `agency` / `developer` 的用户，**无需信用卡**即可开 7 天试用。
- 试用期给 **200 积分**（= 现有 `rookie` 档的 `credits_month`，天然对齐）。
- 积分用完 或 7 天到期 → 回落 `explore`（付费功能 402，地图按经纪规则锁）。
- 随时可**提前付费**；付费即**刷新积分池**（当月计数清零），并立即生效。
- **现有 5 个订阅（3 trialing rookie + 2 active agent）零影响。**

### 3.2 数据模型（不新建表）

复用 `lt_subscriptions`，加一个显式的 `source` 列区分订阅来源：

```sql
ALTER TABLE lt_subscriptions ADD COLUMN source text NOT NULL DEFAULT 'stripe';  -- stripe | comp | free_trial

INSERT INTO lt_subscriptions (agent_id, plan_id, status, source, current_period_end)
VALUES ($agent, 'agent', 'trialing', 'free_trial', now() + interval '7 days');
```

> ⚠️ **原计划用 `stripe_subscription_id IS NULL` 当判据，实施时发现这是致命的。**
> 生产快照显示后台 comp 授予的**两个终身账户**（`agents.ts:114`，100 年期）的
> `stripe_subscription_id` 也是 NULL。拿它做过期清理会把终身客户一起干掉。
> 必须用显式 `source` 列，过期清理只作用于 `source='free_trial'`。

**试用发的是 `agent`(Pro) 档的功能权限，不是 `rookie`。** 因为实时带看 / Luna 导览的
`minPlan='agent'` —— 发 Starter 的话旗舰功能试不到，试用等于没试。但积分不吃 Pro 的
1200：`credits.ts planFor()` 对 `free_trial` 行硬锁 `TRIAL_CREDITS=200`。
200 分 ≈ 2 场实时带看 或 2 次 Luna 导览，够尝到味道，不够白嫖。

这一行插进去，下面全是**免费搭车**的：
- `credits.ts planFor()` 查 `status IN ('active','trialing')` → 解锁 Pro 功能门 ✅
- `mapMeter.ts agentNeedsPlan()` 查有无 active/trialing 订阅 → 地图自动解锁 ✅
- `agents.ts:34-48` 有 active/trialing 订阅 → 自动 `approved`，审批门自动开 ✅

**防重复试用**：`lt_agents` 加列
```sql
ALTER TABLE lt_agents ADD COLUMN free_trial_started_at timestamptz;
```
非空 = 已用过，不再发放。（不要靠删订阅行来判断——用户能反复删了重开。）

**顺带修的真 bug**：`user_profiles.role` 的 CHECK 约束只允许 `('buyer','agent')`，而代码
（`profile.ts:43`）早已支持四角色 → 选 `agency`/`developer` 会被 DB 拒掉，且 `billing.ts`
里的 role 同步带 `.catch` 把错误静默吞掉。**telemetry 里「agency/developer 史上零人选过」
不是没人想选，是这条路本来就是坏的。**

### 3.3 ⚠️ 四个必踩的坑

**坑 1：到期没有 Stripe webhook 来关它。**
本地试用行没有 Stripe 订阅，没人会把它从 `trialing` 改成 `canceled`。
两层防护（实施时发现代码里有十几处 `status IN ('active','trialing')` 查询，散点补过期判断不可靠）：
1. **sweep**（`services/freeTrialSweep.ts`，每 5 分钟）把过期行真正翻成 `canceled` → DB 状态对**所有**读取方（/me、证书标题、teamSubOf、admin 后台…）都变成真的。
2. **钱相关的两道门另加即时过期谓词**，不等 sweep：`credits.ts planFor()` 和 `mapMeter.ts agentNeedsPlan()` 的 SQL 里都带 `AND (source <> 'free_trial' OR current_period_end > now())`。

sweep 必须 `NODE_ENV === 'production'` 门控（本机 ts-node-dev 残留进程连的是生产库），
并包 `beginMaintenance()/endMaintenance()`（否则批量查询触发慢查询告警刷屏）。

**坑 2：付费时会插出第二行订阅。**
`upsertSubscription()`（`billing.ts`）按 `stripe_subscription_id` 唯一索引 upsert。试用行的该列是 NULL → 付费后会**新插一行**，同一 agent 出现两行订阅。
→ 写入前先 `DELETE FROM lt_subscriptions WHERE agent_id=$1 AND source='free_trial'`。
→ ⚠️ **但只在订阅真正生效（active/trialing）时删**：`customer.subscription.created` 可能先带
`incomplete` 状态（3DS 验证中），那时就删会在付款还没成功时干掉人家的试用，付款再失败就两头空。

**坑 3：14 天白嫖。**
现在 `billing.ts:268` 对 rookie/agent/developer 无条件给 `trial_period_days: 7`。已经免绑卡试用过 7 天的人再去 checkout，会再拿 7 天 Stripe 免费期。
→ **建议：彻底去掉 Stripe 的 `trial_period_days`，统一为「免绑卡试用 7 天 → 付费立即扣款生效」。** 模型更干净，也不影响现有 3 个 trialing 用户（他们的 Stripe 订阅已存在，不受新代码影响）。
→ 顺带把 `payment_method_collection: 'always'` 留着——到这一步的人是真心要付费的。

**坑 4：付费后积分不刷新。**
`lt_usage_counters` 按 `(agent_id, period_month)` 累加。试用期花掉的 200 分记在当月；同月付费升级后，余额 = 新档度数 − 试用期已花，用户会觉得「我付了钱怎么积分还是空的」。
→ 付费成功（`upsertSubscription` 里 status 变 active 且此前有本地试用行）时，**把当月 `credits_used` 归零**，并在 `lt_credit_ledger` 写一条 `feature='trial_reset'`, `credits = -used` 的补偿流水（保留审计可追溯，不要直接 UPDATE 抹掉历史）。

### 3.4 后端改动清单

| 文件 | 改动 |
|---|---|
| `backend/src/db/free-trial-migration.sql` | 新建：`ALTER TABLE lt_agents ADD COLUMN free_trial_started_at timestamptz;` |
| `backend/src/routes/billing.ts` | 新端点 `POST /api/billing/trial/start`（`requireAuth`）：校验 role ∈ agent/agency/developer、`free_trial_started_at IS NULL`、无现存订阅 → 插本地试用行 + 打戳 + `plan_change_log` 记 `action='free_trial_started'` |
| `backend/src/routes/billing.ts:268` | 去掉 `trial_period_days` |
| `backend/src/routes/billing.ts:676 upsertSubscription()` | ① 先删本地试用行（坑 2）② 若来自试用 → 当月 credits_used 归零 + 写补偿 ledger（坑 4）③ `plan_change_log` 记 `trial_converted` |
| `backend/src/routes/billing.ts:324 GET /billing/me` | 返回 `trial: { kind:'free'|'stripe', endsAt, daysLeft, creditsLeft }` |
| `backend/src/luna-tour/credits.ts:68 planFor()` | 惰性过期判定（坑 1） |
| `backend/src/middleware/mapMeter.ts agentNeedsPlan()` | 同款惰性过期判定（坑 1） |

角色映射：agent→`rookie`、agency→`rookie`、developer→`rookie`（试用统一发 rookie/200 分，别按角色发 15000/20000 分的大池子——试用是尝鲜不是白送）。

### 3.5 前端改动清单

| 文件 | 改动 |
|---|---|
| `frontend/src/pages/PricingPage.tsx` | 主 CTA 改「**免费试用 7 天 · 无需信用卡**」→ `POST /api/billing/trial/start`，成功直接进 `/agent`（不跳 Stripe）。次要链接「直接订阅」保留原 checkout 路径。已试用过 → CTA 回落「立即订阅」 |
| 新组件 `TrialBanner.tsx` | 经纪台顶部常驻条：`试用中 · 剩 X 天 · 剩 Y 积分` + 「立即订阅」按钮。剩 ≤2 天或 ≤40 积分时转警示色 |
| `frontend/src/luna-tour/pages/AgentBilling.tsx` | 显示免绑卡试用状态 + 「订阅后积分立即刷新」说明 |
| 402 弹窗（`insufficient_credits` / `subscription_required`） | 文案改成「试用积分已用完 —— 订阅后立即恢复」+ 直达订阅按钮。**权限 UI 绝不静默 redirect**（见 `[[payplan-share]]` 铁律） |
| `PricingPage.tsx:479` | 顺手修：底部小字对 founder 也写「7 天免费试用」是错的 |
| `PricingPage.tsx:149` | 顺手修：agent 档积分文案写 2500，DB 实际 1200 |

### 3.6 现有客户不受影响 — 逐条核对

| 现有对象 | 影响 |
|---|---|
| 2 个 `active` agent 订阅 | 无。有 stripe_subscription_id，惰性过期判定不碰它们 |
| 3 个 `trialing` rookie（Stripe 试用中） | 无。他们的 Stripe 订阅已创建，`trial_period_days` 的移除只影响**新** checkout |
| `UNLIMITED_EMAILS` / owner | 无。`isUnlimited()` 在 planFor 之前短路 |
| founder 席位共享池（`billing_agent_id`） | 无。本地试用行只发给主 agent；席位成员走 `billingAgentOf()` |
| 已 approved 的经纪 | 无。审批门只看有无 active/trialing，不看来源 |

**上线前必跑**：`SELECT agent_id, plan_id, status, stripe_subscription_id FROM lt_subscriptions` 快照留档，部署后比对无变化。

---

## 4. P1：激活引导（治「进来了什么也不干」）

免绑卡试用把人放进来，如果他还是零产出，只是把「7 天后不续」提前变成「7 天后蒸发」。

试用开始后，经纪台首屏放 **3 步任务卡**（完成即划掉）：
1. **生成第一份客户报告**（20 分）
2. **做一份 Sales Offer 报价单**（5 分）
3. **和 Luna 聊一次找房**

三步都在 200 分预算内，且都是「aha 时刻」功能。完成 ≥1 步的人才算真正激活——把「试用激活率」做成 dashboard 上的一个数。

---

## 5. 验收（2026-07-11 已跑，全过）

`backend/scripts/verify-free-trial.ts` —— 在真库上用临时 agent 走完整生命周期，15 项断言，跑完自清理：

- [x] 试用前 explore，付费功能被 402 拦住
- [x] 开试用 → 积分池 = 200（不是 Pro 的 1200）
- [x] Luna 导览 / 实时带看（minPlan=agent）解锁 ← 试用给 Pro 功能门
- [x] 烧完 200 分 → 402 `insufficient` 且带 `freeTrial` 标记（文案说"订阅即恢复"）
- [x] 转化 → 负数补偿流水 + 积分池刷新（不抹历史）
- [x] 到期 → 惰性判定立即回落 explore（不等 sweep），功能重新上锁
- [x] sweep 把 DB 状态翻成 canceled + 记 `free_trial_expired` 审计
- [x] **回归：两个 comp 终身账户不受影响**
- [x] 部署前后生产订阅快照逐行一致（5 行未变）
- [x] backend + frontend `tsc --noEmit` 全过

---

## 6. 一句话总结

**先补埋点（半天），再做免绑卡试用（把它当激活工具，不是当转化救命稻草），同时把火力放在顶端——现在每月只有 12 个人经过定价页这个房间，换门把手不如先把人领进楼。**
