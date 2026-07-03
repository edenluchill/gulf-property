/**
 * RoleSelectModal — 登录后一次性选择用户类型(type):买家(免费)或经纪(付费)。
 * 设计稿: docs/map-metering-and-tiered-pricing-plan-2026-07-03.md §2
 *
 * 挂在 Layout(全局)。触发条件:已登录 && user_profiles.role 为空 && 不在
 * 分享页/回调页。买家一键进入(零摩擦 —— 买家行为是 lead 引擎的燃料);
 * 选经纪 → 记 type 后送去 /pricing 选付费档。选错随时可在设置里 promote。
 */
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Home, Briefcase } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchMyRole, setMyRole } from '../lib/billingApi'

const CACHE_KEY = 'pinzos-role' // sessionStorage:避免每次导航都打接口

// 分享/回调/登录页不打扰(客户正被经纪带着看内容,或流程未完)
const QUIET_PREFIXES = ['/t/', '/v/', '/r/', '/cr/', '/factsheet/', '/auth/', '/login']

export default function RoleSelectModal() {
  const { user, loading, isAdmin } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const zh = !!i18n.language?.startsWith('zh')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState<'buyer' | 'agent' | null>(null)

  useEffect(() => {
    if (loading || !user || isAdmin) { setOpen(false); return } // 内部/owner 账号不问
    if (QUIET_PREFIXES.some((p) => location.pathname.startsWith(p))) return
    try {
      if (sessionStorage.getItem(CACHE_KEY)) return
    } catch { /* noop */ }
    let stale = false
    void fetchMyRole().then((role) => {
      if (stale) return
      if (role) {
        try { sessionStorage.setItem(CACHE_KEY, role) } catch { /* noop */ }
      } else {
        setOpen(true)
      }
    })
    return () => { stale = true }
  }, [user, loading, location.pathname])

  const choose = async (role: 'buyer' | 'agent') => {
    if (saving) return
    setSaving(role)
    const ok = await setMyRole(role)
    setSaving(null)
    if (!ok) return // 失败静默保留弹窗,下次点击重试
    try { sessionStorage.setItem(CACHE_KEY, role) } catch { /* noop */ }
    setOpen(false)
    if (role === 'agent') navigate('/pricing')
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl p-6">
        <h2 className="text-xl font-semibold text-slate-900 text-center">
          {zh ? '你今天来,是想…' : 'What brings you here?'}
        </h2>
        <p className="mt-1 text-sm text-slate-500 text-center">
          {zh ? '选一下,我们把体验调成最适合你的样子' : "Pick one — we'll tailor the experience for you"}
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            disabled={!!saving}
            onClick={() => void choose('buyer')}
            className="group rounded-xl border-2 border-slate-200 hover:border-teal-500 hover:bg-teal-50/50 transition-colors p-5 text-left disabled:opacity-60"
          >
            <Home className="h-7 w-7 text-teal-600" />
            <div className="mt-3 font-semibold text-slate-900">
              {zh ? '我在找房 / 研究投资' : "I'm buying / researching"}
            </div>
            <div className="mt-1 text-sm font-medium text-teal-600">{zh ? '免费' : 'Free'}</div>
            <ul className="mt-2 space-y-1 text-xs text-slate-500">
              <li>· {zh ? '地图与市场数据不限时' : 'Unlimited map & market data'}</li>
              <li>· {zh ? '收藏 · Luna 智能助手 · 5年回报分析' : 'Favorites · Luna AI · 5-yr ROI analysis'}</li>
            </ul>
            <div className="mt-2 text-[11px] text-slate-400">
              {zh ? '专业经纪工具(客户管理、品牌报告、实时带看)不包含' : 'Pro agent tools (CRM, branded reports, live tours) not included'}
            </div>
            {saving === 'buyer' && <div className="mt-2 text-xs text-teal-600">{zh ? '进入中…' : 'Setting up…'}</div>}
          </button>
          <button
            disabled={!!saving}
            onClick={() => void choose('agent')}
            className="group rounded-xl border-2 border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/50 transition-colors p-5 text-left disabled:opacity-60"
          >
            <Briefcase className="h-7 w-7 text-indigo-600" />
            <div className="mt-3 font-semibold text-slate-900">
              {zh ? '我是地产经纪' : "I'm a real estate agent"}
            </div>
            <div className="mt-1 text-sm font-medium text-indigo-600">
              {zh ? '$25/月起 · 7天免费试用' : 'From $25/mo · 7-day free trial'}
            </div>
            <ul className="mt-2 space-y-1 text-xs text-slate-500">
              <li>· {zh ? '全部买家功能 + 客户 CRM' : 'Everything for buyers + client CRM'}</li>
              <li>· {zh ? '品牌化报告 · Luna 导览 · 潜在客户推送' : 'Branded reports · Luna tours · lead flow'}</li>
            </ul>
            {saving === 'agent' && <div className="mt-2 text-xs text-indigo-600">{zh ? '进入中…' : 'Setting up…'}</div>}
          </button>
        </div>
        <p className="mt-4 text-center text-[11px] text-slate-400">
          {zh ? '以后随时可以在设置里更改' : 'You can change this anytime in settings'}
        </p>
      </div>
    </div>
  )
}
