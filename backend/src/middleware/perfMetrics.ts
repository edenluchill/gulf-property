/**
 * perfMetrics — per-request latency/status sampler. Feeds services/perfSink.
 *
 * Mounted early (before routes) in index.ts. Never touches the response; on
 * 'finish' it records duration + status + concurrency into the in-memory sink.
 * Fail-safe: any error here is swallowed so telemetry can't break a request.
 */
import { Request, Response, NextFunction } from 'express'
import { recordRequest, recordEndpoint, incConcurrency, decConcurrency } from '../services/perfSink'

// Health checks and the metrics endpoints themselves would skew the numbers.
const IGNORE = new Set(['/health'])

// 天生长连接的路径:大文件上传(几十秒-几分钟)和 SSE 进度流。它们的耗时是
// 设计如此,不是"慢"——混进 p95 会在低流量时把 HIGH_LATENCY 报警顶爆
// (2026-07-07 实锤:一条 142s 上传把 5 请求窗口的 p95 干到 142083ms 误报)。
// 仍计 req/错误率/并发,只是不进延迟分位样本。
const LONG_LIVED_PREFIXES = ['/api/upload', '/api/r2-upload', '/api/langgraph-progress']
function isLongLived(path: string): boolean {
  return LONG_LIVED_PREFIXES.some((p) => path.startsWith(p))
}

/**
 * Stable, low-cardinality key for the per-endpoint table. Prefer the matched
 * Express route template (baseUrl + route.path → "/api/residential-projects/:id",
 * which already collapses ids). Fall back to a heuristic that swaps id-like path
 * segments for ":id" so unmatched/404 paths don't explode cardinality.
 */
function endpointKey(req: Request): string {
  const routePath = (req.route && req.route.path) || ''
  if (routePath) {
    const tmpl = (req.baseUrl || '') + (routePath === '/' ? '' : routePath)
    return `${req.method} ${tmpl || '/'}`
  }
  const norm = req.path
    .split('/')
    .map((seg) =>
      /^\d+$/.test(seg) || /^[0-9a-f-]{16,}$/i.test(seg) ? ':id' : seg
    )
    .join('/')
  return `${req.method} ${norm || '/'}`
}

export function perfMetrics(req: Request, res: Response, next: NextFunction): void {
  if (IGNORE.has(req.path)) return next()

  const start = process.hrtime.bigint()
  let counted = false
  incConcurrency()

  const done = () => {
    if (counted) return
    counted = true
    try {
      decConcurrency()
      const ms = Number(process.hrtime.bigint() - start) / 1e6
      // 长连接不进全局延迟分位(报警口径);端点表仍记真实耗时(展示用,诚实)。
      recordRequest(res.statusCode, ms, isLongLived(req.path))
      recordEndpoint(endpointKey(req), res.statusCode, ms)
      // 诊断埋点(2026-07-08):p95 报警多次被 70-98s 的神秘请求触发,但 morgan 里
      // 无踪影(疑似 client-abort 只走 'close')。>10s 一律留名,让下一次自己招供。
      if (ms > 10_000) {
        console.log(`[perf] slow-request ${Math.round(ms)}ms ${req.method} ${String(req.originalUrl).slice(0, 140)} status=${res.statusCode} aborted=${!res.writableFinished}`)
      }
    } catch {
      /* telemetry must never throw into the request lifecycle */
    }
  }

  res.on('finish', done)
  res.on('close', done) // client aborted before finish
  next()
}
