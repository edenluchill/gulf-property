/**
 * MapMeterGuard — 匿名地图每日限时的体验层(真正的强制在服务端 mapMeter 429)。
 * 设计稿: docs/map-metering-and-tiered-pricing-plan-2026-07-03.md
 *
 * 三段渐进,刻意温和 —— 这是注册引导,不是付费墙:
 *   0-7 分钟   完全无感(不显示倒计时,倒计时制造焦虑)
 *   剩 ≤2 分钟  左下角一条可关闭的软提示(每天最多一次)
 *   用尽       地图轻模糊 + 居中卡片;画面不清空,登录后一键回到原视角
 *
 * 心跳:仅在「匿名 + 地图可见 + 标签页可见」时每 30s 打一次,服务端按活跃分钟
 * 桶去重计数并返回剩余。额度耗尽的数据请求会触发全局 MAP_QUOTA_EVENT(track.ts
 * 的 fetch 拦截器广播),两条路都会点亮 overlay。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { API_BASE_URL } from '../lib/config'
import { MAP_QUOTA_EVENT } from '../lib/track'
import { setMyRole } from '../lib/billingApi'

const HEARTBEAT_MS = 30_000
const TOAST_DAY_KEY = 'map-meter-toast-day'
/** 登录回来恢复地图现场用(AuthCallback 读 authReturnUrl 回跳,MapPage 读这个 key 恢复视角)。 */
export const MAP_RESUME_KEY = 'pinzos:map-resume'

export function saveMapResumeView(view: { longitude: number; latitude: number; zoom: number } | null): void {
  try {
    if (view) localStorage.setItem(MAP_RESUME_KEY, JSON.stringify({ ...view, at: Date.now() }))
    sessionStorage.setItem('authReturnUrl', window.location.pathname + window.location.search)
  } catch { /* storage full/blocked — 恢复只是锦上添花 */ }
}

export function readMapResumeView(): { longitude: number; latitude: number; zoom: number } | null {
  try {
    const raw = localStorage.getItem(MAP_RESUME_KEY)
    if (!raw) return null
    localStorage.removeItem(MAP_RESUME_KEY)
    const v = JSON.parse(raw) as { longitude: number; latitude: number; zoom: number; at: number }
    if (Date.now() - v.at > 20 * 60_000) return null // 太旧就算了,别把人闪送去老位置
    return { longitude: v.longitude, latitude: v.latitude, zoom: v.zoom }
  } catch {
    return null
  }
}

interface Props {
  /** 普通浏览模式(tour/collab 分享页不弹)+ 地图当前可见。登录与否由心跳响应判定。 */
  active: boolean
  /** 从 MapPage 拿当前实时视角(命令式,不进 React state) */
  getView: () => { longitude: number; latitude: number; zoom: number } | null
}

export default function MapMeterGuard({ active, getView }: Props) {
  const { i18n } = useTranslation()
  const zh = !!i18n.language?.startsWith('zh')
  const navigate = useNavigate()
  const { signInWithGoogle, user } = useAuth()
  const [remaining, setRemaining] = useState<number | null>(null)
  const [exhausted, setExhausted] = useState(false)
  // 登录经纪但没订阅 → 引导去选套餐(而不是登录);由服务端心跳/429 判定
  const [requiresPlan, setRequiresPlan] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [toastDismissed, setToastDismissed] = useState(false)
  const activeRef = useRef(active)
  activeRef.current = active

  // ── 心跳(拦截器自动带 Authorization,买家/已订阅经纪返回 unlimited)────
  useEffect(() => {
    if (!active) return
    let stop = false
    const beat = async () => {
      if (stop || document.visibilityState !== 'visible') return
      try {
        const res = await fetch(`${API_BASE_URL}/api/usage/map-heartbeat`, { method: 'POST' })
        if (!res.ok) return
        const j = await res.json()
        if (stop) return
        if (j?.unlimited) { setExhausted(false); setRequiresPlan(false); return }
        if (typeof j?.remainingMinutes === 'number') setRemaining(j.remainingMinutes)
        setRequiresPlan(!!j?.requiresPlan)
        if (j?.exhausted) setExhausted(true)
      } catch { /* 心跳失败无所谓,服务端数据门兜底 */ }
    }
    void beat()
    const timer = setInterval(() => void beat(), HEARTBEAT_MS)
    return () => { stop = true; clearInterval(timer) }
  }, [active, user])

  // ── 数据层 429 → overlay(fetch 拦截器广播)──────────────
  useEffect(() => {
    const onQuota = (e: Event) => {
      if (!activeRef.current) return
      setExhausted(true)
      const detail = (e as CustomEvent).detail as { requiresPlan?: boolean } | undefined
      if (detail?.requiresPlan) setRequiresPlan(true)
    }
    window.addEventListener(MAP_QUOTA_EVENT, onQuota)
    return () => window.removeEventListener(MAP_QUOTA_EVENT, onQuota)
  }, [])

  const goLogin = useCallback((provider: 'google' | 'email') => {
    saveMapResumeView(getView())
    if (provider === 'google') void signInWithGoogle()
    else navigate('/login')
  }, [getView, navigate, signInWithGoogle])

  // 选错身份的后悔药:改回买家(免费不限时),服务端清计量门后整页刷新恢复数据
  const switchToBuyer = useCallback(async () => {
    setSwitching(true)
    const ok = await setMyRole('buyer')
    if (!ok) { setSwitching(false); return }
    try { sessionStorage.setItem('pinzos-role', 'buyer') } catch { /* noop */ }
    window.location.reload()
  }, [])

  if (!active) return null

  // ── 软提示(剩 ≤2 分钟,一天一次,可关)────────────────
  const today = new Date().toISOString().slice(0, 10)
  const toastShownToday = (() => { try { return localStorage.getItem(TOAST_DAY_KEY) === today } catch { return false } })()
  const showToast = !exhausted && !toastDismissed && !toastShownToday && remaining !== null && remaining <= 2 && remaining > 0
  const dismissToast = () => {
    setToastDismissed(true)
    try { localStorage.setItem(TOAST_DAY_KEY, today) } catch { /* noop */ }
  }

  return (
    <>
      {showToast && (
        <div className="absolute bottom-6 left-4 z-[550] max-w-[300px] rounded-xl bg-white/95 shadow-lg ring-1 ring-slate-200 backdrop-blur px-4 py-3 flex items-start gap-3">
          <div className="text-sm text-slate-700 leading-relaxed">
            {requiresPlan
              ? (zh ? '试用时长快用完了 —— 选择套餐后不限时使用 ✨' : 'Trial time is almost up — pick a plan for unlimited access ✨')
              : (zh ? '喜欢这张地图?登录后可以不限时使用,还能收藏项目 ✨' : 'Enjoying the map? Sign in to keep exploring without limits ✨')}
            <button
              className="ml-2 font-medium text-teal-600 hover:text-teal-700"
              onClick={() => { dismissToast(); requiresPlan ? navigate('/agent/plans') : goLogin('email') }}
            >
              {requiresPlan ? (zh ? '查看套餐' : 'See plans') : (zh ? '登录' : 'Sign in')}
            </button>
          </div>
          <button aria-label="close" className="mt-0.5 text-slate-400 hover:text-slate-600" onClick={dismissToast}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {exhausted && !requiresPlan && (
        <div className="absolute inset-0 z-[600] flex items-center justify-center bg-slate-900/45 backdrop-blur-[6px] p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6 text-center">
            <div className="text-4xl mb-2">🗺️</div>
            <h3 className="text-lg font-semibold text-slate-900">
              {zh ? '今天的免费探索先到这里' : "That's today's free exploring"}
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              {zh ? '登录后即可继续 —— 完全免费:' : 'Sign in to continue — completely free:'}
            </p>
            <ul className="mt-3 space-y-1.5 text-sm text-slate-600 text-left mx-auto w-fit">
              <li>✓ {zh ? '地图与市场数据不限时' : 'Unlimited map & market data'}</li>
              <li>✓ {zh ? '收藏项目,跨设备同步' : 'Favorites synced across devices'}</li>
              <li>✓ {zh ? 'Luna 智能助手' : 'Luna AI assistant'}</li>
            </ul>
            <div className="mt-5 space-y-2">
              <button
                className="w-full h-11 rounded-xl bg-teal-600 text-white font-medium hover:bg-teal-700 transition-colors"
                onClick={() => goLogin('google')}
              >
                {zh ? '用 Google 继续' : 'Continue with Google'}
              </button>
              <button
                className="w-full h-11 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                onClick={() => goLogin('email')}
              >
                {zh ? '邮箱登录' : 'Sign in with email'}
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              {zh ? '你刚才看的位置会原样保留 · 明天额度也会刷新' : 'Your spot on the map is saved · quota refreshes tomorrow'}
            </p>
          </div>
        </div>
      )}

      {/* 经纪身份但没订阅:引导选套餐(7天免费试用),留「改回买家」后悔药 */}
      {exhausted && requiresPlan && (
        <div className="absolute inset-0 z-[600] flex items-center justify-center bg-slate-900/45 backdrop-blur-[6px] p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6 text-center">
            <div className="text-4xl mb-2">💼</div>
            <h3 className="text-lg font-semibold text-slate-900">
              {zh ? '选一档,解锁你的经纪工作台' : 'Pick a plan to unlock your workspace'}
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              {zh ? '经纪账号选择套餐后即可不限时使用 —— $25/月起,7 天免费试用,试用期取消零费用:' : 'Agent accounts get unlimited access with a plan — from $25/mo, 7-day free trial, cancel at no charge:'}
            </p>
            <ul className="mt-3 space-y-1.5 text-sm text-slate-600 text-left mx-auto w-fit">
              <li>✓ {zh ? '地图与市场数据不限时' : 'Unlimited map & market data'}</li>
              <li>✓ {zh ? '客户 CRM + 品牌化报告' : 'Client CRM + branded reports'}</li>
              <li>✓ {zh ? '买家线索推送' : 'Buyer lead flow'}</li>
            </ul>
            <div className="mt-5 space-y-2">
              <button
                className="w-full h-11 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
                onClick={() => navigate('/agent/plans')}
              >
                {zh ? '查看套餐(7 天免费试用)' : 'See plans (7-day free trial)'}
              </button>
              <button
                disabled={switching}
                className="w-full h-11 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2"
                onClick={() => void switchToBuyer()}
              >
                {switching && <Loader2 className="h-4 w-4 animate-spin" />}
                {zh ? '我其实是买家,改回免费身份' : "I'm actually a buyer — switch back (free)"}
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              {zh ? '7 天内取消不产生任何费用' : 'Cancel within 7 days at no charge'}
            </p>
          </div>
        </div>
      )}
    </>
  )
}
