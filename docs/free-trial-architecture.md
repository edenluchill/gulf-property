# 试用体系 · 完整结构

最后更新：2026-07-11 · 状态：已上线
相关：[计划](./no-card-trial-plan-2026-07-11.md) · [Test Plan](./free-trial-test-plan-2026-07-11.md) · [漏斗数据](./reports/2026-07-11-conversion-funnel-trial-gate-analysis.md)

---

## 1. 谁能拿到什么

| 身份 | 试用 | 积分 | 功能 | 怎么拿 |
|---|---|---|---|---|
| 买家 `buyer` | — | — | 地图 / DLD 数据 / Luna，**免费不限时** | 不需要 |
| 经纪 `agent` | 7 天 | 200 | **Pro 全功能** | 自助一键，不绑卡 |
| 经纪公司 `agency` | 7 天 | 200 | Pro 全功能（席位需订阅） | 自助 |
| 开发商 `developer` 未验证 | 7 天 | 200 | Pro 全功能 + 楼书上传 | 自助 |
| 开发商 **已验证** | **30 天** | **600** | 同上 | 提交公司信息 → owner 审批 |

**两个刻意的设计**

- **试用发的是 Pro(`agent`) 档功能权限，不是 Starter。** 实时带看 / Luna 导览的 `minPlan='agent'`——发 Starter 的话旗舰功能试不到，试用等于没试。积分独立锁死，不吃 Pro 的 1200。
- **自助一律 7 天，包括开发商。** `/choose-role` 上人人都能点"我是开发商"。若自助就能拿 30 天而经纪只有 7 天，所有经纪都会去冒充开发商。那道人工验证门是有意为之。

---

## 2. 数据模型

```
lt_agents                          user_profiles                lt_subscriptions
─────────────────────────          ─────────────────            ─────────────────────────────
id                    ◄──┐         user_id (PK)                 agent_id ──────┘
email                    │         email                        plan_id      'agent' (试用发 Pro 权限)
free_trial_started_at ◄──┼── 一人   role  ─────────┐             status       trialing|active|canceled
   一次的戳(不可逆)      │   一次   'buyer'        │             source   ★   stripe | comp | free_trial
developer_verified_at    │         'agent'        │             current_period_end   ← 到期时间
billing_agent_id ────────┘         'agency'       │             trial_credits ★      NULL=200 / 600
   (席位成员→founder)              'developer' ───┼──► 决定       stripe_subscription_id
                                                  │    can-upload
                                                  └──► 决定 mapMeter 是否锁地图

developer_verifications            lt_credit_ledger              lt_usage_counters
────────────────────────          ──────────────────            ──────────────────
agent_id (UNIQUE)                 agent_id                      agent_id
user_id  ← 审批时按它落 role       feature                       period_month  ← 自然月
company / website / note          credits  (负数=补偿)           credits_used
status  pending|approved|rejected  created_at ★ 试用用量按它算     ↑ 只用于付费订阅
```

★ = 这轮新增的列

### 为什么必须有 `source` 列

> **`stripe_subscription_id IS NULL` ≠ 本地试用。**
> 后台 comp 授予的**终身账户**（`agents.ts`，100 年期）该列也是 NULL。
> 拿它当判据做过期清理，会把终身客户一起干掉。这是最初的计划里差点上线的 bug。

### 防重复领取：两道锁

```
锁 1（应用层，原子）      UPDATE lt_agents SET free_trial_started_at = now()
                          WHERE id = $1 AND free_trial_started_at IS NULL
                          RETURNING id
                          单条语句 → 行锁天然互斥。并发 N 次只有一个拿到返回行。

锁 2（数据库，硬约束）    CREATE UNIQUE INDEX idx_lt_subs_one_trial_per_agent
                          ON lt_subscriptions (agent_id) WHERE source = 'free_trial'
                          应用层哪天写漏了，数据库也不允许出现第二条。
```

**顺序很关键**：占位必须在所有业务检查**之前**。若先查"有没有生效订阅"再占位，并发时赢家插入试用行后，输家会先撞到那个检查 → 返回 `already_subscribed` 而不是 `trial_used`，结果取决于线程时序。

**占位后任何校验不通过，必须把戳退回去**（`releaseClaim`）——否则用户占了位却没拿到试用 = 永远失去资格。

---

## 3. 用户旅程

### 3.1 新用户（经纪）

```
登录 → /choose-role 选「我是经纪」
                    │  (付费角色不预写 role —— 没付款下次刷新还会再问,免得被付费墙锁死)
                    ▼
              /agent/plans
                    │  主 CTA:「免费试用 7 天 · 无需信用卡」
                    │  次要:  「或直接订阅 →」
                    ▼
         POST /api/billing/trial/start   ← requireAuth(必须登录:戳要绑账号)
                    │
                    ├─ 原子占位 + 插试用行 (source=free_trial, plan=agent, 7天)
                    ├─ upsert user_profiles.role = 'agent'
                    └─ autoApprovePaid → agents 表 approved
                    ▼
                 /agent  工作台
                    │  顶部:试用条(剩 7 天 · 200/200 积分)
                    │  首屏:3 步激活清单
                    ▼
        建客户(0分) → 秒出提案(20分) → Luna 导览(100分)
```

### 3.2 老用户 / 试用到期（← 你截图里那个缺口）

免费试用的 CTA **只长在 `/agent/plans` 上**，而那条路只有新用户会走。已登录的老经纪打开个人中心，看到的是「Explore · 未订阅 · 剩 0/0 积分」的**死卡片**。

现在有三个入口，资格由服务端算（`/billing/me` 的 `trial.eligible`）：

```
                    ┌─ 个人中心 /profile「订阅与用量」卡内
  trial.eligible ──►├─ 经纪台顶部 (TrialBanner)
  (从业者 & 无订阅   └─ 地图被锁 429 → /agent/plans
   & 没用过)
                       「你还有 7 天免费试用没领 · 一键领取」
```

**试用到期后不再静默**（之前是：功能全 402、地图被锁，但没有任何地方解释发生了什么）：

```
  trial.used && !active && status='none' && 从业者
        └─►「免费试用已结束 · 订阅后积分立即恢复」+ 查看套餐
```

### 3.3 开发商

```
选开发商 → 自助试用 (7天/200分，和经纪一样)
              │
              ├─ 经纪台顶部出现琥珀色卡:「开发商可申请 30 天试用」
              ▼
     POST /developer/verify-request { company, website, note }
              │  → 邮件通知 owner
              ▼
     /admin/analytics →「开发商验证」tab → owner 点「批」
              │
              ├─ 删旧试用行,换发全新 30 天 / 600 分(从批准日起算)
              ├─ user_profiles.role = 'developer'  ← 楼书上传的前提
              └─ developer_verified_at 打戳
              ▼
        30 天 / 600 分 ≈ 15 份楼书(40 分/份)
```

`/developer/plans` 同时给两个出口：**Pro $49** 和 **Developer $999**——不是每个开发商一上来就要 5 个席位。

---

## 4. 门禁：谁在拦人

| 门 | 位置 | 触发 | 响应 |
|---|---|---|---|
| 地图计量 | `mapMeter.agentNeedsPlan()` | 从业者角色 + 无生效订阅 | **429** → `/agent/plans` |
| 套餐门 | `credits.checkCredits()` | `PLAN_RANK[plan] < minPlan` | **402** `subscription_required` |
| 余额门 | 同上 | `balance < cost` | **402** `insufficient_credits` |
| 楼书上传 | `agents.ts /can-upload` | 非 developer 或无生效订阅 | 隐藏入口 |
| 审批门 | `AgentLayout` | `agents.status ≠ approved` | 状态卡 + 试用入口 |

**试用到期后这四道门同时合上**，靠的是同一个判定：

```sql
status IN ('active','trialing')
  AND (source <> 'free_trial' OR current_period_end > now())
       ↑ 免绑卡试用没有 Stripe webhook 来关它,过期必须我们自己判
```

**两层防护**（代码里有十几处 `status IN ('active','trialing')` 的查询，散点补判断不可靠）：

1. **sweep**（`freeTrialSweep.ts`，每 5 分钟）把过期行真正翻成 `canceled` → DB 状态对**所有**读取方都是真的
2. **钱的两道门另带即时过期谓词**（`planFor` / `agentNeedsPlan` / `can-upload`）——不能容忍那 5 分钟窗口

---

## 5. 积分口径（一个容易错的地方）

```
付费订阅   →  按自然月    (lt_usage_counters.period_month,新月自动归零)
免费试用   →  按试用起点  (lt_credit_ledger 累计 created_at >= 试用开始)
```

> **为什么试用不能按自然月：** 7 天试用从月底开始就跨月，一到月初 `credits_used` 归零 → **200 分白送第二遍**。30 天的开发商试用**必然**跨月，600 直接变 1200。

**转化时**（试用 → 付费）：把当月 `credits_used` 清零，并写一条负数 `trial_reset` 流水（不抹历史）。否则同月内「付了钱余额还是空的」。

---

## 6. 埋点漏斗

```
pricing_view → plan_select → ┬─ trial_start ──────────────► 激活清单
                             └─ checkout_start ─┬─ checkout_success
                                                └─ checkout_abandon
                                                   ↑
                         这两者的差值 = 「绑卡吓跑了多少人」
                         —— 上线前我们在数据上根本无法回答这个问题

paywall_hit (402)  ·  map_gate_hit (429)   ← 埋在全局 fetch 拦截器的唯一咽喉处,
                                              所有现在和将来的付费功能自动覆盖
```

加事件必须改**两处**白名单：`frontend/src/lib/track.ts` 的 `AppEvent` + `backend/src/services/eventIngest.ts` 的 `ALLOWED_EVENTS`。

---

## 7. 文件地图

| 关注点 | 文件 |
|---|---|
| 领取试用（原子、并发安全） | `backend/src/services/freeTrial.ts` |
| 到期清理 | `backend/src/services/freeTrialSweep.ts` |
| 积分单一真相源 | `backend/src/luna-tour/credits.ts` |
| 端点（试用 / 开发商验证 / Stripe） | `backend/src/routes/billing.ts` |
| 地图门 | `backend/src/middleware/mapMeter.ts` |
| 楼书上传门 | `backend/src/routes/agents.ts` |
| 迁移 | `src/db/free-trial-migration.sql`、`developer-verification-migration.sql`、`free-trial-claim-once.sql` |
| 定价页 | `frontend/src/pages/PricingPage.tsx` |
| 试用条 / 领取卡 / 到期卡 | `frontend/src/components/TrialBanner.tsx`、`TrialClaimCard.tsx` |
| 开发商验证（用户端 / admin） | `DeveloperVerifyCard.tsx`、`analytics/DeveloperVerification.tsx` |
| 激活清单 | `frontend/src/luna-tour/ui/ActivationChecklist.tsx` |
| **回归测试（39 项）** | `backend/scripts/verify-free-trial.ts` |
| 捞人发邮件 | `backend/scripts/notify-trial-eligible.ts` |

---

## 8. 上线前必跑

```bash
cd backend  && npm run build          # ⚠️ 不是 tsc --noEmit —— 生产用 tsconfig.production.json,更严
cd frontend && npx tsc --noEmit
cd backend  && npx ts-node --transpile-only scripts/verify-free-trial.ts   # 39 项
```

订阅快照比对（部署前后逐行一致）：

```bash
npx ts-node scripts/db-query.ts "SELECT s.plan_id, s.status, s.source, a.email FROM lt_subscriptions s LEFT JOIN lt_agents a ON a.id=s.agent_id ORDER BY s.created_at"
```

---

## 9. 六个坑（都已修，别再踩回去）

1. **`stripe_subscription_id IS NULL` ≠ 本地试用** —— comp 终身账户也是 NULL，清理会误杀。用 `source` 列。
2. **试用跨月白送积分** —— 按自然月计数的额度，碰上跨周期的试用必然漏。改按试用起点累计。
3. **开发商买 Pro 会丢楼书上传权限** —— `ROLE_BY_PLAN['agent']='agent'` 把 role 从 developer 改写掉。前后端两处都加了守卫。
4. **3DS 验证中删试用会两头空** —— `subscription.created` 可能先带 `incomplete`，此时删试用而付款又失败 → 什么都没有。只在 `active`/`trialing` 时删。
5. **读后写能被双击绕过** —— 先 SELECT 查戳再 INSERT 是 TOCTOU。改原子 UPDATE + 唯一索引。
6. **试用到期是静默的** —— 功能全 402、地图被锁，却没有任何地方解释。加到期态卡片。
