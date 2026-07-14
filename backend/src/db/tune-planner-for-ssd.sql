-- PostgreSQL 规划器调参:告诉它自己跑在 NVMe SSD 上(2026-07-13)
--
-- 这些是 **database 级** 设置(ALTER DATABASE)—— 不需要 superuser、**不需要重启**,
-- 新连接立即生效。(我是 gulf_property 的 owner,所以能改。)
--
-- ⚠️ `random_page_cost = 4` 是 PostgreSQL 的**机械硬盘默认值** ——
--    它假设随机读比顺序读贵 4 倍。而 Hetzner 是 NVMe SSD,真实差距接近 1。
--    这个参数会让规划器**高估索引扫描的成本**,于是**宁可全表扫** ——
--    正是 dld_rent_contracts(4.7GB)被反复全表扫的帮凶。
--
-- effective_io_concurrency = 1 同理:那是**单盘机械硬盘**的假设。NVMe 能并发几百个 IO。
--
-- 实测(同一条查询,在缺失索引补上之后):
--    改参数前  758 ms
--    改参数后  390 ms      ← 又快一倍

ALTER DATABASE gulf_property SET random_page_cost = 1.1;          -- NVMe SSD(默认 4 = 机械盘)
ALTER DATABASE gulf_property SET effective_io_concurrency = 200;  -- NVMe 可并发(默认 1 = 单机械盘)
ALTER DATABASE gulf_property SET effective_cache_size = '6GB';    -- 机器 8GB;告诉规划器 OS 缓存有多大
ALTER DATABASE gulf_property SET work_mem = '16MB';               -- 默认 4MB,大排序会落盘(实际连接数只有个位数)

-- ❌ 改不了(需要重启 PG + root shell,DB 服务器的 SSH key 我这边没有):
--    shared_buffers = 512MB  → 建议 2GB(机器 8GB,数据 5.3GB)
--    它是 postmaster context,只能改 postgresql.conf + 重启。
--
--    不过在补上索引之后,**紧迫性已经大大降低** —— 实测 20 次 insights 请求的
--    磁盘读增量是 **0 block**(之前每次要读 4.7GB)。shared_buffers 小的主要危害
--    (被大表全表扫冲掉)已经消失。
