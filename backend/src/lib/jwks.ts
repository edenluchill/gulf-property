/**
 * jwks — Supabase 的 JWT 签名公钥,缓存在内存里,供本地验签用。
 *
 * 为什么需要它(2026-07-11 实测):
 *   这个项目已经在新版 Supabase 密钥体系上——access token 用 **ES256 非对称签名**
 *   (JWKS 端点发布 EC P-256 公钥,service_role key 也是新的 sb_secret_ 格式)。
 *   而 context.ts 的本地快路径只会 HS256 共享密钥,遇到 ES256 直接返回 null →
 *   每个登录请求都回退到 supabaseAdmin.auth.getUser() 的远程调用。
 *
 *   实测那一次远程调用要 **141-494ms**,而 DB 往返只有 1ms。dashboard 上
 *   「登录接口一律 200-460ms、未登录接口 1-2ms」的那个地板,就是它。
 *
 *   用公钥在本地验 ES256 之后,这个开销归零,而且**一个 secret 都不用存**
 *   (公钥是公开的,泄露也无所谓)——比塞 HS256 共享密钥更安全。
 *
 * 铁律:attachContext 必须是同步且零网络的(它挂在全局,匿名请求也要过)。
 * 所以公钥在启动时预取、后台定期刷新,请求路径只读内存里的同步缓存。
 * 缓存里没有的 kid(比如刚轮转)→ 返回 null → 那一次请求退回远程校验,
 * 同时在后台触发一次刷新。永远不会因为验不了签就把用户判成未登录。
 */
import { createPublicKey, KeyObject } from 'crypto'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const REFRESH_MS = 6 * 60 * 60 * 1000
const MIN_REFETCH_MS = 60_000 // 未知 kid 触发的刷新,最快 1 分钟一次(防打爆)

const keys = new Map<string, KeyObject>()
let lastFetchAt = 0
let inflight: Promise<void> | null = null

async function fetchJwks(): Promise<void> {
  if (!SUPABASE_URL) return
  const res = await fetch(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
  if (!res.ok) throw new Error(`jwks ${res.status}`)
  const body = (await res.json()) as { keys?: Record<string, unknown>[] }
  if (!Array.isArray(body.keys)) return
  for (const jwk of body.keys) {
    const kid = typeof jwk.kid === 'string' ? jwk.kid : null
    if (!kid) continue
    try {
      keys.set(kid, createPublicKey({ key: jwk as any, format: 'jwk' }))
    } catch {
      /* 单个 key 解析失败不影响其它 */
    }
  }
  lastFetchAt = Date.now()
}

/** 拉一次公钥;并发调用合并成一次。失败只记日志——验签退回远程,不影响可用性。 */
export async function refreshJwks(): Promise<void> {
  if (inflight) return inflight
  inflight = fetchJwks()
    .catch((e) => { console.error('[jwks] refresh failed:', e instanceof Error ? e.message : e) })
    .finally(() => { inflight = null })
  return inflight
}

/** 启动时预取 + 定期刷新。 */
export async function primeJwks(): Promise<void> {
  await refreshJwks()
  const t = setInterval(() => { void refreshJwks() }, REFRESH_MS)
  if (typeof t.unref === 'function') t.unref()
  console.log(`🔑 JWKS 已加载: ${keys.size} 个签名公钥(本地验签,登录请求零远程调用)`)
}

/** 同步取公钥 —— 请求路径只走这个,永不发网络请求。 */
export function getSigningKey(kid: string): KeyObject | null {
  const k = keys.get(kid)
  if (k) return k
  // 未知 kid(密钥轮转了):后台补一次,本次请求退回远程校验。
  if (Date.now() - lastFetchAt > MIN_REFETCH_MS) void refreshJwks()
  return null
}

export function jwksReady(): boolean {
  return keys.size > 0
}
