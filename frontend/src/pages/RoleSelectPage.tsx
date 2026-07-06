/**
 * RoleSelectPage — 选择身份(独立页面,route: /choose-role)。
 * 设计稿: docs/role-onboarding-badges-plan-2026-07-05.md
 *
 * 2026-07-05 从弹窗改为页面(用户要求):首登无角色 → RoleSelectRedirect 送到
 * 这里;头像菜单「切换身份」、各 plans 页「重新选择角色」也都来这里。
 * 规则:选前不显示价格;买家即选即用;付费角色(经纪/经纪公司/开发商)
 * 先「不」落身份,付款成功才 set(webhook + 回跳页),没付款下次还会再问。
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2, ChevronRight } from 'lucide-react'
import { setMyRole, type UserRole } from '../lib/billingApi'

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

export default function RoleSelectPage() {
  const { i18n } = useTranslation()
  const zh = !!i18n.language?.startsWith('zh')
  const [saving, setSaving] = useState<UserRole | null>(null)

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
