-- 客户报告可选测算口径:经纪生成报告时选定的户型 + 价格。
-- 报告页(/r/:code)的 5 年投资测算按 unit_price 计算(否则回退项目起售价)。
ALTER TABLE lt_project_reports ADD COLUMN IF NOT EXISTS unit_type  text;
ALTER TABLE lt_project_reports ADD COLUMN IF NOT EXISTS unit_price numeric;
