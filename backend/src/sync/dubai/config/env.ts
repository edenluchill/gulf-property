/**
 * Typed environment loader for the Dubai data.dubai sync.
 * Reads DUBAI_API_* from backend/.env (loaded via dotenv).
 * NEVER logs secret values.
 */
import dotenv from 'dotenv'
dotenv.config()

export interface DubaiEnv {
  baseUrl: string
  appId: string
  clientId: string
  clientSecret: string
  proxyUrl: string
}

let cached: DubaiEnv | null = null

export function getEnv(): DubaiEnv {
  if (cached) return cached
  const baseUrl = (process.env.DUBAI_API_BASE_URL || 'https://stg-apis.data.dubai').replace(/\/+$/, '')
  const appId = process.env.DUBAI_API_APP_ID || ''
  const clientId = process.env.DUBAI_API_CLIENT_ID || ''
  const clientSecret = process.env.DUBAI_API_CLIENT_SECRET || ''
  const proxyUrl = process.env.DUBAI_API_PROXY_URL || ''

  const missing = [
    ['DUBAI_API_APP_ID', appId],
    ['DUBAI_API_CLIENT_ID', clientId],
    ['DUBAI_API_CLIENT_SECRET', clientSecret],
  ].filter(([, v]) => !v).map(([k]) => k)

  if (missing.length) {
    throw new Error(`Missing required env var(s): ${missing.join(', ')} — set them in backend/.env`)
  }

  cached = { baseUrl, appId, clientId, clientSecret, proxyUrl }
  return cached
}

/** Parse DUBAI_API_PROXY_URL into an axios proxy config (or false for direct). */
export function parseProxy(proxyUrl: string): false | {
  protocol: string
  host: string
  port: number
  auth?: { username: string; password: string }
} {
  if (!proxyUrl) return false
  try {
    const u = new URL(proxyUrl)
    const cfg: any = {
      protocol: u.protocol.replace(':', ''),
      host: u.hostname,
      port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80),
    }
    if (u.username) {
      cfg.auth = { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) }
    }
    return cfg
  } catch {
    return false
  }
}
