/**
 * perfMetrics — per-request latency/status sampler. Feeds services/perfSink.
 *
 * Mounted early (before routes) in index.ts. Never touches the response; on
 * 'finish' it records duration + status + concurrency into the in-memory sink.
 * Fail-safe: any error here is swallowed so telemetry can't break a request.
 */
import { Request, Response, NextFunction } from 'express'
import { recordRequest, incConcurrency, decConcurrency } from '../services/perfSink'

// Health checks and the metrics endpoints themselves would skew the numbers.
const IGNORE = new Set(['/health'])

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
    } catch {
      /* telemetry must never throw into the request lifecycle */
    }
  }

  res.on('finish', done)
  res.on('close', done) // client aborted before finish
  next()
}
