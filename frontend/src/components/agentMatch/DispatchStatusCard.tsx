/**
 * 「我的派单状态」卡片 —— 经纪台首页和「买家匹配」页共用。
 *
 * owner 2026-08-09:「经纪台没办法看到自己的派单状态呀」。之前状态只藏在
 * 「买家匹配」那一页里,而经纪落地的是 Dashboard —— 等于要先知道它存在才看得到。
 *
 * 这张卡回答三个问题,按重要性排:
 *   ① 我现在接不接得到买家?接不到是差什么?
 *   ② **还要等几个人才轮到我?**(经纪最想知道的其实是这个)
 *   ③ 到目前为止分到过几条
 *
 * 🔴 判据全部来自服务端 `/pool` —— 前端**不自己拼** `in_pool`。
 *    排班表和这张卡都因为"前端再拼一遍"显示过「正在接单」而实际根本轮不到。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { UserRoundSearch, AlertTriangle, Phone, ChevronRight, Loader2 } from 'lucide-react'
import { fetchPoolStatus, type PoolStatus } from '../../lib/agentMatchApi'

export default function DispatchStatusCard({ compact }: { compact?: boolean }) {
  const { t } = useTranslation('misc')
  const [pool, setPool] = useState<PoolStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void fetchPoolStatus().then((p) => { setPool(p); setLoading(false) })
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center rounded-2xl bg-white py-6 ring-1 ring-slate-200">
        <Loader2 className="h-4 w-4 animate-spin text-slate-300" />
      </div>
    )
  }
  // 内部账号(owner 的号 / demo)永远不进派单 —— 对他们整张卡没有意义,不渲染
  if (!pool || pool.internal) return null

  const ok = pool.in_pool
  const waiting = ok && !pool.got_this_round && pool.queue_position

  return (
    <div className={`rounded-2xl p-4 ring-1 ${ok ? 'bg-white ring-slate-200' : 'bg-amber-50/60 ring-amber-100'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {ok ? <UserRoundSearch className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />}
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${ok ? 'text-slate-900' : 'text-amber-800'}`}>
              {pool.paused ? t('agentMatch.paused')
                : !pool.subscribed ? t('agentMatch.needSub')
                : !pool.has_contact ? t('agentMatch.needContact')
                : t('agentMatch.inPool')}
            </p>

            {/* ② 还要等几个人 —— 这才是经纪最想知道的。
                本轮已经拿过 / 排不出名次时**不编数字**,如实说另一种情况。 */}
            {ok && (
              <p className="mt-0.5 text-xs text-slate-500">
                {pool.got_this_round
                  ? t('agentMatch.gotThisRound', { round: pool.round_no })
                  : waiting
                    ? t('agentMatch.queuePos', { pos: pool.queue_position, len: pool.queue_length })
                    : t('agentMatch.inQueue')}
              </p>
            )}

            {/* 差手机号是最常见的原因,而且一步就能解决 —— 直接给到个人资料的链接 */}
            {!pool.has_contact && pool.subscribed && (
              <Link to="/profile" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-700 underline-offset-2 hover:underline">
                <Phone className="h-3 w-3" />{t('agentMatch.goFillContact')}
              </Link>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="text-end">
            <div className="text-xl font-semibold tabular-nums text-slate-900">{pool.leads_total ?? 0}</div>
            <div className="text-[10px] text-slate-400">{t('agentMatch.leadsTotal')}</div>
          </div>
          {!compact && (
            <Link to="/agent/matches"
              className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800">
              {t('agentMatch.viewAll')}<ChevronRight className="h-3 w-3 rtl:rotate-180" />
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
