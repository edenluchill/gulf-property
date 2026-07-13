/**
 * perfMetrics — per-request latency/status sampler. Feeds services/perfSink.
 *
 * Mounted early (before routes) in index.ts. Never touches the response; on
 * 'finish' it records duration + status + concurrency into the in-memory sink.
 * Fail-safe: any error here is swallowed so telemetry can't break a request.
 */
import { Request, Response, NextFunction } from 'express'
import { recordRequest, recordEndpoint, recordError, recordSlow, SLOW_REQ_MS, incConcurrency, decConcurrency } from '../services/perfSink'

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

  // ⚠️ 必须在入口(app 级中间件、进任何子路由之前)算好长连接判断:进入挂载在
  // /api/r2-upload 的子路由时 Express 会临时把 req.url 剥成 /start,而 done() 跑在
  // 异步的 res.on('finish') 里——那时 req.path 可能已不是完整路径,前缀匹配失效,
  // 上传请求就漏回 p95 样本(2026-07-09 实测:一次 2665ms 上传顶爆 HIGH_LATENCY,
  // 排除逻辑明明已部署却没生效,根因即此)。这里锁定,done() 只读闭包变量。
  const longLived = isLongLived(req.path)

  const done = () => {
    if (counted) return
    counted = true
    try {
      decConcurrency()
      const ms = Number(process.hrtime.bigint() - start) / 1e6
      // 长连接不进全局延迟分位(报警口径);端点表仍记真实耗时(展示用,诚实)。
      const key = endpointKey(req)
      const who = req.ctx?.email || req.ctx?.visitorId || null
      recordRequest(res.statusCode, ms, longLived)
      recordEndpoint(key, res.statusCode, ms)
      // Every 5xx is captured whole — who ate it and on which URL. Unsampled:
      // this is the record that has to survive long enough to be root-caused.
      if (res.statusCode >= 500) {
        recordError(key, res.statusCode, String(req.originalUrl), who)
      }
      // Same for every slow request. Long-lived paths (uploads/SSE) are slow by
      // design and don't count toward p95, so they're excluded here too — this
      // records exactly the requests that can raise a HIGH_LATENCY alert, which
      // is what makes such an alert diagnosable at all.
      if (!longLived && ms >= SLOW_REQ_MS) {
        recordSlow({
          endpoint: key,
          url: String(req.originalUrl),
          status: res.statusCode,
          ms: Math.round(ms),
          who,
          aborted: !res.writableFinished,
        })
        console.log(`[perf] slow-request ${Math.round(ms)}ms ${key} ${String(req.originalUrl).slice(0, 140)} status=${res.statusCode} who=${who || '-'} aborted=${!res.writableFinished}`)
      }
    } catch {
      /* telemetry must never throw into the request lifecycle */
    }
  }

  res.on('finish', done)
  res.on('close', done) // client aborted before finish
  next()
}
