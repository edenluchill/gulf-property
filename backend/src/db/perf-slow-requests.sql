-- 慢请求全量留证 —— 让延迟告警可被追根因
--
-- 2026-07-12 发现的监控盲区:告警说「p95 8673ms」,但**查不出是哪个请求**。
--   • api_calls 是采样表,且 GET 只记 BUSINESS_READ 白名单(项目详情/market/compare)
--     → 地图首屏那几个最重的接口(/api/dubai/areas、map-pins、dubai-pois)一条都不记;
--     那个窗口里 api_calls 最慢的只有 53ms,真正的 8.6s 根本没进表。
--   • morgan 日志随容器重启蒸发(排查时已经没了)。
--   • perfMetrics 里「>10s 留名」的诊断埋点,阈值 10 秒 → 8.6 秒正好漏过。
--
-- 结论:过去每条延迟告警都注定查不出根因——不是没人查,是证据压根没留下。
-- 和 5xx 事故同一个病:证据被采样和滚动日志丢掉了。
--
-- 这张表全量记录每个超过 PERF_SLOW_REQ_MS(默认 1000ms)的请求,带现场
-- (真实 URL / 谁 / 状态码),并在 HIGH_LATENCY 告警里直接点名最慢的那几个。

CREATE TABLE IF NOT EXISTS perf_slow_requests (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  endpoint    text NOT NULL,          -- 路由模板 "GET /api/dubai/areas"
  url         text,                   -- 真实 originalUrl(带 query,可复现)
  status      integer,
  duration_ms integer NOT NULL,
  who         text,                   -- email / visitor_id / null
  aborted     boolean DEFAULT false   -- 客户端提前放弃(浏览器等不及了)
);

CREATE INDEX IF NOT EXISTS idx_perf_slow_at ON perf_slow_requests (at DESC);
CREATE INDEX IF NOT EXISTS idx_perf_slow_endpoint ON perf_slow_requests (endpoint, at DESC);
