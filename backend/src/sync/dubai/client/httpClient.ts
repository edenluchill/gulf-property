/**
 * Low-level authenticated GET against the data.dubai Data API.
 * Responsibilities (and nothing else — knows no DB, no dataset semantics):
 *   - rate pacing (stay under 60 req/min)
 *   - 30s timeout
 *   - retry with exponential backoff on 429 / 5xx / network errors
 *   - one token refresh on 401
 *   - optional UAE proxy (DUBAI_API_PROXY_URL)
 */
import axios, { AxiosError, AxiosInstance } from 'axios'
import { getEnv } from '../config/env'
import { getProxyAgent } from './proxyAgent'
import { getToken } from './auth'
import { makeLogger } from '../observability/log'

const log = makeLogger('http')

// data.dubai cap is 60 req/min. Pace at ~1.1s spacing for headroom.
const MIN_INTERVAL_MS = 1100
let lastRequestAt = 0

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function pace(): Promise<void> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastRequestAt = Date.now()
}

let client: AxiosInstance | null = null
function getClient(): AxiosInstance {
  if (client) return client
  const env = getEnv()
  client = axios.create({
    baseURL: env.baseUrl,
    timeout: 30_000,
    proxy: false,
    httpsAgent: getProxyAgent(),
    validateStatus: (s) => s >= 200 && s < 300,
  })
  return client
}

export async function apiGet<T = any>(
  path: string,
  params: Record<string, any> = {},
  opts: { retries?: number } = {}
): Promise<T> {
  const retries = opts.retries ?? 4
  let attempt = 0

  while (true) {
    await pace()
    const token = await getToken()
    try {
      const res = await getClient().get<T>(path, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      })
      return res.data
    } catch (e) {
      const err = e as AxiosError
      const status = err.response?.status
      attempt++

      // Expired/invalid token: refresh once and retry immediately.
      if (status === 401 && attempt <= retries) {
        await getToken(true)
        continue
      }

      const retryable = !status || status === 429 || status >= 500
      if (retryable && attempt <= retries) {
        // Circuit breaker on the gateway suspends ~5s; back off generously.
        const backoff = Math.min(30_000, 1000 * 2 ** attempt)
        log.warn(`GET ${path} failed (status=${status ?? 'network'}); retry ${attempt}/${retries} in ${backoff}ms`)
        await sleep(backoff)
        continue
      }

      const body = JSON.stringify(err.response?.data)?.slice(0, 400)
      const error: any = new Error(`GET ${path} failed: status=${status ?? 'network'} ${body ?? err.message}`)
      error.status = status
      throw error
    }
  }
}
