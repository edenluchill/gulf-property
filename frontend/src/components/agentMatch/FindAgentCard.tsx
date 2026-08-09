/**
 * 「找经纪帮我」—— 买家侧入口。项目详情页和地图区域弹窗共用这一个件。
 *
 * 三段式,每一段都是有意的:
 *   ① 按钮      —— **点了才去派单**。挂载就预取的话,轮换名额会被一堆压根没想找
 *                   经纪的人消耗掉,"派给谁"就失去意义了(而且库里全是假记录)。
 *   ② 经纪卡片  —— 只有名字/头像/头衔。**没有电话**。
 *   ③ 联系方式  —— 再点一次才发。这一下才是真正的转化信号。
 *
 * 池子空(没有任何付费/试用且留了联系方式的经纪)时**整个组件不渲染** ——
 * 摆一个点了说"暂时没有经纪"的按钮,比没有按钮更伤。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UserRound, Loader2, MessageCircle, Phone, BadgeCheck, Mail } from 'lucide-react'
import { matchAgent, peekNextAgent, revealContact, type MatchedAgent, type RevealedContact } from '../../lib/agentMatchApi'
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

export default function FindAgentCard({ projectId, source, compact, variant = 'card', autoStart }: {
  projectId?: string
  source: 'project' | 'map'
  /** 地图弹窗里空间紧,收窄留白 */
  compact?: boolean
  /**
   * 'card' 独立卡片(地图区域弹窗内)
   * 'bar'  **通栏横条** —— 项目详情页顶部那条,和 ProjectTourCta 并排,不用滚就看得见
   */
  variant?: 'card' | 'bar'
  /** 挂载即派单。**只给"用户已经点过一次才会挂载"的场景用**(例如弹窗内部)。
   *  普通页面绝不能开 —— 那就变成预取了,轮换名额会被没想找经纪的人消耗掉。 */
  autoStart?: boolean
}) {
  const { t } = useTranslation('misc')
  const [state, setState] = useState<'idle' | 'loading' | 'matched' | 'revealed' | 'empty'>('idle')
  const [matchId, setMatchId] = useState<number | null>(null)
  const [agent, setAgent] = useState<MatchedAgent | null>(null)
  const [contact, setContact] = useState<RevealedContact | null>(null)
  const [note, setNote] = useState('')
  const [myContact, setMyContact] = useState('')
  const [err, setErr] = useState('')
  /** 值班中的那位 —— **只读 peek,不落库**。用来在按钮上直接显示头像和名字。 */
  const [onDuty, setOnDuty] = useState<(MatchedAgent & { id: string }) | null>(null)
  const [peeked, setPeeked] = useState(false)

  // 先 peek 一下现在值班的是谁 —— 按钮上要显示他的头像和名字(owner 要求)。
  // 这是**只读**的,不写库、不占轮换名额,所以可以在挂载时就调。
  useEffect(() => {
    let alive = true
    peekNextAgent(projectId).then((a) => { if (alive) { setOnDuty(a); setPeeked(true) } })
    return () => { alive = false }
  }, [projectId])

  // autoStart:弹窗里用户已经点过一次了,不要再让他点第二下
  useEffect(() => { if (autoStart) void ask() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [autoStart])

  const ask = async () => {
    setState('loading')
    trackEvent('contact_attempt', { contact_type: 'agent_match_open' }, { project_id: projectId, immediate: true })
    const r = await matchAgent({ projectId, source, prefer: onDuty?.id })
    if (!r.agent || !r.matchId) { setState('empty'); return }
    setAgent(r.agent)
    setMatchId(r.matchId)
    setState(r.revealed ? 'revealed' : 'matched')
    // 之前 reveal 过就直接把联系方式取回来(同一个人刷新页面不该再走一遍流程)
    if (r.revealed) setContact(await revealContact(r.matchId))
  }

  /** relay 渠道下买家看不到任何地址,只能靠我们转发 —— 没有回址等于死信。 */
  const needContact = (agent?.channel ?? onDuty?.channel) === 'relay'

  const reveal = async () => {
    if (!matchId) return
    if (needContact && !myContact.trim()) { setErr(t('agentMatch.contactRequired')); return }
    setErr('')
    setState('loading')
    trackEvent('contact_attempt', { contact_type: 'agent_match_reveal' }, { project_id: projectId, immediate: true })
    const c = await revealContact(matchId, { contact: myContact, note })
    setContact(c)
    setState('revealed')
  }

  // 池子空 → 什么都不渲染(见文件头)。peek 回来是 null 也一样 ——
  // 摆一个「暂时没有经纪」的按钮比没有按钮更伤。
  if (state === 'empty') return null
  if (state === 'idle' && peeked && !onDuty) return null
  // peek 还没回来时不闪一下占位骨架:入口在页面顶部,闪一下比晚 200ms 出现更难看
  if (state === 'idle' && !peeked) return null

  const pad = compact ? 'p-3' : 'p-4'

  if (state === 'idle') {
    // 通栏横条 —— 项目详情页顶部,紧挨着导览入口。和 ProjectTourCta 一个调性:
    // 满宽、有底色、不用滚就看得见。
    if (variant === 'bar') {
      return (
        <div className="border-b border-slate-100 bg-white">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-3 py-2.5">
              <span className="relative shrink-0">
                <AgentAvatar agent={onDuty} size={9} />
                {/* 绿点 = 现在有人在接。它说明的是「有人值班」,不是「已认证」 */}
                <span className="absolute -end-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-900">{onDuty?.display_name}</span>
                <span className="block truncate text-xs text-slate-500">
                  {[onDuty?.title, onDuty?.brokerage].filter(Boolean).join(' · ') || t('agentMatch.onDuty')}
                </span>
              </span>
              <button type="button" onClick={ask}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 active:scale-95 sm:text-sm">
                <MessageCircle className="h-3.5 w-3.5" />
                {t('agentMatch.askHim')}
              </button>
            </div>
          </div>
        </div>
      )
    }
    return (
      <button type="button" onClick={ask}
        className={`flex w-full items-center gap-3 rounded-2xl bg-white ${pad} text-start ring-1 ring-slate-200 transition hover:ring-slate-300 active:scale-[0.99]`}>
        <span className="relative shrink-0">
          <AgentAvatar agent={onDuty} size={10} />
          <span className="absolute -end-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-900">{onDuty?.display_name}</span>
          <span className="block truncate text-xs text-slate-500">
            {[onDuty?.title, onDuty?.brokerage].filter(Boolean).join(' · ') || t('agentMatch.onDuty')}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
          <MessageCircle className="h-3.5 w-3.5" />{t('agentMatch.askHim')}
        </span>
      </button>
    )
  }

  if (state === 'loading' && !agent) {
    return (
      <div className={`flex items-center justify-center rounded-2xl bg-slate-50 ${pad} ring-1 ring-slate-100`}>
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      </div>
    )
  }

  const body = (
    <div className={`rounded-2xl bg-white ${pad} ring-1 ring-slate-200`}>
      <div className="flex items-start gap-3">
        {agent?.photo_url ? (
          <img src={agent.photo_url} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-slate-100" />
        ) : (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600">
            <UserRound className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{agent?.display_name}</p>
          <p className="truncate text-xs text-slate-500">
            {[agent?.title, agent?.brokerage].filter(Boolean).join(' · ') || t('agentMatch.roleFallback')}
          </p>
          {/* RERA 牌照号只在**真有**的时候显示。没有就什么都不写 ——
              编一个「已认证」徽章出来是在替一个我们没验证过的人背书。 */}
          {agent?.rera_brn && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-px text-[10px] font-medium text-emerald-700">
              <BadgeCheck className="h-3 w-3" />BRN {agent.rera_brn}
            </span>
          )}
        </div>
      </div>

      {state !== 'revealed' ? (
        <div className="mt-3 space-y-2">
          {/* 两个输入都**可留空** —— 强制留手机会把大部分人挡在门外,
              而我们现在最缺的就是任何一条真实询盘。 */}
          <input value={myContact} onChange={(e) => setMyContact(e.target.value)} maxLength={120}
            placeholder={needContact ? t('agentMatch.yourContactRequired') : t('agentMatch.yourContact')}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none" />
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500}
            placeholder={t('agentMatch.yourNote')}
            className="w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none" />
          {err && <p className="text-xs font-medium text-rose-600">{err}</p>}
          <button type="button" onClick={reveal} disabled={state === 'loading'}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
            {state === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
            {needContact ? t('agentMatch.sendRequest') : t('agentMatch.getContact')}
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {/* relay:买家拿不到地址 —— 如实告诉他需求转过去了/没转成功。
              relayed=false 一定要说,不然他以为发了、一直在等。 */}
          {contact?.channel === 'relay' && (
            <p className={`w-full rounded-xl px-3 py-2.5 text-sm ${
              contact.relayed ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'
            }`}>
              {contact.relayed
                ? t('agentMatch.relaySent', { name: contact.display_name || '' })
                : t('agentMatch.relayFailed')}
            </p>
          )}
          {contact?.email && (
            <a href={`mailto:${contact.email}`}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
              <Mail className="h-4 w-4" />{contact.email}
            </a>
          )}
          {contact?.whatsapp && (
            <a href={`https://wa.me/${contact.whatsapp.replace(/[^\d]/g, '')}`} target="_blank" rel="noreferrer"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600">
              <MessageCircle className="h-4 w-4" />WhatsApp
            </a>
          )}
          {contact?.phone && (
            <a href={`tel:${contact.phone}`}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
              <Phone className="h-4 w-4" />{t('agentMatch.call')}
            </a>
          )}
        </div>
      )}
    </div>
  )

  // bar 变体展开后仍留在那条横条的位置上,套一层 container 免得贴边
  if (variant === 'bar') {
    return (
      <div className="border-b border-teal-100 bg-emerald-50/40">
        <div className="container mx-auto px-4 py-3">{body}</div>
      </div>
    )
  }
  return body
}
