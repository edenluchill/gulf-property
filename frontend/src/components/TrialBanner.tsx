/**
 * 免绑卡试用常驻条 (2026-07-11) — 挂在经纪台外壳(AgentLayout)顶部。
 *
 * 试用没有信用卡兜底 —— 到期就是真的停。所以剩余天数和剩余积分必须一直在眼前,
 * 而不是等他撞到 402 才知道。剩 ≤2 天 或 ≤40 积分 → 转警示色(那是最该转化的时刻)。
 * 非试用用户/加载中 → 什么都不渲染(零打扰)。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Sparkles, ArrowRight } from 'lucide-react'
import { fetchBillingMe, type BillingMe } from '../lib/billingApi'
import DeveloperVerifyCard from './DeveloperVerifyCard'

export default function TrialBanner() {
  const { i18n } = useTranslation()
  const zh = !!i18n.language?.startsWith('zh')
  const L = (a: string, b: string) => (zh ? a : b)
  const [me, setMe] = useState<BillingMe | null>(null)

  const load = () => { void fetchBillingMe().then(setMe) }
  useEffect(load, [])

  if (!me) return null

  // 开发商未验证 → 引导去拿 30 天 / 600 分(与试用条共用这一份 /me,不重复请求)
  const devCard = <DeveloperVerifyCard me={me} onDone={load} />
  if (!me.trial?.active) return devCard

  const days = me.trial.daysLeft ?? 0
  const balance = me.credits?.balance ?? 0
  const month = me.credits?.month ?? 0
  const urgent = days <= 2 || balance <= 40
  const pct = month > 0 ? Math.max(0, Math.min(100, (balance / month) * 100)) : 0

  return (
    <>
    {devCard}
    <div
      className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-2.5 text-sm ${
        urgent
          ? 'border-amber-300/60 bg-amber-50 text-amber-900'
          : 'border-emerald-300/50 bg-emerald-50 text-emerald-900'
      }`}
    >
      <Sparkles className={`h-4 w-4 shrink-0 ${urgent ? 'text-amber-500' : 'text-emerald-500'}`} />
      <span className="font-semibold">
        {L('免费试用中', 'Free trial')}
        {' · '}
        {days > 0
          ? L(`还剩 ${days} 天`, `${days} day${days === 1 ? '' : 's'} left`)
          : L('今天到期', 'ends today')}
      </span>

      {/* 剩余积分 + 细进度条:用完就停,让他一直看得见 */}
      <span className="flex items-center gap-2">
        <span className={urgent ? 'text-amber-800' : 'text-emerald-800'}>
          {L(`剩 ${balance} / ${month} 积分`, `${balance} / ${month} credits left`)}
        </span>
        <span className={`h-1.5 w-16 overflow-hidden rounded-full ${urgent ? 'bg-amber-200' : 'bg-emerald-200'}`}>
          <span
            className={`block h-full rounded-full ${urgent ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${pct}%` }}
          />
        </span>
      </span>

      <Link
        to="/agent/billing"
        className={`ml-auto inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white transition ${
          urgent ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
        }`}
      >
        {L('订阅 · 积分立即恢复', 'Subscribe · credits reset now')}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
    </>
  )
}
