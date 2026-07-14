-- ============================================================================
-- /api/ai/analytics/investment 慢查询修复(2026-07-14)
--
-- 现象:owner 在 admin「性能负载」上看到 GET /api/ai/analytics/investment
--       5.5s / 7.8s / 9.0s / 5.8s(真实客户 graceww1110 / shelldubai26 / joe.liang)。
--
-- ⚠️ 先说一件事:这个接口**根本不调 AI**(ai-analytics.ts 里零个 Gemini 调用,
--    路径里的 `ai` 只是「给 Luna 用的数据接口」的命名习惯)。它是 100% 纯 SQL ——
--    一个 plpgsql 函数 area_investment_report()。所以 5–9 秒**就是慢查询,没有借口**。
--
-- 实测(Dubai Marina / apartment):3553 ms,碰了 **240 万个 buffer ≈ 18 GB**。
-- 拆开看,时间花在两处:
--
--   ① 全城中位数对比(函数第 102 行,v_city_sqm)—— **340 ms,Parallel Seq Scan 整张
--      dld_transactions**。注意是 *Parallel* —— **Hetzner 图上那个 CPU 150% 就是它**
--      (PG 开多个 worker 一起扫,单查询就能吃满多核)。
--      而这个数**跟查哪个区完全无关**,只取决于 (ptype, 口径),却每次请求重算一遍。
--
--   ② 租金中位数(第 80 行,v_rent)—— **1268 ms**,走的是 start_date 索引,
--      等于把**全迪拜近 2 年的租约**捞出来再逐行过滤区域。
--      为什么不走区域索引?两个原因叠加:
--        · v_rent 里写的是 `COALESCE(r.dubai_area_id, dla.dubai_area_id)` ——
--          **COALESCE 谓词匹配不上任何裸列索引**(老坑,见 area-insights-slow-query-indexes)
--        · 我 2026-07-13 建的 idx_rent_area_id_resid 是 `WHERE usage_type='Residential'`
--          的**部分索引**,而 v_rent 根本没有 usage_type 谓词 → 规划器**不敢用**它
--
-- 修法对应两处。
-- 应用:cd backend && npx ts-node scripts/db-runner.ts src/db/fix-investment-report-slow.sql
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- ① 把 COALESCE 的成因消灭掉:回填 dubai_area_id
--
-- 现状:559.7 万行里 542.7 万行**本来就直接带 dubai_area_id**,只有 17.06 万行(3%)
--       是 NULL 要靠 JOIN dld_areas 兜底。
--       **为了这 3% 的兜底,整张 4.7 GB 表的区域索引全废了。**
-- 那就把这 3% 填上,COALESCE 就是纯累赘了。
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE dld_rent_contracts r
   SET dubai_area_id = dla.dubai_area_id
  FROM dld_areas dla
 WHERE dla.area_id = r.area_id
   AND r.dubai_area_id IS NULL
   AND dla.dubai_area_id IS NOT NULL;

-- ⚠️ 每日 data.dubai 同步会插入新行,新行可能又是 NULL。
--    所以**同一条回填已经写进 scripts/refresh-derived.ts**(每日同步后自动跑),
--    否则这个修复会随着时间慢慢烂掉 —— 视图不再有 COALESCE 兜底,
--    没回填的新行会**从区域查询里静默消失**。两者必须成对存在。


-- ─────────────────────────────────────────────────────────────────────────────
-- ② v_rent:去掉 COALESCE(现在它已无必要),让谓词落到裸列上 → 索引可用
--    列名/类型不变,CREATE OR REPLACE 安全(下游 mv_area_net_yield 等不受影响)。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_rent AS
SELECT r.contract_id,
       r.dubai_area_id,              -- ← 原为 COALESCE(r.dubai_area_id, dla.dubai_area_id)
       r.area_id,
       r.area_name,
       CASE
         WHEN r.property_type::text = ANY (ARRAY['Flat','Studio ','Studio','Hotel apartments']) THEN 'apartment'
         WHEN r.property_type::text = ANY (ARRAY['Villa','Complex Villas']) THEN 'villa'
         ELSE lower(r.property_type::text)
       END AS ptype,
       r.property_area AS size_sqm,
       CASE
         WHEN r.property_area IS NULL       THEN NULL::text
         WHEN r.property_area < 50          THEN 'XS'
         WHEN r.property_area < 100         THEN 'S'
         WHEN r.property_area < 200         THEN 'M'
         WHEN r.property_area < 400         THEN 'L'
         ELSE 'XL'
       END AS size_band,
       r.annual_amount AS annual_rent,
       r.annual_amount / NULLIF(r.property_area, 0) AS rent_sqm,
       r.start_date
  FROM dld_rent_contracts r
 WHERE r.property_type::text = ANY (ARRAY['Flat','Studio ','Studio','Hotel apartments','Villa','Complex Villas'])
   AND r.property_area >= 20
   AND r.annual_amount > 0
   AND r.annual_amount <= 500000
   AND (r.annual_amount / NULLIF(r.property_area, 0)) <= 3000
   AND r.start_date <= CURRENT_DATE
   AND r.start_date >= '2000-01-01'::date;

-- 配套索引:**不是部分索引**(v_rent 没有 usage_type 谓词,部分索引用不上 —— 这正是
-- 上一版 idx_rent_area_id_resid 白建的原因)。INCLUDE 让它能走 Index Only Scan。
--
-- ⚠️ 索引**不在这个文件里** —— CREATE INDEX CONCURRENTLY 不能跑在事务块里,
--    而 db-runner.ts 会把整个文件包进一个事务(报 25001 PreventInTransactionBlock,
--    且**整个文件回滚**)。所以它单独跑:
--
--      npx ts-node scripts/db-query.ts "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rent_dubai_area_start
--        ON dld_rent_contracts (dubai_area_id, start_date DESC)
--        INCLUDE (property_type, property_area, annual_amount)"
--
--    (用 CONCURRENTLY 是因为这是 4.7GB 的线上表 —— 普通 CREATE INDEX 会写锁它几分钟,
--     期间所有租金查询卡死。)


-- ─────────────────────────────────────────────────────────────────────────────
-- ③ 全城基线 → 物化视图(把每次请求的 Parallel Seq Scan 变成一次主键查找)
--
-- 口径必须和函数第 102–104 行**逐字对齐**:ptype + 口径(all/offplan/ready) + 近 12 个月。
-- CURRENT_DATE 在 MV 里是**刷新那一刻**冻结的 —— 每日刷新,对"全城中位数"这种
-- 慢变量完全够用(它一天都动不了 0.1%)。
-- ─────────────────────────────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS mv_city_baseline;
CREATE MATERIALIZED VIEW mv_city_baseline AS
  -- seg='all':不分期房/现房(对应 v_off IS NULL)
  SELECT ptype,
         'all'::text AS seg,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY price_sqm) AS city_sqm,
         count(*) AS n
    FROM v_sales
   WHERE txn_date >= CURRENT_DATE - INTERVAL '12 months'
   GROUP BY ptype
  UNION ALL
  -- seg='offplan' / 'ready':对应 is_offplan = v_off
  SELECT ptype,
         CASE WHEN is_offplan THEN 'offplan' ELSE 'ready' END AS seg,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY price_sqm) AS city_sqm,
         count(*) AS n
    FROM v_sales
   WHERE txn_date >= CURRENT_DATE - INTERVAL '12 months'
     AND is_offplan IS NOT NULL
   GROUP BY ptype, 2;

-- REFRESH ... CONCURRENTLY 要求唯一索引(否则每次刷新会锁表,阻塞线上读)
CREATE UNIQUE INDEX IF NOT EXISTS mv_city_baseline_pk ON mv_city_baseline (ptype, seg);

ANALYZE mv_city_baseline;
ANALYZE dld_rent_contracts;
