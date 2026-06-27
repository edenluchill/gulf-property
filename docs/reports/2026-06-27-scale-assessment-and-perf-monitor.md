# 容量评估 + 性能监控埋点方案（2026-06-27）

## 1. 背景

用户问题：1 万 / 10 万 / 100 万客户同时试用（尤其是地图），现有服务器能否 handle？能否记录 query 速度 / failure，到达临界点提醒？是否应该「后面再做 scale」？

结论：**监控先行、真扩容靠数据**。本轮只实现监控埋点（告警走 Admin 后台红条 + 邮件），暂不做限流/gzip/缓存/水平扩展。

## 2. 架构现状（实测）

| 层 | 现状 | 扩展性 |
|---|---|---|
| 前端静态站 | Cloudflare Pages | 无限 |
| 地图瓦片 | MapTiler / ArcGIS / CARTO / OSM（第三方 CDN） | 不占自有服务器；MapTiler 免费 key 有调用上限（成本/限流风险） |
| 区域/地标 geojson | 前端 `localStorage` 缓存（`MapPage.tsx`，回访不再拉） | 老用户近零负载 |
| **API 服务器** | **单容器 cpx11，1.8 vCPU / 1.5GB，单 Node 进程（无 cluster）** | **瓶颈** |
| **数据库** | 单台外部 Postgres，`pool.max = 50`，重聚合接口（`market.ts` 等）无缓存 | **瓶颈** |
| 限流 | `API_RATE_LIMIT_*` env 变量存在但**代码未使用**（`index.ts:86` 明确 disabled） | 风险 |

关键区分：**「试用用户数」≠「每秒请求数 RPS」**。地图首屏拉 areas+landmarks+pois geojson + 重接口；老用户走 localStorage 缓存几乎零负载。

## 3. 容量判断（诚实版）

- **1 万（分散浏览）**：大概率能撑，但无余量；同一时刻集中涌入（营销推送）→ 冷加载 + 无缓存重接口会让单进程排队、DB CPU 打满 → 部分超时。
- **1 万同时在线峰值**：当前配置危险，会有零星 502 / 超时。
- **10 万**：不行。需水平扩展（LB 已有，加 2–4 个 API 实例）+ 重接口缓存 + DB 读副本。
- **100 万**：需正经架构（多实例自动扩容 + Redis 缓存 + CDN 缓存 API 响应 + pgbouncer + DB 读写分离）。

## 4. 几乎免费的瓶颈（本轮不做，列为后续）

1. 加限流（`express-rate-limit`，env 变量已在）。
2. 开 gzip 压缩（`compression`）。
3. 重读接口加短缓存（内存 30–60s 或 `Cache-Control` 让 Cloudflare 兜）。
4. Node cluster / 多实例。

## 5. 本轮交付：性能监控埋点

### 5.1 设计原则
- **每请求零 DB 写**：全部在 Node 进程内存里聚合（按秒分桶，滚动 300s）。
- 每分钟只落 1 行滚动汇总（`perf_minute`，1440 行/天，可忽略）。
- 仅「告警事件」落 `perf_alerts` 并发邮件。
- 遥测绝不阻断请求路径（仿 `eventIngest.ts` 的 fail-safe）。

### 5.2 采集
- 中间件 `middleware/perfMetrics.ts`：每请求记录 路径/耗时/状态码/是否慢请求，并维护当前并发数。
- `db/pool.ts`：包裹 `pool.query` 计时，统计慢查询（>`PERF_SLOW_QUERY_MS`）。
- `services/perfSink.ts`：无依赖的内存按秒分桶（解决 pool ↔ monitor 循环依赖），提供 `window(seconds)` 聚合 p50/p95/p99、RPS、错误率、慢请求、慢查询。

### 5.3 汇总 + 告警（`services/perfMonitor.ts`，每 60s tick）
- 把 60s 窗口写入 `perf_minute`。
- 在 180s 窗口上评估规则；状态机：无 active → breach 则 INSERT alert + 发邮件；恢复则 `resolved_at = now()` + 发恢复邮件（天然去抖，不刷屏）。

| 规则 | 默认阈值（env 可调） | 说明 |
|---|---|---|
| `HIGH_LATENCY` | p95(3min) > `PERF_P95_MS`=2000 | 接口整体变慢 |
| `HIGH_ERROR_RATE` | 5xx 率(3min) > `PERF_ERR_PCT`=5%（样本≥30） | 后端在报错 |
| `SLOW_QUERIES` | 慢查询(3min) > `PERF_SLOWQ_3MIN`=60 | DB 是瓶颈 |
| `DB_POOL_SATURATION` | `pool.waitingCount` ≥ `PERF_POOL_WAIT`=1 | 连接池被打满，请求在排队 |

阈值常量：`PERF_SLOW_REQ_MS`=1000、`PERF_SLOW_QUERY_MS`=500。

### 5.4 告警通道
- **Admin 后台红条**：dashboard 顶部（tabs 上方）出现 active alert 时显示红条；新「性能」tab 显示实时 KPI + p95/RPS 趋势 + 慢接口 + 告警历史。
- **邮件**：`services/notify.ts` 走 Resend HTTP API（`RESEND_API_KEY` + `ALERT_EMAIL`，默认收件人 owner）。**未配置 key 时优雅降级**：只走红条 + `console.warn`，不阻断部署。

### 5.5 表
```sql
perf_minute(minute timestamptz pk, req int, err4 int, err5 int, slow_req int,
            query_count int, slow_query int, p50 int, p95 int, p99 int, max_ms int,
            peak_concurrency int, pool_total int, pool_waiting int)
perf_alerts(id bigserial pk, created_at timestamptz, resolved_at timestamptz null,
            kind text, severity text, metric numeric, threshold numeric,
            window_s int, message text, emailed bool)
```

### 5.6 接口（挂在 `/api/admin/analytics`，owner 鉴权复用）
- `GET /perf` → `{ live, rollups[], alerts[] }`（live=内存快照，rollups=近 N 分钟，alerts=近况）
- `GET /perf/alerts/active` → 红条用，轻量
- `POST /perf/alerts/:id/ack` → 手动标记已解决

### 5.7 部署须知
- 新表：跑 `backend/src/db/perf-monitor-tables.sql`（直连生产库）。
- 新 env（加进服务器 `/opt/pinzos/.env` 和 compose 映射，见记忆 stripe-billing 坑）：`RESEND_API_KEY`、`ALERT_EMAIL`、可选 `PERF_*` 阈值。
- 发信缺 key 也能跑（只少邮件）。
- 改后端 → 跑 `backend/quick-deploy.ps1`。

## 6. 后续（数据说话后再做）
监控跑 1–2 周拿到真实 p95 / 峰值 RPS / 连接池占用后，再按 §4 顺序逐项做：限流 → gzip → 重接口缓存 → 加 API 实例（LB 已就绪）→ DB 读副本。
