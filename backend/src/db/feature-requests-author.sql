-- 功能建议:公开署名(owner 2026-08-08 决定)
--
-- 原设计是全站匿名。改成公开署名之后,有两件事必须一起做,少一件都会变成"背着人
-- 公开了他的名字":
--
--   1. 发帖界面**必须先告诉他会署名**(前端 ComposeModal 已加提示,显示的就是这里
--      存的 author_name)。
--   2. **已经存在的帖子不能追溯署名** —— 它们是在页面明写"匿名"的前提下提交的。
--      下面把存量行一律标成 is_anonymous,新帖默认署名。
--
-- 为什么把名字**快照**进这张表,而不是查询时 JOIN lt_agents:
--   人会改 display_name。发帖时用的是哪个名字,公开页面上就该一直是哪个名字 ——
--   JOIN 的话,改一次名会把历史帖子的署名全部改写(包括别人引用过的)。
--   快照还顺带省掉列表页的 N+1。
--
-- 匿名承诺剩下的部分**没有变**:user_email 依旧只走 publicShape()/commentShape(),
-- 公开返回里永远不出现;只有 owner/admin 能看到 author_email。

ALTER TABLE feature_requests
  ADD COLUMN IF NOT EXISTS author_name  TEXT,
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE feature_request_comments
  ADD COLUMN IF NOT EXISTS author_name  TEXT,
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT false;

-- 存量行:一律匿名(它们是在"匿名"承诺下提交的)。
-- ⚠️ 这句是**一次性**的,靠 author_name IS NULL 认存量 —— 新帖写入时一定带
--    author_name,所以重复执行这个文件不会把新帖也变匿名。
UPDATE feature_requests         SET is_anonymous = true WHERE author_name IS NULL;
UPDATE feature_request_comments SET is_anonymous = true WHERE author_name IS NULL;

COMMENT ON COLUMN feature_requests.author_name IS
  '发帖时的显示名快照(lt_agents.display_name)。is_anonymous=true 时不对外返回。';
COMMENT ON COLUMN feature_requests.is_anonymous IS
  'true=公开页面显示"匿名"。2026-08-08 之前的存量行全是 true(当时承诺了匿名)。';
