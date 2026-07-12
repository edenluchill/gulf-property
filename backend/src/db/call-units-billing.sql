-- ===========================================================================
-- 通话计费统一口径:语音 + 视频 合并成「通话额度」— 2026-07-12
--
-- 背景(三套并存的乱象 + 一个真实敞口):
--   • 实时带看(地图协作 WebSocket)—— 成本 $0(跑我们自己服务器),却收 60 积分/场
--   • 语音 —— 有真实成本,但额度按 **会话墙钟秒** 算(voice_sessions.duration_seconds),
--     **不乘人数**。而 Agora 是按 user-minute 计费的 → 6 人房间成本是 1 人的 6 倍,
--     额度消耗却一模一样。而且语音**一个积分都不扣**。
--     最坏:3h/天 × 6人 × 30天 = 32,400 user-min/月 = $32/月(vs $49 月费 → 毛利 35%)
--   • 视频 —— 按 viewer-minute 扣积分(这套是对的)
--
-- 新口径 = Agora 自己的 **Standard 分钟**(音频 1×,HD 视频 4× —— 正好是成本比):
--   语音 1 user-分钟   = 1 unit   ($0.00099)
--   视频 1 viewer-分钟 = 4 units  ($0.00396)
--   超额 1 积分        = 4 units  → 售价 $0.041/4units,成本 $0.00396 → 10× 加价
--
-- 巧合(好的):视频价格**完全不变**(1 viewer-min = 4 units = 1 积分),
-- 语音变成 4 user-min = 1 积分。
--
-- 带看本身改为 **免费不限场次**(2026-07-12 owner 定):成本是 0,收费没有依据,
-- 且限制它 = 限制核心价值主张。真正的封顶交给通话额度。
--
-- 详见 docs/collab-live-video-spec.md
-- ===========================================================================

-- 1) 套餐额度:video_minutes_month → call_units_month
--
-- 换算:原 300 视频分钟 = 300 × 4 = 1200 units(等价,不涨不跌)
--   agent     1200 units → 成本 $1.19  (2.4% of $49)
--                          = 1对1 语音 10 小时/月,或 300 分钟视频,或混合
--   founder   6000 units → 成本 $5.94  (0.85% of $699)
--   developer 2400 units → 成本 $2.38  (0.24% of $999)
--   rookie/explore 0 —— 无带看权限(minPlan=agent)
UPDATE lt_subscription_plans SET limits = (limits - 'video_minutes_month') || '{"call_units_month": 1200}'::jsonb WHERE id = 'agent';
UPDATE lt_subscription_plans SET limits = (limits - 'video_minutes_month') || '{"call_units_month": 6000}'::jsonb WHERE id = 'founder';
UPDATE lt_subscription_plans SET limits = (limits - 'video_minutes_month') || '{"call_units_month": 2400}'::jsonb WHERE id = 'developer';
UPDATE lt_subscription_plans SET limits = (limits - 'video_minutes_month') || '{"call_units_month": 0}'::jsonb    WHERE id IN ('rookie', 'explore');

-- 2) voice_sessions:语音也要按 **user-秒** 记(不是会话墙钟秒)
--
-- ⚠️ 这是敞口的根:duration_seconds 是会话时长,与人数无关。Agora 按人头收费。
--    audio_user_seconds = Σ(在场人数 × 时长),才是真实计费口径。
--    duration_seconds 保留(语音日额度/统计还在用),不动。
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS audio_user_seconds int NOT NULL DEFAULT 0;

COMMENT ON COLUMN voice_sessions.audio_user_seconds IS
  '音频 user-秒累计(在场人数 × 时长)。Agora 按 user-minute 计费,会话墙钟秒会严重低估多人房间的成本。';
COMMENT ON COLUMN voice_sessions.video_viewer_seconds IS
  '视频 viewer-秒累计(观看人数 × 时长)。1 viewer-分钟 = 4 units(HD 视频比音频贵 4 倍)。';
COMMENT ON COLUMN voice_sessions.video_credits_spent IS
  '本场已实扣的通话积分(语音+视频合计)。heartbeat 实时结算,此列保证崩溃/重放不重复扣。';

-- 3) 校验
SELECT id, price_usd_month,
       (limits->>'credits_month')::int   AS credits,
       (limits->>'call_units_month')::int AS call_units,
       limits ? 'video_minutes_month'     AS still_has_old_key
  FROM lt_subscription_plans ORDER BY (price_usd_month)::numeric;
