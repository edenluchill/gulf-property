/**
 * Builds an HTTPS proxy agent from DUBAI_API_PROXY_URL (the UAE egress).
 * axios's built-in `proxy` option does not CONNECT-tunnel HTTPS reliably,
 * so we pass this as `httpsAgent` with `proxy: false`.
 * Returns undefined when no proxy is configured (direct connection).
 */
import { HttpsProxyAgent } from 'https-proxy-agent'
import { getEnv } from '../config/env'

let cached: { agent?: HttpsProxyAgent<string> } | null = null

export function getProxyAgent(): HttpsProxyAgent<string> | undefined {
  if (!cached) {
    const url = getEnv().proxyUrl
    cached = { agent: url ? new HttpsProxyAgent(url) : undefined }
  }
  return cached.agent
}
