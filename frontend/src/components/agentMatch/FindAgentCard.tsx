/**
 * 「找真人帮忙」—— 买家侧的选人 + 留言表单。弹窗和地图区域弹窗共用。
 *
 * 流程是两态,**不是三态**(owner 2026-08-09 定的形态):
 *   ① 选人 + 留言 —— 摆 3 位正在排班的顾问让买家挑,同屏留联系方式和想问的
 *   ② 结果       —— 拿到 WhatsApp / 公开邮箱,或者"需求已转交"
 *
 * 🔴 **入口按钮上不显示是谁**(那在 FindAgentDock / FindAgentChip 里)。
 *    像 Uber:点之前不知道会是谁,点开才看到人选。
 *
 * 🔴 **看到候选 ≠ 消耗轮次。** 候选是只读拉的;轮次只在买家真的选了人并提交
 *    (matchAgent + reveal)时才消耗。否则每个点开弹窗的人都会一次吃掉 3 个名额。
 *
 * 🔴 **候选按轮值顺序取,展示顺序才是随机的。** 真随机会跳过等最久的人,
 *    轮值就白做了 —— 打乱只影响观感,被提名的机会严格按队列走(见 fetchCandidates)。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UserRound, Loader2, MessageCircle, Phone, BadgeCheck, Mail, Check } from 'lucide-react'
import { matchAgent, fetchCandidates, revealContact, type MatchedAgent, type RevealedContact } from '../../lib/agentMatchApi'
import { trackEvent } from '../../lib/track'

/**
 * 头像;没传照片就画一个中性图标 —— **绝不用姓名首字母拼一个假头像**。
 *
 * ⚠️ 尺寸走这张查表,**不要写 `h-${size}`** —— Tailwind 是静态扫源码生成 CSS 的,
 *    拼出来的类名它看不见,结果是头像没有宽高、塌成 0×0。
 */
const AVATAR_SIZE = { 9: 'h-9 w-9', 10: 'h-10 w-10', 11: 'h-11 w-11' } as const

export function AgentAvatar({ agent, size = 10 }: {
  agent: { photo_url?: string | null } | null
  size?: keyof typeof AVATAR_SIZE
}) {
  const cls = AVATAR_SIZE[size]
  return agent?.photo_url
    ? <img src={agent.photo_url} alt="" className={`${cls} rounded-full object-cover ring-1 ring-slate-200`} />
    : <span className={`${cls} flex items-center justify-center rounded-full bg-slate-100 text-slate-400 ring-1 ring-slate-200`}>
        <UserRound className="h-1/2 w-1/2" />
      </span>
}

type Cand = MatchedAgent & { id: string }

export default function FindAgentCard({ projectId, projectName, source, compact }: {
  projectId?: string
  /** 预填 WhatsApp 开场白时写进去 —— 让经纪一眼知道买家在看哪个盘 */
  projectName?: string
  source: 'project' | 'map'
  /** 地图弹窗里空间紧,收窄留白 */
  compact?: boolean
}) {
  const { t, i18n } = useTranslation('misc')
  const [cands, setCands] = useState<Cand[] | null>(null)
  const [chosen, setChosen] = useState<Cand | null>(null)
  const [contact, setContact] = useState<RevealedContact | null>(null)
  const [note, setNote] = useState('')
  const [myContact, setMyContact] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // 候选是**只读**拉的:不写库、不占轮换名额,所以挂载时调是安全的
  useEffect(() => {
    let alive = true
    fetchCandidates(projectId, 3).then((list) => {
      if (!alive) return
      setCands(list)
      if (list.length === 1) setChosen(list[0])   // 只有一位就不用挑
    })
    return () => { alive = false }
  }, [projectId])

  /** relay 渠道下买家看不到任何地址,只能靠我们转发 —— 没有回址等于死信。 */
  const needContact = chosen?.channel === 'relay'

  const submit = async () => {
    if (!chosen) { setErr(t('agentMatch.pickOne')); return }
    if (needContact && !myContact.trim()) { setErr(t('agentMatch.contactRequired')); return }
    setErr(''); setBusy(true)
    trackEvent('contact_attempt', { contact_type: 'agent_match_submit' }, { project_id: projectId, immediate: true })
    /**
     * prefer 带上买家选中的那位。服务端会**重新验此人还在池子里** ——
     * 直接信前端传来的 id 的话,谁都能指定任意 agent 把买家派给自己人,
     * 连"暂停接单/掉订阅"都绕过去了。
     */
    const r = await matchAgent({ projectId, source, prefer: chosen.id })
    if (!r.agent || !r.matchId) { setErr(t('agentMatch.tryAgain')); setBusy(false); return }
    setContact(await revealContact(r.matchId, { contact: myContact, note, lang: i18n.language }))
    setBusy(false)
  }

  const pad = compact ? 'p-3' : 'p-4'

  // 池子空 —— 什么都不渲染(外层入口也是靠这个判断隐藏的)
  if (cands && cands.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">{t('agentMatch.noneAvailable')}</p>
  }
  if (!cands) {
    return <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-slate-300" /></div>
  }

  // ── ② 结果 ────────────────────────────────────────────────────────────────
  if (contact) {
    const waText = t('agentMatch.waPrefill', { project: projectName ? ` (${projectName})` : '' }).trim()
    return (
      <div className={`rounded-2xl bg-white ${pad} ring-1 ring-slate-200`}>
        <div className="flex items-center gap-3">
          <AgentAvatar agent={chosen} size={10} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{contact.display_name}</p>
            <p className="truncate text-xs text-slate-500">
              {[chosen?.title, chosen?.brokerage].filter(Boolean).join(' · ') || t('agentMatch.roleFallback')}
            </p>
          </div>
        </div>

        {contact.channel === 'relay' && (
          <p className={`mt-3 rounded-xl px-3 py-2.5 text-sm leading-relaxed ${
            contact.relayed ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'
          }`}>
            {contact.relayed
              ? t('agentMatch.relaySent', { name: contact.display_name || '' })
              : t('agentMatch.relayFailed')}
          </p>
        )}

        {/* 没留联系方式时**如实说**:顾问没法主动找你,得你把消息发出去。
            不说的话买家会干等,而经纪那边什么也没有。 */}
        {contact.channel !== 'relay' && !myContact.trim() && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            {t('agentMatch.mustReachOut')}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {contact.whatsapp && (
            /* 预填第一条消息 —— 匿名买家可以什么都不留就拿走号码,
               不预填的话经纪收到一条陌生消息,不知道来自哪个盘、是不是 Pinzos。 */
            <a href={`https://wa.me/${contact.whatsapp.replace(/[^\d]/g, '')}?text=${encodeURIComponent(waText)}`}
              target="_blank" rel="noreferrer"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600">
              <MessageCircle className="h-4 w-4" />WhatsApp
            </a>
          )}
          {contact.phone && (
            <a href={`tel:${contact.phone}`}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
              <Phone className="h-4 w-4" />{t('agentMatch.call')}
            </a>
          )}
          {contact.email && (
            <a href={`mailto:${contact.email}`}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
              <Mail className="h-4 w-4" />{contact.email}
            </a>
          )}
        </div>
      </div>
    )
  }

  // ── ① 选人 + 留言 ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {cands.length > 1 && (
        <>
          <p className="text-xs text-slate-500">{t('agentMatch.pickHint')}</p>
          <ul className="space-y-2">
            {cands.map((c) => {
              const on = chosen?.id === c.id
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => { setChosen(c); setErr('') }}
                    className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-start transition ${
                      on ? 'bg-teal-50 ring-2 ring-teal-500' : 'bg-white ring-1 ring-slate-200 hover:ring-slate-300'
                    }`}>
                    <AgentAvatar agent={c} size={10} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">{c.display_name}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {[c.title, c.brokerage].filter(Boolean).join(' · ') || t('agentMatch.roleFallback')}
                      </span>
                      {/* RERA 牌照号只在**真有**的时候显示 —— 编一个「已认证」徽章出来
                          是在替一个我们没验证过的人背书 */}
                      {c.rera_brn && (
                        <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-px text-[10px] font-medium text-emerald-700">
                          <BadgeCheck className="h-3 w-3" />BRN {c.rera_brn}
                        </span>
                      )}
                    </span>
                    {on && <Check className="h-4 w-4 shrink-0 text-teal-600" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {/* 两个输入:relay 渠道下联系方式是**必填**(他看不到地址,经纪只能回过去) */}
      <input value={myContact} onChange={(e) => setMyContact(e.target.value)} maxLength={120}
        placeholder={needContact ? t('agentMatch.yourContactRequired') : t('agentMatch.yourContact')}
        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none" />
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500}
        placeholder={t('agentMatch.yourNote')}
        className="w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none" />

      {err && <p className="text-xs font-medium text-rose-600">{err}</p>}

      <button type="button" onClick={submit} disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
        {needContact ? t('agentMatch.sendRequest') : t('agentMatch.getContact')}
      </button>
    </div>
  )
}
