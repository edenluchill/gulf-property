# Stripe Billing 接入设计 — 经纪台订阅

> 状态:设计稿(2026-06-25)。决策已定:**USD 营销价 / 按个人经纪计费 / 独立营销报价页 + 台内升级页**。

## 0. 背景与现状

经纪台(`/agent`,`frontend/src/luna-tour/pages/AgentLayout.tsx`)目前靠简单的 `agents`
表做准入审批(pending/approved/rejected),**还没有任何收费**。

底层订阅脚手架其实搭了一半(`backend/src/db/luna-tour-schema.sql:262-307`):

- `lt_subscription_plans`(id, name, price_aed_month, stripe_price_id, limits jsonb)
- `lt_subscriptions`(agent_id→lt_agents, plan_id, status, stripe_customer_id,
  stripe_subscription_id, current_period_end, seats …)
- `lt_usage_counters`(agent_id, period_month, sessions_created, live_minutes,
  tts_chars, pdf_pages)
- 用量计量/配额检查已在 `backend/src/luna-tour/agent-router.ts:102-137`
  (`sessionUsage`/`meterSession`)

**就差 Stripe 本身**:`package.json` 没装 stripe,没有 webhook、billing 端点、checkout UI。

### 必须先解决的矛盾:价格口径

- 营销页 `/pricing`(其实是 `AboutPage.tsx:265-283` 里一段):Explore 免费 /
  **Agent $99/mo** / **Founder $699/mo**(USD)
- DB seed:free $0 / **pro 199** / **team 299**(AED)

**决议:以营销页 USD 为准。** DB 的 free/pro/team 全部废弃,重建为 explore/agent/founder(USD)。

## 1. 关键决策(已定)

| 决策 | 选择 | 理由 |
|---|---|---|
| 套餐/币种 | explore 免费 / agent $99 / founder $699,USD | 以营销页为准,DB 改成这套 |
| 计费单位 | 按个人经纪 | v1 最简单;team 多 seats/brokerage 共享留到 v2 |
| 报价页 | 独立营销报价页 + 台内升级页 | 共享后端 `/api/billing/plans`,价格单一真相源 |
| 支付方式 | **Stripe Checkout(托管)+ Customer Portal(托管)** | 小团队最省、最稳;Stripe 包揽卡输入/3DS/SCA/税/催款/换卡/取消 |

## 2. 套餐定义(写进 `lt_subscription_plans`)

| plan_id | 名称 | 价格 | limits(jsonb,每月额度) |
|---|---|---|---|
| `explore` | Explore | 免费 | 买家/投资人;各功能 2 次试用;live_tours 0 |
| `agent` | Agent | $99/mo | `{ "luna_tours_month": 20, "live_tours_month": 20, "reports_month": 30, "white_label": false }` |
| `founder` | Founder | $699/mo | `{ "luna_tours_month": 200, "live_tours_month": 200, "reports_month": 300, "white_label": true, "price_locked": true, "priority_support": true }` |

- agent 含 **7 天免费试用(收卡,随时取消)**。
- `limits` 的 key 用被计费的单位(luna_tours / live_tours / reports),
  与 `lt_usage_counters` 现有的 sessions/live_minutes/… **需要对齐**(见 §6)。
- `-1` 代表无限。

## 3. 身份与数据模型(实际实现)

v1 按个人计费。**复用现有 `lt_subscriptions` 表**(配额代码 `sessionUsage` 已在读它,Stripe 列也齐),
计费身份挂在 `lt_agents.id` 上 —— 经纪进台时 `currentAgent()` 会用其 Supabase email/id 走
`ensureAgent` find-or-create 该行。审批状态仍读简单的 `agents` 表(checkout 前校验 approved)。
迁移文件:`backend/src/db/stripe-billing-migration.sql`。

### 3.1 迁移要点

```sql
-- 一经纪一永久 Stripe customer
ALTER TABLE lt_agents ADD COLUMN IF NOT EXISTS stripe_customer_id text;
CREATE UNIQUE INDEX ... ON lt_agents (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- 套餐加 USD 价格列
ALTER TABLE lt_subscription_plans ADD COLUMN IF NOT EXISTS price_usd_month numeric;

-- 订阅唯一(幂等 upsert 用)
CREATE UNIQUE INDEX ... ON lt_subscriptions (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
```

### 3.2 重建套餐目录(USD)

`limits.sessions_month = Luna AI tours/月` —— 沿用现有计量口径,所以旧的 `sessionUsage` 配额代码不动即生效。

```sql
INSERT INTO lt_subscription_plans (id, name, price_aed_month, price_usd_month, limits) VALUES
  ('explore', 'Explore', 0,   0,   '{"sessions_month":2,  "live_tours_month":0,  "reports_month":2,  "white_label":false}'),
  ('agent',   'Agent',   99,  99,  '{"sessions_month":20, "live_tours_month":20, "reports_month":30, "white_label":false}'),
  ('founder', 'Founder', 699, 699, '{"sessions_month":200,"live_tours_month":200,"reports_month":300,"white_label":true,"price_locked":true,"priority_support":true}')
ON CONFLICT (id) DO UPDATE SET ...;
-- 旧 free/pro/team 在无订阅引用时删除。stripe_price_id 在 P0 后回填(或用 env STRIPE_PRICE_* 覆盖)。
```

### 3.3 真相源原则

- **Stripe = 订阅状态真相源**,DB 仅通过 webhook 镜像。
- 配额检查读 DB(`lt_subscription_plans.limits` + `lt_usage_counters`)。
- 前端永不可信:`GET /api/billing/me` 以 DB 为准(必要时回查 Stripe)。

## 4. 后端 billing 模块

新文件 `backend/src/routes/billing.ts`,挂在 `/api/billing`。

| 端点 | 鉴权 | 作用 |
|---|---|---|
| `GET /plans` | 公开 | 返回三档套餐(price + limits)。营销报价页 + 台内升级页共用 |
| `POST /checkout` | requireAuth + 已审批 | 建/复用 Stripe Customer → 建 Checkout Session → 返回 `url` |
| `POST /portal` | requireAuth | 建 Billing Portal Session → 返回 `url`(改套餐/取消/换卡/发票) |
| `POST /webhook` | Stripe 验签 | 处理订阅事件,回写 `agents` |
| `GET /me` | requireAuth | 当前 plan + status + 本月用量 vs 额度 |

### 4.1 Checkout(新订阅)

```ts
// POST /api/billing/checkout  body: { planId: 'agent' | 'founder' }
const customerId = await ensureStripeCustomer(agent); // 复用或新建,回写 agents.stripe_customer_id
const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  customer: customerId,
  line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
  subscription_data: { trial_period_days: planId === 'agent' ? 7 : 0 },
  payment_method_collection: 'always',          // 试用也收卡
  client_reference_id: String(agent.id),
  success_url: `${APP_URL}/agent/billing?status=success`,
  cancel_url:  `${APP_URL}/agent/billing?status=cancel`,
  allow_promotion_codes: true,
});
return { url: session.url };  // 前端 window.location = url
```

### 4.2 Portal(管理已有订阅)

```ts
const session = await stripe.billingPortal.sessions.create({
  customer: agent.stripe_customer_id,
  return_url: `${APP_URL}/agent/billing`,
});
return { url: session.url };
```

### 4.3 Webhook

处理事件:

- `checkout.session.completed` — 首次订阅落地(拿 subscription id)
- `customer.subscription.created | updated | deleted` — 状态/套餐/周期变化(**主真相源**)
- `invoice.payment_failed` — 标记 past_due(配合 Portal 催款)
- `invoice.payment_succeeded` — 续费成功(可选,刷新 period_end)

回写逻辑统一以 subscription 对象为准 upsert:

```ts
function syncSubscription(sub) {
  // 找 agents by stripe_customer_id
  // 由 sub.items.data[0].price.id 反查 plan_id
  UPDATE agents SET
    plan_id = mappedPlanId,
    subscription_status = sub.status,        // trialing|active|past_due|canceled
    stripe_subscription_id = sub.id,
    current_period_end = sub.current_period_end,
    trial_end = sub.trial_end
  WHERE stripe_customer_id = sub.customer;
}
```

## 5. 三个必须避开的坑

1. **Webhook 必须 raw body,且挂在全局 `express.json` 之前。**
   你们 `index.ts` 全局有 500MB json body parser,会把 webhook 原文吃掉 → 验签必失败。
   解法:`/api/billing/webhook` 单独 `express.raw({ type: 'application/json' })`,
   并在路由挂载顺序上**先于** json parser(或用路由级中间件)。

2. **新 env 变量必须加进 docker-compose 映射。**
   `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`(以及可选 `STRIPE_PRICE_AGENT`/`STRIPE_PRICE_FOUNDER`)
   不仅写进 `.env`,**必须在 compose 里映射进容器**——这正是之前 Supabase 漏映射、
   requireAuth 全程跳过的同款坑(见 memory: agent-approval-and-auth)。

3. **Webhook 幂等 + 乱序。**
   事件会重复投递、可能乱序。一律以 Stripe subscription 对象为唯一真相 upsert;
   忽略比当前 `current_period_end` 更旧的事件;按 `stripe_subscription_id` 唯一约束防重。

### 其它注意

- 用托管 Checkout 跳转,**前端不需要 publishable key**,无敏感代码。
- Webhook 端点走 `api.pinzos.com/api/billing/webhook`(Cloudflare 代理,Stripe webhook 正常通过)。
- requireAuth 已存在(`backend/src/middleware/auth.ts`),已审批用 `agents.status='approved'` 判断。

## 6. 配额 gating(P3)

- **准入(approved)= 能进经纪台(Explore 免费档)。**
- **active/trialing 订阅 = 解锁 Agent/Founder 额度。**
- 产品路由(`/api/luna/agent/*`)在执行前查 `agents.subscription_status` + 套餐 limits。
- `lt_usage_counters` 字段对齐计费单位:把现有 sessions_created/live_minutes 映射成
  luna_tours_month / live_tours_month / reports_month(或加列),
  与 `lt_subscription_plans.limits` 的 key 一致。

## 7. 前端

### 7.1 独立营销报价页(从 AboutPage 拆出)

- 新 `frontend/src/pages/PricingPage.tsx`,路由 `/pricing` 指向它(移除 AboutPage 内 `#pricing` 段)。
- 纯三栏功能对比 × 价格 × 单一 CTA,**不堆其它信息**(符合「专门展示功能」)。
- 数据来自 `GET /api/billing/plans`(价格不再硬编码)。
- CTA:未登录 → 登录后跳 `/agent/billing`;已登录 → 直接跳 `/agent/billing`。

### 7.2 台内升级页

- 新 `frontend/src/luna-tour/pages/AgentBilling.tsx`,AgentLayout 侧栏加「订阅/升级」tab,路由 `/agent/billing`。
- 内容:当前套餐 + 用量进度条(`GET /api/billing/me`)+ 升级按钮(→ `POST /checkout` 拿 url 跳转)+「管理订阅」(→ `POST /portal`)。
- `?status=success|cancel` 回跳后给个 toast。

### 7.3 共享数据

两页都吃 `GET /api/billing/plans`,价格永远一致、永远和 Stripe 对得上。

## 8. 分期落地

| 阶段 | 内容 |
|---|---|
| **P0(手动)** | Stripe test 模式建 Products/Prices(agent $99 / founder $699),拿 price_id;配 env(test key);本地 `stripe listen` 拿 webhook secret |
| **P1 后端** | `npm i stripe`;`billing.ts`(plans/checkout/portal/webhook/me);DB 迁移(加列 + re-seed USD);compose 映射 env |
| **P2 前端** | 独立 `PricingPage.tsx`;台内 `AgentBilling.tsx` + 侧栏 tab |
| **P3 gating** | 产品路由按订阅状态 gating;用量计量对齐计费单位 |
| **P4 上线** | 切 live key;Stripe dashboard 注册生产 webhook 端点;真卡走一遍试用→扣费→取消→换卡 |

## 9. 环境变量清单

| 变量 | 用途 | 位置 |
|---|---|---|
| `STRIPE_SECRET_KEY` | 服务端 Stripe SDK | backend .env + **compose 映射** |
| `STRIPE_WEBHOOK_SECRET` | webhook 验签 | backend .env + **compose 映射** |
| `STRIPE_PRICE_AGENT` / `STRIPE_PRICE_FOUNDER` | (可选)price_id,也可存 DB | backend .env |
| `APP_URL` | success/cancel/return url 基址 | backend .env(prod = https://www.pinzos.com) |

> 前端无需任何 Stripe key(托管 Checkout 跳转)。
