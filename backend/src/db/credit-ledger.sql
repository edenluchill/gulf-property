-- ===========================================================================
-- 逐笔积分流水(credit ledger) — 2026-07-10
--
-- 背景:原来 credits.ts 的 spend() 只累加 lt_usage_counters.credits_used 月度
-- 聚合值,没有逐笔明细 → 经纪看不到"用了什么/几点/扣多少积分"。此表补上明细。
--
-- 两个 agent id 刻意分开:
--   agent_id       = 计费归属(Founder 席位成员解析到 founder 头上 → 共享池)
--   actor_agent_id = 实际操作人(席位成员时 ≠ agent_id)
-- 展示规则(2026-07-10 用户定):
--   席位成员 → 只看自己(WHERE actor_agent_id = 我)
--   团队 admin/owner(billing_agent_id IS NULL 且有成员)→ 看整个团队(WHERE agent_id = 我),带操作人名字
--
-- 历史不可回填:只从本表上线时刻起记录。
-- ===========================================================================

CREATE TABLE IF NOT EXISTS lt_credit_ledger (
  id             BIGSERIAL PRIMARY KEY,
  agent_id       uuid NOT NULL,             -- 计费归属(founder 池 or 自己)
  actor_agent_id uuid NOT NULL,             -- 实际操作人
  feature        text NOT NULL,             -- reports | brochures | live_tours | luna_tours | payplan | ...
  credits        integer NOT NULL,          -- 本次实扣(含 Founder 折扣;owner/无限记 0)
  ref_type       text,                      -- payplan | project_report | client_report | tour | live | brochure
  ref_id         text,                      -- share_code / session id,可点回原件
  ref_label      text,                      -- 展示用(项目名/客户名/户型名)
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_agent_time ON lt_credit_ledger (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_actor_time ON lt_credit_ledger (actor_agent_id, created_at DESC);
