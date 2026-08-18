-- ===========================================================================
-- 取消经纪台准入排队 (2026-08-17)
--
-- 背景:agents 表的 pending 行**不是任何人申请出来的** —— routes/agents.ts 的
-- GET /me 会给每一个点进 /agent/* 的登录用户自动插一行 'pending',包括误点进来
-- 的买家。owner 后台因此长出一个无法判断、也无需判断的队列;用户那边撞到一堵
-- 「审核中」的墙。而这道门本来就是假的:开个免费试用下次就 auto:subscription 放行。
--
-- 代码侧已改为默认 'approved'(decided_by='auto:open')。这里清掉存量 pending,
-- 否则这批人要等到下次访问才会被升级、后台的「待审批」区会一直挂着他们。
--
-- ⚠️ 'rejected' 一行不动 —— 那是 owner 主动封的人,是真决策。
-- ===========================================================================
UPDATE agents
   SET status = 'approved', decided_at = now(), decided_by = 'auto:open'
 WHERE status = 'pending';

SELECT status, count(*) FROM agents GROUP BY status ORDER BY 1;
