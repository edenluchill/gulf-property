import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react'
import { User, Session, AuthError } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured, AUTH_STORAGE_KEY, getLastRefresh, readStoredSession } from '../lib/supabase'
import { identifyVisitor, trackEvent } from '../lib/track'
import { clearFavorites } from '../lib/favorites'
import { isAdminEmail, API_BASE_URL } from '../lib/config'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  isAdmin: boolean
  /** 楼书上传权限:admin 隐含 true;其他人查服务端 upload_permissions 白名单。
      null = 正在查(ProtectedRoute 会等,不要当 false 用)。 */
  canUpload: boolean | null
  isConfigured: boolean
  signInWithOtp: (email: string) => Promise<{ error: AuthError | null }>
  verifyOtp: (email: string, token: string) => Promise<{ error: AuthError | null }>
  signInWithGoogle: () => Promise<{ error: AuthError | null }>
  signInWithMicrosoft: () => Promise<{ error: AuthError | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  // 首屏零等待:同步从 localStorage 把 session 读出来当初值,而不是先渲染成「未登录」、
  // 等 getSession()(要抢 navigator.locks,空载 400~800ms,多 tab 抢锁时好几秒)回来再翻。
  // 下面的 getSession() + onAuthStateChange 仍然照跑,负责校验和纠正 —— token 真失效了
  // 会走 SIGNED_OUT 把界面改回未登录。乐观渲染,不是鉴权:真鉴权全在服务端。
  const bootstrap = readStoredSession()

  const [user, setUser] = useState<User | null>(bootstrap?.user ?? null)
  const [session, setSession] = useState<Session | null>(bootstrap)
  // 已经有 session 就不算 loading —— 否则 ProtectedRoute 会白转一圈 spinner
  const [loading, setLoading] = useState(!bootstrap)
  const [isAdmin, setIsAdmin] = useState(isAdminEmail(bootstrap?.user?.email))
  const [canUpload, setCanUpload] = useState<boolean | null>(false)
  // "为什么老被登出"排查埋点:区分用户点退出 vs SDK 自杀会话(refresh token 被
  // reuse-detection 吊销、存储被清等)。manual:false 的 auth_signed_out 才是事故。
  const manualSignOutRef = useRef(false)
  const lastEmailRef = useRef<string | null>(bootstrap?.user?.email ?? null)

  // 楼书上传权限:admin 直接 true;普通账号问服务端白名单(upload_permissions)
  useEffect(() => {
    if (!user) { setCanUpload(false); return }
    if (isAdminEmail(user.email)) { setCanUpload(true); return }
    let stale = false
    setCanUpload(null)
    ;(async () => {
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        const r = await fetch(`${API_BASE_URL}/api/agents/can-upload`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        const j = await r.json()
        if (!stale) setCanUpload(!!j.canUpload)
      } catch {
        if (!stale) setCanUpload(false)
      }
    })()
    return () => { stale = true }
  }, [user?.email])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    // On the OAuth callback route, let AuthCallback be the SOLE auth operator.
    // A concurrent getSession() here races AuthCallback's setSession()/exchange
    // for the gotrue navigator.locks lock and throws "signal is aborted without
    // reason" — the cause of mobile Google login failing (provider=google,
    // has_hash=true). AuthCallback will finish auth and onAuthStateChange below
    // will then update us; so we just skip the initial getSession on that route.
    const onAuthCallback =
      typeof window !== 'undefined' && window.location.pathname.startsWith('/auth/callback')

    // Get initial session (skipped on the callback route to avoid the lock race)
    if (!onAuthCallback) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user?.email) lastEmailRef.current = session.user.email
        checkAdminRole(session?.user ?? null)
        setLoading(false)
        // Link this browser's anonymous visitor_id to the account (backfills email).
        if (session?.user) void identifyVisitor()
      })
    } else {
      setLoading(false)
    }

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        // manual:false = the SDK ended the session on its own — that's the bug we
        // hunt (refresh-token revocation / storage loss), keyed by who it hit.
        //
        // 附上最近一次 token 刷新的结果(见 supabase.ts 的 diagnosticFetch),这是区分
        // 「刷新失败了」和「刷新根本没触发(tab 被冻结)」的唯一证据:
        //   last_refresh_* 有值且 ok=false → 失败,error_code 说明为什么
        //   last_refresh_age_ms 很大 / 为 null → 压根没刷过 → 定时器没跑
        const lr = getLastRefresh()
        trackEvent('auth_signed_out', {
          manual: manualSignOutRef.current,
          last_email: lastEmailRef.current || undefined,
          last_refresh_ok: lr?.ok ?? null,
          last_refresh_status: lr?.status ?? null,
          last_refresh_error: lr?.error_code ?? null,
          // error_code 常常是空的(GoTrue 错误体形状不一),message 才是真正说清死因的那个
          last_refresh_message: lr?.message?.slice(0, 200) ?? null,
          last_refresh_age_ms: lr ? Date.now() - lr.at : null,
          visibility: typeof document !== 'undefined' ? document.visibilityState : null,
        })
        manualSignOutRef.current = false
        lastEmailRef.current = null
      }
      if (session?.user?.email) lastEmailRef.current = session.user.email
      setSession(session)
      setUser(session?.user ?? null)
      checkAdminRole(session?.user ?? null)
      setLoading(false)
      if (session?.user) void identifyVisitor()
    })

    // 跨 tab 同步。auth-js 只在 visibilitychange 时和存储对账,不监听 storage 事件 ——
    // 所以并排开着的两个 tab,A 登录/退出/换账号后 B 的内存里还是旧 session,界面就一直
    // 显示错的人(用户报的"每个 tab 状态不一样")。而且 signOut 改成 scope:'local' 后,
    // 退出只清存储、清不掉别的 tab 内存里的 session,更需要这条链路把它们拉齐。
    const syncFromStorage = async () => {
      let stored: { access_token?: string; refresh_token?: string } | null = null
      try {
        const raw = window.localStorage.getItem(AUTH_STORAGE_KEY)
        stored = raw ? JSON.parse(raw) : null
      } catch { stored = null }

      const { data } = await supabase.auth.getSession()
      const current = data.session

      if (!stored?.access_token) {
        // 别的 tab 退出了 → 清掉本 tab 内存里还活着的 session
        if (current) {
          manualSignOutRef.current = true // 用户在别的 tab 点的退出,不是事故,别报警
          await supabase.auth.signOut({ scope: 'local' })
          try { clearFavorites() } catch { /* best-effort */ }
        }
        return
      }

      // 别的 tab 登录了、换了账号、或刷新了 token → 采用存储里的这份
      if (stored.refresh_token && stored.access_token !== current?.access_token) {
        await supabase.auth.setSession({
          access_token: stored.access_token,
          refresh_token: stored.refresh_token,
        })
      }
    }

    const onStorage = (e: StorageEvent) => {
      if (e.storageArea && e.storageArea !== window.localStorage) return
      if (e.key !== null && e.key !== AUTH_STORAGE_KEY) return // key === null 是 clear()
      void syncFromStorage()
    }
    window.addEventListener('storage', onStorage)

    return () => {
      subscription.unsubscribe()
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const checkAdminRole = (user: User | null) => {
    if (!user) {
      setIsAdmin(false)
      return
    }
    // Admin is restricted to a fixed email allow-list (see lib/config ADMIN_EMAILS),
    // NOT role metadata — so only the whitelisted accounts get admin access. The
    // server enforces the same list; this is the UX-side gate.
    setIsAdmin(isAdminEmail(user.email))
  }

  const signInWithOtp = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        // Route any magic-link click through /auth/callback — with
        // detectSessionInUrl off, that's the only place tokens get processed.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    return { error }
  }

  const verifyOtp = async (email: string, token: string) => {
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    })
    return { error }
  }

  const signInWithGoogle = async () => {
    // Remember the provider so /auth/callback can offer a one-tap retry if the
    // OAuth round-trip fails (a common mobile flake — see AuthCallback).
    try { sessionStorage.setItem('authProvider', 'google') } catch { /* ignore */ }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    return { error }
  }

  const signInWithMicrosoft = async () => {
    try { sessionStorage.setItem('authProvider', 'azure') } catch { /* ignore */ }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: 'email profile openid',
      },
    })
    return { error }
  }

  const signOut = async () => {
    manualSignOutRef.current = true
    // scope:'local' —— 只退出这台设备。Supabase 的默认值是 'global',会吊销该账号在
    // **所有设备**上的 refresh token:埋点实测,每次在电脑上点退出,3~11 秒后手机和
    // 另一台电脑就收到 manual:false 的 auth_signed_out 被踢下线(20 次里 14 次如此)。
    // 这就是"每天都要重新登录"的真凶,不是 refresh token reuse-detection。
    await supabase.auth.signOut({ scope: 'local' })
    setUser(null)
    setSession(null)
    setIsAdmin(false)
    // Clear the local favorites store so the next account on this device starts
    // clean — they're safely persisted server-side and re-merge on next login.
    try { clearFavorites() } catch { /* best-effort */ }
  }

  const value = {
    user,
    session,
    loading,
    isAdmin,
    canUpload,
    isConfigured: isSupabaseConfigured,
    signInWithOtp,
    verifyOtp,
    signInWithGoogle,
    signInWithMicrosoft,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
