/**
 * OAuth2 client_credentials token manager.
 * Caches the bearer token in-memory and refreshes ~60s before expiry.
 * The client_secret is read from env and sent only in the POST body — never logged.
 */
import axios from 'axios'
import { getEnv } from '../config/env'
import { getProxyAgent } from './proxyAgent'
import { makeLogger } from '../observability/log'

const log = makeLogger('auth')

let cachedToken: string | null = null
let expiresAtMs = 0

export async function getToken(force = false): Promise<string> {
  const env = getEnv()
  if (!force && cachedToken && Date.now() < expiresAtMs - 60_000) {
    return cachedToken
  }

  const url = `${env.baseUrl}/secure/ssis/dubaiai/gatewaytoken/1.0.0/getAccessToken`
  const res = await axios.post(
    url,
    {
      grant_type: 'client_credentials',
      client_id: env.clientId,
      client_secret: env.clientSecret,
    },
    {
      headers: {
        'x-DDA-SecurityApplicationIdentifier': env.appId,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
      proxy: false,
      httpsAgent: getProxyAgent(),
      // Treat only 2xx as success so we surface auth errors clearly.
      validateStatus: (s) => s >= 200 && s < 300,
    }
  )

  const accessToken = res.data?.access_token
  const expiresIn = Number(res.data?.expires_in ?? 3600)
  if (!accessToken) {
    throw new Error(`Token endpoint returned no access_token: ${JSON.stringify(res.data)?.slice(0, 300)}`)
  }

  cachedToken = accessToken
  expiresAtMs = Date.now() + expiresIn * 1000
  log.info(`token acquired (expires in ${expiresIn}s)`)
  return accessToken
}

/** For tests / forced refresh after a 401. */
export function clearToken(): void {
  cachedToken = null
  expiresAtMs = 0
}
