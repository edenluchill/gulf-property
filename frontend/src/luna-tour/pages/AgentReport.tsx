/**
 * Luna Tour — 「客户分析报告」(route: /agent/report)。
 *
 * owner 定性:**「用 AI 解释清楚为啥适合客户、特点是什么、为啥值得 —— 说服客户」**
 *
 * 所以这不是「秒出提案」(旧名),AI 的活也不是**选盘** —— 经纪心里早知道要推哪个项目,
 * 他缺的是「**怎么说服客户这个值得**」。
 *
 * 入口三段(全都不用打字):
 *   ① 客户 —— 从客户雷达选(**画像自动带出来**),或用同一个 ClientProfileWizard 新建
 *   ② 项目 —— 经纪手选(他知道要推什么)。不选才回落到 AI 推荐(给不确定的新人)
 *   ③ 生成 —— 20 积分
 *
 * ⚠️ 旧版是两个自由文本框(客户名字 + 一段画像),而 **CRM 里早就有全套结构化字段** ——
 *    经纪却要从零手打。而且旧版的「适合的户型」是假的(就是最便宜的 8 个)。
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Loader2, Check, ExternalLink, Copy, Sparkles, Search, X, Plus, User, Eye,
} from 'lucide-react'
import { lunaFetch, getClients, searchProjectsForCompare, type Client, type CompareSearchProject } from '../lunaApi'
import ClientProfileWizard, { type Profile } from '../ui/ClientProfileWizard'

interface Step { key: string; label: string; done: boolean }

/** 画像里最能决定论证质量的几条 —— 缺了就提示去补(不阻塞)。 */
const KEY_FIELDS: (keyof Profile)[] = ['goal', 'budget_max', 'payment', 'family_size', 'nationality', 'offplan_ok']

export default function AgentReport() {
  const { i18n } = useTranslation()
  const zh = !!i18n.language?.startsWith('zh')
  const L = (a: string, b: string) => (zh ? a : b)

  // ── 客户 ──────────────────────────────────────────────────────────────────
  const [clients, setClients] = useState<Client[]>([])
  const [clientId, setClientId] = useState('')
  const [profile, setProfile] = useState<Profile>({})
  const [showWizard, setShowWizard] = useState(false)

  // ── 项目(经纪手选)──────────────────────────────────────────────────────
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<CompareSearchProject[]>([])
  const [picked, setPicked] = useState<CompareSearchProject[]>([])
  const [searching, setSearching] = useState(false)

  // ── 生成 ─────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle')
  const [steps, setSteps] = useState<Step[]>([])
  const [shareCode, setShareCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState('')
  const [history, setHistory] = useState<any[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadClients = () => { void getClients().then(setClients).catch(() => {}) }
  const loadHistory = () => { lunaFetch('/client-reports').then((r) => r.json()).then((j) => setHistory(j.reports || [])).catch(() => {}) }
  useEffect(() => { loadClients(); loadHistory() }, [])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  // 选了客户 → 画像**自动带出来**(经纪不用重填)
  useEffect(() => {
    if (!clientId) { setProfile({}); return }
    void lunaFetch(`/clients/${clientId}/profile`)
      .then((r) => r.json())
      .then((j) => setProfile(j?.profile || {}))
      .catch(() => setProfile({}))
  }, [clientId])

  // 项目搜索(防抖)
  useEffect(() => {
    if (!q.trim()) { setHits([]); return }
    setSearching(true)
    const t = setTimeout(() => {
      void searchProjectsForCompare(q.trim())
        .then((r) => setHits(r.filter((h) => !picked.some((p) => p.id === h.id))))
        .catch(() => setHits([]))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(t)
  }, [q, picked])

  const missing = KEY_FIELDS.filter((k) => profile[k] == null || profile[k] === '')
  const url = shareCode ? `${window.location.origin}/cr/${shareCode}` : ''
  const canRun = !!clientId && phase !== 'generating'

  const run = async () => {
    setPhase('generating'); setErr(''); setShareCode(null); setSteps([])
    try {
      const r = await lunaFetch('/client-reports', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          profile,                                   // 结构化画像 —— 论证的全部依据
          project_ids: picked.map((p) => String(p.id)), // 空 → AI 推荐
        }),
      })
      const d = await r.json()
      if (!d.shareCode) { setErr(d.error || L('生成失败，请确认已登录', 'Generation failed — please sign in')); setPhase('error'); return }
      setShareCode(d.shareCode)
      pollRef.current = setInterval(async () => {
        try {
          const s = await (await lunaFetch(`/client-reports/${d.shareCode}/status`)).json()
          if (s.progress) setSteps(s.progress)
          if (s.status === 'ready') { clearInterval(pollRef.current!); setPhase('ready'); loadHistory() }
          else if (s.status === 'error') { clearInterval(pollRef.current!); setErr(L('生成失败', 'Generation failed')); setPhase('error') }
        } catch { /* keep polling */ }
      }, 1500)
    } catch (e) {
      setErr(e instanceof Error ? e.message : L('网络错误', 'Network error')); setPhase('error')
    }
  }

  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* */ } }

  return (
    <div className="max-w-2xl">
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-2xl font-bold">{L('客户分析报告', 'Client fit report')}</h1>
        {/* 样板报告 —— 不知道能产出什么的人不敢用 */}
        <a href="/cr/demo" target="_blank" rel="noreferrer"
          className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-200">
          <Eye className="h-3.5 w-3.5" /> {L('看一份样板', 'See a sample')}
        </a>
      </div>
      <p className="mb-6 text-sm text-slate-500">
        {L(
          '选客户 + 选项目 → AI 逐条论证「为什么这个适合他、哪个户型适合他」，用真实 DLD 数据说服客户。可分享链接、可存 PDF。',
          'Pick a client and a project → AI argues, point by point, why it fits them and which unit suits them — backed by real DLD data.'
        )}
      </p>

      <div className="mb-6 space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
        {/* ① 客户 ——— 画像自动带出来,不用手打 */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">{L('① 客户', '① Client')}</label>
          <div className="flex gap-2">
            <select
              value={clientId} onChange={(e) => setClientId(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              <option value="">{L('从客户雷达选一位…', 'Pick from client radar…')}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={() => setShowWizard(true)}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50">
              <Plus className="h-4 w-4" /> <span className="hidden sm:inline">{L('新客户', 'New')}</span>
            </button>
          </div>

          {/* 画像预览 —— 经纪要看得见 AI 拿到了什么 */}
          {clientId && (
            <div className="mt-2 rounded-xl bg-slate-50 p-3">
              <div className="flex flex-wrap gap-1.5">
                {Object.keys(profile).length === 0 ? (
                  <span className="text-xs text-slate-400">{L('这个客户还没有画像', 'No profile yet')}</span>
                ) : (
                  <ProfileChips profile={profile} zh={zh} />
                )}
              </div>
              {missing.length > 0 && (
                <button onClick={() => setShowWizard(true)}
                  className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:underline">
                  <Sparkles className="h-3 w-3" />
                  {L(`画像缺 ${missing.length} 条关键信息 —— 补上匹配会准很多`, `${missing.length} gaps in the profile — fill them for a sharper report`)}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ② 项目 ——— 经纪手选(他知道要推什么) */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">
            {L('② 项目', '② Project')}
            <span className="ml-1 font-normal text-slate-400">{L('（不选 = 让 AI 帮你推荐）', '(leave empty = let AI pick)')}</span>
          </label>

          {picked.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {picked.map((p) => (
                <span key={p.id} className="flex items-center gap-1 rounded-full bg-teal-50 py-1 pl-2.5 pr-1 text-xs font-medium text-teal-800 ring-1 ring-teal-200">
                  {p.project_name}
                  <button onClick={() => setPicked((v) => v.filter((x) => x.id !== p.id))}
                    className="rounded-full p-0.5 transition hover:bg-teal-200"><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          )}

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={L('搜项目名…', 'Search a project…')}
              className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
            {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-300" />}
          </div>

          {hits.length > 0 && (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200">
              {hits.slice(0, 8).map((h) => (
                <button key={h.id}
                  onClick={() => { setPicked((v) => [...v, h]); setQ(''); setHits([]) }}
                  className="flex w-full items-center gap-2 border-b border-slate-50 px-3 py-2 text-left transition last:border-0 hover:bg-slate-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">{h.project_name}</span>
                    {h.area && <span className="block truncate text-[11px] text-slate-400">{h.area}</span>}
                  </span>
                  <Plus className="h-4 w-4 shrink-0 text-slate-300" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ③ 生成 */}
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
          <button disabled={!canRun} onClick={run}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-40">
            {phase === 'generating' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {phase === 'generating' ? L('生成中…', 'Generating…') : L('生成分析报告', 'Generate report')}
          </button>
          <span className="text-[11px] text-slate-400">20 {L('积分', 'credits')}</span>
          {!clientId && <span className="text-[11px] text-slate-400">{L('先选一位客户', 'Pick a client first')}</span>}
          {err && <span className="text-sm text-rose-500">❌ {err}</span>}
        </div>
      </div>

      {/* 进度 */}
      {(phase === 'generating' || phase === 'ready') && (
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/[0.06]">
          <div className="space-y-3">
            {steps.map((s) => (
              <div key={s.key} className="flex items-center gap-3 text-sm">
                {s.done
                  ? <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-3.5 w-3.5" /></span>
                  : <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100"><Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" /></span>}
                <span className={s.done ? 'text-slate-700' : 'text-slate-400'}>{s.label}</span>
              </div>
            ))}
            {!steps.length && <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />{L('正在启动…', 'Starting…')}</div>}
          </div>

          {phase === 'ready' && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <div className="mb-2 text-sm font-semibold text-slate-800">✅ {L('报告已生成，可直接发给客户：', 'Report ready — send it to your client:')}</div>
              <div className="flex items-center gap-2">
                <input readOnly value={url} className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600" />
                <button onClick={copy} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">{copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}</button>
                <a href={url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 rounded-lg bg-teal-500 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-600"><ExternalLink className="h-4 w-4" /></a>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">{L('客户打开后可点「保存 PDF」。链接公开，无需登录。', 'Clients can save it as a PDF. The link is public — no sign-in.')}</p>
            </div>
          )}
        </div>
      )}

      {/* 历史 */}
      {history.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-bold text-slate-700">{L('我的分析报告', 'My reports')}（{history.length}）</h2>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
            {history.map((h) => {
              const u = `${window.location.origin}/cr/${h.share_code}`
              return (
                <div key={h.share_code} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-800">{h.client_name || L('未命名客户', 'Unnamed')}</span>
                      {h.status === 'generating' && <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">{L('生成中', 'Generating')}</span>}
                      {h.status === 'error' && <span className="shrink-0 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-600">{L('失败', 'Failed')}</span>}
                    </div>
                    <div className="truncate text-xs text-slate-400">{String(h.created_at).slice(0, 10)}{h.view_count ? ` · ${L('浏览', 'Views')} ${h.view_count}` : ''}</div>
                  </div>
                  <button onClick={() => { navigator.clipboard?.writeText(u) }} className="shrink-0 rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><Copy className="h-4 w-4" /></button>
                  <a href={u} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><ExternalLink className="h-4 w-4" /></a>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 画像 wizard —— 和客户雷达用的是**同一个组件** */}
      {showWizard && (
        <ClientProfileWizard
          existing={clientId ? { id: clientId, name: clients.find((c) => c.id === clientId)?.name } : null}
          onClose={() => setShowWizard(false)}
          onSaved={(id, p) => {
            setShowWizard(false)
            setClientId(id)
            setProfile(p)
            loadClients()
          }}
          ctaLabel={L('保存画像', 'Save profile')}
        />
      )}
    </div>
  )
}

function ProfileChips({ profile: p, zh }: { profile: Profile; zh: boolean }) {
  const out: string[] = []
  if (p.goal) out.push({ live: zh ? '自住' : 'End-use', invest: zh ? '投资' : 'Investment', both: zh ? '先租后住' : 'Rent then live' }[p.goal])
  const b = p.budget_max ?? p.budget_min
  if (b) out.push(`AED ${(b / 1_000_000).toFixed(b % 1_000_000 ? 1 : 0)}M`)
  if (p.payment) out.push({ cash: zh ? '全款' : 'Cash', installment: zh ? '分期' : 'Installments', mortgage: zh ? '贷款' : 'Mortgage' }[p.payment as string] || String(p.payment))
  if (p.horizon) out.push({ rent_long: zh ? '长期收租' : 'Long-term', flip: zh ? '3-5年转手' : 'Flip', rent_then_live: zh ? '先租后住' : 'Rent then live' }[p.horizon as string] || String(p.horizon))
  if (p.family_size) out.push(zh ? `${p.family_size} 口人` : `${p.family_size} people`)
  if (p.has_children) out.push(zh ? '有小孩' : 'Kids')
  if (p.has_maid) out.push(zh ? '请保姆' : 'Maid')
  if (p.cooking === 'often') out.push(zh ? '常做饭' : 'Cooks often')
  if (p.nationality) out.push(String(p.nationality))
  if (p.golden_visa) out.push(zh ? '要黄金签证' : 'Golden visa')
  if (p.first_time_buyer) out.push(zh ? '首次置业' : 'First-time')
  return (
    <>
      {out.map((c, i) => (
        <span key={i} className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200">
          {i === 0 && <User className="h-3 w-3 text-slate-400" />}{c}
        </span>
      ))}
    </>
  )
}
