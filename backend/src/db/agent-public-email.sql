-- 经纪名片公开邮箱(2026-07-07):显示在 Sales Offer / 品牌报告落款上。
-- 单开一列:lt_agents.email 是登录身份键(按 lower(email) 反查),绝不能改;
-- public_email 是经纪自己想展示给客户的联系邮箱,可空(空 = 不显示)。
ALTER TABLE lt_agents
  ADD COLUMN IF NOT EXISTS public_email text;
