import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables not configured. Auth features will be disabled.')
}

/** session 在 localStorage 里的 key。跨 tab 同步要监听它,所以导出去共用一个真值。 */
export const AUTH_STORAGE_KEY = 'pinzos-auth'

/** gotrue 的锁没抢到时抛这个;auth-js 靠 isAcquireTimeout 识别并跳过本轮自动刷新。 */
class LockUnavailableError extends Error {
  readonly isAcquireTimeout = true
}

/**
 * gotrue 用 navigator.locks 串行化所有 auth 操作,锁名按 storageKey 派生 —— 而这把锁
 * 是**整个 origin 共享的**:任意一个 tab(包括被浏览器冻结、永远不会释放锁的后台 tab)
 * 攥着它,其它 tab 就抢不到。auth-js 默认 lockAcquireTimeout=10s,超时就 abort() 且不带
 * reason,于是 setSession() 抛出字面量 "signal is aborted without reason" → 登录失败。
 * 线上 auth_failure 埋点 100% 是这一条(reason=exception / provider=google)。
 *
 * 为了一把跨 tab 互斥锁而把用户挡在门外,这个取舍是反的。抢不到锁就**不加锁直接执行**:
 * 最坏情况是两个 tab 同时刷新 token,而 Supabase 有 10s 的 refresh token 复用宽限期
 * (同一个旧 token 在窗口内会拿到同一个新 token),代价远小于登不进去。
 */
const LOCK_WAIT_MS = 5000

const resilientLock = async <R>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<R>
): Promise<R> => {
  const locks = globalThis.navigator?.locks
  if (!locks) return await fn()

  // acquireTimeout === 0 是自动刷新 tick 的「抢不到就算了」语义,保持原样 —— 这条路径
  // 上放弃是正确的(下一个 tick 会再来),不需要降级成无锁执行。
  if (acquireTimeout === 0) {
    return await locks.request(name, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock) throw new LockUnavailableError(`Lock "${name}" not immediately available`)
      return await fn()
    })
  }

  // 等锁封顶 5 秒(auth-js 传进来的是 10 秒),抢不到就降级 —— 别让登录页干等。
  // 区分「没抢到锁」和「抢到了但 fn 自己炸了」:后者绝不能重跑。
  let started = false
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOCK_WAIT_MS)

  try {
    return await locks.request(name, { mode: 'exclusive', signal: controller.signal }, async () => {
      started = true
      return await fn()
    })
  } catch (err) {
    if (started) throw err
    return await fn()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * ── refresh 诊断层 ──────────────────────────────────────────────────────────
 *
 * "每天要重登"里还剩一批 manual:false 的登出解释不了,因为我们对 token 刷新这段是**全盲**的:
 * 只知道 session 死了,不知道刷新是**失败了**(refresh_token_not_found / 被限流 / 网络断)
 * 还是**根本没触发**(tab 被冻结,定时器没跑)。SDK 不暴露这个,所以在 fetch 层自己拦。
 *
 * 拦 Supabase auth 的两个端点,把真实 status + error_code 记下来:
 *   /auth/v1/token?grant_type=refresh_token  → 刷新
 *   /auth/v1/logout                          → 退出(scope 是 local 还是 global)
 */
export type RefreshDiag = {
  ok: boolean
  status: number
  error_code?: string
  message?: string
  ms: number
  at: number
}

let lastRefresh: RefreshDiag | null = null
/** 最近一次 token 刷新的结果 —— SIGNED_OUT 时附在埋点上,用来回答"它是怎么死的"。 */
export const getLastRefresh = (): RefreshDiag | null => lastRefresh

/** track.ts 反过来 import 了 supabase,静态 import 会成环 —— 所以延迟拿。 */
const report = (event: 'auth_token_refresh' | 'auth_logout_call', payload: Record<string, unknown>) => {
  void import('./track')
    .then((m) => m.trackError(event, payload))
    .catch(() => { /* 诊断埋点绝不能反过来搞坏 auth */ })
}

const diagnosticFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const isRefresh = url.includes('/auth/v1/token') && url.includes('grant_type=refresh_token')
  const isLogout = url.includes('/auth/v1/logout')
  if (!isRefresh && !isLogout) return fetch(input, init)

  const t0 = Date.now()
  try {
    const res = await fetch(input, init)
    const ms = Date.now() - t0

    if (isLogout) {
      // scope 在 query 里(?scope=local)。确认线上真的走的是 local,别再悄悄踢别的设备。
      report('auth_logout_call', { status: res.status, scope: new URL(url).searchParams.get('scope'), ms })
      return res
    }

    let errorCode: string | undefined
    let message: string | undefined
    if (!res.ok) {
      // clone:body 只能读一次,读完了 SDK 就没得读了。
      try {
        const body = await res.clone().json()
        // GoTrue 的错误体在不同版本/路径下形状不一(error_code / error / code),
        // 实测刷新失败时只回了 message。**别猜结构** —— 认得出的字段就用,认不出的
        // 就把原始 body 截一段带上,不然分类字段是空的,这条埋点就白埋了。
        errorCode = body?.error_code || body?.error || body?.code
        message = body?.error_description || body?.msg || body?.message || JSON.stringify(body).slice(0, 200)
      } catch { /* 非 JSON 就算了 */ }
    }

    lastRefresh = { ok: res.ok, status: res.status, error_code: errorCode, message, ms, at: t0 }
    report('auth_token_refresh', {
      ok: res.ok,
      status: res.status,
      error_code: errorCode ?? null,
      message: message?.slice(0, 200) ?? null,
      ms,
      // tab 冻结是头号嫌疑 —— 记下刷新发生时页面是不是可见的。
      visibility: typeof document !== 'undefined' ? document.visibilityState : null,
      online: typeof navigator !== 'undefined' ? navigator.onLine : null,
    })
    return res
  } catch (err) {
    // 网络层就断了(离线/DNS/超时)—— 这一类根本到不了 status
    const ms = Date.now() - t0
    const message = err instanceof Error ? err.message : String(err)
    lastRefresh = { ok: false, status: 0, error_code: 'network', message, ms, at: t0 }
    if (isRefresh) {
      report('auth_token_refresh', {
        ok: false,
        status: 0,
        error_code: 'network',
        message: message.slice(0, 200),
        ms,
        visibility: typeof document !== 'undefined' ? document.visibilityState : null,
        online: typeof navigator !== 'undefined' ? navigator.onLine : null,
      })
    }
    throw err
  }
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    global: { fetch: diagnosticFetch },
    auth: {
      persistSession: true,
      storageKey: AUTH_STORAGE_KEY,
      autoRefreshToken: true,
      // detectSessionInUrl is OFF on purpose. With it on, this client parses the
      // OAuth callback hash itself AND our AuthCallback calls setSession() — two
      // concurrent ops contend gotrue's navigator.locks lock and one aborts with
      // "signal is aborted without reason" (seen on mobile, captured via the
      // auth_failure telemetry). AuthCallback is now the SOLE handler of the
      // callback URL (hash → setSession, ?code → exchangeCodeForSession), so
      // there's exactly one processor and no race.
      detectSessionInUrl: false,
      lock: resilientLock,
    },
  }
)

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey)
