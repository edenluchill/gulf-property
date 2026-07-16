/**
 * 客户画像生成器 (2026-07-12) —— **全站唯一的画像入口**。
 *
 * owner 定:「本来就有一个客户画像生成的 tab，应该把那个优化好，做成 AI 引导而且
 *           很 smooth 的（边填边指导）。生成 report 时可以选已有客户画像或者用
 *           **同样的**客户画像生成器，而不是写 duplicate 的。」
 *
 * 所以它**替换**了原来的 ClientForm（不是并存），客户雷达和报告页都挂它：
 *   · 客户雷达 · 新建/编辑
 *   · 报告页 · 选的客户画像不全时就地补
 *
 * ── 为什么是输入框而不是表单 ──────────────────────────────────────────────
 * 经纪习惯写笔记，不习惯填 20 个字段。所以：随便写 → 点「AI 检查」→ AI 读懂它，
 * 告诉你**还缺哪几条、缺了会损失哪条论证**，每条都带**可点选项**（一个字不用打）。
 *
 * ── 不阻塞（owner 定）────────────────────────────────────────────────────
 * 缺信息只提醒，可以直接保存。画像糙 → 报告糙，那是经纪的选择。
 *
 * ── 成本 ─────────────────────────────────────────────────────────────────
 * AI 检查是**手动触发**的，一次 ~$0.001，不扣积分（后端 5 秒节流兜底）。
 * 为几厘钱去阻止一个提升主产品（20 积分的报告）质量的动作，不划算。
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles, Check, X, Loader2, RefreshCw, Wand2 } from 'lucide-react'
import { lunaFetch } from '../lunaApi'

const AVA = (seed: string) => `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,ffd5dc,ffdfbf`
const rseed = () => Math.random().toString(36).slice(2, 9)

export interface Gap {
  key: string
  question: string
  why: string
  options: { value: string; label: string }[]
}
export interface Profile {
  name?: string | null
  goal?: 'live' | 'invest' | 'both' | null
  budget_min?: number | null
  budget_max?: number | null
  bedrooms?: number | null
  family_size?: number | null
  has_children?: boolean | null
  nationality?: string | null
  preferred_areas?: string[] | null
  payment?: string | null
  horizon?: string | null
  has_maid?: boolean | null
  cooking?: string | null
  golden_visa?: boolean | null
  first_time_buyer?: boolean | null
  offplan_ok?: boolean | null
  [k: string]: unknown
}

export interface ClientProfileWizardProps {
  /** 编辑已有客户（预填）；不传 = 新建。字段可空 —— DB 里就是 nullable。 */
  existing?: { id: string; name?: string | null; avatar_url?: string | null; background?: string | null } | null
  onClose: () => void
  /** 保存成功 → 回传 clientId + 最终画像（报告页拿来直接生成） */
  onSaved: (clientId: string, profile: Profile) => void
  /** 报告页用：改标题 + 按钮文案 */
  ctaLabel?: string
}

/** 人话:把结构化画像渲染成 chips —— 经纪要看得见 AI 到底读懂了什么。 */
function profileChips(p: Profile, t: (k: string, o?: Record<string, unknown>) => string): string[] {
  const out: string[] = []
  const goal = { live: t('lunaTour:endUse3'), invest: t('lunaTour:investment3'), both: t('lunaTour:rentThenLive5') }
  if (p.goal) out.push(goal[p.goal])
  const b = p.budget_max ?? p.budget_min
  if (b) out.push(`AED ${(b / 1_000_000).toFixed(b % 1_000_000 ? 1 : 0)}M`)
  if (p.payment) out.push({ cash: t('lunaTour:cash3'), installment: t('lunaTour:installments3'), mortgage: t('lunaTour:mortgage3') }[p.payment as string] || String(p.payment))
  if (p.horizon) out.push({ rent_long: t('lunaTour:longTermRental'), flip: t('lunaTour:flip35y'), rent_then_live: t('lunaTour:rentThenLive6') }[p.horizon as string] || String(p.horizon))
  if (p.family_size) out.push(t('lunaTour:people3', { p_family_size: p.family_size }))
  if (p.has_children) out.push(t('lunaTour:hasChildren'))
  if (p.has_maid) out.push(t('lunaTour:hasAMaid'))
  if (p.cooking === 'often') out.push(t('lunaTour:cooksOften2'))
  if (p.bedrooms) out.push(`${p.bedrooms}BR`)
  if (p.nationality) out.push(String(p.nationality))
  if (p.golden_visa) out.push(t('lunaTour:goldenVisa3'))
  if (p.first_time_buyer) out.push(t('lunaTour:firstTimeBuyer'))
  if (p.offplan_ok === false) out.push(t('lunaTour:readyOnly'))
  if (p.preferred_areas?.length) out.push(...p.preferred_areas.slice(0, 3))
  return out
}

/** 把点选的答案转成人话，追加进笔记 —— 经纪要看得见自己的画像长什么样。 */
function answerToNote(gap: Gap, label: string): string {
  return `${gap.question.replace(/[？?]$/, '')}：${label}`
}

export default function ClientProfileWizard({ existing, onClose, onSaved, ctaLabel }: ClientProfileWizardProps) {
  const { t: tRaw } = useTranslation('lunaTour')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string

  const [name, setName] = useState(existing?.name || '')
  const [note, setNote] = useState(existing?.background || '')
  const [profile, setProfile] = useState<Profile>({})
  const [gaps, setGaps] = useState<Gap[]>([])
  const [known, setKnown] = useState(0)
  const [total, setTotal] = useState(6)
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [seeds, setSeeds] = useState<string[]>(() => Array.from({ length: 6 }, rseed))
  const [avatar, setAvatar] = useState(existing?.avatar_url || '')
  const noteRef = useRef<HTMLTextAreaElement>(null)

  // 编辑已有客户 → 把库里的画像带出来(问过一次就别再问)
  useEffect(() => {
    if (!existing?.id) return
    void lunaFetch(`/clients/${existing.id}/profile`)
      .then((r) => r.json())
      .then((j) => { if (j?.profile) { setProfile(j.profile); if (j.profile.note) setNote(j.profile.note) } })
      .catch(() => {})
  }, [existing?.id])

  /**
   * 打完字**自动**读 —— 不再要经纪去点一个按钮。
   *
   * ⚠️ 旧版是「笔记框 + 一个『AI 检查画像』按钮」:经纪写完字,得**主动去点**那个按钮,
   *    才知道 AI 读懂了什么、还缺什么。绝大多数人不会点 —— 于是这个引导式画像
   *    等于不存在,画像永远是空的。
   *
   * 停止输入 900ms 后自动抽取(≥12 字才值得跑,免得每敲一个字烧一次 Gemini)。
   */
  const autoRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (autoRef.current) clearTimeout(autoRef.current)
    if (checked || checking) return
    if (note.trim().length < 12) return
    autoRef.current = setTimeout(() => { void check() }, 900)
    return () => { if (autoRef.current) clearTimeout(autoRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note, checked, checking])

  const check = async () => {
    setChecking(true); setErr('')
    try {
      const r = await lunaFetch('/clients/profile-coach', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: note, client_id: existing?.id }),
      })
      const j = await r.json()
      if (!j.success) { setErr(j.error || t('lunaTour:checkFailed')); return }
      setProfile((prev) => ({ ...prev, ...j.extracted }))
      if (j.extracted?.name && !name.trim()) setName(j.extracted.name)
      setGaps(j.gaps || [])
      setKnown(j.known ?? 0); setTotal(j.total ?? 6)
      setChecked(true)
    } catch { setErr(t('lunaTour:networkError8')) } finally { setChecking(false) }
  }

  /** 点一个选项 → ①写进结构化画像 ②把人话追加进笔记 ③这条问题消失 */
  const answer = (gap: Gap, opt: { value: string; label: string }) => {
    const v: unknown =
      opt.value === 'true' ? true :
      opt.value === 'false' ? false :
      /^\d+$/.test(opt.value) ? Number(opt.value) : opt.value
    setProfile((p) => ({ ...p, [gap.key]: v }))
    setNote((n) => (n.trim() ? `${n.trim()}\n${answerToNote(gap, opt.label)}` : answerToNote(gap, opt.label)))
    setGaps((g) => g.filter((x) => x.key !== gap.key))
    setKnown((k) => k + 1)
  }

  const save = async () => {
    const nm = (name || String(profile.name || '')).trim()
    if (!nm) { setErr(t('lunaTour:clientNameIsRequired')); return }
    setSaving(true); setErr('')
    try {
      let id = existing?.id
      if (!id) {
        const r = await lunaFetch('/clients', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: nm, avatar_url: avatar || AVA(nm), background: note }),
        })
        const j = await r.json()
        if (!j?.id) throw new Error('create failed')
        id = j.id
      } else {
        await lunaFetch(`/clients/${id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: nm, avatar_url: avatar || existing?.avatar_url || AVA(nm), background: note }),
        })
      }
      // 结构化画像回写 —— 不回写的话下次生成报告又要重答一遍
      await lunaFetch(`/clients/${id}/profile`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: { ...profile, name: nm }, note }),
      })
      onSaved(id!, { ...profile, name: nm })
    } catch {
      setErr(t('lunaTour:saveFailed3'))
    } finally { setSaving(false) }
  }

  const chips = profileChips(profile, t)
  const pct = Math.min(100, Math.round((known / Math.max(1, total)) * 100))

  return (
    // 响应式:手机全屏贴底(键盘弹起也够用)、pad/桌面居中卡片
    <div className="fixed inset-0 z-[10001] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:max-w-lg sm:rounded-2xl lg:max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头 */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold text-slate-900">
              {existing ? t('lunaTour:clientProfile') : t('lunaTour:newClient2')}
            </h3>
            <p className="mt-0.5 truncate text-[11px] text-slate-400">
              {t('lunaTour:justWriteFreelyAi')}
            </p>
          </div>
          <button onClick={onClose} className="ml-2 shrink-0 rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 体 —— 可滚 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {/* 姓名 + 头像 */}
          <div className="mb-3 flex items-center gap-3">
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              placeholder={t('lunaTour:clientName')}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
            <button onClick={() => setSeeds(Array.from({ length: 6 }, rseed))} title={t('lunaTour:shuffleAvatars')}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-2 text-xs text-slate-500 hover:bg-slate-50">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* 头像 —— 折叠起来。它对成交没有任何影响,却曾经占着弹窗最显眼的一整行。 */}
          <details className="mb-3">
            <summary className="cursor-pointer list-none text-[11px] font-medium text-slate-400 hover:text-slate-600">
              {t('lunaTour:pickAnAvatarOptional')}
            </summary>
          <div className="mt-2 mb-1 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {seeds.map((s) => {
              const u = AVA(s)
              return (
                <button key={s} onClick={() => setAvatar(u)}
                  className={`shrink-0 overflow-hidden rounded-full ring-2 transition ${avatar === u ? 'ring-teal-500' : 'ring-transparent hover:ring-slate-200'}`}>
                  <img src={u} alt="" className="h-10 w-10 bg-slate-100" />
                </button>
              )
            })}
          </div>
          </details>

          {/* 笔记 —— 一个输入框,不是表单 */}
          <label className="mb-1.5 block text-xs font-medium text-slate-500">
            {t('lunaTour:clientNotesWriteFreely')}
          </label>
          <textarea
            ref={noteRef} value={note} onChange={(e) => { setNote(e.target.value); setChecked(false) }}
            rows={5}
            placeholder={t('lunaTour:eGMrChen2')}
            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          />

          {/* 自动读 —— 这里只报告状态,不再是一个「你必须点」的按钮 */}
          <div className="mt-2 flex min-h-[24px] items-center gap-1.5 text-xs text-slate-400">
            {checking ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('lunaTour:reading')}</>
            ) : checked ? (
              <><Check className="h-3.5 w-3.5 text-emerald-600" /> {t('lunaTour:understoodJustTapTo')}</>
            ) : note.trim().length >= 12 ? (
              <button onClick={check} className="flex items-center gap-1.5 font-semibold text-slate-600 hover:text-slate-900">
                <Wand2 className="h-3.5 w-3.5" /> {t('lunaTour:readNow')}
              </button>
            ) : (
              <><Wand2 className="h-3.5 w-3.5" /> {t('lunaTour:writeAFewLines')}</>
            )}
          </div>

          {err && <p className="mt-2 text-xs text-rose-500">{err}</p>}

          {/* AI 读懂了什么 */}
          {checked && chips.length > 0 && (
            <div className="mt-4 rounded-xl bg-emerald-50/70 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                <Check className="h-3.5 w-3.5" /> {t('lunaTour:aiUnderstood')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {chips.map((c, i) => (
                  <span key={i} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">{c}</span>
                ))}
              </div>
            </div>
          )}

          {/* ⭐ 还缺什么 —— 每条都带可点选项,一个字不用打 */}
          {checked && gaps.length > 0 && (
            <div className="mt-3 rounded-xl bg-amber-50/70 p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                  <Sparkles className="h-3.5 w-3.5" />
                  {t('lunaTour:gapsTapToFill', { gaps_length: gaps.length })}
                </span>
                <span className="text-[10px] tabular-nums text-amber-700">{pct}%</span>
              </div>
              <div className="mb-3 h-1 overflow-hidden rounded-full bg-amber-200/60">
                <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${pct}%` }} />
              </div>

              <div className="space-y-3">
                {gaps.map((g) => (
                  <div key={g.key}>
                    <p className="text-[13px] font-medium leading-snug text-slate-800">{g.question}</p>
                    {/* 缺了会损失**哪条具体论证** —— 不是抽象的「完整度 60%」 */}
                    <p className="mt-0.5 text-[11px] leading-snug text-amber-800/80">→ {g.why}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {g.options.map((o, i) => (
                        <button key={i} onClick={() => answer(g, o)}
                          className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-amber-100 hover:ring-amber-300 active:scale-95">
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {checked && gaps.length === 0 && (
            <div className="mt-3 flex items-center gap-1.5 rounded-xl bg-emerald-50/70 p-3 text-xs font-medium text-emerald-800">
              <Check className="h-4 w-4" /> {t('lunaTour:profileIsCompleteReady')}
            </div>
          )}
        </div>

        {/* 底 —— 不阻塞:缺信息也能存 */}
        <div className="shrink-0 border-t border-slate-100 px-4 py-3 sm:px-5">
          <button onClick={save} disabled={saving}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-teal-500 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-600 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {saving ? t('lunaTour:saving3') : (ctaLabel || (existing ? t('lunaTour:save') : t('lunaTour:createClient')))}
          </button>
          {checked && gaps.length > 0 && (
            <p className="mt-1.5 text-center text-[10px] text-slate-400">
              {t('lunaTour:youCanSaveWith')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
