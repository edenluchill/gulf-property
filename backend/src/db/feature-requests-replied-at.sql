-- 官方回复要显示日期(owner 2026-08-08)
--
-- 为什么**不能**直接用 updated_at:
--   那一列被 PATCH 里的每一件事刷新 —— 改状态、翻受众都会动它。用它当回复日期,
--   意味着你半年后把一条建议从「计划中」点成「已上线」,页面上那条回复的日期就跟着
--   跳到今天,看起来像我们刚回的。日期一旦不可信,它比不显示更糟。
--
-- 所以单独一列,只在 reply 内容**真的变了**的时候才写(见 routes/feature-requests.ts
-- 的 PATCH:replied_at 用 CASE 判断新旧 reply 是否不同)。

ALTER TABLE feature_requests
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;

-- 回填:已经有回复但没有时间戳的,拿 updated_at 顶上。
-- 目前只有 #10 一条,它的 reply 和 updated_at 是同一次写入,所以这个回填是准的。
UPDATE feature_requests
   SET replied_at = updated_at
 WHERE reply IS NOT NULL AND reply <> '' AND replied_at IS NULL;

COMMENT ON COLUMN feature_requests.replied_at IS
  '官方回复的写入时间。只在 reply 内容变化时更新 —— 别用 updated_at,那个会被改状态/受众刷新。';
