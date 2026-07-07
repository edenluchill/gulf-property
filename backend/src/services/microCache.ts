/**
 * microCache — tiny in-process TTL cache with single-flight + serve-stale-on-error.
 *
 * Purpose: protect near-static read endpoints (map first-screen geojson/metrics)
 * that are cheap-ish to compute alone but CATASTROPHIC under a thundering herd of
 * cold visitors. Load testing (2026-06-27) showed GET /api/dubai/areas — which
 * runs ST_AsGeoJSON over 210 areas + the live get_dubai_area_metrics() aggregate —
 * hit p50 27s at just 50 concurrent and collapsed the whole API at ~200 (it
 * starves the 50-slot DB pool). See docs/reports/2026-06-27-api-load-test.md.
 *
 *   - TTL          : fresh entries served from memory, zero DB hit.
 *   - single-flight: N concurrent misses for one key trigger ONE loader; the rest
 *                    await it. This is what kills the stampede — 1000 simultaneous
 *                    new visitors become 1 query, not 1000.
 *   - stale-on-err : if the loader throws but a stale value exists, serve stale
 *                    instead of erroring (keeps the map alive through a DB blip).
 *
 * Only import is the node built-in zlib (for cachedRender) — no project modules,
 * so this can never throw sideways into unrelated code paths.
 */
import zlib from 'zlib'

interface Entry<T> { at: number; data: T }

const store = new Map<string, Entry<unknown>>()
const inflight = new Map<string, Promise<unknown>>()

/**
 * Return cached value for `key` if younger than `ttlMs`, else run `loader` once
 * (coalescing concurrent callers) and cache the result.
 */
export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = store.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T

  const flying = inflight.get(key)
  if (flying) return flying as Promise<T>

  const p = (async () => {
    try {
      const data = await loader()
      store.set(key, { at: Date.now(), data })
      return data
    } catch (err) {
      const stale = store.get(key)
      if (stale) return stale.data as T // serve stale rather than fail
      throw err
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, p)
  return p as Promise<T>
}

/**
 * Pre-rendered cache for FAT, near-static JSON (e.g. the 672 KB /dubai/areas
 * geojson). Caches the serialized string AND a pre-gzipped buffer ONCE per TTL,
 * so each request is a memcpy — no per-request JSON.stringify, no per-request
 * gzip CPU. Load testing showed those two costs (not the DB query) were what
 * pinned the single core and queued requests to 30s+ under concurrency.
 */
export interface Rendered { json: string; gz: Buffer; bytes: number }

export async function cachedRender(
  key: string,
  ttlMs: number,
  loader: () => Promise<unknown>
): Promise<Rendered> {
  return cached<Rendered>(`render:${key}`, ttlMs, async () => {
    const json = JSON.stringify(await loader())
    const gz = zlib.gzipSync(json)
    return { json, gz, bytes: Buffer.byteLength(json) }
  })
}

/** True if the request's Accept-Encoding advertises gzip. */
export function acceptsGzip(acceptEncoding: string | undefined): boolean {
  return /\bgzip\b/.test(acceptEncoding || '')
}

/** Directly install a value (fresh TTL). Lets warmers compute first, swap after —
 *  the old entry keeps serving while the refresh runs, nobody waits on a cold miss. */
export function prime<T>(key: string, data: T): void {
  store.set(key, { at: Date.now(), data })
}

/** Drop entries. No arg → clear all. With prefix → clear keys starting with it. */
export function invalidate(prefix?: string): void {
  if (!prefix) { store.clear(); return }
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k)
}
