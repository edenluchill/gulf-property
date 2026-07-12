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
function profileChips(p: Profile, zh: boolean): string[] {
  const out: string[] = []
  const goal = { live: zh ? '自住' : 'End-use', invest: zh ? '投资' : 'Investment', both: zh ? '先租后住' : 'Rent then live' }
  if (p.goal) out.push(goal[p.goal])
  const b = p.budget_max ?? p.budget_min
  if (b) out.push(`AED ${(b / 1_000_000).toFixed(b % 1_000_000 ? 1 : 0)}M`)
  if (p.payment) out.push({ cash: zh ? '全款' : 'Cash', installment: zh ? '分期' : 'Installments', mortgage: zh ? '贷款' : 'Mortgage' }[p.payment as string] || String(p.payment))
  if (p.horizon) out.push({ rent_long: zh ? '长期收租' : 'Long-term rental', flip: zh ? '3-5年转手' : 'Flip 3-5y', rent_then_live: zh ? '先租后住' : 'Rent then live' }[p.horizon as string] || String(p.horizon))
  if (p.family_size) out.push(zh ? `${p.family_size} 口人` : `${p.family_size} people`)
  if (p.has_children) out.push(zh ? '有小孩' : 'Has children')
  if (p.has_maid) out.push(zh ? '请保姆' : 'Has a maid')
  if (p.cooking === 'often') out.push(zh ? '常做饭' : 'Cooks often')
  if (p.bedrooms) out.push(`${p.bedrooms}BR`)
  if (p.nationality) out.push(String(p.nationality))
  if (p.golden_visa) out.push(zh ? '要黄金签证' : 'Golden visa')
  if (p.first_time_buyer) out.push(zh ? '首次置业' : 'First-time buyer')
  if (p.offplan_ok === false) out.push(zh ? '只要现房' : 'Ready only')
  if (p.preferred_areas?.length) out.push(...p.preferred_areas.slice(0, 3))
  return out
}

/** 把点选的答案转成人话，追加进笔记 —— 经纪要看得见自己的画像长什么样。 */
function answerToNote(gap: Gap, label: string): string {
  return `${gap.question.replace(/[？?]$/, '')}：${label}`
}

export default function ClientProfileWizard({ existing, onClose, onSaved, ctaLabel }: ClientProfileWizardProps) {
  const { i18n } = useTranslation()
  const zh = !!i18n.language?.startsWith('zh')
  const L = (a: string, b: string) => (zh ? a : b)

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

  const check = async () => {
    setChecking(true); setErr('')
    try {
      const r = await lunaFetch('/clients/profile-coach', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: note, client_id: existing?.id }),
      })
      const j = await r.json()
      if (!j.success) { setErr(j.error || L('检查失败', 'Check failed')); return }
      setProfile((prev) => ({ ...prev, ...j.extracted }))
      if (j.extracted?.name && !name.trim()) setName(j.extracted.name)
      setGaps(j.gaps || [])
      setKnown(j.known ?? 0); setTotal(j.total ?? 6)
      setChecked(true)
    } catch { setErr(L('网络错误', 'Network error')) } finally { setChecking(false) }
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
    if (!nm) { setErr(L('请填客户姓名', 'Client name is required')); return }
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
      setErr(L('保存失败', 'Save failed'))
    } finally { setSaving(false) }
  }

  const chips = profileChips(profile, zh)
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
              {existing ? L('客户画像', 'Client profile') : L('新建客户', 'New client')}
            </h3>
            <p className="mt-0.5 truncate text-[11px] text-slate-400">
              {L('随便写，AI 会帮你补齐缺的信息', 'Just write freely — AI fills in the gaps')}
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
              placeholder={L('客户姓名 *', 'Client name *')}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
            <button onClick={() => setSeeds(Array.from({ length: 6 }, rseed))} title={L('换头像', 'Shuffle avatars')}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-2 text-xs text-slate-500 hover:bg-slate-50">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

          {/* 笔记 —— 一个输入框,不是表单 */}
          <label className="mb-1.5 block text-xs font-medium text-slate-500">
            {L('客户情况（随便写，像记笔记一样）', 'Client notes (write freely)')}
          </label>
          <textarea
            ref={noteRef} value={note} onChange={(e) => { setNote(e.target.value); setChecked(false) }}
            rows={5}
            placeholder={L(
              '例：陈先生，香港投资客，预算300万现金，一家四口有两个小孩，想地铁近，重视5年回报',
              'e.g. Mr. Chen, HK investor, AED 3M cash, family of 4 with two kids, wants metro nearby, focused on 5-year return'
            )}
            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          />

          <button
            onClick={check} disabled={checking || !note.trim()}
            className="mt-2 flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
          >
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            {checking ? L('读取中…', 'Reading…') : L('AI 检查画像', 'Check with AI')}
          </button>

          {err && <p className="mt-2 text-xs text-rose-500">{err}</p>}

          {/* AI 读懂了什么 */}
          {checked && chips.length > 0 && (
            <div className="mt-4 rounded-xl bg-emerald-50/70 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                <Check className="h-3.5 w-3.5" /> {L('AI 读到了', 'AI understood')}
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
                  {L(`还缺 ${gaps.length} 条（点一下就补上）`, `${gaps.length} gaps — tap to fill`)}
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
              <Check className="h-4 w-4" /> {L('画像够全了，可以生成精准的分析报告', 'Profile is complete — ready for a precise report')}
            </div>
          )}
        </div>

        {/* 底 —— 不阻塞:缺信息也能存 */}
        <div className="shrink-0 border-t border-slate-100 px-4 py-3 sm:px-5">
          <button onClick={save} disabled={saving}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-teal-500 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-600 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {saving ? L('保存中…', 'Saving…') : (ctaLabel || (existing ? L('保存', 'Save') : L('创建客户', 'Create client')))}
          </button>
          {checked && gaps.length > 0 && (
            <p className="mt-1.5 text-center text-[10px] text-slate-400">
              {L('缺的信息不补也能存 —— 但报告的说服力会打折', 'You can save with gaps — the report will just be less convincing')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
