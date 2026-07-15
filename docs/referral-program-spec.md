# 经纪推荐计划（Referral Program）设计 Spec

> 状态：**代码已完成（前后端全部编译通过）· 待部署到生产** · 定稿日 2026-07-14
>
> **剩余部署步骤（动 live 计费，需 owner 确认）**：
> 1. 建 coupon `REFERRED_FIRST_MONTH_20`：服务器 pinzos-api 容器内跑 `scripts/setup-referral-coupon.ts`（要 live key）
> 2. 给 live webhook `we_1TrFLd...` 加事件类型：`invoice.paid` / `charge.refunded` / `charge.dispute.created`（现只订阅 4 个）
> 3. Stripe CLI 重放 `invoice.paid` / `charge.refunded` 验 qualify / revoke + milestone 并发只发一次
> 4. `backend/quick-deploy.ps1` 部署后端（前端 push main 自动部署）
> 5. 顺序：先建 coupon → 加 webhook 事件 → 部署
>
> DB schema 已上生产库（`referral-schema.sql`，additive）。
> 一句话：经纪分享专属链接 → **新经纪**注册并真实付费 → 每累计 3 个合格推荐，推荐人得 1 个月订阅费抵扣。
> 行业标准查证见 [reports/2026-07-14-referral-attribution-standards.md](reports/2026-07-14-referral-attribution-standards.md)

---

## 0. 已拍板的决策

| 决策 | 结论 |
|---|---|
| **被推荐人是谁** | **同行经纪（泛同行，不限团队/公司）**。⚠️ 现有 5 个付费档（Explore 免费 / Starter $25 / Agent $49 / Agency $699 / Developer $999）**全是卖给经纪、中介、开发商的，买家无货可买** —— 所以"推荐买家来付费"在当前产品形态下不成立。<br><br>❓ 曾担心"经纪不愿把竞争对手拉进来"，但 owner 拿到了真实市场反馈：**「他为了免费，他会拉的」**。以实际反馈为准，不做团队限制。 |
| 归因模型（cookie 阶段） | **last-click**（最后点击的链接赢，覆盖之前的）。行业主流，4 家平台里 3 家默认如此。 |
| 归因模型（注册之后） | **永久锁定**，不被后续任何点击覆盖（lifetime customer linking）。四家平台一致。 |
| 奖励兑现形式 | **Stripe Customer Balance 抵扣**（打负数余额，下张账单自动抵扣）。Stripe 保持唯一真相源，不去手改 `current_period_end`。推荐人当时若还没订阅 → 奖励挂起，等他首次付费时自动 flush。 |
| 双边奖励 | **被推荐的新经纪：首月 20% off**（owner 拍板）。Stripe coupon `percent_off: 20, duration: once`，只给月付首期。<br>📌 我的保留意见：Starter 省 $5 / Agent 省 $9.8，且新经纪本来就有 7 天免绑卡试用（"零风险试起来"已被满足），激励可能偏弱。**但这是一个改一个数字就能调的参数**，先按 20% 上线跑数据，看注册→付费转化率再决定要不要加码（首月 5 折 / 送 credits）。 |
| 计数规则 | **累计制**：每满 3 个合格推荐发 1 个月，无总上限；设发放速率上限（默认 6 个月/自然年）防刷。 |
| **成就 badge** | **做，但只在经纪侧**（推广面板 / 经纪台），**绝不进客户可见页面**（报告 `/r/`、报价单 `/pp/`、tour `/t/`）。三档：引荐人（1 人）/ 推广大使（3 人）/ 金牌推广（10 人）。<br>🔴 **铁律**：客户可见的 badge 会被理解成"平台认证过这人专业"，而实际含义是"这人拉了 3 个同行"——那是拿平台信誉为与专业度无关的行为背书，且一旦被识破会连累页面上所有平台标识的可信度。将来若要做客户可见 badge，**获取条件必须换成真专业度指标**（成交量/客户评价/资质），与拉人头彻底分开。<br>实现：badge 从 `qualified_count` **纯派生**，不需要新表新列。 |

---

## 1. 关键参数（全部对齐行业标准）

| 参数 | 取值 | 依据 |
|---|---|---|
| cookie 窗口 | **60 天** | Rewardful / FirstPromoter 默认 |
| cookie 阶段归因 | **last-click** | 行业主流 |
| 注册后 | **永久锁定** | lifetime attribution，Tapfiliate 原话 *"permanently attributed … regardless of cookies or future links"* |
| **转化死线** | **注册后 180 天内首次付费才算数** | 只有 Rewardful 提供此机制（`days_before_referrals_expire`）。**我们必须加**：奖励是一次性的免费月，没有 recurring 佣金那种"12 个月封顶"的自然衰减，不设死线的话两年后才付费的人也会触发发奖。180 天参考 Airbnb 的合格期，且贴合迪拜的长决策周期。 |
| clawback hold | **30 天** | 行业基准（Rewardful `days_until_commissions_are_due` = 30），官方建议对齐退款政策 |
| 老用户排除 | **自己写**：从未付费 + 账号 ≤ 30 天 | 没有任何平台默认提供此规则（Tapfiliate 官方明说 *"You must implement custom logic"*） |

**归因的核心（也是全行业的做法）**：cookie 只负责"把人送到注册"这一程；注册那一刻把 token **写进我们自己的 DB**，此后由 user_id 接管。客户换设备、清缓存、隔月才付钱，都不影响归属。**Stripe 没有原生 referral 系统**，真相源必须在我们的 DB（外加写一份进 Stripe customer `metadata`，这是 Rewardful 的做法）。

---

## 2. 三个必须新建的东西（现有代码没有）

1. 🔴 **注册时没地方钉推荐人** —— 本仓库**没有 Supabase auth hook / DB trigger**。但因为被推荐人是**经纪**，钩子挂在 `luna-tour/session-builder.ts:524 ensureAgent()`（首次进经纪台时按 email upsert `lt_agents`）比挂在懒创建的 `user_profiles` 更自然。见 §4。
2. 🔴 **Webhook 缺 `invoice.paid`** —— `billing.ts:1128` 只处理 `checkout.session.completed` 和 `customer.subscription.*`。qualify 与退款撤销都必须听 invoice / charge 事件。
3. 🔴 **不能复用 `grantOneTimeTrial`** —— `services/adminGrant.ts:40` 硬编码"每人一生只能一次"（占位在 `lt_agents.trial_granted_at`）。推荐奖励是**可累加**的，需要独立的授予路径。

**可以直接复用的（约 60% 地基已在）**
- 短码生成：`luna-tour/agent-router.ts:181 randomCode()`（32 字符无歧义字母表 + `crypto.randomBytes`，6 位，冲突重试 8 次）
- 原子占位防并发双发：`adminGrant.ts:40` 的 `UPDATE ... WHERE col IS NULL RETURNING` 模式
- 审计流水：`plan_change_log`（`billing.ts:912 logPlanChange`）
- 定时扫描：`services/freeTrialSweep.ts` 的 5 分钟 sweep 模式，hold 到期检查照抄

---

## 3. 数据模型

### 3.1 `lt_agents` 加一列

```sql
ALTER TABLE lt_agents ADD COLUMN referral_code TEXT UNIQUE;
CREATE INDEX idx_lt_agents_referral_code ON lt_agents(referral_code);
```
一个经纪一个码，懒生成（首次进「推广」tab 时生成）。点击量走 `app_events`，不单独建计数表。

### 3.2 `lt_referral_attributions` —— 谁推荐了谁

```sql
CREATE TABLE lt_referral_attributions (
  id                BIGSERIAL PRIMARY KEY,
  referrer_agent_id UUID NOT NULL REFERENCES lt_agents(id),
  referee_agent_id  UUID NOT NULL UNIQUE REFERENCES lt_agents(id),  -- ← 锁定：一个新经纪只能被归因一次
  referee_user_id   UUID,
  referee_email     TEXT,
  code              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'attached',
      -- attached  : 已绑定，尚未付费（180 天转化死线倒计时中）
      -- pending   : 已付首笔真钱，30 天 hold 中
      -- qualified : hold 期满，计入 3 人进度
      -- expired   : 超过 180 天仍未付费
      -- revoked   : 退款 / 拒付 / 风控拒绝
  attached_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT now() + interval '180 days',  -- 转化死线
  first_paid_at     TIMESTAMPTZ,
  first_invoice_id  TEXT,
  qualified_at      TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  revoked_reason    TEXT,
  attach_ip         INET,
  risk_flags        JSONB DEFAULT '[]'::jsonb,     -- same_ip / same_card_fingerprint …
  CHECK (referrer_agent_id <> referee_agent_id)    -- 不能推自己
);
CREATE INDEX idx_ref_attr_referrer ON lt_referral_attributions(referrer_agent_id, status);
```

`referee_agent_id` 上的 **UNIQUE 就是"注册后永久锁定"的物理保证** —— 绑上之后，后续再点任何人的链接都改不了归属（只有 support 能手工改）。这正是 last-click 的抢单漏洞的堵法：**last-click 只在 cookie 阶段生效，注册即封盘**。

### 3.3 `lt_referral_rewards` —— 发了什么奖

```sql
CREATE TABLE lt_referral_rewards (
  id                    BIGSERIAL PRIMARY KEY,
  agent_id              UUID NOT NULL REFERENCES lt_agents(id),
  milestone_index       INT  NOT NULL,             -- floor(qualified_count / 3) 的第几档
  kind                  TEXT NOT NULL DEFAULT 'free_month',   -- 将来可扩 'cash_commission'
  amount_cents          INT  NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'cad',
  status                TEXT NOT NULL DEFAULT 'pending',
      -- pending  : 已达标，等推荐人有 stripe_customer_id 才能落账
      -- applied  : 已打进 Stripe customer balance
      -- failed   : Stripe 调用失败，等重试
  stripe_balance_txn_id TEXT,
  attribution_ids       BIGINT[] NOT NULL,          -- 这一档是哪 3 个人凑出来的（可回溯）
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at            TIMESTAMPTZ,
  UNIQUE (agent_id, milestone_index)                -- ← 防并发双发，比事务锁更硬
);
```

---

## 4. 归因链路

```
推荐人复制链接  https://pinzos.com/i/ABC123
        │
        ▼
新经纪点击 → 前端路由 /i/:code
        │  · localStorage.setItem('ref_code', {code, ts})   ← 60 天窗口，last-click 直接覆盖旧值
        │  · trackEvent('referral_click', {code}, {immediate:true})
        │  · redirect → /pricing
        ▼
新经纪注册 / 登录（Supabase）→ 首次进经纪台 → ensureAgent() 建 lt_agents 行
        │
        ▼
前端 onAuthStateChange === 'SIGNED_IN'（或进经纪台时）
        │  若 localStorage 有未过期的 ref_code 且本机未 attach 过
        ▼
POST /api/referral/attach { code }         ← 幂等，服务端认 verified token
        │
        ▼  服务端校验（全部通过才写 attribution）
        ├─ code 存在且属于某个 lt_agents
        ├─ referee ≠ referrer（user_id / email 双查，DB CHECK 兜底）
        ├─ 该 agent 尚无 attribution 行                   （UNIQUE 兜底 = 永久锁定）
        ├─ 该 agent 从未付过费                            （老用户不能被"抢注"）
        ├─ 该 agent 账号创建 ≤ 30 天                      （必须是新用户；可调）
        └─ ref_code 写入时间距今 ≤ 60 天                  （cookie 窗口）
        ▼
INSERT lt_referral_attributions (status='attached', expires_at = now() + 180d)
        │
        └─ 同时写一份进 Stripe customer metadata（referrer_agent_id），便于对账
```

**为什么不能等到付费时再看 cookie**：新经纪可能换设备、清缓存、隔月才付。绑在 agent 记录上之后，付款发生在什么时候、什么设备上都无所谓 —— **这正是行业的 lifetime attribution。**

---

## 5. Qualify 状态机（钱的部分）

```
attached ──[invoice.paid: amount_paid > 0 且是首张付费发票]──▶ pending
   │                                                             │
   │                                                   [30 天 hold 无退款]
   │                                                             ▼
   ├──[180 天到期仍未付费]──▶ expired                        qualified
   │                                                             │
   pending / qualified ──[charge.refunded | charge.dispute.created]──▶ revoked
```

**qualify 的判据（唯一可靠口径）**
- 监听 `invoice.paid`，条件：`amount_paid > 0` 且 `billing_reason in ('subscription_create','subscription_cycle')`
- ⚠️ 绝不能用 `stripe_subscription_id IS NULL` 判断是否付费 —— 后台 comp 授予也是 NULL（`free-trial-migration.sql:9` 已明确警告）
- 需新写 helper `hasEverPaid(agentId)`，现有代码里**不存在**；`adminGrant.ts:59` 那句最接近，但它把 `comp` 也算进去了，不等于付过钱

**sweep（照抄 `freeTrialSweep.ts` 的 5 分钟循环）**
1. `attached` 且 `expires_at < now()` → `expired`
2. `pending` 且 `first_paid_at < now() - 30 days` → `qualified`
3. 对每个受影响的推荐人：`qualified_count = COUNT(status='qualified')`，`target_milestone = floor(qualified_count / 3)`
4. 对每个尚未发过的 milestone_index，`INSERT lt_referral_rewards ... ON CONFLICT DO NOTHING`（UNIQUE 挡并发）
5. 插入成功的 → 立刻尝试 apply 到 Stripe

**退款撤销**：`charge.refunded` / `charge.dispute.created` → 对应 attribution 置 `revoked`。已发放的奖励**不追回**（Stripe 余额可能已被消费），但 qualified 计数下降会让下一档 milestone 推迟到达 —— **天然完成 clawback，不需要额外逻辑**。

---

## 6. 奖励发放（Stripe）

```ts
// services/referral.ts
await stripe.customers.createBalanceTransaction(
  agent.stripe_customer_id,
  {
    amount: -monthlyPriceCents,          // 负数 = 客户余额（credit）
    currency: 'cad',
    description: `Referral reward — milestone #${milestoneIndex} (3 paid referrals)`,
    metadata: { reward_id: String(reward.id), agent_id: agent.id },
  },
  { idempotencyKey: `ref_reward_${reward.id}` }   // ← 重试安全
)
```

- 下一张发票 Stripe 自动扣这笔余额，**不动 `current_period_end`，不会和计费周期脱节**。
- 推荐人**还没订阅**（试用中 / 无 customer）→ reward 停在 `status='pending'`；在 `checkout.session.completed` 里 flush 该经纪的所有 pending reward。**这正好覆盖"推荐人自己也还在试用"的场景。**
- `amount_cents` = 该经纪当前 plan 的**月价**。
  - ⚠️ **待确认**：年付（Starter $249/年、Agent $490/年）用户拿"1 个月免费"，抵多少？**建议按年费/12**（$20.75 / $40.83），否则年付用户能套利到月付牌价（$25 / $49）。

**发放速率上限**：默认 6 个月/自然年。超出 → reward 记 `status='pending'` 并 flag，转人工。

---

## 7. 被推荐人的折扣（双边）—— 首月 20% off

**已定：首月 20% off**（owner 拍板）。

**实现**：Stripe 建 coupon `REFERRED_FIRST_MONTH_20`（`percent_off: 20`, `duration: 'once'`）；在 `billing.ts:272` 创建 Checkout Session 时，若当前 agent 有 `attached` 状态的 attribution 且未用过折扣 → `discounts: [{ coupon }]`。**只给月付首期**（年付不给）。

⚠️ **注意与既有促销的冲突**：`discounts` **不能与 `allow_promotion_codes` 并存**（[[stripe-billing]] 已踩过），若将来又开创始优惠 coupon，需要决定优先级（同一 session 只能挂一张 coupon）。

📌 **保留意见（记下来，将来看数据回头调）**：Starter 省 $5 / Agent 省 $9.8，且新经纪本来就有 **7 天免绑卡试用**（`services/freeTrial.ts`）——"零风险试起来"这个需求已被完全满足，再叠一个省 $5 的首月折扣，对决策的边际影响可能很小；经纪转发时也不容易说出口。

**但这是一个改一个数字就能调的参数**（Stripe coupon 的 `percent_off`）。上线后盯这条漏斗：

```
referral_click → 注册(attached) → 付费(pending)
```

如果 **注册→付费 转化率明显低于自然流量的同一环节**，说明折扣没起作用，届时升级方案：
- **首月 5 折** —— 有感、说得出口、不推迟付费时点、不侵蚀年付价格锚
- **送积分**（如 1000 credits）—— 成本 ≈ 几次 AI 调用；不碰价格，不养成"找人要链接来打折"的习惯

❌ 无论如何**不要**"延长试用到 30 天"：会推迟付费时点 → 推迟推荐人拿奖励，与激励方向相反。

落地页 `/i/:code` 与定价页必须**显式打出"通过同行邀请注册，首月 8 折"**，否则双边奖励等于没有。

---

## 8. 反作弊

| 手段 | 实现 |
|---|---|
| 不能推自己 | attach 时校验 referrer 的 user_id / email ≠ referee，DB 层 CHECK 兜底 |
| 老用户不能被抢注 | attach 要求「从未付费」+「账号创建 ≤ 30 天」（**没有任何平台默认提供此规则，必须自己写**） |
| 一人只能被归因一次 | `UNIQUE(referee_agent_id)` |
| 无限期躺赚 | 180 天转化死线（`expires_at`） |
| 刷单后退款 | 30 天 hold + revoked 让计数回落 |
| 同一人开小号 | 记录 `attach_ip`；Stripe payment_method **card fingerprint** 与 referrer 相同 → `risk_flags` 打标，该 attribution **不自动 qualified**，转人工 |
| 批量刷 | 发放速率上限 6 个月/年 |
| 重复发奖 | `UNIQUE(agent_id, milestone_index)` |

---

## 9. 经纪台「推广」tab

**改 2 处**：
1. `frontend/src/pages/profile/ProfileShell.tsx:60` 的 `AGENT_TABS` 加一项
2. `frontend/src/App.tsx:124` 的 `/agent` 路由下加子路由

**页面内容**（`GET /api/me/referral` 一个接口全给）：
- 我的专属链接 + 一键复制 + 二维码（经纪多在微信/WhatsApp 里转发）
- 漏斗：**点击数 → 注册数 → 付费数**（取自 `app_events.referral_click` / `attached` / `pending+qualified`）
- 进度条：`qualified % 3` / 3 → "再推荐 N 位付费同行，得 1 个月免费"
- **成就 badge**（见下）
- 明细表：每个被推荐人（**邮箱脱敏**，如 `a***@gmail.com`）+ 状态徽章（已注册·剩 N 天 / 已付费·生效倒计时 X 天 / 已生效 / 已失效）
- 已获奖励：几个月、什么时候到账、抵扣了哪张账单

### 9.1 成就 Badge

| 档位 | 条件（`qualified_count`） |
|---|---|
| 引荐人 | ≥ 1 |
| 推广大使 | ≥ 3 |
| 金牌推广 | ≥ 10 |

**纯派生**，不需要新表新列 —— `computeBadge(qualifiedCount)` 一个函数搞定。

🔴 **铁律：badge 只在经纪侧显示（推广面板 / 经纪台），绝不出现在客户可见的页面上**（报告 `/r/`、报价单 `/pp/`、tour `/t/` `/v/`、客户报告 `/cr/`）。

理由：客户可见的平台 badge 会被理解成**"平台认证过这个经纪的专业度"**，但它的实际含义是**"这人拉了 3 个同行注册"**。把它摆到客户面前，等于拿平台信誉为一个与专业度毫无关系的行为背书；而且一旦被识破是靠拉人头拿的，客户对该页面上**所有**平台标识（包括真实的资质认证）的信任都会一起打折。

将来若要做客户可见的信任 badge，**获取条件必须换成真专业度指标**（成交量 / 客户评价 / 牌照资质），与推荐计数彻底解耦。

---

## 10. 改动清单

**后端**
| 文件 | 动作 |
|---|---|
| `backend/src/db/referral-schema.sql` | 🆕 两张表 + `lt_agents.referral_code` |
| `backend/src/services/referral.ts` | 🆕 attach / qualify / revoke / grantReward / flushPending / getStats / `hasEverPaid()` |
| `backend/src/services/referralSweep.ts` | 🆕 expired + hold 到期 → qualified → 发奖（照抄 `freeTrialSweep.ts`） |
| `backend/src/routes/referral.ts` | 🆕 `POST /api/referral/attach`、`GET /api/me/referral` |
| `backend/src/routes/billing.ts:1128` | ✏️ webhook 加 `invoice.paid` / `charge.refunded` / `charge.dispute.created`；`checkout.session.completed` 里 flush pending reward |
| `backend/src/routes/billing.ts:272` | ✏️ Checkout 创建时挂被推荐人折扣券 |
| `backend/src/luna-tour/session-builder.ts:524` | ✏️ `ensureAgent()` 里接住 attach（或独立走 `/attach` 端点） |
| `backend/src/services/eventIngest.ts:13` | ✏️ `ALLOWED_EVENTS` 加 `referral_click` |
| `backend/src/middleware/mapMeter.ts:109` | ✏️ share-code 白名单加 `/i/` 路由（否则落地页会被地图计量拦） |

**前端**
| 文件 | 动作 |
|---|---|
| `frontend/src/pages/agent/PromoPage.tsx` | 🆕 推广面板 |
| `frontend/src/pages/ReferralLanding.tsx` | 🆕 `/i/:code` 落地页（存码 → 埋点 → 跳定价页） |
| `frontend/src/lib/referral.ts` | 🆕 localStorage 存/取/过期（60 天，last-click 覆盖）+ 登录后 attach |
| `frontend/src/pages/profile/ProfileShell.tsx:60` | ✏️ AGENT_TABS |
| `frontend/src/App.tsx:124` | ✏️ 路由 |
| `frontend/src/lib/track.ts:22` | ✏️ `AppEvent` 联合类型加 `referral_click` |
| `frontend/src/lib/track.ts:238` | ✏️ share-code 路由白名单加 `/i/` |

**工作量估算**：后端 2–3 天，前端 1–2 天。风险最高的是 Stripe webhook 那一块 —— **Stripe 现在是 live 模式在收真钱**（`acct_1TmRxcLQ2nIWAGfr`），测试必须用 Stripe CLI 重放事件，不能在生产上刷卡试。

---

## 11. 已消解的疑虑：经纪愿意拉同行吗？

曾提出的担忧：被推荐人是**同行经纪**（竞争关系）——"我推荐 3 个同行进来，换我一个月免费（$25–49）"，对方拿到的是和我一模一样的工具，可能直接抢我的客户。这跟 Dropbox 送空间、Airbnb 送房费（用户之间不竞争）有本质区别。

**→ 已由真实市场反馈驳回。** owner 向实际接触经纪的人求证，得到的回答是：**「他为了免费，他会拉的」**。

以真实反馈为准，**不做团队/公司限制，直接做泛同行推荐**。

（备选路线存档：若上线后数据证明经纪确实不愿拉同行，可转向"团队邀请"——入口放在产品内的协作场景（实时带看/共享报告），奖励改成团队能力解锁，终局指向 Agency 档（$699）升级。**底层机制完全复用本 spec**，只需改入口话术和 `lt_referral_rewards.kind`。）

---

## 12. 上线后要盯的两个数字

1. **注册 → 付费转化率**（被推荐人 vs 自然流量）→ 决定 20% off 要不要加码，见 §7
2. **人均推荐数**（发出链接的经纪里，真正带来 ≥1 个付费的比例）→ 决定"3 个换 1 个月"的力度够不够

---

## 13. 遗留待确认

1. 年付经纪的"1 个月免费"抵扣金额口径（**建议 = 年费/12**，防套利：否则年付用户能套到月付牌价）
2. 发放速率上限（暂定 6 个月/自然年）
