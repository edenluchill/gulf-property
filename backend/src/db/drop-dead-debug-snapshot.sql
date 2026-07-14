-- 删死列:pdf_processing_tasks.debug_snapshot(2026-07-13 大扫除)
--
-- 证据(每条都验证过,不是猜):
--   · 写它的 taskManager.updateDebugSnapshot() —— **全代码库零调用**
--   · 列里 **0 行数据**
--   · admin-tasks 读它 → 永远返回 null → 前端根本不用
--
-- ⚠️ 对比:同一批加进来的 processing_logs 列是**活的**(logToDB 有 6 处调用,
--    33 个任务里有日志)。别顺手把它一起删了。

ALTER TABLE pdf_processing_tasks DROP COLUMN IF EXISTS debug_snapshot;
