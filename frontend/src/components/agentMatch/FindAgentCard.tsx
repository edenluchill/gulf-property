/**
 * 「联系房产顾问」—— 买家侧的选人 + 留言表单。弹窗和地图区域弹窗共用。
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
 *
 * 🔴 **三位候选横排,不许改回竖着堆**(owner 2026-08-11:「不喜欢现在上下 3 个,
 *    应该左右横排 3 个,相对小一点也行」)。竖排把表单挤到首屏外,买家要滚一下
 *    才看得到「留联系方式」——而那一步才是这个功能的转化点。
 *
 * 🔴 **联系方式先选类型再填,而且要过校验**(同一天 owner:「不能随便现在什么垃圾
 *    都可以」)。规则在 lib/contactValidation.ts,**后端有同一份**。
 */
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { UserRound, Loader2, MessageCircle, Phone, BadgeCheck, Mail, Check, AlertCircle } from 'lucide-react'
import { matchAgent, fetchCandidates, revealContact, type MatchedAgent, type RevealedContact } from '../../lib/agentMatchApi'
import { contactError, normalizeContact, CONTACT_TYPES, type ContactType } from '../../lib/contactValidation'
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
  /** 默认 WhatsApp —— 迪拜这边经纪和买家几乎只用它 */
  const [contactType, setContactType] = useState<ContactType>('whatsapp')
  /** 只有在他碰过输入框之后才报红,别一打开弹窗就一片红 */
  const [touched, setTouched] = useState(false)
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
  /** 空 = 没填(非 relay 时允许);非空但不合法 = 要拦 */
  const badContact = myContact.trim() ? contactError(contactType, myContact) : null

  const submit = async () => {
    if (!chosen) { setErr(t('agentMatch.pickOne')); return }
    if (needContact && !myContact.trim()) { setTouched(true); setErr(t('agentMatch.contactRequired')); return }
    // 填了就必须填对 —— 打不通的号码比没号码更伤(经纪会觉得这个来源是垃圾)
    if (badContact) { setTouched(true); setErr(t(`agentMatch.invalid_${badContact}`)); return }
    setErr(''); setBusy(true)
    trackEvent('contact_attempt', { contact_type: 'agent_match_submit' }, { project_id: projectId, immediate: true })
    /**
     * prefer 带上买家选中的那位。服务端会**重新验此人还在池子里** ——
     * 直接信前端传来的 id 的话,谁都能指定任意 agent 把买家派给自己人,
     * 连"暂停接单/掉订阅"都绕过去了。
     */
    const r = await matchAgent({ projectId, source, prefer: chosen.id })
    if (!r.agent || !r.matchId) { setErr(t('agentMatch.tryAgain')); setBusy(false); return }
    setContact(await revealContact(r.matchId, {
      // 存归一化后的值(+区号、去掉空格横杠),经纪那边才能直接拨/直接开 wa.me
      contact: myContact.trim() ? normalizeContact(contactType, myContact) : '',
      contactType,
      note,
      lang: i18n.language,
    }))
    setBusy(false)
  }

  const pad = compact ? 'p-3' : 'p-4'

  // 池子空 —— 什么都不渲染(外层入口也是靠这个判断隐藏的)
  if (cands && cands.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">{t('agentMatch.noneAvailable')}</p>
  }
  /**
   * 🔴 **骨架必须和真表单一样高**(owner 2026-08-11:「它会卡一下再弹上来」)。
   *
   * 之前这里只放了一个转圈:抽屉是按**当时的高度**从底下升上来的,候选一到、
   * 内容撑开,面板就会在动画刚结束时再往上蹿一截 —— 那一下就是他说的「卡一下」。
   * 不是掉帧,是布局在动画中途变了。
   *
   * 所以骨架逐块对着下面的真表单摆:3 张候选卡 / 类型药丸 / 输入框 / 备注框 / 提交键。
   * 改真表单的结构时**这里要跟着改**,不然那一跳会回来。
   */
  if (!cands) {
    return (
      /* 高度是**量出来的**,不是估的(真表单五块:16 / 97 / 103 / 58 / 40)。
         改真表单的结构时重新量一遍,别拍脑袋。 */
      <div className="animate-pulse space-y-3" aria-hidden>
        <div className="h-4 w-28 rounded bg-slate-100" />
        <div className="grid h-[97px] grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col items-center justify-center gap-1.5 rounded-xl ring-1 ring-slate-200">
              <span className="h-10 w-10 rounded-full bg-slate-100" />
              <span className="h-3 w-14 rounded bg-slate-100" />
              <span className="h-2.5 w-10 rounded bg-slate-100" />
            </div>
          ))}
        </div>
        <div className="h-[103px] space-y-2">
          <div className="h-[42px] rounded-full bg-slate-100" />
          <div className="h-[38px] rounded-xl bg-slate-100" />
          <div className="h-4 w-40 rounded bg-slate-100" />
        </div>
        <div className="h-[58px] rounded-xl bg-slate-100" />
        <div className="h-10 rounded-xl bg-slate-200" />
      </div>
    )
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
          {/* 🔴 横排三列。别改回 space-y 竖排 —— 见文件头 */}
          <ul className="grid grid-cols-3 gap-2">
            {cands.map((c) => {
              const on = chosen?.id === c.id
              return (
                <li key={c.id}>
                  <motion.button type="button" onClick={() => { setChosen(c); setErr('') }}
                    whileTap={{ scale: 0.96 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                    className={`flex h-full w-full flex-col items-center gap-1 rounded-xl px-1.5 py-2.5 text-center transition ${
                      on ? 'bg-teal-50 ring-2 ring-teal-500' : 'bg-white ring-1 ring-slate-200 hover:ring-slate-300'
                    }`}>
                    <span className="relative">
                      <AgentAvatar agent={c} size={10} />
                      {/* 选中的对勾贴在头像右下角 —— 横排卡片里没有一行的空间放它 */}
                      <AnimatePresence>
                        {on && (
                          <motion.span
                            initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
                            transition={{ type: 'spring', stiffness: 520, damping: 20 }}
                            className="absolute -bottom-0.5 -end-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-teal-500 ring-2 ring-white">
                            <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </span>
                    <span className="w-full truncate text-xs font-semibold text-slate-900">{c.display_name}</span>
                    <span className="w-full truncate text-[10px] leading-tight text-slate-500">
                      {[c.title, c.brokerage].filter(Boolean).join(' · ') || t('agentMatch.roleFallback')}
                    </span>
                    {/* RERA 牌照号只在**真有**的时候显示 —— 编一个「已认证」徽章出来
                        是在替一个我们没验证过的人背书。横排卡片窄,号码放 title 里 */}
                    {c.rera_brn && (
                      <span title={`BRN ${c.rera_brn}`}
                        className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-px text-[10px] font-medium text-emerald-700">
                        <BadgeCheck className="h-2.5 w-2.5" />BRN
                      </span>
                    )}
                  </motion.button>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {/* ── 联系方式:先选类型,再填,填了就要合法 ─────────────────────────── */}
      <div>
        <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1">
          {CONTACT_TYPES.map((ty) => {
            const on = contactType === ty
            const Icon = ty === 'email' ? Mail : ty === 'phone' ? Phone : MessageCircle
            return (
              <button key={ty} type="button"
                /* 换类型就清空已填的值 —— 一个 +971 号码在「邮箱」下永远不合法,
                   留着只会挂一个红感叹号让人以为自己填错了。 */
                onClick={() => { setContactType(ty); setMyContact(''); setErr(''); setTouched(false) }}
                className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-medium transition-colors ${
                  on ? 'text-teal-700' : 'text-slate-500 hover:text-slate-700'
                }`}>
                {/* 滑动的白色药丸 —— layoutId 让它在三个格子之间真的滑过去 */}
                {on && (
                  <motion.span layoutId="contact-type-pill"
                    transition={{ type: 'spring', stiffness: 480, damping: 34 }}
                    className="absolute inset-0 rounded-full bg-white shadow-sm" />
                )}
                <Icon className="relative h-3.5 w-3.5" />
                <span className="relative">{t(`agentMatch.type_${ty}`)}</span>
              </button>
            )
          })}
        </div>

        <div className="relative mt-2">
          <input
            value={myContact}
            onChange={(e) => { setMyContact(e.target.value); setErr('') }}
            onBlur={() => setTouched(true)}
            maxLength={120}
            type={contactType === 'email' ? 'email' : 'tel'}
            inputMode={contactType === 'email' ? 'email' : 'tel'}
            autoComplete={contactType === 'email' ? 'email' : 'tel'}
            dir="ltr"
            placeholder={t(`agentMatch.ph_${contactType}`)}
            aria-invalid={!!(touched && badContact)}
            className={`w-full rounded-xl border px-3 py-2 pe-9 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none ${
              touched && badContact ? 'border-rose-300 focus:border-rose-400' : 'border-slate-200 focus:border-teal-400'
            }`}
          />
          {/* 右边那个小状态图标:合法 → 绿勾,不合法 → 红感叹号。没填就什么都不显示 */}
          <AnimatePresence>
            {myContact.trim() && (
              <motion.span
                initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 24 }}
                className="pointer-events-none absolute inset-y-0 end-3 flex items-center">
                {badContact
                  ? <AlertCircle className="h-4 w-4 text-rose-400" />
                  : <Check className="h-4 w-4 text-emerald-500" />}
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
          {needContact ? t('agentMatch.contactWhyRequired') : t('agentMatch.contactWhy')}
        </p>
      </div>

      {/* `block` 不是装饰:textarea 默认 inline-block,行盒会在它下面多留 6px 的
          基线空隙 —— 那 6px 让骨架和真表单永远差一点,抽屉升上来之后还会再跳一下。 */}
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500}
        placeholder={t('agentMatch.yourNote')}
        className="block w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none" />

      {err && (
        <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-1.5 text-xs font-medium text-rose-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />{err}
        </motion.p>
      )}

      <button type="button" onClick={submit} disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
        {needContact ? t('agentMatch.sendRequest') : t('agentMatch.getContact')}
      </button>
    </div>
  )
}
