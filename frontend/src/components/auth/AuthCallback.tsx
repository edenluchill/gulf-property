import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { trackError } from '../../lib/track'

/**
 * OAuth / magic-link callback handler — hardened.
 *
 * The old version just awaited getSession() and relied on Supabase's
 * detectSessionInUrl racing against the AuthProvider's own getSession() at the
 * app root. On mobile that race (or blocked storage) silently threw and dumped
 * users on a generic "Authentication Error" with the token still sitting in the
 * URL. This version handles every branch explicitly and reports failures to the
 * owner dashboard (错误监控 tab) so they stop being invisible:
 *
 *   1. Provider returned an error (?error / #error_description) → show it.
 *   2. Implicit/hash flow (#access_token + refresh_token) → setSession() ourselves.
 *   3. PKCE flow (?code=) → exchangeCodeForSession().
 *   4. Nothing in the URL (AuthProvider may have already consumed the hash) →
 *      poll getSession() briefly to win the race instead of failing instantly.
 *
 * On failure we offer a one-tap retry of the original provider, not just
 * "return home", and stamp diagnostics so we can tell *why* it broke.
 */

/** Can we actually persist a session? Blocked storage (private mode, some
 *  in-app browsers) is a common silent cause of "login mysteriously fails". */
function storageOk(): boolean {
  try {
    const k = '__pinzos_probe__'
    localStorage.setItem(k, '1')
    localStorage.removeItem(k)
    return true
  } catch {
    return false
  }
}

function parseParams(): { hash: URLSearchParams; query: URLSearchParams } {
  const hash = new URLSearchParams(
    (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#/, '')
  )
  const query = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
  return { hash, query }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * gotrue serialises auth ops behind a navigator.locks lock; under contention it
 * can reject with "signal is aborted without reason". Retry a couple of times
 * (the lock frees within a tick) before surfacing the failure.
 */
async function abortRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Increasing backoff (300/600/900/1200ms): on mobile the lock can stay
      // contended longer than a fixed delay, which is why 3×350ms still failed.
      if (i < tries - 1 && /abort/i.test(msg)) {
        await delay(300 * (i + 1))
        continue
      }
      throw e
    }
  }
}

export default function AuthCallback() {
  const navigate = useNavigate()
  const { t } = useTranslation('auth')
  const { signInWithGoogle, signInWithMicrosoft } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    let cancelled = false

    const finish = () => {
      const returnUrl = sessionStorage.getItem('authReturnUrl') || '/'
      sessionStorage.removeItem('authReturnUrl')
      // Strip the token-bearing hash from history so a back-nav can't replay it.
      try { window.history.replaceState(null, '', window.location.pathname) } catch { /* ignore */ }
      navigate(returnUrl, { replace: true })
    }

    /** Record the failure (best-effort) and surface a friendly message. */
    const fail = (reason: string, message: string, extra?: Record<string, unknown>) => {
      if (cancelled) return
      const { hash, query } = parseParams()
      trackError('auth_failure', {
        reason,
        message: (message || '').slice(0, 300),
        provider: (() => { try { return sessionStorage.getItem('authProvider') } catch { return null } })(),
        has_hash: !!hash.get('access_token'),
        has_code: !!query.get('code'),
        storage_ok: storageOk(),
        origin: typeof window !== 'undefined' ? window.location.origin : null,
        ...extra,
      })
      setError(message || t('authCallback.generic'))
    }

    const run = async () => {
      try {
        const { hash, query } = parseParams()

        // 1. Provider-side error (consent denied, misconfig, expired). Most
        //    informative — show the provider's own description.
        const providerErr =
          hash.get('error_description') || query.get('error_description') ||
          hash.get('error') || query.get('error')
        if (providerErr) {
          return fail('provider', decodeURIComponent(providerErr), {
            error_code: hash.get('error_code') || query.get('error_code') || null,
          })
        }

        // 2. Implicit / hash flow — set the session explicitly instead of
        //    racing Supabase's auto-detection (the original silent-failure path).
        const accessToken = hash.get('access_token')
        const refreshToken = hash.get('refresh_token')
        if (accessToken && refreshToken) {
          const { data, error: setErr } = await abortRetry(() =>
            supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          )
          if (setErr) return fail('set_session', setErr.message)
          if (data.session) return finish()
        }

        // 3. PKCE flow — exchange the code. (Fails if the code_verifier is
        //    missing, e.g. the round-trip crossed www ↔ apex origins.)
        const code = query.get('code')
        if (code) {
          const { data, error: exErr } = await abortRetry(() => supabase.auth.exchangeCodeForSession(code))
          if (exErr) return fail('code_exchange', exErr.message)
          if (data.session) return finish()
        }

        // 4. Nothing actionable in the URL — Supabase's own detectSessionInUrl
        //    (or the AuthProvider) may have already consumed the hash. Poll
        //    briefly so we win that race instead of failing instantly.
        for (let i = 0; i < 14 && !cancelled; i++) {
          const { data } = await abortRetry(() => supabase.auth.getSession())
          if (data.session) return finish()
          await delay(300)
        }

        if (!cancelled) {
          // No tokens were present AND no session ever appeared.
          const hadAnything = !!accessToken || !!code
          return fail(hadAnything ? 'no_session' : 'timeout', t('authCallback.generic'))
        }
      } catch (err) {
        return fail('exception', err instanceof Error ? err.message : String(err))
      }
    }

    void run()
    return () => { cancelled = true }
  }, [navigate, t])

  const retry = async () => {
    setRetrying(true)
    let provider: string | null = null
    try { provider = sessionStorage.getItem('authProvider') } catch { /* ignore */ }
    try {
      if (provider === 'azure') await signInWithMicrosoft()
      else if (provider === 'google') await signInWithGoogle()
      else { navigate('/login', { replace: true }); return }
    } catch {
      navigate('/login', { replace: true })
    }
    // signInWith* triggers a full redirect; this only runs if it didn't.
    setRetrying(false)
  }

  if (error) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-center p-6 sm:p-8 max-w-md w-full">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <span className="text-2xl">!</span>
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">
            {t('authCallback.title')}
          </h2>
          <p className="text-slate-600 mb-6 break-words">{error}</p>
          <div className="flex flex-col gap-3">
            <button
              onClick={retry}
              disabled={retrying}
              className="bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white px-8 py-3 rounded-lg font-medium transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2"
            >
              {retrying && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('authCallback.retry')}
            </button>
            <button
              onClick={() => navigate('/', { replace: true })}
              className="text-slate-500 hover:text-slate-700 px-8 py-2 rounded-lg font-medium transition-colors"
            >
              {t('backToHome')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-12 h-12 text-teal-500 animate-spin mx-auto mb-4" />
        <p className="text-slate-600">{t('authCallback.completing')}</p>
      </div>
    </div>
  )
}
