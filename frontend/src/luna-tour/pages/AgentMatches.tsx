/**
 * 经纪台 →「分配给我的买家」。
 *
 * 这一页有四个职责,第二个才是重点:
 *   ① 列出派给我的买家
 *   ② **告诉我为什么没有买家** —— 2026-08-09 实测:付费/试用 33 人里只有 2 人
 *      填了手机号,其余 31 人**永远不会被派到**,而他们自己完全不知道。
 *      所以「差一个手机号」这行提示比列表本身更重要,放在最上面。
 *   ③ **信息栏** —— 本轮第几 / 排第几位 / 累计几条 / 几条真要了联系方式 / 几条待跟进。
 *      owner 2026-08-09:「一点也看不到排班状况和历史 也没有信息栏」。
 *   ④ **历史按轮分段** —— 派单是轮值制,「第 3 轮」比「8 月 7 日」更能说明
 *      "我在这一轮里拿到了",时间只是次要坐标。
 *
 * 🔴 **内部账号会看到一张空页。** DispatchStatusCard 对内部号返回 null(对他们无意义),
 *    列表也永远是空的 —— owner 自己看到的就是一片空白,所以才觉得"这页没用"。
 *    这里必须给一条明说的说明条,不能什么都不画。
 */
import { Fragment, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { Loader2, Phone, MessageSquare, Check, Pause, Play, Copy, Mail, RotateCcw, ChevronRight } from 'lucide-react'
import DispatchStatusCard from '../../components/agentMatch/DispatchStatusCard'
import {
  fetchMyMatches, fetchPoolStatus, setPaused, ackMatch, markDeadLead,
  type MyMatch, type PoolStatus,
} from '../../lib/agentMatchApi'

export default function AgentMatches() {
  const { t, i18n } = useTranslation('misc')
  const { isAdmin } = useAuth()
  const [matches, setMatches] = useState<MyMatch[] | null>(null)
  const [pool, setPool] = useState<PoolStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
  const [filter, setFilter] = useState<'all' | 'todo' | 'done'>('all')
  const locale = i18n.language.startsWith('zh') ? 'zh-CN' : i18n.language

  useEffect(() => {
    void fetchMyMatches().then(setMatches)
    void fetchPoolStatus().then(setPool)
  }, [])

  const togglePause = async () => {
    if (!pool) return
    setBusy(true)
    const next = !pool.paused
    if (await setPaused(next)) setPool({ ...pool, paused: next, in_pool: !next && pool.subscribed && pool.has_contact })
    setBusy(false)
  }

  const toggleAck = async (m: MyMatch) => {
    const done = !m.agent_ack_at
    if (await ackMatch(m.id, done)) {
      setMatches((p) => (p || []).map((x) => (x.id === m.id ? { ...x, agent_ack_at: done ? new Date().toISOString() : null } : x)))
    }
  }

  const revealed = (matches || []).filter((m) => m.revealed_at).length
  const todo = (matches || []).filter((m) => !m.agent_ack_at).length
  const shown = (matches || []).filter((m) =>
    filter === 'all' ? true : filter === 'todo' ? !m.agent_ack_at : !!m.agent_ack_at)

  const fmt = (s: string) => new Date(s).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{t('agentMatch.hubTitle')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('agentMatch.hubSub')}</p>
      </div>

      {/* 状态卡和经纪台首页**共用同一个件** —— 各画一遍必然漂移
          (排班表就因为"前端再拼一遍 in_pool"显示过「正在接单」而实际轮不到)。 */}
      <DispatchStatusCard compact />

      {/* 内部号:状态卡不渲染 + 列表恒空 = 一片空白。明说一句,别让人以为坏了。
          admin 再给一个**能点的**去处 —— 只写「去后台看」而不给链接等于让人自己找。 */}
      {pool?.internal && (
        <p className="rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-500 ring-1 ring-slate-200">
          {t('agentMatch.internalNote')}
          {isAdmin && (
            <Link to="/admin/analytics?tab=dispatch"
              className="ms-1 inline-flex items-center gap-1 font-medium text-teal-600 underline-offset-2 hover:underline">
              {t('agentMatch.openAdminDispatch')}<ChevronRight className="h-3 w-3 rtl:rotate-180" />
            </Link>
          )}
        </p>
      )}

      {/* ── 信息栏 ────────────────────────────────────────────────────────
          五个数一行摆开。**一个都不许在前端拼**(in_pool / 轮次都来自服务端),
          能在前端算的只有列表自己的计数。 */}
      {pool && !pool.internal && (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-slate-200 ring-1 ring-slate-200 sm:grid-cols-5">
          <Stat label={t('agentMatch.statRound')} value={pool.round_no != null ? `#${pool.round_no}` : '—'} />
          <Stat label={t('agentMatch.statQueue')}
            value={pool.got_this_round ? t('agentMatch.statQueueGot')
              : pool.queue_position != null ? `${pool.queue_position}/${pool.queue_length}` : '—'} />
          <Stat label={t('agentMatch.statTotal')} value={String(matches?.length ?? '—')} />
          <Stat label={t('agentMatch.statRevealed')} value={String(revealed)} accent />
          <Stat label={t('agentMatch.statTodo')} value={String(todo)} />
        </dl>
      )}

      {/* 暂停/恢复接单 —— 只有真在池子里的人才需要这个开关 */}
      {pool?.in_pool && (
        <button type="button" onClick={togglePause} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50">
          {pool.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          {pool.paused ? t('agentMatch.resume') : t('agentMatch.pause')}
        </button>
      )}

      {/* ── 买家列表 ──────────────────────────────────────────────────────── */}
      {matches === null ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
      ) : matches.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
          {t('agentMatch.hubEmpty')}
        </p>
      ) : (
        <>
          {/* 过滤 —— 「待跟进」是经纪每天真正要打开的那一档,放在中间最好按 */}
          <div className="flex flex-wrap gap-1.5">
            {([['all', matches.length], ['todo', todo], ['done', matches.length - todo]] as const).map(([f, n]) => (
              <button key={f} type="button" onClick={() => setFilter(f)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  filter === f ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}>
                {f === 'all' ? t('agentMatch.filterAll') : f === 'todo' ? t('agentMatch.filterTodo') : t('agentMatch.filterDone')}
                <span className="tabular-nums opacity-60">{n}</span>
              </button>
            ))}
          </div>

        <ul className="space-y-2.5">
          {shown.map((m, idx) => (
          <Fragment key={m.id}>
          {/* 轮次分隔 —— 历史按轮读才有意义(见文件头 ④) */}
          {(idx === 0 || shown[idx - 1].round_no !== m.round_no) && (
            <li className="flex items-center gap-2 pt-1 first:pt-0">
              <span className="text-[11px] font-semibold text-slate-400">
                {m.round_no != null ? t('agentMatch.roundLabel', { n: m.round_no }) : t('agentMatch.roundNone')}
              </span>
              <span className="h-px flex-1 bg-slate-200" />
            </li>
          )}
            <li className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className="tabular-nums">{fmt(m.created_at)}</span>
                {m.project_name && <span className="font-medium text-slate-600">{m.project_name}</span>}
                {/* revealed = 买家真的要了联系方式。这条比"被分配"重要得多,
                    所以给它一个显眼的绿标,别和普通分配混在一起。 */}
                {m.revealed_at && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    <Check className="h-3 w-3" />{t('agentMatch.buyerAsked')}
                  </span>
                )}
              </div>
              {m.buyer_contact ? (
                /* 买家自己选了类型(whatsapp / phone / email),所以这里能给一个
                   **能直接点**的动作,而不是让经纪自己复制粘贴。
                   ⚠️ buyer_contact_type 上线前的老记录是 null —— 那时按值里有没有
                      '@' 兜底,别假设非空。 */
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">
                    {m.buyer_contact_type === 'email' || (!m.buyer_contact_type && m.buyer_contact.includes('@'))
                      ? <Mail className="me-1 inline h-3.5 w-3.5 text-slate-400" />
                      : m.buyer_contact_type === 'whatsapp'
                        ? <MessageSquare className="me-1 inline h-3.5 w-3.5 text-emerald-500" />
                        : <Phone className="me-1 inline h-3.5 w-3.5 text-slate-400" />}
                    {m.buyer_contact}
                  </span>
                  {m.buyer_contact_type === 'whatsapp' && (
                    <a href={`https://wa.me/${m.buyer_contact.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-emerald-600">
                      <MessageSquare className="h-3 w-3" />WhatsApp
                    </a>
                  )}
                  {m.buyer_contact_type === 'phone' && (
                    <a href={`tel:${m.buyer_contact}`}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-slate-800">
                      <Phone className="h-3 w-3" />{t('agentMatch.call')}
                    </a>
                  )}
                </div>
              ) : (
                /* 买家没留联系方式(WhatsApp 渠道下是允许的:他拿了号自己去发消息)。
                   **说清楚该怎么办**,别只写一句「未留」让人干瞪眼。 */
                <div className="mt-1.5 rounded-xl bg-amber-50 px-3 py-2">
                  <p className="text-xs leading-relaxed text-amber-800">{t('agentMatch.noContactHint')}</p>
                  <button type="button"
                    onClick={async () => {
                      if (await markDeadLead(m.id)) {
                        setMatches((p) => (p || []).filter((x) => x.id !== m.id))
                        void fetchPoolStatus().then(setPool)
                      }
                    }}
                    className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200 transition hover:bg-amber-100">
                    <RotateCcw className="h-3 w-3" />{t('agentMatch.markDead')}
                  </button>
                </div>
              )}
              {m.buyer_note && (
                <p className="mt-1 whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-600">
                  <MessageSquare className="me-1 inline h-3.5 w-3.5 text-slate-400" />{m.buyer_note}
                </p>
              )}
              {/* ── 现成的联系邮件 ────────────────────────────────────────
                  我们**不替经纪发信**(owner:「不用帮他发邮件 给他准备模板就好」)——
                  署名、回信地址、后续往来都该在他自己手里。这里只把写好的主题和
                  正文摆出来:复制,或者直接打开邮件客户端。
                  文案是按**买家的语言**生成的(后端 agentOutreachTemplate),
                  不是按经纪的 —— 收信的是买家。
                  之前没有模板时,实测经纪发出去的是一封无主题的一句话邮件。 */}
              {m.template && (
                <div className="mt-2.5 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">
                      {m.template.subject}
                    </p>
                    <div className="flex shrink-0 gap-1.5">
                      <button type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(`${m.template!.subject}

${m.template!.body}`)
                          setCopied(m.id); setTimeout(() => setCopied(null), 1600)
                        }}
                        className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50">
                        {copied === m.id ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                        {t('agentMatch.copyTemplate')}
                      </button>
                      {/* 买家留的是邮箱才给 mailto —— 留手机的话这个链接没意义 */}
                      {m.buyer_contact && m.buyer_contact.includes('@') && (
                        <a href={`mailto:${m.buyer_contact}?subject=${encodeURIComponent(m.template.subject)}&body=${encodeURIComponent(m.template.body)}`}
                          className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-slate-800">
                          <Mail className="h-3 w-3" />{t('agentMatch.openMail')}
                        </a>
                      )}
                    </div>
                  </div>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-slate-500">
                    {m.template.body}
                  </pre>
                </div>
              )}

              <button type="button" onClick={() => toggleAck(m)}
                className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
                  m.agent_ack_at ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100'
                }`}>
                <Check className="h-3 w-3" />{m.agent_ack_at ? t('agentMatch.doneMark') : t('agentMatch.markDone')}
              </button>
            </li>
          </Fragment>
          ))}
        </ul>
        </>
      )}
    </div>
  )
}

/** 信息栏的一格。数字用 tabular-nums,否则一行里五个数会左右跳。 */
function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-white px-3 py-2.5">
      <dt className="truncate text-[10px] text-slate-400">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${accent ? 'text-emerald-600' : 'text-slate-900'}`}>{value}</dd>
    </div>
  )
}
