-- ===========================================================================
-- 带看视频(Agora 单向摄像头)计费 — 2026-07-12
--
-- 模型:套餐内含免费额度(Pro 300 viewer-min/月) + 超额 1 积分/viewer-minute。
-- 计量单位是 **viewer-minute**(观看视频的客户数 × 分钟),不是墙上时钟分钟 ——
-- Agora 按「订阅」计费,成本是按人头涨的(经纪推流不花钱,只有客户观看才计)。
--
-- 详见 docs/collab-live-video-spec.md
-- ===========================================================================

-- 1) 逐笔流水加 units 列(计量型功能的用量)
--
-- ⚠️ 必须有这列:免费额度内的行 credits = 0,若不单独记 viewer-minutes,
--    免费用量在账本上就是**隐形的** → 永远算不出「本月 300 分钟用掉多少」。
--    额度直接从本列回算,不再另建计数表。
ALTER TABLE lt_credit_ledger ADD COLUMN IF NOT EXISTS units integer;

COMMENT ON COLUMN lt_credit_ledger.units IS
  '计量型功能的用量(live_video = viewer-minutes)。免费额度内的行 credits=0 但 units>0。';

-- 按 (agent, feature, 时间) 查本月已用 viewer-minutes
CREATE INDEX IF NOT EXISTS idx_ledger_agent_feature_time
  ON lt_credit_ledger (agent_id, feature, created_at DESC);

-- 2) 语音会话表加视频用量列
--
-- video_viewer_seconds:heartbeat 每 30s 累加 (当前观看人数 × 30)
-- video_credits_spent :已实扣积分 —— heartbeat 实时结算,此列防重复扣
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS video_viewer_seconds int NOT NULL DEFAULT 0;
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS video_credits_spent  int NOT NULL DEFAULT 0;

COMMENT ON COLUMN voice_sessions.video_viewer_seconds IS
  '视频观看者-秒累计(观看人数 × 时长)。heartbeat 每 30s 累加。';
COMMENT ON COLUMN voice_sessions.video_credits_spent IS
  '本场已实扣的视频积分。heartbeat 实时结算,此列保证崩溃/重放不重复扣。';

-- 3) 各档套餐的免费视频额度(viewer-minutes / 月)
--
-- 成本核算(Agora HD $3.99/1000 viewer-min → $0.00399/viewer-min):
--   agent     300 → $1.20  (占 $49  月费的 2.4%)
--   founder  1500 → $5.99  (占 $699 月费的 0.9%)
--   developer 600 → $2.39  (占 $999 月费的 0.24%)
--   rookie/explore 0 —— live_tours 的 minPlan 就是 agent,本来就无带看权限
--
-- ⚠️ 免绑卡试用**不读这里**,走 credits.ts 的 TRIAL_VIDEO_MINUTES 独立常量(默认 30)。
--    试用行的 plan_id 可能就是 'agent' → 若读套餐会直接继承 300 分钟,
--    而试用是零收入 + 免绑卡(注册成本近乎为零)→ 100 个邮箱刷试用 = $200。
UPDATE lt_subscription_plans SET limits = limits || '{"video_minutes_month": 300}'::jsonb  WHERE id = 'agent';
UPDATE lt_subscription_plans SET limits = limits || '{"video_minutes_month": 1500}'::jsonb WHERE id = 'founder';
UPDATE lt_subscription_plans SET limits = limits || '{"video_minutes_month": 600}'::jsonb  WHERE id = 'developer';
UPDATE lt_subscription_plans SET limits = limits || '{"video_minutes_month": 0}'::jsonb    WHERE id IN ('rookie', 'explore');

-- 校验
SELECT id, price_usd_month, (limits->>'credits_month')::int AS credits,
       (limits->>'video_minutes_month')::int AS video_min
  FROM lt_subscription_plans ORDER BY (price_usd_month)::numeric;
