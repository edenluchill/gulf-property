/**
 * API attribution — records WHO made meaningful business API calls, so a
 * successful request isn't an anonymous void. Reads identity from req.ctx
 * (resolved network-free by attachContext) and writes to api_calls.
 *
 * Performance contract (this is the whole point):
 *   • Nothing runs in the request path — we only register a res.on('finish')
 *     hook, so latency added to the response is ZERO.
 *   • Writes are SAMPLED (see shouldRecord) so the table never firehoses.
 *   • Writes are buffered + batched + fire-and-forget; a slow/erroring DB can
 *     never surface to the client (mirrors the app_events ingest design).
 *
 * Delete this file + its mount line + api-calls.sql to remove the feature.
 */
import { Request, Response, NextFunction } from 'express'
import pool from '../db/pool'

// Meaningful reads worth attributing (a customer pulling real intelligence).
// High-frequency viewport/poll GETs (map-pins, clusters, areas overlay, health)
// are deliberately excluded — they're noise, not intent.
const BUSINESS_READ: RegExp[] = [
  /^\/api\/residential-projects\/[0-9a-f-]{36}(\/|$)/, // project detail / insights / transactions
  /^\/api\/market\//,                                  // area-insights, transaction lists
  /^\/api\/compare/,                                   // AI property comparison
]

// Never record these even though they're writes (telemetry channels / noise).
const SKIP_PATH: RegExp[] = [
  /^\/api\/events/,        // the semantic-event channel itself
  /^\/health/,
  /^\/api\/admin\/analytics\/perf/, // dashboard's own perf polling
]

function shouldRecord(method: string, path: string): boolean {
  if (method === 'OPTIONS' || method === 'HEAD') return false
  if (SKIP_PATH.some((re) => re.test(path))) return false
  if (method !== 'GET') return true                         // all actions (POST/PUT/PATCH/DELETE)
  return BUSINESS_READ.some((re) => re.test(path))          // curated reads only
}

interface Row {
  method: string; path: string; status: number; duration_ms: number
  visitor_id: string | null; user_id: string | null; user_email: string | null; is_admin: boolean
}

const buffer: Row[] = []
let timer: ReturnType<typeof setTimeout> | null = null
const MAX_BATCH = 50
const FLUSH_MS = 5_000

function enqueue(row: Row): void {
  buffer.push(row)
  if (buffer.length >= MAX_BATCH) void flush()
  else if (!timer) timer = setTimeout(() => { timer = null; void flush() }, FLUSH_MS)
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return
  const batch = buffer.splice(0, buffer.length)
  if (timer) { clearTimeout(timer); timer = null }

  // Build one multi-row INSERT: 8 columns per row.
  const cols = 8
  const values: string[] = []
  const params: any[] = []
  batch.forEach((r, i) => {
    const b = i * cols
    values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`)
    params.push(r.method, r.path, r.status, r.duration_ms, r.visitor_id, r.user_id, r.user_email, r.is_admin)
  })
  try {
    await pool.query(
      `INSERT INTO api_calls (method, path, status, duration_ms, visitor_id, user_id, user_email, is_admin)
       VALUES ${values.join(',')}`,
      params
    )
  } catch (err) {
    // Swallow — attribution must never disrupt the app.
    console.error('[attribution] flush failed (ignored):', err instanceof Error ? err.message : err)
  }
}

/** Global middleware: zero work in the request path, sampled write on finish. */
export function attribution(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now()
  res.on('finish', () => {
    try {
      const path = (req.originalUrl || req.url || '').split('?')[0]
      if (!shouldRecord(req.method, path)) return
      enqueue({
        method: req.method,
        path: path.slice(0, 300),
        status: res.statusCode,
        duration_ms: Date.now() - start,
        visitor_id: req.ctx?.visitorId ?? null,
        user_id: req.ctx?.userId ?? null,
        user_email: req.ctx?.email ?? null,
        is_admin: !!req.ctx?.isAdmin,
      })
    } catch { /* never throw from a finish handler */ }
  })
  next()
}
