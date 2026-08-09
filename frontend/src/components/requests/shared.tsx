/**
 * 功能建议 —— 共享的展示件（状态/角色标签、卡片、发帖弹窗、列表看板）。
 *
 * 为什么单独一个模块：建议**自己是一页**（/requests），产品日记（/changelog）
 * 只在 hero 放一张「大家在提什么」的入口卡。两边都要用状态/角色标签，
 * 抽出来才不会两份定义各自漂移。
 *
 * 🔴 这里渲染的任何字段都来自服务端的 publicShape()/commentShape()。
 * 署名走 `author`（null = 匿名，包括 2026-08-08 之前的全部存量帖）；
 * `author_email` 服务端只发给 owner/admin —— 前端**不判断权限，有就显示**，
 * 免得判据两处分叉。角色（经纪/买家）独立于署名，匿名帖也照常显示。
 */
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  Lightbulb, Loader2, Check, Send, ChevronUp, MessageSquare,
  Search as SearchIcon, ChevronDown, X, Briefcase, Eye,
} from 'lucide-react'
import { pickLang } from '../../data/changelog'
import { useAuth } from '../../contexts/AuthContext'
import {
  fetchFeatureRequests, submitFeatureRequest, toggleVote, fetchThread, postReply, updateRequest,
  fetchWhoami,
  type FeatureRequest, type RequestStatus, type RequestComment, type RequestAudience, type WhoAmI,
} from '../../lib/featureRequestApi'

export const ACCENT = '#00E0B8'

export const STATUS: Record<RequestStatus, { chip: string; key: string }> = {
  shipped: { chip: 'bg-emerald-50 text-emerald-700 ring-emerald-100', key: 'misc:changelog.fShipped' },
  planned: { chip: 'bg-sky-50 text-sky-700 ring-sky-100', key: 'misc:changelog.fPlanned' },
  open: { chip: 'bg-slate-100 text-slate-600 ring-slate-200', key: 'misc:changelog.fOpen' },
  // 「暂不做」也照常显示 —— 悄悄让它消失比明说更伤人，提议的人会觉得石沉大海
  declined: { chip: 'bg-slate-50 text-slate-400 ring-slate-100', key: 'misc:changelog.fDeclined' },
}

export const ROLE: Record<string, { chip: string; key: string }> = {
  agent: { chip: 'bg-teal-50 text-teal-700 ring-teal-100', key: 'misc:changelog.roleAgent' },
  agency: { chip: 'bg-teal-50 text-teal-700 ring-teal-100', key: 'misc:changelog.roleAgency' },
  developer: { chip: 'bg-indigo-50 text-indigo-600 ring-indigo-100', key: 'misc:changelog.roleDeveloper' },
  buyer: { chip: 'bg-sky-50 text-sky-600 ring-sky-100', key: 'misc:changelog.roleBuyer' },
}

const INTL_LOCALE = { zh: 'zh-CN', en: 'en-GB', fr: 'fr-FR', ru: 'ru-RU', ar: 'ar-AE' } as const

/** Intl 用完整 BCP-47；数据字段用 pickLang。两件事，别混。 */
export function useT() {
  const { t: raw, i18n } = useTranslation('misc')
  return {
    t: raw as (k: string, o?: Record<string, unknown>) => string,
    i18n,
    lang: pickLang(i18n.language),
    locale: INTL_LOCALE[pickLang(i18n.language)],
  }
}

export function RoleTag({ role }: { role: string | null }) {
  const { t } = useT()
  const r = role && ROLE[role]
  if (!r) return null
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium ring-1 ${r.chip}`}>
      {t(r.key)}
    </span>
  )
}

/**
 * 把整句翻译里的某个片段加粗（这里用来突出「会公开成什么名字」）。
 *
 * 之所以不把句子拆成 signedAs + signedAsTail 两个键：中/英/法/俄/阿的语序不一样，
 * 拆开就等于把语序**写死成中文的**，其余四种语言必然读起来是坏的。整句一个键 +
 * {{name}} 插值，翻译能自由排语序；这里只负责在结果里找到那个名字并加粗。
 */
function emphasize(text: string, needle: string) {
  const at = needle ? text.indexOf(needle) : -1
  if (at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <b className="font-semibold text-slate-700">{needle}</b>
      {text.slice(at + needle.length)}
    </>
  )
}

/**
 * 官方标记 —— logo + Pinzos，一眼把我们的答复和其他人的跟帖分开。
 *
 * 用 <img src="/logo.svg"> 而不是把 Header 里那段 SVG 抄过来：Header 在同一页上，
 * 它的 <linearGradient id="pinzosPin"> 是**写死的 id**，抄一份进来就是同页两个同名
 * id —— 浏览器只认第一个，渲染顺序一变就可能画出个没有渐变的灰色图钉。
 */
export function PinzosMark({ className = '' }: { className?: string }) {
  return (
    <span
      translate="no"
      className={`inline-flex items-center gap-1 rounded-full bg-slate-900 py-px pe-2 ps-1 text-[10px] font-semibold text-white ${className}`}
    >
      <img src="/logo.svg" alt="" aria-hidden className="h-3 w-3" />
      Pinzos
    </span>
  )
}

/**
 * 一条建议 / 一层楼的署名行。
 *
 * `author` 为 null 就是匿名 —— **不要拿 email 前缀或者角色去顶**：存量帖是在页面
 * 明写「匿名」时提交的，给它编一个名字等于替人家改了当时的约定。
 *
 * `email` 只有 owner/admin 收得到（服务端决定），用更淡的样式挂在后面：
 * 它是给你回访用的，不是这一行的主角。
 */
export function Byline({ author, role, email }: {
  author: string | null; role: string | null; email?: string
}) {
  const { t } = useT()
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`text-[11px] ${author ? 'font-medium text-slate-600' : 'text-slate-400'}`}>
        {author || t('misc:changelog.anonymous')}
      </span>
      <RoleTag role={role} />
      {email && (
        <span translate="no" title={t('misc:changelog.ownerOnlyEmail')}
          className="inline-flex items-center rounded bg-amber-50 px-1.5 py-px text-[10px] text-amber-700 ring-1 ring-amber-100">
          {email}
        </span>
      )}
    </span>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 发帖弹窗 —— 没登录也能打开、能填，登录提示放在最后一步
// ════════════════════════════════════════════════════════════════════════════

export function ComposeModal({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (r: FeatureRequest) => void
}) {
  const { t } = useT()
  const { user, signInWithGoogle } = useAuth()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)
  const [who, setWho] = useState<WhoAmI | null>(null)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  // 登录了才问 —— 没登录时署名还没定，问了也只能得到 null
  useEffect(() => { if (user) void fetchWhoami().then(setWho) }, [user])

  const send = async () => {
    setErr(''); setBusy(true)
    try {
      onCreated(await submitFeatureRequest(title.trim(), body.trim()))
      setOk(true)
      setTimeout(onClose, 1400)
    } catch (e) {
      // 后端把「每天最多 5 条」「标题太短」写在 message 里 —— 原样显示，
      // 静默失败会让人以为提交成功了
      setErr(e instanceof Error ? e.message : t('misc:changelog.failed'))
    } finally { setBusy(false) }
  }

  // 铁律：fixed modal 必须 portal 到 body（否则被祖先的 transform/backdrop-filter 困住）
  return createPortal(
    <div className="fixed inset-0 z-[9000] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-t-3xl bg-white shadow-2xl motion-safe:animate-[slideUp_.22s_ease-out] sm:rounded-3xl">
        <style>{`@keyframes slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`}</style>

        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-500">
              <Lightbulb className="h-5 w-5" />
            </span>
            <h3 className="text-base font-semibold text-slate-900">{t('misc:changelog.requestCta')}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          {ok ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <Check className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-slate-800">{t('misc:changelog.submitted')}</p>
              <p className="text-xs text-slate-400">{t('misc:changelog.submittedSub')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus
                placeholder={t('misc:changelog.phTitle')}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none" />
              <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={4}
                placeholder={t('misc:changelog.phBody')}
                className="w-full resize-y rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none" />

              {err && <p className="text-xs font-medium text-rose-600">{err}</p>}

              {/* 🔴 署名告知 —— 这条**不能省**。建议板从匿名改成公开署名（2026-08-08），
                  不先告诉人就把名字挂出去，比一直匿名糟得多。而且这里显示的名字来自
                  服务端 whoami，跟真正写库用的是同一个判据，不会出现「提示写着 A、
                  公开出去是 B」。取不到名字就如实说会匿名发布。 */}
              {user && who && (
                <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
                  <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <p className="text-[11px] leading-relaxed text-slate-500">
                    {who.author
                      ? emphasize(t('misc:changelog.signedAs', { name: who.author }), who.author)
                      : t('misc:changelog.willBeAnonymous')}
                    {who.author && (
                      <Link to="/profile" onClick={onClose} className="ms-1 text-teal-600 underline-offset-2 hover:underline">
                        {t('misc:changelog.changeName')}
                      </Link>
                    )}
                  </p>
                </div>
              )}

              {/* 🔴 没登录**也能一路填到这里** —— 登录提示放在最后一步。
                  一上来就拿登录墙拦住，大多数人根本不会去登录，那条建议就永远没了。 */}
              {user ? (
                <button type="button" disabled={busy || title.trim().length < 4} onClick={send}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: ACCENT }}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {t('misc:changelog.submit')}
                </button>
              ) : (
                <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-100">
                  <p className="text-xs leading-relaxed text-slate-500">{t('misc:changelog.needLogin')}</p>
                  <button type="button" onClick={() => void signInWithGoogle()}
                    className="mt-2.5 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
                    {t('misc:changelog.signInSubmit')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 一条建议：票数 / 状态 / 角色 / 楼层 / admin 内联操作
// ════════════════════════════════════════════════════════════════════════════

export function RequestCard({ r, user, isAdmin, onPatch, onNeedLogin, defaultOpen, linkTitle }: {
  r: FeatureRequest; user: boolean; isAdmin: boolean
  onPatch: (r: FeatureRequest) => void
  onNeedLogin: () => void
  /** 楼层默认展开（详情页点进来就是来看讨论的） */
  defaultOpen?: boolean
  /** 标题是否渲染成跳详情页的链接（列表 true；详情页自己就是那一页，false） */
  linkTitle?: boolean
}) {
  const { t, locale } = useT()
  const [open, setOpen] = useState(!!defaultOpen)
  const [thread, setThread] = useState<RequestComment[] | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const s = STATUS[r.status] || STATUS.open

  useEffect(() => {
    if (open && thread === null) void fetchThread(r.id).then(setThread)
  }, [open, thread, r.id])

  const vote = async () => {
    // 没登录**照样能点** —— 点了就告诉他要登录，而不是把按钮画成灰色让他猜
    if (!user) { onNeedLogin(); return }
    // 乐观更新：点赞要**立刻**有反馈，一个要等一圈网络才动的赞没人点第二次
    const before = { votes: r.votes, voted: r.voted }
    onPatch({ ...r, votes: r.votes + (r.voted ? -1 : 1), voted: !r.voted })
    try {
      onPatch({ ...r, ...(await toggleVote(r.id)) })
    } catch {
      onPatch({ ...r, ...before })   // 失败回滚，绝不留一个假的赞
    }
  }

  const reply = async () => {
    const body = draft.trim()
    if (body.length < 2) return
    setBusy(true)
    try {
      const c = await postReply(r.id, body)
      setThread((p) => [...(p || []), c])
      setDraft('')
      onPatch({ ...r, comments: r.comments + 1 })
    } catch { /* 失败保留草稿，让他能重试 */ } finally { setBusy(false) }
  }

  const setStatus = async (status: RequestStatus) => {
    try { onPatch(await updateRequest(r.id, { status })) } catch { /* 403 等 */ }
  }

  // 受众是按提议人角色**推**出来的默认值,推错很正常(经纪提的「地图加个学校筛选」
  // 买家也该看到)。给 admin 一个一下就能翻的开关,不然错了只能进数据库改。
  const flipAudience = async () => {
    const audience: RequestAudience = r.audience === 'agent' ? 'all' : 'agent'
    try { onPatch(await updateRequest(r.id, { audience })) } catch { /* 403 等 */ }
  }

  return (
    <li id={`r-${r.id}`} className="scroll-mt-24 rounded-2xl border border-slate-100 bg-white p-4 transition hover:border-slate-200 hover:shadow-[0_2px_16px_-6px_rgba(15,23,42,0.15)]">
      <div className="flex gap-3.5">
        <button type="button" onClick={vote}
          title={t(user ? 'misc:changelog.upvote' : 'misc:changelog.signInVote')}
          className={`flex h-14 w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border transition active:scale-95 ${
            r.voted ? 'border-teal-200 bg-teal-50 text-teal-700'
                    : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'
          }`}>
          <ChevronUp className="h-4 w-4" />
          <span translate="no" className="text-xs font-semibold tabular-nums">{r.votes}</span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${s.chip}`}>
              {t(s.key)}
            </span>
            <Byline author={r.author} role={r.role} email={r.author_email} />
            {/* 「经纪专属」只有经纪看得到(买家的列表里根本没有这些条目)——
                标出来是让他知道这条不会出现在客户那边,别拿去当共同话题。 */}
            {r.audience === 'agent' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-600 ring-1 ring-violet-100">
                <Briefcase className="h-3 w-3" />
                {t('misc:changelog.agentOnly')}
              </span>
            )}
            <span translate="no" className="text-[11px] tabular-nums text-slate-400">
              {new Date(r.created_at).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })}
            </span>
          </div>

          {/* 标题是**链接** —— 每条建议有自己的页面(可分享的固定地址)。
              详情页复用这张卡,所以那边不再套一层链接(套了就是点自己)。 */}
          {linkTitle ? (
            <Link to={`/requests/${r.id}`}
              className="-my-1 mt-1 block py-1 text-[15px] font-medium leading-snug text-slate-800 transition hover:text-teal-700">
              {r.title}
            </Link>
          ) : (
            <h1 className="mt-1.5 text-[17px] font-semibold leading-snug text-slate-900">{r.title}</h1>
          )}
          {r.body && <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-500">{r.body}</p>}

          {r.reply && (
            <div className="mt-2.5 rounded-xl bg-teal-50/70 px-3 py-2 ring-1 ring-teal-100">
              <div className="flex flex-wrap items-center gap-1.5">
                <PinzosMark />
                {/* 日期走 replied_at,**不是** updated_at —— 后者会被改状态/受众刷新,
                    那样一条半年前的回复会因为今天点了下「已上线」而显示成今天。 */}
                {r.replied_at && (
                  <span translate="no" className="text-[10px] tabular-nums text-teal-600/70">
                    {new Date(r.replied_at).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </span>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-teal-800">{r.reply}</p>
            </div>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setOpen((v) => !v)}
              className="-my-1.5 inline-flex min-h-[34px] items-center gap-1.5 py-1.5 text-xs font-medium text-slate-400 transition hover:text-slate-700">
              <MessageSquare className="h-3.5 w-3.5" />
              {r.comments > 0 ? `${r.comments} ${t('misc:changelog.replies')}` : t('misc:changelog.reply')}
              <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {/* admin：直接在这条上决定要不要纳入 */}
            {isAdmin && (
              <div className="flex flex-wrap items-center gap-1">
                {(['open', 'planned', 'shipped', 'declined'] as RequestStatus[]).map((st) => (
                  <button key={st} type="button" onClick={() => setStatus(st)}
                    className={`inline-flex min-h-[30px] items-center rounded-full px-2.5 py-1 text-[10px] font-medium transition sm:min-h-0 sm:py-0.5 ${
                      r.status === st ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-400 ring-1 ring-slate-100 hover:bg-slate-100'
                    }`}>
                    {t(STATUS[st].key)}
                  </button>
                ))}
                <button type="button" onClick={flipAudience}
                  title={t('misc:changelog.audienceHint')}
                  className={`inline-flex min-h-[30px] items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium transition sm:min-h-0 sm:py-0.5 ${
                    r.audience === 'agent' ? 'bg-violet-100 text-violet-700' : 'bg-slate-50 text-slate-400 ring-1 ring-slate-100 hover:bg-slate-100'
                  }`}>
                  <Briefcase className="h-3 w-3" />
                  {t(r.audience === 'agent' ? 'misc:changelog.agentOnly' : 'misc:changelog.audienceAll')}
                </button>
              </div>
            )}
          </div>

          {open && (
            <div className="mt-3 space-y-2.5 border-t border-slate-100 pt-3">
              {thread === null ? (
                <Loader2 className="h-4 w-4 animate-spin text-slate-300" />
              ) : thread.length === 0 ? (
                <p className="text-xs text-slate-400">{t('misc:changelog.noReplies')}</p>
              ) : (
                thread.map((c, i) => (
                  <div key={c.id} className="flex gap-2.5">
                    <span translate="no" className="mt-0.5 w-7 shrink-0 text-end text-[11px] tabular-nums text-slate-300">#{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {c.is_staff ? (
                          <PinzosMark />
                        ) : (
                          <Byline author={c.author} role={c.role} email={c.author_email} />
                        )}
                        <span translate="no" className="text-[10px] tabular-nums text-slate-300">
                          {new Date(c.created_at).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{c.body}</p>
                    </div>
                  </div>
                ))
              )}

              {user ? (
                <div className="flex items-start gap-2 pt-1">
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={800}
                    placeholder={t(isAdmin ? 'misc:changelog.phReplyStaff' : 'misc:changelog.phReply')}
                    className="min-w-0 flex-1 resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none" />
                  <button type="button" onClick={reply} disabled={busy || draft.trim().length < 2}
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-900 transition hover:opacity-90 disabled:opacity-40"
                    style={{ background: ACCENT }}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              ) : (
                <button type="button" onClick={onNeedLogin}
                  className="inline-flex min-h-[34px] items-center py-1.5 text-xs text-teal-600 underline-offset-2 hover:underline">
                  {t('misc:changelog.signInReply')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 看板：搜索 + 筛选 + 排序 + 列表
// ════════════════════════════════════════════════════════════════════════════

type Filter = 'all' | RequestStatus
type Sort = 'top' | 'new'
/** 受众筛选:'any' 不分 / 'agent' 只看经纪侧 / 'all' 只看客户也看得到的 */
type AudFilter = 'any' | RequestAudience

export function RequestsBoard({ list, setList, onCompose, focusId }: {
  list: FeatureRequest[] | null
  setList: React.Dispatch<React.SetStateAction<FeatureRequest[] | null>>
  onCompose: () => void
  focusId?: number | null
}) {
  const { t } = useT()
  const { user, isAdmin } = useAuth()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('top')
  const [aud, setAud] = useState<AudFilter>('any')

  /**
   * 受众那一排**只在列表里真的有经纪侧条目时**才出现。
   *
   * 不去问「你是不是经纪」—— 服务端已经按身份把买家的经纪侧条目滤掉了,买家手上
   * 这个数组永远是 0,开关自动消失。少一处判据 = 少一处会跟服务端分叉的地方。
   */
  const hasAgentSide = (list || []).some((r) => r.audience === 'agent')

  const patch = (r: FeatureRequest) => setList((p) => (p || []).map((x) => (x.id === r.id ? r : x)))

  // 带 ?r=<id> 进来 → 滚到那条（楼层由 RequestCard 的 defaultOpen 展开）
  useEffect(() => {
    if (!focusId || !list) return
    const el = document.getElementById(`r-${focusId}`)
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
  }, [focusId, list])

  const shown = useMemo(() => {
    if (!list) return []
    const kw = q.trim().toLowerCase()
    const hit = list.filter((r) => {
      if (filter !== 'all' && r.status !== filter) return false
      if (aud !== 'any' && r.audience !== aud) return false
      if (kw && !`${r.title} ${r.body || ''}`.toLowerCase().includes(kw)) return false
      return true
    })
    // 服务端已按「已上线 > 计划中 > 待评估 > 暂不做」再按票数排好；
    // 只在用户明确选「最新」时才重排，别把默认顺序也搅了。
    return sort === 'new' ? [...hit].sort((a, b) => b.created_at.localeCompare(a.created_at)) : hit
  }, [list, q, filter, sort, aud])

  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: t('misc:changelog.fAll') },
    { id: 'open', label: t('misc:changelog.fOpen') },
    { id: 'planned', label: t('misc:changelog.fPlanned') },
    { id: 'shipped', label: t('misc:changelog.fShipped') },
    { id: 'declined', label: t('misc:changelog.fDeclined') },
  ]
  const countOf = (f: Filter) => (f === 'all' ? (list?.length || 0) : (list || []).filter((r) => r.status === f).length)

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-60">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t('misc:changelog.search')}
            className="w-full rounded-xl border border-slate-200 py-2 ps-9 pe-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none" />
        </div>
        {FILTERS.map((f) => (
          <button key={f.id} type="button" onClick={() => setFilter(f.id)}
            className={`inline-flex min-h-[34px] items-center rounded-full px-3 py-1.5 text-xs font-medium transition sm:min-h-0 sm:px-2.5 sm:py-1 ${
              filter === f.id ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500 ring-1 ring-slate-100 hover:bg-slate-100'
            }`}>
            {f.label}<span translate="no" className="ms-1 opacity-50 tabular-nums">{countOf(f.id)}</span>
          </button>
        ))}
        {/* 经纪侧的建议单独切出来看 —— 和产品日记上那个开关是同一件事:
            「客户在要什么」和「同行在要什么」是两个问题,混在一起两个都看不清。 */}
        {hasAgentSide && (
          <>
            <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:block" />
            {([
              { id: 'agent', label: t('misc:changelog.agentOnly') },
              { id: 'all', label: t('misc:changelog.viewShared') },
            ] as { id: AudFilter; label: string }[]).map((a) => (
              <button key={a.id} type="button" onClick={() => setAud(aud === a.id ? 'any' : a.id)}
                className={`inline-flex min-h-[34px] items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition sm:min-h-0 sm:px-2.5 sm:py-1 ${
                  aud === a.id ? 'bg-violet-600 text-white' : 'bg-violet-50 text-violet-600 ring-1 ring-violet-100 hover:bg-violet-100'
                }`}>
                <Briefcase className="h-3 w-3" />{a.label}
                <span translate="no" className="opacity-60 tabular-nums">
                  {(list || []).filter((r) => r.audience === a.id).length}
                </span>
              </button>
            ))}
          </>
        )}
        <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:block" />
        <button type="button" onClick={() => setSort(sort === 'top' ? 'new' : 'top')}
          className="inline-flex min-h-[34px] items-center rounded-full bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500 ring-1 ring-slate-100 transition hover:bg-slate-100 sm:min-h-0 sm:px-2.5 sm:py-1">
          {t(sort === 'top' ? 'misc:changelog.sortTop' : 'misc:changelog.sortNew')}
        </button>
      </div>

      <div className="mt-5">
        {list === null ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
        ) : shown.length === 0 ? (
          <button type="button" onClick={onCompose}
            className="w-full rounded-2xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400 transition hover:border-teal-300 hover:text-slate-600">
            {t(list.length === 0 ? 'misc:changelog.emptyNone' : 'misc:changelog.emptyFilter')}
          </button>
        ) : (
          <ul className="space-y-3">
            {shown.map((r) => (
              <RequestCard key={r.id} r={r} user={!!user} isAdmin={!!isAdmin} linkTitle
                onPatch={patch} onNeedLogin={onCompose} defaultOpen={focusId === r.id} />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

export { fetchFeatureRequests }
export type { FeatureRequest }
