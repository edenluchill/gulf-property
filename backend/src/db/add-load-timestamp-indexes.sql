-- add-load-timestamp-indexes.sql
--
-- WHY(2026-07-15):/api/meta/data-freshness 每次缓存 miss 要 4.5 秒,是当时最频繁又最慢
-- 的接口(3天内 19 次、每次 ~4.3s)。EXPLAIN 显示 `max(load_timestamp)` 在两张表上退化成
-- Parallel Seq Scan —— dld_rent_contracts(4.7GB)一次从磁盘读 ~3GB → 4.1s。
-- 同一条查询也被 telemetry/dataFreshness.ts 每 15 分钟跑一次(后台饿死前台的元凶之一)。
--
-- `max(col)` 只要有 btree 索引就能走 index-only backward scan(亚毫秒)。加上后
-- 整条 freshness 查询 4479ms → 0.7ms。
--
-- ⚠️ 已用 CREATE INDEX CONCURRENTLY 直接在生产库建好(不锁表)。此文件仅作存档/可复现。
-- CONCURRENTLY 不能在事务里跑,所以别用 db-runner(它把整个文件当一个隐式事务);
-- 要重放请逐条用 db-query.ts 跑。

CREATE INDEX CONCURRENTLY IF NOT EXISTS dld_rent_contracts_load_ts_idx
  ON dld_rent_contracts (load_timestamp DESC NULLS LAST);

CREATE INDEX CONCURRENTLY IF NOT EXISTS dld_transactions_load_ts_idx
  ON dld_transactions (load_timestamp DESC NULLS LAST);
