-- ============================================================================
-- 经纪推荐计划(Referral Program) — 2026-07-14
-- Spec: docs/referral-program-spec.md
-- 行业标准查证: docs/reports/2026-07-14-referral-attribution-standards.md
--
-- 模型:经纪分享 /i/:code → 新经纪注册并**真实付费** → 每 3 个合格推荐送推荐人 1 个月。
--
-- 归因两段式(全行业做法):
--   1) cookie 阶段(60 天,last-click 可覆盖)  — 只负责把人送到注册,活在前端 localStorage
--   2) 注册即锁定(lifetime attribution)      — token 落进本表,此后 cookie 死活都不影响
-- ============================================================================

-- ── 1. 经纪的专属推荐码(懒生成:首次进「推广」tab 时才建)──────────────
ALTER TABLE lt_agents ADD COLUMN IF NOT EXISTS referral_code TEXT;

-- 部分唯一索引:NULL 不参与唯一性(绝大多数经纪没生成过码)
CREATE UNIQUE INDEX IF NOT EXISTS idx_lt_agents_referral_code
  ON lt_agents (referral_code) WHERE referral_code IS NOT NULL;

-- 首次分享 +7 天的占位戳(一辈子一次;微信分享无法验证,只能靠"一次"防刷)
ALTER TABLE lt_agents ADD COLUMN IF NOT EXISTS share_reward_claimed_at TIMESTAMPTZ;


-- ── 2. 归因:谁推荐了谁 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lt_referral_attributions (
  id                BIGSERIAL PRIMARY KEY,

  referrer_agent_id UUID NOT NULL REFERENCES lt_agents(id) ON DELETE CASCADE,
  referee_agent_id  UUID NOT NULL REFERENCES lt_agents(id) ON DELETE CASCADE,
  referee_user_id   UUID,          -- Supabase auth user id(可空:ensureAgent 按 email 建行)
  referee_email     TEXT,
  code              TEXT NOT NULL, -- 归因当时用的码(经纪换码后仍可回溯)

  -- attached  : 已绑定,尚未付费(expires_at 转化死线倒计时中)
  -- pending   : 已付首笔真钱,30 天 clawback hold 中
  -- qualified : hold 期满,计入「3 人进度」
  -- expired   : 超过转化死线仍未付费
  -- revoked   : 退款 / 拒付 / 风控拒绝
  status            TEXT NOT NULL DEFAULT 'attached',

  attached_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,   -- = attached_at + 180 天(转化死线)
  first_paid_at     TIMESTAMPTZ,
  first_invoice_id  TEXT,                   -- 幂等:同一张发票重放不会重复触发
  qualified_at      TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  revoked_reason    TEXT,

  attach_ip         TEXT,
  risk_flags        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- ['same_ip','same_card_fingerprint',...]

  -- 被推荐人的首月折扣券只能用一次(checkout 时读这个,成功后置 true)
  discount_applied  BOOLEAN NOT NULL DEFAULT false,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 不能推自己(服务层还会按 email/user_id 再查一道,这里是最后兜底)
  CONSTRAINT lt_ref_attr_no_self CHECK (referrer_agent_id <> referee_agent_id),
  CONSTRAINT lt_ref_attr_status CHECK (
    status IN ('attached','pending','qualified','expired','revoked')
  )
);

-- 🔒 一个新经纪**只能被归因一次** —— 这就是「注册后永久锁定」的物理保证。
-- last-click 只在 cookie 阶段生效;一旦落到这张表,后续任何人的链接都抢不走。
CREATE UNIQUE INDEX IF NOT EXISTS idx_lt_ref_attr_referee
  ON lt_referral_attributions (referee_agent_id);

CREATE INDEX IF NOT EXISTS idx_lt_ref_attr_referrer
  ON lt_referral_attributions (referrer_agent_id, status);

-- sweep 的两个扫描谓词
CREATE INDEX IF NOT EXISTS idx_lt_ref_attr_expiring
  ON lt_referral_attributions (expires_at) WHERE status = 'attached';
CREATE INDEX IF NOT EXISTS idx_lt_ref_attr_holding
  ON lt_referral_attributions (first_paid_at) WHERE status = 'pending';


-- ── 3. 奖励:发了什么 ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lt_referral_rewards (
  id                    BIGSERIAL PRIMARY KEY,
  agent_id              UUID NOT NULL REFERENCES lt_agents(id) ON DELETE CASCADE,

  -- floor(qualified_count / 3) 的第几档。UNIQUE(agent_id, milestone_index) 是
  -- **防重复发奖的唯一防线**:并发 webhook/sweep 同时算出「第 2 档达标」,只有一个能插进去。
  milestone_index       INT  NOT NULL,

  kind                  TEXT NOT NULL DEFAULT 'free_month',  -- 预留 'cash_commission'

  -- ⚠️ 金额**在 apply 那一刻**从 Stripe 的实际订阅价现算(月付=unit_amount,
  -- 年付=unit_amount/12),不在达标时从 DB 猜:①币种绝对正确 ②堵死「年付用户
  -- 拿月付牌价」的套利。达标但还没订阅的人 → 金额为 NULL,等 flush 时填。
  amount_cents          INT,
  currency              TEXT,

  -- pending : 已达标,等推荐人有 stripe_customer_id + 活跃订阅才能落账
  -- applied : 已打进 Stripe customer balance(下张发票自动抵扣)
  -- failed  : Stripe 调用失败,等 sweep 重试
  -- blocked : 触发发放速率上限,转人工
  status                TEXT NOT NULL DEFAULT 'pending',

  stripe_balance_txn_id TEXT,
  attribution_ids       BIGINT[] NOT NULL DEFAULT '{}',  -- 这一档是哪 3 个人凑的(可回溯)

  attempts              INT NOT NULL DEFAULT 0,
  last_error            TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at            TIMESTAMPTZ,

  CONSTRAINT lt_ref_reward_status CHECK (status IN ('pending','applied','failed','blocked')),
  CONSTRAINT lt_ref_reward_once UNIQUE (agent_id, milestone_index)
);

CREATE INDEX IF NOT EXISTS idx_lt_ref_reward_agent
  ON lt_referral_rewards (agent_id, created_at DESC);

-- sweep 捡未落账的(pending/failed)
CREATE INDEX IF NOT EXISTS idx_lt_ref_reward_unapplied
  ON lt_referral_rewards (status) WHERE status IN ('pending','failed');
