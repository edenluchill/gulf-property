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

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
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
