-- 派单改成**真正的轮次制**(owner 2026-08-09)
--
-- owner 原话:「轮流轮班哦,假如 32 个全都拿到 lead 了就自动轮到新的一轮。
--             不过不能每天 24 小时 reset —— 假如每天只有 10 个客户,
--             那后面的经纪就永远收不到 email」。
--
-- 他说的是对的,原设计有两个洞:
--
-- ① **时间口径不等于轮次**。原来是「最近 30 天被分配次数最少的优先」。
--    这看着像轮换,但任何带时间窗的东西都会在窗口滚动时把计数抹掉,
--    轮次却不该被日历切开 —— 一轮就是一轮,发完 32 个人才算一轮。
--
-- ② **原来按「被分配」计数,不是按「真收到 lead」计数**。买家点开卡片看了一眼
--    就走(没提交需求),那个经纪的名额已经用掉了 —— 他**从没收到过邮件**,
--    却已经排到队尾。10 个买家里只有 3 个真提交的话,后面的人真的永远轮不到。
--    所以轮次要在**买家真的提交**(revealed)那一刻才消耗。
--
-- 规则:
--   · round_no 只在 reveal 时写(= 真 lead)。只被分配没提交的行,round_no 是 NULL。
--   · 当前轮 = MAX(round_no)。
--   · 挑人时**只从「本轮还没拿过 lead」的人里挑**;都拿过了 → 自动进下一轮。
--   · **没有任何时间成分** —— 每天来 1 个买家还是 100 个,轮次都照样一个一个走完。

ALTER TABLE agent_match_assignments
  ADD COLUMN IF NOT EXISTS round_no INTEGER;

-- 挑人时要查「这个经纪本轮拿过没」
CREATE INDEX IF NOT EXISTS idx_agent_match_round
  ON agent_match_assignments (round_no, agent_id)
  WHERE round_no IS NOT NULL;

-- 回填:已经发出去的真 lead 都算第 1 轮
UPDATE agent_match_assignments
   SET round_no = 1
 WHERE revealed_at IS NOT NULL AND round_no IS NULL;

COMMENT ON COLUMN agent_match_assignments.round_no IS
  '第几轮。**只在 reveal(买家真提交)时写** —— 只看了卡片不算,否则经纪会在没收到任何邮件的情况下被排到队尾。NULL = 还没成为真 lead。';
