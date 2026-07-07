-- Sales Offer 自定义付款周期(2026-07-07):付款计划可谈——经纪在生成弹窗里
-- 导入项目默认计划后可加/减期数、调比例/时间;调整过的以快照落在分享行上
-- (行 = [{name, pct, date}]),不改项目本身;NULL = 用项目默认计划。
ALTER TABLE lt_payment_shares
  ADD COLUMN IF NOT EXISTS plan_snapshot jsonb;
