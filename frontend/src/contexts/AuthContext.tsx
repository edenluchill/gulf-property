import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { User, Session, AuthError } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { identifyVisitor } from '../lib/track'
import { clearFavorites } from '../lib/favorites'
import { isAdminEmail } from '../lib/config'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  isAdmin: boolean
  isConfigured: boolean
  signInWithOtp: (email: string) => Promise<{ error: AuthError | null }>
  verifyOtp: (email: string, token: string) => Promise<{ error: AuthError | null }>
  signInWithGoogle: () => Promise<{ error: AuthError | null }>
  signInWithMicrosoft: () => Promise<{ error: AuthError | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

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
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      checkAdminRole(session?.user ?? null)
      setLoading(false)
      if (session?.user) void identifyVisitor()
    })

    return () => subscription.unsubscribe()
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
    await supabase.auth.signOut()
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
