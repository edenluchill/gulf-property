/**
 * GlobalQuotaGate — 非地图页面的配额兜底引导。
 *
 * mapMeter 在服务端拦的是整个数据面(/api/market、/api/residential-projects、
 * /api/dubai* …),不只是地图。匿名额度用尽后,成交页/详情页等页面的请求同样
 * 429,但 MapMeterGuard 只挂在地图上(active gated)—— 之前这些页面就是
 * 「静默空白」:数据 fetcher 安全回退成空,没有任何解释(2026-07-07 实锤:
 * 一位连逛 /login、/choose-role、/agent/join 的高意向访客打开成交页全空)。
 *
 * 这里挂在 Layout 上全局监听 fetch 拦截器广播的 MAP_QUOTA_EVENT:
 *   - 地图路径:不管(MapMeterGuard 自己处理,含刷新清数据的完整语义)
 *   - requiresPlan(登录经纪没订阅):整页跳 /agent/plans,与地图行为一致
 *   - 匿名:盖一张与地图同款的登录引导卡(登录免费不限时)
 */
import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { isMapPath } from '../lib/isMapPath'
import { MAP_QUOTA_EVENT } from '../lib/track'

export default function GlobalQuotaGate() {
  const { t: tRaw } = useTranslation('gate')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const navigate = useNavigate()
  const loc = useLocation()
  const { signInWithGoogle, user } = useAuth()
  const [exhausted, setExhausted] = useState(false)
  const onMap = isMapPath(loc.pathname, loc.search)

  useEffect(() => {
    const onQuota = (e: Event) => {
      if (isMapPath(window.location.pathname, window.location.search)) return
      const detail = (e as CustomEvent).detail as { requiresPlan?: boolean } | undefined
      if (detail?.requiresPlan) {
        // 登录经纪未订阅:与 MapMeterGuard 相同的整页跳转(清内存数据,无刷新循环)
        try { sessionStorage.setItem('authReturnUrl', window.location.pathname + window.location.search) } catch { /* noop */ }
        window.location.replace('/agent/plans?from=map')
        return
      }
      setExhausted(true)
    }
    window.addEventListener(MAP_QUOTA_EVENT, onQuota)
    return () => window.removeEventListener(MAP_QUOTA_EVENT, onQuota)
  }, [])

  // 换路由 / 登录成功 → 收起(登录后拦截器带上身份,数据请求自然恢复)
  useEffect(() => { setExhausted(false) }, [loc.pathname, user])

  const goLogin = useCallback((provider: 'google' | 'email') => {
    try { sessionStorage.setItem('authReturnUrl', window.location.pathname + window.location.search) } catch { /* noop */ }
    if (provider === 'google') void signInWithGoogle()
    else navigate('/login')
  }, [navigate, signInWithGoogle])

  if (!exhausted || onMap) return null

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/45 backdrop-blur-[6px] p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6 text-center">
        <div className="text-4xl mb-2">📊</div>
        <h3 className="text-lg font-semibold text-slate-900">
          {t('gate:thatSTodayS2')}
        </h3>
        <p className="mt-2 text-sm text-slate-500">
          {t('gate:signInToContinue2')}
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-slate-600 text-start mx-auto w-fit">
          <li>✓ {t('gate:unlimitedMarketTransactionData')}</li>
          <li>✓ {t('gate:favoritesSyncedAcrossDevices2')}</li>
          <li>✓ {t('gate:lunaAiAssistant2')}</li>
        </ul>
        <div className="mt-5 space-y-2">
          <button
            className="w-full h-11 rounded-xl bg-teal-600 text-white font-medium hover:bg-teal-700 transition-colors"
            onClick={() => goLogin('google')}
          >
            {t('gate:continueWithGoogle2')}
          </button>
          <button
            className="w-full h-11 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
            onClick={() => goLogin('email')}
          >
            {t('gate:signInWithEmail2')}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          {t('gate:yourFreeQuotaRefreshes')}
        </p>
      </div>
    </div>
  )
}
