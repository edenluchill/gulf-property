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

export default function TrialClaimCard({ me, compact = false }: { me: BillingMe | null; compact?: boolean }) {
  const { i18n } = useTranslation()
  const zh = !!i18n.language?.startsWith('zh')
  const L = (a: string, b: string) => (zh ? a : b)

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
            <div className="text-sm font-bold text-slate-900">{L('免费试用已结束', 'Your free trial has ended')}</div>
            <div className="mt-0.5 text-[12.5px] leading-snug text-slate-500">
              {L('订阅后积分立即恢复,客户 CRM、实时带看、Luna 导览与地图数据继续可用。',
                 'Subscribe and your credits come back right away — CRM, live tours, Luna and the map data all resume.')}
            </div>
          </div>
          <Link to="/agent/plans"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-slate-800">
            {L('查看套餐', 'See plans')}<ArrowRight className="h-3.5 w-3.5" />
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
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Gift className="h-4 w-4" />{L('一键领取', 'Claim it')}<ArrowRight className="h-3.5 w-3.5" /></>}
    </button>
  )

  return (
    <div className={`${compact ? 'mb-4' : 'mt-4'} rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-emerald-900">
            {L('你还有 7 天免费试用没领', 'You have an unclaimed 7-day free trial')}
          </div>
          <div className="mt-0.5 text-[12.5px] leading-snug text-emerald-800">
            {L('全部专业功能 + 200 积分 · 无需信用卡 · 到期自动停止,不会扣款',
               'All Pro features + 200 credits · no credit card · it just stops at the end, nothing is charged')}
          </div>
        </div>
        {btn}
      </div>
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
    </div>
  )
}
