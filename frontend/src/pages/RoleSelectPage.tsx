/**
 * RoleSelectPage — 选择身份(独立页面,route: /choose-role)。
 * 设计稿: docs/role-onboarding-badges-plan-2026-07-05.md
 *
 * 2026-07-05 从弹窗改为页面(用户要求):首登无角色 → RoleSelectRedirect 送到
 * 这里;头像菜单「切换身份」、各 plans 页「重新选择角色」也都来这里。
 * 规则:选前不显示价格;买家即选即用;付费角色(经纪/经纪公司/开发商)
 * 先「不」落身份,付款成功才 set(webhook + 回跳页),没付款下次还会再问。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2, ChevronRight, BadgeCheck } from 'lucide-react'
import { fetchBillingMe, setMyRole, type UserRole } from '../lib/billingApi'
import { badgeForPlan, ROLE_BY_PLAN, type RoleBadge } from '../lib/roleBadge'
import { useAuth } from '../contexts/AuthContext'

// 四个角色卡:可视化 emoji 徽章 + 专属配色,一眼分得开。不放价格。
const ROLE_CARDS: {
  id: UserRole
  emoji: string
  titleZh: string; titleEn: string
  descZh: string; descEn: string
  bulletsZh: string[]; bulletsEn: string[]
  grad: string
  ring: string
  bg: string
  paid: boolean
  next: string | null
}[] = [
  {
    id: 'buyer', emoji: '🏠',
    titleZh: '买家', titleEn: 'Buyer',
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
    bulletsZh: ['客户 CRM · 品牌报告 · 实时带看', 'Lead 推送'],
    bulletsEn: ['Client CRM · branded reports · live tours', 'Lead flow'],
    grad: 'from-blue-400 to-indigo-500', ring: 'hover:border-indigo-500', bg: 'hover:bg-indigo-50/60',
    paid: true, next: '/agent/plans',
  },
  {
    id: 'agency', emoji: '🏢',
    titleZh: '经纪公司', titleEn: 'Agency',
    descZh: '我们是团队或经纪公司', descEn: "We're a team or brokerage",
    bulletsZh: ['多席位共享 · 团队管理', 'Lead 独占优先 · 品牌定制'],
    bulletsEn: ['Multiple seats · team management', 'First pick of leads · white-label'],
    grad: 'from-violet-400 to-purple-600', ring: 'hover:border-violet-500', bg: 'hover:bg-violet-50/60',
    paid: true, next: '/agency/plans',
  },
  {
    id: 'developer', emoji: '🏗️',
    titleZh: '开发商', titleEn: 'Developer',
    descZh: '我们开发/销售楼盘项目', descEn: 'We develop & sell projects',
    bulletsZh: ['上传楼书 · AI 解析 · 项目管理', '销售工具 + 楼盘全站曝光'],
    bulletsEn: ['Upload brochures · AI parsing · projects', 'Sales tools + full exposure'],
    grad: 'from-amber-400 to-orange-500', ring: 'hover:border-amber-500', bg: 'hover:bg-amber-50/60',
    paid: true, next: '/developer/plans',
  },
]

export default function RoleSelectPage() {
  const { i18n } = useTranslation()
  const zh = !!i18n.language?.startsWith('zh')
  const { user, loading: authLoading } = useAuth()
  const [saving, setSaving] = useState<UserRole | null>(null)

  // 已付费 → 身份由订阅决定,不给再切(切成买家还在扣费/切别的角色会重复购买,
  // 都是坑)。变更身份 = 先去订阅页调整/取消套餐。未登录/未付费 → 正常四选一。
  const [paidBadge, setPaidBadge] = useState<RoleBadge | null>(null)
  const [checking, setChecking] = useState(true)
  useEffect(() => {
    let stale = false
    void fetchBillingMe()
      .then((me) => {
        if (stale || !me) return
        const b = badgeForPlan(me.plan?.id, me.status, me.teamMember)
        setPaidBadge(b)
        // 有生效订阅但 role 可能没落(席位成员被邀请、owner 手动赠送、webhook
        // 竞态)→ 按套餐自动补落。不补的话:无角色 → 被送来本页 → 引导卡只有
        // "回地图" → 又被送回来,死循环。席位成员按 agent 算(不是经纪公司本体)。
        if (b) {
          const r: UserRole = me.teamMember ? 'agent' : (ROLE_BY_PLAN[me.plan?.id || ''] || 'agent')
          void setMyRole(r)
          try { sessionStorage.setItem('pinzos-role', r) } catch { /* noop */ }
        }
      })
      .catch(() => { /* 未登录/失败 → 按未付费处理 */ })
      .finally(() => { if (!stale) setChecking(false) })
    return () => { stale = true }
  }, [])

  const choose = async (card: typeof ROLE_CARDS[number]) => {
    if (saving) return
    // 付费角色:先不落身份 —— 付款成功后才 set(webhook + 回跳页双保险)。
    // 没付款的话下次进来还会再问,选错也不会被付费墙锁住。
    if (card.paid) {
      window.location.assign(card.next || '/')
      return
    }
    setSaving(card.id)
    const ok = await setMyRole(card.id)
    setSaving(null)
    if (!ok) return
    try { sessionStorage.setItem('pinzos-role', card.id) } catch { /* noop */ }
    // 整页跳转:角色态(Header/经纪台)处处即时一致
    window.location.assign('/')
  }

  // 匿名访问:选角色需要登录(否则点卡片静默失败,像坏了一样)
  if (!authLoading && !user) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-y-auto bg-slate-50 px-4">
        <div className="w-full max-w-sm rounded-3xl bg-white p-7 text-center shadow-sm ring-1 ring-slate-900/[0.06]">
          <h1 className="text-xl font-bold text-slate-900">{zh ? '请先登录' : 'Please sign in first'}</h1>
          <p className="mt-2 text-sm text-slate-500">
            {zh ? '登录后即可选择你的身份,开启对应的工作台' : 'Sign in to choose your role and unlock your workspace'}
          </p>
          <a href="/login" className="mt-5 block rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800">
            {zh ? '去登录' : 'Sign in'}
          </a>
        </div>
      </div>
    )
  }

  if (checking) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-50">
        <Loader2 className="h-7 w-7 animate-spin text-teal-500" />
      </div>
    )
  }

  // 已付费:身份跟着套餐走,给引导而不是四张卡
  if (paidBadge) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-y-auto bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-3xl bg-white p-7 text-center shadow-sm ring-1 ring-slate-900/[0.06]">
          <span
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-[34px] shadow-md"
            style={{ background: `linear-gradient(135deg, ${paidBadge.from}, ${paidBadge.to})` }}
            aria-hidden
          >
            {paidBadge.emoji}
          </span>
          <h1 className="mt-4 flex items-center justify-center gap-1.5 text-xl font-bold text-slate-900">
            <BadgeCheck className="h-5 w-5 text-teal-500" />
            {zh ? paidBadge.titleZh : paidBadge.titleEn}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            {zh
              ? '你已开通对应套餐,身份由订阅决定。如需变更身份,请先在「订阅与套餐」里调整或取消当前套餐。'
              : 'Your role follows your active subscription. To change it, adjust or cancel your plan first.'}
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <a
              href="/agent/billing"
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
            >
              {zh ? '管理订阅与套餐' : 'Manage subscription'}
            </a>
            <a href="/" className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100">
              {zh ? '回到地图' : 'Back to the map'}
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
        <h1 className="text-center text-2xl font-bold text-slate-900 sm:text-3xl">
          {zh ? '你是哪种身份?' : 'Which one are you?'}
        </h1>
        <p className="mt-2 text-center text-sm text-slate-500">
          {zh ? '我们会按身份为你打开对应的工作台和功能' : "We'll set up the right workspace and tools for you"}
        </p>

        {/* 提醒:角色决定功能 */}
        <div className="mx-auto mt-4 flex max-w-xl items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span>
            {zh
              ? '请选择符合你真实身份的角色 —— 角色决定你能使用的功能,选错会缺少对应功能(之后可随时回到本页切换)。'
              : 'Pick the role that matches you — your role decides which features you get (you can come back and switch anytime).'}
          </span>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {ROLE_CARDS.map((c) => (
            <button
              key={c.id}
              disabled={!!saving}
              onClick={() => void choose(c)}
              className={`group relative flex items-start gap-4 rounded-2xl border-2 border-slate-200 bg-white p-5 text-left shadow-sm transition-all duration-150 active:scale-[0.98] disabled:opacity-60 ${c.ring} ${c.bg}`}
            >
              <span
                className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-[34px] shadow-md transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-3 ${c.grad}`}
                aria-hidden
              >
                {c.emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-base font-bold text-slate-900">{zh ? c.titleZh : c.titleEn}</span>
                  {saving === c.id
                    ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                    : <ChevronRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5" />}
                </span>
                <span className="mt-0.5 block text-[13px] text-slate-500">{zh ? c.descZh : c.descEn}</span>
                <span className="mt-2 block space-y-1">
                  {(zh ? c.bulletsZh : c.bulletsEn).map((b, i) => (
                    <span key={i} className="block text-xs leading-relaxed text-slate-400">· {b}</span>
                  ))}
                </span>
              </span>
            </button>
          ))}
        </div>

        <p className="mt-5 text-center text-[11px] text-slate-400">
          {zh ? '选完之后,随时可以在右上角头像菜单里「切换身份」回到本页' : 'You can switch your role anytime from the avatar menu (top right)'}
        </p>
      </div>
    </div>
  )
}
