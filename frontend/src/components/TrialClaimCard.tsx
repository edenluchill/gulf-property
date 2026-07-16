/**
 * 「还没领免费试用」一键领取 (2026-07-11)。
 *
 * 为什么需要:免费试用的 CTA 只长在 /agent/plans 上,而那条路只有**新用户**
 * (choose-role → plans)会走。已经登录的老经纪打开个人中心,看到的是一张
 * 「Explore · 未订阅 · 剩 0/0 积分」的死卡片 —— 产品里没有任何地方告诉他
 * 可以白拿 7 天。试用到期的人也会落回同一个死界面。
 *
 * 资格由服务端算(/billing/me 的 trial.eligible):从业者角色 + 无生效订阅 + 没用过试用。
 * 用在:个人中心「订阅与用量」卡 + 经纪台顶部(TrialBanner)。
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Gift, ArrowRight, Loader2, Clock } from 'lucide-react'
import { startFreeTrial, type BillingMe, type TrialRole } from '../lib/billingApi'

const WORKER_ROLES = ['agent', 'agency', 'developer']

export default function TrialClaimCard({ me, compact = false, buyerNudge: showBuyerNudge = true }: {
  me: BillingMe | null
  compact?: boolean
  /** 个人中心左侧已有「成为经纪(7 天免费试用)」卡 → 那里关掉,别问两遍 */
  buyerNudge?: boolean
}) {
  const { t: tRaw } = useTranslation('misc')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // 试用结束了 —— 必须说一声。否则用户只会发现功能突然全 402、地图被锁,
  // 却没有任何地方解释发生了什么(静默失效是最糟的体验)。
  const expired =
    !!me && !me.trial?.active && !!me.trial?.used && me.status === 'none' &&
    !!me.role && WORKER_ROLES.includes(me.role)

  if (expired) {
    return (
      <div className={`${compact ? 'mb-4' : 'mt-4'} rounded-xl border border-slate-200 bg-slate-50 px-4 py-3`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Clock className="h-4 w-4 shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-slate-900">{t('misc:yourFreeTrialHas')}</div>
            <div className="mt-0.5 text-[12.5px] leading-snug text-slate-500">
              {t('misc:subscribeAndYourCredits')}
            </div>
          </div>
          <Link to="/agent/plans"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-slate-800">
            {t('misc:seePlans')}<ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    )
  }

  // 账号登记为「买家」但其实是经纪 —— 告诉他试用在哪、怎么拿到。
  // (买家本来就免费用地图,直接给他开经纪试用没意义,而且试用到期后地图反而会被锁 ——
  //  所以必须先让他明确切换身份,不能替他决定。)
  const buyerNudge =
    showBuyerNudge && !!me && me.role === 'buyer' && me.status === 'none' && !me.trial?.used

  if (buyerNudge) {
    return (
      <div className={`${compact ? 'mb-4' : 'mt-4'} rounded-xl border border-slate-200 bg-slate-50 px-4 py-3`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Gift className="h-4 w-4 shrink-0 text-emerald-500" />
          <div className="min-w-0 flex-1 text-[13px] leading-snug text-slate-600">
            <b className="text-slate-900">{t('misc:areYouAnAgent')}</b>{' '}
            {t('misc:yourAccountIsRegistered2')}
          </div>
          <Link to="/choose-role"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-emerald-700">
            {t('misc:switchRole2')}<ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    )
  }

  if (!me?.trial?.eligible) return null

  async function claim() {
    setBusy(true); setErr(null)
    const r = await startFreeTrial((me!.role as TrialRole) || 'agent')
    if (r.trial) { window.location.reload(); return }  // 整页刷新:额度/地图/审批门处处即时一致
    setErr(r.error || null)
    setBusy(false)
  }

  const btn = (
    <button onClick={claim} disabled={busy}
      className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Gift className="h-4 w-4" />{t('misc:claimIt')}<ArrowRight className="h-3.5 w-3.5" /></>}
    </button>
  )

  return (
    <div className={`${compact ? 'mb-4' : 'mt-4'} rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-emerald-900">
            {t('misc:youHaveAnUnclaimed')}
          </div>
          <div className="mt-0.5 text-[12.5px] leading-snug text-emerald-800">
            {t('misc:allProFeatures2002')}
          </div>
        </div>
        {btn}
      </div>
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
    </div>
  )
}
