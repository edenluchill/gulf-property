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
import TrialClaimCard from './TrialClaimCard'

export default function TrialBanner() {
  const { t: tRaw } = useTranslation('misc')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const [me, setMe] = useState<BillingMe | null>(null)

  const load = () => { void fetchBillingMe().then(setMe) }
  useEffect(load, [])

  if (!me) return null

  // 2026-08-17:这里原来还挂着「开发商验证」引导卡,已连同整条链路删除。
  // 那道人工审批守的东西全是假的 —— 上传楼书要的是 role='developer'(自助选角色就有,
  // 23 人),不是验证;验证唯一给的是 30 天/600 分,而唯一通过验证的人交付了 0 个楼盘。
  // 要给谁加长试用,用后台已有的「赠 Pro 30 天」(1200 分,更慷慨)。
  if (!me.trial?.active) {
    // 还没领试用的老用户:经纪台里也要能一键领(不是只有 /agent/plans 那一条路)
    return <TrialClaimCard me={me} compact />
  }

  const days = me.trial.daysLeft ?? 0
  const balance = me.credits?.balance ?? 0
  const month = me.credits?.month ?? 0
  const urgent = days <= 2 || balance <= 40
  const pct = month > 0 ? Math.max(0, Math.min(100, (balance / month) * 100)) : 0

  return (
    <>
    <div
      className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-2.5 text-sm ${
        urgent
          ? 'border-amber-300/60 bg-amber-50 text-amber-900'
          : 'border-emerald-300/50 bg-emerald-50 text-emerald-900'
      }`}
    >
      <Sparkles className={`h-4 w-4 shrink-0 ${urgent ? 'text-amber-500' : 'text-emerald-500'}`} />
      <span className="font-semibold">
        {t('misc:freeTrial')}
        {' · '}
        {days > 0
          ? (days === 1 ? t('misc:dayLeft', { days }) : t('misc:daysLeft', { days }))
          : t('misc:endsToday')}
      </span>

      {/* 剩余积分 + 细进度条:用完就停,让他一直看得见 */}
      <span className="flex items-center gap-2">
        <span className={urgent ? 'text-amber-800' : 'text-emerald-800'}>
          {t('misc:creditsLeft', { balance, month })}
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
        className={`ms-auto inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white transition ${
          urgent ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
        }`}
      >
        {t('misc:subscribeCreditsResetNow')}
        <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
      </Link>
    </div>
    </>
  )
}
