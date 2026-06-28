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
      recordRequest(res.statusCode, ms)
      recordEndpoint(endpointKey(req), res.statusCode, ms)
    } catch {
      /* telemetry must never throw into the request lifecycle */
    }
  }

  res.on('finish', done)
  res.on('close', done) // client aborted before finish
  next()
}
