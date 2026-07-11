-- 告警语义修正:把"错误"从"状态"改成"事故(incident)"
--
-- 旧设计的病(2026-07-11 发现):
--   reconcileAlerts 把所有规则都当状态机,按 kind 一个 key,只要当前窗口
--   !breached 就 resolved_at = now()。对 5xx 而言 "!breached" 的真实含义是
--   "最近 3 分钟错误率掉回阈值以下" —— 在 3 请求/分钟的流量下,只要没人再点
--   那个坏接口,错误率自然归零,**bug 一行没改,告警自己关了**。
--   实例:2026-07-09 12:34 「5xx 5.1% (2/39)」自动"已恢复"。那 2 条 500 是
--   /api/billing/checkout 挂了,撞的是 admin@yesir.ai —— 一个正在付款的客户。
--
--   而且告警只按 kind 分组:billing/checkout 挂了和 voice/token 挂了会被合并成
--   同一条 HIGH_ERROR_RATE,看不出是哪个接口、哪个客户、什么错。
--
-- 新语义:
--   • signature —— 事故按 (接口模板, 状态码) 立案,各查各的根因,不再糊成一条。
--   • detail    —— 存现场:originalUrl / 受害客户 / 出现次数 / 首末次时间。
--   • API_5XX 类告警**永不自动恢复**,只能由人在 dashboard 上「标记已解决」
--     (= 已定位根因并修复)。资源型告警(连接池等)才保留自动恢复语义。

ALTER TABLE perf_alerts ADD COLUMN IF NOT EXISTS signature text;
ALTER TABLE perf_alerts ADD COLUMN IF NOT EXISTS detail jsonb;

-- 同一个 (kind, signature) 同时只允许一条未解决的事故 —— 重复命中累加 detail.count,
-- 不再刷屏。已解决的可以再次开案(修完又复发 = 新事故,应该重新报)。
CREATE UNIQUE INDEX IF NOT EXISTS uq_perf_alerts_open_signature
  ON perf_alerts (kind, signature)
  WHERE resolved_at IS NULL AND signature IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_perf_alerts_open
  ON perf_alerts (created_at DESC)
  WHERE resolved_at IS NULL;
