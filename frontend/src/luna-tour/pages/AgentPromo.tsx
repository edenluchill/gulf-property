/**
 * 经纪台「推广有礼」tab (route: /agent/promo) — docs/referral-program-spec.md
 *
 * 「推广」= 推荐同行注册**付费**:被推荐人首月 20% off,推荐人每累计 3 个合格推荐得 1 个月免费。
 * 用 /i/:code 推荐链接(与「入驻海报」的扩散链接是**两条**,owner 2026-07-14 定,别混)。
 * 只放:推荐链接 + 分享 + 漏斗 + 进度 + 成就 badge + 已获奖励。入驻海报(+7天扩散)在登录弹窗。
 * 🔴 badge 只在经纪侧,绝不进客户可见页(见 spec §9.1)。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Gift, Users, MousePointerClick, BadgeDollarSign, Trophy, Loader2, Info, Copy, Check, Share2 } from 'lucide-react'
import { fetchReferral, type ReferralStats, type AttrStatus } from '../../lib/referralApi'

const BADGE_STYLE: Record<string, { bg: string; text: string; emoji: string }> = {
  connector: { bg: 'bg-sky-100', text: 'text-sky-700', emoji: '🔗' },
  ambassador: { bg: 'bg-violet-100', text: 'text-violet-700', emoji: '⭐' },
  gold: { bg: 'bg-amber-100', text: 'text-amber-700', emoji: '🏆' },
}

const STATUS_META: Record<AttrStatus, { zh: string; en: string; cls: string }> = {
  attached: { zh: '已注册', en: 'Signed up', cls: 'bg-slate-100 text-slate-600' },
  pending: { zh: '已付费 · 生效中', en: 'Paid · pending', cls: 'bg-sky-100 text-sky-700' },
  qualified: { zh: '已生效', en: 'Qualified', cls: 'bg-emerald-100 text-emerald-700' },
  expired: { zh: '已失效', en: 'Expired', cls: 'bg-slate-100 text-slate-400' },
  revoked: { zh: '已撤销', en: 'Revoked', cls: 'bg-rose-100 text-rose-600' },
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  return ms > 0 ? Math.ceil(ms / 86400_000) : 0
}

export default function AgentPromo() {
  const { t: tRaw, i18n } = useTranslation('lunaTour')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const zh = !!i18n.language?.startsWith('zh')
  const L = (a: string, b: string) => (zh ? a : b)
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  const load = () => {
    setLoading(true)
    fetchReferral().then(setStats).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [])

  async function copyLink() {
    if (!stats) return
    try { await navigator.clipboard.writeText(stats.link); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* noop */ }
  }
  async function shareLink() {
    if (!stats) return
    const text = t('lunaTour:signUpToPinzos')
    if (navigator.share) { try { await navigator.share({ title: 'Pinzos', text, url: stats.link }); return } catch { return } }
    copyLink()
  }

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
  }
  if (!stats) {
    return <div className="py-24 text-center text-slate-400">{t('lunaTour:couldNotLoadPlease')}</div>
  }

  const badge = stats.badge.tier !== 'none' ? BADGE_STYLE[stats.badge.tier] : null

  return (
    <div className="max-w-3xl space-y-6">   {/* 去掉 mx-auto/px-4:外层 main 已有内边距,再居中会两侧留白 */}
      {/* 标题 */}
      <div className="flex items-center gap-2">
        <Gift className="w-6 h-6 text-indigo-500" />
        <h1 className="text-xl font-bold text-slate-900">{t('lunaTour:referEarn')}</h1>
        {badge && (
          <span className={`ms-auto inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold ${badge.bg} ${badge.text}`}>
            {badge.emoji} {L(stats.badge.zh, stats.badge.label)}
          </span>
        )}
      </div>

      {/* 推荐链接卡:主行动 */}
      <div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 p-5 text-white shadow-lg shadow-indigo-500/20">
        <div className="text-sm font-medium text-indigo-100">{t('lunaTour:yourReferralLink')}</div>
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2.5">
          <span className="flex-1 truncate text-sm font-mono">{stats.link}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={copyLink} className="flex items-center justify-center gap-2 rounded-xl bg-white py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 transition active:scale-[0.99]">
            {copied ? <><Check className="w-4 h-4" /> {t('lunaTour:copied3')}</> : <><Copy className="w-4 h-4" /> {t('lunaTour:copyLink3')}</>}
          </button>
          <button onClick={shareLink} className="flex items-center justify-center gap-2 rounded-xl bg-indigo-900/40 py-2.5 text-sm font-semibold text-white hover:bg-indigo-900/60 transition active:scale-[0.99]">
            <Share2 className="w-4 h-4" /> {t('lunaTour:shareWithPeers')}
          </button>
        </div>
        <p className="mt-3 text-xs text-indigo-100">
          {t('lunaTour:peersWhoSignUp')}<b className="text-white">{t('lunaTour:20OffMonth1')}</b>
          {t('lunaTour:every')}<b className="text-white">{stats.perReward}</b>{t('lunaTour:whoPayEarnsYou')}<b className="text-white">{t('lunaTour:1FreeMonth')}</b>
        </p>
      </div>

      {/* 进度条 */}
      <div className="rounded-2xl bg-white ring-1 ring-slate-100 p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-500">{t('lunaTour:progressToNextFree')}</span>
          <span className="text-sm font-bold text-slate-900">{stats.progress} / {stats.perReward}</span>
        </div>
        <div className="mt-2.5 h-2.5 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 transition-all" style={{ width: `${(stats.progress / stats.perReward) * 100}%` }} />
        </div>
        <p className="mt-3 text-sm text-slate-500">
          {t('lunaTour:refer')}<b className="text-indigo-600">{stats.towardNext}</b>{t('lunaTour:morePayingPeersTo')}<b className="text-indigo-600">{t('lunaTour:1FreeMonth2')}</b>
        </p>
      </div>

      {/* 漏斗 */}
      <div className="grid grid-cols-3 gap-3">
        <Stat icon={MousePointerClick} label={t('lunaTour:clicks')} value={stats.clicks} tint="text-sky-500" />
        <Stat icon={Users} label={t('lunaTour:signups')} value={stats.signups} tint="text-indigo-500" />
        <Stat icon={BadgeDollarSign} label={t('lunaTour:paid')} value={stats.paid} tint="text-emerald-500" />
      </div>

      {/* 推荐明细 */}
      {stats.referrals.length > 0 && (
        <div className="rounded-2xl bg-white ring-1 ring-slate-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-700">{t('lunaTour:referralDetails')}</div>
          <div className="divide-y divide-slate-50">
            {stats.referrals.map((r, i) => {
              const meta = STATUS_META[r.status]
              const holdDays = daysUntil(r.holdUntil)
              const expDays = daysUntil(r.expiresAt)
              return (
                <div key={i} className="flex items-center justify-between px-4 py-3">
                  <div className="text-sm text-slate-600 font-mono">{r.email}</div>
                  <div className="flex items-center gap-2">
                    {r.status === 'pending' && holdDays != null && (
                      <span className="text-xs text-slate-400">{t('lunaTour:activeInD', { holdDays })}</span>
                    )}
                    {r.status === 'attached' && expDays != null && (
                      <span className="text-xs text-slate-400">{t('lunaTour:dLeft', { expDays })}</span>
                    )}
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.cls}`}>{L(meta.zh, meta.en)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 已获奖励 */}
      {stats.rewards.length > 0 && (
        <div className="rounded-2xl bg-white ring-1 ring-slate-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Trophy className="w-4 h-4 text-amber-500" /> {t('lunaTour:rewardsEarned')}
          </div>
          <div className="divide-y divide-slate-50">
            {stats.rewards.map((r) => (
              <div key={r.milestone} className="flex items-center justify-between px-4 py-3">
                <div className="text-sm text-slate-600">{t('lunaTour:freeMonth', { r_milestone: r.milestone })}</div>
                <div className="flex items-center gap-2">
                  {r.amount != null && (
                    <span className="text-sm font-semibold text-emerald-600">
                      -{r.amount.toFixed(2)} {(r.currency || '').toUpperCase()}
                    </span>
                  )}
                  <span className={`text-xs rounded-full px-2.5 py-0.5 font-medium ${
                    r.status === 'applied' ? 'bg-emerald-100 text-emerald-700'
                    : r.status === 'blocked' ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-100 text-slate-500'}`}>
                    {r.status === 'applied' ? t('lunaTour:applied') : r.status === 'blocked' ? t('lunaTour:underReview') : t('lunaTour:pending')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 规则说明 */}
      <div className="flex gap-2 rounded-xl bg-slate-50 p-3.5 text-xs text-slate-500 leading-relaxed">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
        <div>
          {t('lunaTour:aPeerWhoSigns', { stats_perReward: stats.perReward })}
        </div>
      </div>
    </div>
  )
}

function Stat({ icon: Icon, label, value, tint }: { icon: typeof Users; label: string; value: number; tint: string }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-100 p-4 text-center">
      <Icon className={`w-5 h-5 mx-auto ${tint}`} />
      <div className="mt-1.5 text-2xl font-black text-slate-900">{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  )
}
