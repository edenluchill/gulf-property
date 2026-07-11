-- ===========================================================================
-- 开发商验证 + 加长试用 (2026-07-11)
--
-- 策略(合伙人提):先把开发商喂饱 —— 他们提供的是**供给**(楼盘/户型/付款计划),
-- 那是买家和经纪来这儿的理由。7 天对一个要走内部流程、整理楼书的开发商太短。
--
-- 但 /choose-role 上人人都能点「我是开发商」→ 若开发商 30 天而经纪 7 天,
-- 所有经纪都会去点开发商。所以:
--   自助开试用   = 7 天 / 200 分(所有角色一样,含开发商)
--   开发商验证后 = 30 天 / 600 分(owner 在 admin 一键批)
-- ===========================================================================

-- 1) 试用参数落到订阅行上(而不是写死在代码里):不同试用可以有不同的积分池。
--    NULL = 用代码里的默认值(credits.ts TRIAL_CREDITS=200)。
ALTER TABLE lt_subscriptions ADD COLUMN IF NOT EXISTS trial_credits int;

-- 2) 开发商验证申请。
CREATE TABLE IF NOT EXISTS developer_verifications (
  id          bigserial PRIMARY KEY,
  agent_id    uuid NOT NULL,
  user_id     uuid,                   -- Supabase auth id;审批通过要按它 upsert
                                      -- user_profiles.role='developer'(can-upload 的前提)
  email       text NOT NULL,
  company     text NOT NULL,          -- 开发商公司名
  website     text,                   -- 官网/项目页(核实用)
  note        text,                   -- 申请人补充说明
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by  text,
  decided_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- 一个 agent 只留一条申请(重复提交 = 更新那条)
CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_verif_agent ON developer_verifications (agent_id);
CREATE INDEX IF NOT EXISTS idx_dev_verif_status ON developer_verifications (status, created_at DESC);

-- 3) 已验证开发商的戳(审批通过时打)。
ALTER TABLE lt_agents ADD COLUMN IF NOT EXISTS developer_verified_at timestamptz;
