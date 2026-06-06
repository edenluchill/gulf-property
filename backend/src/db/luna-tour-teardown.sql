-- ============================================================
-- Luna Tour — 一键拆除(把所有 lt_* 对象彻底删掉)
-- 用途:功能出问题或不想要了,跑这个就能把 Luna Tour 的数据库痕迹清干净,
--      不影响任何现有业务表。
-- 运行:cd backend && npx ts-node scripts/db-runner.ts src/db/luna-tour-teardown.sql
-- 注意:会删除 lt_* 所有数据,不可逆。
-- ============================================================

DROP MATERIALIZED VIEW IF EXISTS lt_session_lead_scores CASCADE;

DROP TABLE IF EXISTS lt_tour_script_versions CASCADE;
DROP TABLE IF EXISTS lt_edit_comments       CASCADE;
DROP TABLE IF EXISTS lt_usage_counters      CASCADE;
DROP TABLE IF EXISTS lt_subscriptions       CASCADE;
DROP TABLE IF EXISTS lt_subscription_plans  CASCADE;
DROP TABLE IF EXISTS lt_client_feedback     CASCADE;
DROP TABLE IF EXISTS lt_engagement_events   CASCADE;
DROP TABLE IF EXISTS lt_audio_assets        CASCADE;
DROP TABLE IF EXISTS lt_session_news_items  CASCADE;
DROP TABLE IF EXISTS lt_tour_scripts        CASCADE;
DROP TABLE IF EXISTS lt_session_properties  CASCADE;
DROP TABLE IF EXISTS lt_demo_sessions       CASCADE;
DROP TABLE IF EXISTS lt_demo_configs        CASCADE;
DROP TABLE IF EXISTS lt_clients             CASCADE;
DROP TABLE IF EXISTS lt_agents              CASCADE;
DROP TABLE IF EXISTS lt_brokerages          CASCADE;

-- 触发器函数(仅 Luna Tour 用,确认无其他依赖后删除)
DROP FUNCTION IF EXISTS lt_set_updated_at() CASCADE;

-- 说明:pgcrypto 扩展为共享资源,不在此删除。
