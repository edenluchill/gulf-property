-- 通用遥测表(2026-07-13)。所有 feature 共用一张 —— 加埋点不用建表。
--
-- 见 docs/telemetry-spec.md。为什么不复用 perf_minute:那张表的列是写死给 HTTP 的
-- (req/err5/p95/slow_query…),每来一个功能就加几列 → 越堆越脏。这张只认
-- 「名字 + label + 值」。

CREATE TABLE IF NOT EXISTS metrics_minute (
  minute  timestamptz      NOT NULL,               -- 分钟对齐
  name    text             NOT NULL,               -- 'collab.ws.connect'
  labels  jsonb            NOT NULL DEFAULT '{}',  -- 低基数枚举:{"reason":"room_not_found"}
  kind    text             NOT NULL,               -- counter | gauge | histogram
  count   bigint,                                  -- counter: 增量;histogram: 样本数
  value   double precision,                        -- gauge: 瞬时值
  sum     double precision,                        -- histogram
  min     double precision,
  max     double precision,
  p50     double precision,
  p95     double precision,
  PRIMARY KEY (minute, name, labels)
);

-- 查询模式全是「某个指标的最近 N 分钟」→ (name, minute) 复合。
CREATE INDEX IF NOT EXISTS idx_metrics_minute_name_time
  ON metrics_minute (name, minute DESC);

-- 保留期清理用(比 perf_minute 长:容量趋势要看长周期)。
CREATE INDEX IF NOT EXISTS idx_metrics_minute_time
  ON metrics_minute (minute);

ALTER TABLE metrics_minute DROP CONSTRAINT IF EXISTS metrics_minute_kind_check;
ALTER TABLE metrics_minute ADD CONSTRAINT metrics_minute_kind_check
  CHECK (kind IN ('counter', 'gauge', 'histogram'));
