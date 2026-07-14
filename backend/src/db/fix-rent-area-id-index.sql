-- 🔴 DB 磁盘读爆表的根因(2026-07-13)
--
-- 症状:DB 服务器 CPU 经常 150%、**磁盘读 300–400 MBps、15K IOPS**,
--      缓存命中率只有 88%(健康值 >99%),累计从磁盘读了 **50 TB**。
--
-- 根因:`dld_rent_contracts`(**4.7 GB / 530 万行**,占整个库 5.3GB 的 88%)
--      被**全表扫描 1741 次**。
--      项目详情页的 insights 查询按 **`area_id`** 过滤 ——
--      而这张表有 13 个索引,**唯独没有 area_id**(它有的是 `dubai_area_id`,
--      是另一个列;还有 `area_name`)。
--      对照组:`dld_transactions` **有** area_id 索引,所以它虽然被扫 15025 次,
--      但表只有 486MB,代价小得多。
--
-- 后果:/api/residential-projects/:id/insights **平均 3 秒、最慢 11.3 秒** ——
--      真实客户打开项目详情页要等 11 秒。而且每次全表扫 4.7GB,
--      把 shared_buffers(只有 512MB)整个冲掉 → 别的查询也跟着变慢。
--
-- 效果(实测,同一条生产查询):
--      Parallel Seq Scan  3,806 ms · 读 4.7 GB
--   →  Index Only Scan       45 ms · 读 17 MB     (磁盘读 ↓ ~270×)
--
-- INCLUDE 那几列 → Index Only Scan(连表都不用回),这是把 4.7GB 读降到 17MB 的关键。
-- CONCURRENTLY:生产库,**绝不能锁表**。

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rent_area_id_resid
  ON dld_rent_contracts (area_id, start_date DESC)
  INCLUDE (project_name, property_type, property_subtype, property_area,
           annual_amount, registration_type)
  WHERE usage_type = 'Residential';

-- 顺带:统计信息严重陈旧(29 万行改动没进统计)—— 规划器估错行数也会放弃索引。
-- autovacuum 对这么大的表默认阈值太松,已手动 ANALYZE。
ANALYZE dld_rent_contracts;
ANALYZE dld_transactions;
