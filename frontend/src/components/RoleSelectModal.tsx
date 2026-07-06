/**
 * RoleSelectModal — 登录后一次性选择身份(四角色,2026-07-05 版)。
 * 设计稿: docs/role-onboarding-badges-plan-2026-07-05.md
 *
 * 规则:一个页面选 4 个角色;选之前不显示任何价格;顶部提醒"选对角色否则
 * 缺功能"。买家选完直接用;经纪人/经纪公司/开发商选完各自进专属付费页
 * (各自只看到自己的价格,无免费选项)。
 * 挂在 Layout(全局)。触发条件:已登录 && user_profiles.role 为空 && 不在
 * 分享页/回调页。
 */
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2, ChevronRight, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchMyRole, setMyRole, type UserRole } from '../lib/billingApi'

const CACHE_KEY = 'pinzos-role' // sessionStorage:避免每次导航都打接口

// 分享/回调/登录页不打扰(客户正被经纪带着看内容,或流程未完)
const QUIET_PREFIXES = ['/t/', '/v/', '/r/', '/cr/', '/pp/', '/factsheet/', '/auth/', '/login']

// 四个角色卡:可视化 emoji 徽章 + 专属配色,一眼分得开。不放价格。
const ROLE_CARDS: {
  id: UserRole
  emoji: string
  titleZh: string; titleEn: string
  descZh: string; descEn: string
  bulletsZh: string[]; bulletsEn: string[]
  grad: string          // emoji 徽章渐变
  ring: string          // hover 边框色
  bg: string            // hover 背景
  paid: boolean
  next: string | null   // 选完去哪(null = 直接用)
}[] = [
  {
    id: 'buyer', emoji: '🏠',
    titleZh: '买家 / 投资人', titleEn: 'Buyer / Investor',
    descZh: '我在找房、研究迪拜楼市', descEn: "I'm buying or researching",
    bulletsZh: ['地图与市场数据不限时', '收藏 · Luna 助手 · 5年回报分析'],
    bulletsEn: ['Unlimited map & market data', 'Favorites · Luna AI · 5-yr ROI'],
    grad: 'from-teal-400 to-emerald-500', ring: 'hover:border-teal-500', bg: 'hover:bg-teal-50/60',
    paid: false, next: null,
  },
  {
    id: 'agent', emoji: '🧑‍💼',
    titleZh: '经纪人', titleEn: 'Agent',
    descZh: '我是独立地产经纪', descEn: "I'm a real estate agent",
    bulletsZh: ['客户 CRM · 品牌报告 · 实时带看', '买家线索推送'],
    bulletsEn: ['Client CRM · branded reports · live tours', 'Buyer lead flow'],
    grad: 'from-blue-400 to-indigo-500', ring: 'hover:border-indigo-500', bg: 'hover:bg-indigo-50/60',
    paid: true, next: '/agent/plans',
  },
  {
    id: 'agency', emoji: '🏢',
    titleZh: '经纪公司 / Agency', titleEn: 'Agency / Brokerage',
    descZh: '我们是团队或经纪公司', descEn: "We're a team or brokerage",
    bulletsZh: ['多席位共享 · 团队管理', '买家线索独占优先 · 品牌定制'],
    bulletsEn: ['Multiple seats · team management', 'First pick of leads · white-label'],
    grad: 'from-violet-400 to-purple-600', ring: 'hover:border-violet-500', bg: 'hover:bg-violet-50/60',
    paid: true, next: '/agency/plans',
  },
  {
    id: 'developer', emoji: '🏗️',
    titleZh: '开发商', titleEn: 'Developer',
    descZh: '我们开发/销售楼盘项目', descEn: 'We develop & sell projects',
    bulletsZh: ['上传楼书 · AI 解析 · 项目管理', '销售工具 + 全站买家曝光'],
    bulletsEn: ['Upload brochures · AI parsing · projects', 'Sales tools + buyer exposure'],
    grad: 'from-amber-400 to-orange-500', ring: 'hover:border-amber-500', bg: 'hover:bg-amber-50/60',
    paid: true, next: '/developer/plans',
  },
]

export default function RoleSelectModal() {
  const { user, loading, isAdmin } = useAuth()
  const location = useLocation()
  const { i18n } = useTranslation()
  const zh = !!i18n.language?.startsWith('zh')
  const [open, setOpen] = useState(false)
  // 切换身份打开的弹窗可以关闭(反悔不换);首登 onboarding 强制选,不给关闭
  const [dismissable, setDismissable] = useState(false)
  const [saving, setSaving] = useState<UserRole | null>(null)

  // 头像菜单「切换身份」→ 重新弹出本弹窗(已有角色也弹)
  useEffect(() => {
    const reopen = () => { setDismissable(true); setOpen(true) }
    window.addEventListener('pinzos:role-select', reopen)
    return () => window.removeEventListener('pinzos:role-select', reopen)
  }, [])

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

  const choose = async (card: typeof ROLE_CARDS[number]) => {
    if (saving) return
    setSaving(card.id)
    const ok = await setMyRole(card.id)
    setSaving(null)
    if (!ok) return // 失败静默保留弹窗,下次点击重试
    try { sessionStorage.setItem(CACHE_KEY, card.id) } catch { /* noop */ }
    setOpen(false)
    // 整页跳转:切换身份后 Header/经纪台等所有角色态立即一致(SPA navigate 会留旧态)
    window.location.assign(card.next || '/')
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center overflow-y-auto bg-slate-900/55 p-4 backdrop-blur-sm">
      <div className="relative my-auto w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl sm:p-7">
        {dismissable && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <h2 className="text-center text-xl font-bold text-slate-900 sm:text-2xl">
          {zh ? '你是哪种身份?' : 'Which one are you?'}
        </h2>
        <p className="mt-1 text-center text-sm text-slate-500">
          {zh ? '我们会按身份为你打开对应的工作台和功能' : "We'll set up the right workspace and tools for you"}
        </p>

        {/* 提醒:角色决定功能,选错会缺功能 */}
        <div className="mx-auto mt-3 flex max-w-xl items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span>
            {zh
              ? '请选择符合你真实身份的角色 —— 角色决定你能使用的功能,选错会缺少对应功能(之后可在头像菜单随时切换)。'
              : 'Pick the role that matches you — your role decides which features you get. Choosing wrong means missing tools (contact us later to adjust).'}
          </span>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {ROLE_CARDS.map((c) => (
            <button
              key={c.id}
              disabled={!!saving}
              onClick={() => void choose(c)}
              className={`group relative flex items-start gap-3.5 rounded-2xl border-2 border-slate-200 p-4 text-left transition-all duration-150 active:scale-[0.98] disabled:opacity-60 ${c.ring} ${c.bg}`}
            >
              {/* 可视化徽章:渐变圆 + 大 emoji,悬浮微弹 */}
              <span
                className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-[30px] shadow-md transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-3 ${c.grad}`}
                aria-hidden
              >
                {c.emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="font-bold text-slate-900">{zh ? c.titleZh : c.titleEn}</span>
                  {saving === c.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                    : <ChevronRight className="h-3.5 w-3.5 text-slate-300 transition-transform group-hover:translate-x-0.5" />}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">{zh ? c.descZh : c.descEn}</span>
                <span className="mt-1.5 block space-y-0.5">
                  {(zh ? c.bulletsZh : c.bulletsEn).map((b, i) => (
                    <span key={i} className="block text-[11px] leading-relaxed text-slate-400">· {b}</span>
                  ))}
                </span>
              </span>
            </button>
          ))}
        </div>

        <p className="mt-4 text-center text-[11px] text-slate-400">
          {zh ? '选完之后,随时可以在右上角头像菜单里「切换身份」' : 'You can switch your role anytime from the avatar menu (top right)'}
        </p>
      </div>
    </div>
  )
}
