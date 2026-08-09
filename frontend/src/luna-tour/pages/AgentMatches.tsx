/**
 * 经纪台 →「分配给我的买家」。
 *
 * 这一页有两个职责,第二个才是重点:
 *   ① 列出派给我的买家
 *   ② **告诉我为什么没有买家** —— 2026-08-09 实测:付费/试用 33 人里只有 2 人
 *      填了手机号,其余 31 人**永远不会被派到**,而他们自己完全不知道。
 *      所以「差一个手机号」这行提示比列表本身更重要,放在最上面。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Loader2, UserRound, Phone, MessageSquare, Check, Pause, Play, AlertTriangle, Copy, Mail, RotateCcw } from 'lucide-react'
import {
  fetchMyMatches, fetchPoolStatus, setPaused, ackMatch, markDeadLead,
  type MyMatch, type PoolStatus,
} from '../../lib/agentMatchApi'

export default function AgentMatches() {
  const { t, i18n } = useTranslation('misc')
  const [matches, setMatches] = useState<MyMatch[] | null>(null)
  const [pool, setPool] = useState<PoolStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
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

  const fmt = (s: string) => new Date(s).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{t('agentMatch.hubTitle')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('agentMatch.hubSub')}</p>
      </div>

      {/* ── 接单状态 —— 这一块是这页最重要的东西 ─────────────────────────── */}
      {pool && (
        <div className={`rounded-2xl p-4 ring-1 ${
          pool.in_pool ? 'bg-emerald-50/60 ring-emerald-100' : 'bg-amber-50/60 ring-amber-100'
        }`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              {pool.in_pool
                ? <UserRound className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />}
              <div>
                <p className={`text-sm font-semibold ${pool.in_pool ? 'text-emerald-800' : 'text-amber-800'}`}>
                  {pool.paused ? t('agentMatch.paused') : pool.in_pool ? t('agentMatch.inPool')
                    : !pool.subscribed ? t('agentMatch.needSub') : t('agentMatch.needContact')}
                </p>
                {/* 差手机号是**最常见**的原因,而且一步就能解决 —— 直接给个到个人资料的链接,
                    别只说"资料不全"让人自己找。 */}
                {!pool.has_contact && pool.subscribed && (
                  <Link to="/profile" className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-amber-700 underline-offset-2 hover:underline">
                    <Phone className="h-3 w-3" />{t('agentMatch.needContact')}
                  </Link>
                )}
                {pool.in_pool && typeof pool.matched_30d === 'number' && (
                  <p className="mt-0.5 text-xs text-emerald-700">
                    {t('agentMatch.matched30d')}: <b className="tabular-nums">{pool.matched_30d}</b>
                  </p>
                )}
              </div>
            </div>
            {pool.subscribed && pool.has_contact && (
              <button type="button" onClick={togglePause} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50">
                {pool.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                {pool.paused ? t('agentMatch.resume') : t('agentMatch.pause')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── 买家列表 ──────────────────────────────────────────────────────── */}
      {matches === null ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
      ) : matches.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
          {t('agentMatch.hubEmpty')}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {matches.map((m) => (
            <li key={m.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
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
                <p className="mt-1.5 text-sm font-medium text-slate-800">
                  <Phone className="me-1 inline h-3.5 w-3.5 text-slate-400" />{m.buyer_contact}
                </p>
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
          ))}
        </ul>
      )}
    </div>
  )
}
