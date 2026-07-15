/**
 * 经纪台「推广有礼」tab (route: /agent/promo) — docs/referral-program-spec.md
 *
 * 恭喜入驻海报(分享入口)+ 推荐漏斗 + 进度条 + 成就 badge + 推荐明细 + 已获奖励。
 * 每累计 3 个「合格推荐」(被推荐人真实付费满 30 天)→ 得 1 个月订阅费抵扣。
 *
 * 🔴 badge 只在这里(经纪侧)显示,绝不进客户可见页面(见 spec §9.1)。
 */
import { useEffect, useState } from 'react'
import { Gift, Users, MousePointerClick, BadgeDollarSign, Trophy, Loader2, Info } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { fetchReferral, type ReferralStats, type AttrStatus } from '../../lib/referralApi'
import CelebrationPoster from '../components/CelebrationPoster'

const BADGE_STYLE: Record<string, { bg: string; text: string; emoji: string }> = {
  connector: { bg: 'bg-sky-100', text: 'text-sky-700', emoji: '🔗' },
  ambassador: { bg: 'bg-violet-100', text: 'text-violet-700', emoji: '⭐' },
  gold: { bg: 'bg-amber-100', text: 'text-amber-700', emoji: '🏆' },
}

const STATUS_META: Record<AttrStatus, { zh: string; cls: string }> = {
  attached: { zh: '已注册', cls: 'bg-slate-100 text-slate-600' },
  pending: { zh: '已付费 · 生效中', cls: 'bg-sky-100 text-sky-700' },
  qualified: { zh: '已生效', cls: 'bg-emerald-100 text-emerald-700' },
  expired: { zh: '已失效', cls: 'bg-slate-100 text-slate-400' },
  revoked: { zh: '已撤销', cls: 'bg-rose-100 text-rose-600' },
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  return ms > 0 ? Math.ceil(ms / 86400_000) : 0
}

export default function AgentPromo() {
  const { user } = useAuth()
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [loading, setLoading] = useState(true)

  const name = (user?.user_metadata?.name as string) || user?.email?.split('@')[0] || '经纪'
  const avatarUrl = (user?.user_metadata?.avatar_url as string) || (user?.user_metadata?.picture as string) || null

  const load = () => {
    setLoading(true)
    fetchReferral().then(setStats).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [])

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
  }
  if (!stats) {
    return <div className="py-24 text-center text-slate-400">暂时无法加载推广信息,请稍后再试</div>
  }

  const badge = stats.badge.tier !== 'none' ? BADGE_STYLE[stats.badge.tier] : null

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* 标题 */}
      <div className="flex items-center gap-2">
        <Gift className="w-6 h-6 text-indigo-500" />
        <h1 className="text-xl font-bold text-slate-900">推广有礼</h1>
        {badge && (
          <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold ${badge.bg} ${badge.text}`}>
            {badge.emoji} {stats.badge.zh}
          </span>
        )}
      </div>

      {/* 恭喜入驻海报 + 分享 */}
      <CelebrationPoster
        name={name}
        avatarUrl={avatarUrl}
        link={stats.link}
        shareRewardClaimed={stats.shareRewardClaimed}
        shareRewardDays={stats.shareRewardDays}
        onClaimed={load}
      />

      {/* 进度条:再推荐 N 位付费同行,得 1 个月免费 */}
      <div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 p-5 text-white shadow-lg shadow-indigo-500/20">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-indigo-100">距离下一个「免费月」</span>
          <span className="text-sm font-bold">{stats.progress} / {stats.perReward}</span>
        </div>
        <div className="mt-2.5 h-2.5 rounded-full bg-white/25 overflow-hidden">
          <div className="h-full rounded-full bg-white transition-all" style={{ width: `${(stats.progress / stats.perReward) * 100}%` }} />
        </div>
        <p className="mt-3 text-sm text-indigo-50">
          再推荐 <b className="text-white">{stats.towardNext}</b> 位付费同行,即可获得 <b className="text-white">1 个月免费</b>
        </p>
      </div>

      {/* 漏斗 */}
      <div className="grid grid-cols-3 gap-3">
        <Stat icon={MousePointerClick} label="点击" value={stats.clicks} tint="text-sky-500" />
        <Stat icon={Users} label="注册" value={stats.signups} tint="text-indigo-500" />
        <Stat icon={BadgeDollarSign} label="付费" value={stats.paid} tint="text-emerald-500" />
      </div>

      {/* 推荐明细 */}
      {stats.referrals.length > 0 && (
        <div className="rounded-2xl bg-white ring-1 ring-slate-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-700">推荐明细</div>
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
                      <span className="text-xs text-slate-400">{holdDays} 天后生效</span>
                    )}
                    {r.status === 'attached' && expDays != null && (
                      <span className="text-xs text-slate-400">剩 {expDays} 天</span>
                    )}
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.cls}`}>{meta.zh}</span>
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
            <Trophy className="w-4 h-4 text-amber-500" /> 已获奖励
          </div>
          <div className="divide-y divide-slate-50">
            {stats.rewards.map((r) => (
              <div key={r.milestone} className="flex items-center justify-between px-4 py-3">
                <div className="text-sm text-slate-600">第 {r.milestone} 个免费月</div>
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
                    {r.status === 'applied' ? '已抵扣账单' : r.status === 'blocked' ? '审核中' : '待生效'}
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
          被推荐的同行通过你的链接注册并**真实付费**满 30 天,即算 1 个合格推荐;每满 {stats.perReward} 个,
          你的下一期账单自动抵扣 1 个月订阅费。被推荐人首月享 8 折。试用不计入。退款/取消会相应扣减进度。
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
