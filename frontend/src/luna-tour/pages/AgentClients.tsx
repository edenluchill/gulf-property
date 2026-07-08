/**
 * Luna Tour — agent "客户" tab (route: /agent/clients).
 *
 * A workbench that knows who to chase: list cards surface heat / pipeline stage /
 * last activity / overdue follow-ups, with stage + search filters. The detail view
 * merges follow-ups and the client's real tour engagement into one timeline, lets
 * the agent log a follow-up, switch pipeline stage, and still generate an
 * investment proposal or a tour.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, X, Loader2, Check, ExternalLink, Copy, Sparkles, RefreshCw, ChevronLeft, FileText,
  Map as MapIcon, Search, Phone, MessageCircle, Mail, Users, Home, StickyNote, Flame,
  Clock, Eye, CheckCircle2, BarChart3, CalendarClock, Scale, ImageOff,
} from 'lucide-react'
import {
  lunaFetch, getClients, getClientDetail, addInteraction, setClientStage,
  searchProjectsForCompare, generateCompareReport, getClientReportStatus,
  type Client, type PipelineStage, type InteractionKind, type InteractionOutcome,
  type ClientInteraction, type ClientEngagement, type ClientHeat, type CompareSearchProject,
} from '../lunaApi'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../../components/DirhamSymbol'

const AVA = (seed: string) => `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,ffd5dc,ffdfbf`
const rseed = () => Math.random().toString(36).slice(2, 9)

const ago = (iso?: string | null) => {
  if (!iso) return ''
  const m = (Date.now() - new Date(iso).getTime()) / 60000
  if (m < 1) return '刚刚'
  if (m < 60) return `${Math.round(m)} 分钟前`
  if (m < 1440) return `${Math.round(m / 60)} 小时前`
  return `${Math.round(m / 1440)} 天前`
}
const isOverdue = (iso?: string | null) => !!iso && new Date(iso).getTime() <= Date.now()
const dateStr = (iso?: string | null) => (iso ? String(iso).slice(0, 10) : '')

const STAGES: { key: PipelineStage; label: string; chip: string }[] = [
  { key: 'new', label: '新客', chip: 'bg-blue-50 text-blue-600 ring-blue-200' },
  { key: 'engaged', label: '互动中', chip: 'bg-teal-50 text-teal-600 ring-teal-200' },
  { key: 'viewing', label: '看房', chip: 'bg-amber-50 text-amber-600 ring-amber-200' },
  { key: 'offer', label: '报价', chip: 'bg-purple-50 text-purple-600 ring-purple-200' },
  { key: 'closed', label: '成交', chip: 'bg-emerald-50 text-emerald-600 ring-emerald-200' },
  { key: 'lost', label: '流失', chip: 'bg-slate-100 text-slate-400 ring-slate-200' },
]
const stageMeta = (s?: PipelineStage | null) => STAGES.find((x) => x.key === s)

const heatTone = (h: number) =>
  h >= 70 ? 'bg-red-50 text-red-600 ring-red-200'
    : h >= 40 ? 'bg-amber-50 text-amber-600 ring-amber-200'
      : 'bg-slate-100 text-slate-500 ring-slate-200'

const KINDS: { key: InteractionKind; label: string; icon: typeof Phone }[] = [
  { key: 'call', label: '电话', icon: Phone },
  { key: 'whatsapp', label: '微信', icon: MessageCircle },
  { key: 'email', label: '邮件', icon: Mail },
  { key: 'meeting', label: '会面', icon: Users },
  { key: 'viewing', label: '看房', icon: Home },
  { key: 'note', label: '备注', icon: StickyNote },
]
const kindMeta = (k: InteractionKind) => KINDS.find((x) => x.key === k) || KINDS[5]

const OUTCOMES: { key: InteractionOutcome; label: string }[] = [
  { key: 'interested', label: '有意向' },
  { key: 'follow_up', label: '待跟进' },
  { key: 'not_interested', label: '没兴趣' },
  { key: 'closed_won', label: '成交' },
  { key: 'closed_lost', label: '流失' },
]
const outcomeLabel = (o: InteractionOutcome) => OUTCOMES.find((x) => x.key === o)?.label || o

function engagementInfo(e: ClientEngagement): { label: string; icon: typeof Eye } {
  switch (e.event_type) {
    case 'open': return { label: '打开导览', icon: Eye }
    case 'property_dwell': return { label: `停留 ${e.project_name || '项目'}${e.dwell_ms ? ` ${Math.round(e.dwell_ms / 1000)}s` : ''}`, icon: Clock }
    case 'tour_complete': return { label: '看完导览', icon: CheckCircle2 }
    case 'chart_view': return { label: '看了数据', icon: BarChart3 }
    case 'cta_whatsapp': return { label: '点了联系', icon: MessageCircle }
    default: return { label: e.event_type, icon: Eye }
  }
}

export default function AgentClients() {
  const [clients, setClients] = useState<Client[]>([])
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [sel, setSel] = useState<Client | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [stage, setStage] = useState<PipelineStage | 'all'>('all')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  const load = (stageArg: PipelineStage | 'all' = stage, qArg = q) => {
    setLoading(true)
    return getClients({ stage: stageArg === 'all' ? undefined : stageArg, q: qArg || undefined })
      .then((cs) => setClients(cs))
      .catch(() => setClients([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const id = setTimeout(() => load(stage, q), 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, q])

  const openDetail = (c: Client) => { setSel(c); setView('detail') }

  return (
    <div className="max-w-3xl">
      {view === 'list' ? (
        <>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">客户雷达</h1>
              <p className="text-sm text-slate-500">按热度排序，第一时间知道该追谁。</p>
            </div>
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white"><Plus className="h-4 w-4" />新建客户</button>
          </div>

          {/* search */}
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜名字 / 邮箱 / 电话"
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
          </div>

          {/* pipeline filter */}
          <div className="mb-4 flex flex-wrap gap-1.5">
            <FilterTab active={stage === 'all'} onClick={() => setStage('all')}>全部</FilterTab>
            {STAGES.map((s) => (
              <FilterTab key={s.key} active={stage === s.key} onClick={() => setStage(s.key)}>{s.label}</FilterTab>
            ))}
          </div>

          {loading ? (
            <div className="px-4 py-12 text-center text-sm text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
          ) : clients.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-12 text-center text-sm text-slate-400">
              {q || stage !== 'all' ? '没有匹配的客户。' : '还没有客户，点「新建客户」开始。'}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {clients.map((c) => <ClientCard key={c.id} c={c} onClick={() => openDetail(c)} />)}
            </div>
          )}
        </>
      ) : (
        sel && <ClientDetail client={sel} onBack={() => { setView('list'); load() }} onEdit={() => { setShowCreate(true) }} />
      )}

      {showCreate && (
        <ClientForm
          existing={view === 'detail' ? sel : null}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); load() }}
        />
      )}
    </div>
  )
}

function FilterTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
    >
      {children}
    </button>
  )
}

function ClientCard({ c, onClick }: { c: Client; onClick: () => void }) {
  const heat = c.heat ?? 0
  const sm = stageMeta(c.pipeline_stage)
  const overdue = isOverdue(c.next_followup_at)
  return (
    <button onClick={onClick} className="flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-teal-300">
      <div className="flex items-center gap-3">
        <img src={c.avatar_url || AVA(c.name)} alt={c.name} className="h-12 w-12 rounded-full bg-slate-100 ring-1 ring-slate-200" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-slate-800">{c.name}</div>
          <div className="truncate text-xs text-slate-400">{c.budget || '—'}{c.report_count ? ` · ${c.report_count} 份报告` : ''}</div>
        </div>
        <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ring-1 ${heatTone(heat)}`}>
          <Flame className="h-3 w-3" />{heat}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {sm && <span className={`rounded-full px-2 py-0.5 font-medium ring-1 ${sm.chip}`}>{sm.label}</span>}
        {c.last_activity_at && <span className="text-slate-400">活跃 {ago(c.last_activity_at)}</span>}
        {c.next_followup_at && (
          <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${overdue ? 'bg-red-50 text-red-600 ring-1 ring-red-200' : 'text-slate-400'}`}>
            <CalendarClock className="h-3 w-3" />{overdue ? '待跟进' : `跟进 ${dateStr(c.next_followup_at)}`}
          </span>
        )}
      </div>
    </button>
  )
}

function ClientDetail({ client, onBack, onEdit }: { client: Client; onBack: () => void; onEdit: () => void }) {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<'idle' | 'generating' | 'ready'>('idle')
  const [steps, setSteps] = useState<any[]>([])
  const [shareCode, setShareCode] = useState<string | null>(null)
  const [reports, setReports] = useState<any[]>([])
  const [interactions, setInteractions] = useState<ClientInteraction[]>([])
  const [engagement, setEngagement] = useState<ClientEngagement[]>([])
  const [heat, setHeat] = useState<ClientHeat | null>(null)
  const [stage, setStage] = useState<PipelineStage | null>(client.pipeline_stage || null)
  const [savingStage, setSavingStage] = useState(false)
  const [showCompare, setShowCompare] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const url = shareCode ? `${window.location.origin}/cr/${shareCode}` : ''

  const refresh = () =>
    getClientDetail(client.id).then((j) => {
      setReports(j.reports || [])
      setInteractions(j.interactions || [])
      setEngagement(j.engagement || [])
      setHeat(j.heat || null)
      if (j.client?.pipeline_stage) setStage(j.client.pipeline_stage)
    }).catch(() => {})

  useEffect(() => { refresh() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [client.id])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const changeStage = async (s: PipelineStage) => {
    if (s === stage || savingStage) return
    setSavingStage(true)
    const prev = stage
    setStage(s)
    try { await setClientStage(client.id, s); await refresh() }
    catch { setStage(prev); alert('更新失败') }
    finally { setSavingStage(false) }
  }

  const genReport = async () => {
    setPhase('generating'); setSteps([]); setShareCode(null)
    try {
      const r = await (await lunaFetch('/client-reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: client.id }) })).json()
      if (!r.shareCode) { setPhase('idle'); alert(r.error || '生成失败'); return }
      setShareCode(r.shareCode)
      pollRef.current = setInterval(async () => {
        const s = await (await lunaFetch(`/client-reports/${r.shareCode}/status`)).json()
        if (s.progress) setSteps(s.progress)
        if (s.status === 'ready') { clearInterval(pollRef.current!); setPhase('ready'); refresh() }
      }, 1500)
    } catch { setPhase('idle'); alert('生成失败') }
  }

  const fields: [string, string | null][] = [['背景', client.background], ['资金', client.budget], ['期待', client.expectations], ['特色', client.traits]]

  // merged activity timeline (newest first)
  type TL =
    | { ts: string; kind: 'interaction'; it: ClientInteraction }
    | { ts: string; kind: 'engagement'; ev: ClientEngagement }
  const timeline: TL[] = [
    ...interactions.map((it) => ({ ts: it.created_at, kind: 'interaction' as const, it })),
    ...engagement.map((ev) => ({ ts: ev.created_at, kind: 'engagement' as const, ev })),
  ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())

  return (
    <div>
      <button onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ChevronLeft className="h-4 w-4" />返回客户列表</button>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <img src={client.avatar_url || AVA(client.name)} alt={client.name} className="h-16 w-16 rounded-full bg-slate-100 ring-1 ring-slate-200" />
          <div className="flex-1">
            <div className="text-xl font-bold text-slate-900">{client.name}</div>
            {heat && (
              <div className="mt-1 flex items-center gap-2 text-xs">
                <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-bold ring-1 ${heatTone(heat.heat)}`}><Flame className="h-3 w-3" />热度 {heat.heat}</span>
                <span className="text-slate-400">打开 {heat.opens} · 完看 {heat.completes} · 联系 {heat.cta}</span>
              </div>
            )}
          </div>
          <button onClick={onEdit} className="text-sm text-slate-400 hover:text-slate-600">编辑</button>
        </div>

        {/* pipeline switcher */}
        <div className="mt-4">
          <div className="mb-1.5 text-[11px] font-semibold text-slate-400">管道阶段</div>
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map((s) => {
              const active = stage === s.key
              return (
                <button
                  key={s.key}
                  onClick={() => changeStage(s.key)}
                  disabled={savingStage}
                  className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors disabled:opacity-60 ${active ? s.chip : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50'}`}
                >
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {fields.map(([k, v]) => v && <div key={k} className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-[11px] text-slate-400">{k}</div><div className="mt-0.5 text-sm text-slate-700">{v}</div></div>)}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <button onClick={genReport} disabled={phase === 'generating'} className="flex items-center justify-center gap-2 rounded-xl bg-teal-500 px-4 py-3 font-semibold text-white hover:bg-teal-600 disabled:opacity-60">
            {phase === 'generating' ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5" />}生成投资提案
          </button>
          <button onClick={() => setShowCompare(true)} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 font-semibold text-slate-700 hover:bg-slate-50">
            <Scale className="h-5 w-5 text-teal-500" />生成对比报告
          </button>
          <button onClick={() => navigate('/agent/tour')} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 font-semibold text-slate-700 hover:bg-slate-50">
            <MapIcon className="h-5 w-5 text-teal-500" />生成导览
          </button>
        </div>

        {showCompare && <CompareModal clientId={client.id} onClose={() => { setShowCompare(false); refresh() }} />}

        {(phase === 'generating' || phase === 'ready') && (
          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="space-y-2.5">
              {steps.map((s) => (
                <div key={s.key} className="flex items-center gap-2.5 text-sm">
                  {s.done ? <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-3 w-3" /></span> : <Loader2 className="h-5 w-5 animate-spin text-slate-300" />}
                  <span className={s.done ? 'text-slate-700' : 'text-slate-400'}>{s.label}</span>
                </div>
              ))}
              {!steps.length && <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />正在启动…</div>}
            </div>
            {phase === 'ready' && (
              <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                <input readOnly value={url} className="flex-1 truncate rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600" />
                <button onClick={() => navigator.clipboard?.writeText(url)} className="rounded-lg border border-slate-200 p-2 text-slate-500"><Copy className="h-4 w-4" /></button>
                <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg bg-teal-500 px-3 py-2 text-sm font-semibold text-white"><ExternalLink className="h-4 w-4" />打开</a>
              </div>
            )}
          </div>
        )}

        {reports.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 text-xs font-bold text-slate-500">历史提案</div>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {reports.map((rp) => {
                const u = `${window.location.origin}/cr/${rp.share_code}`
                return (
                  <div key={rp.share_code} className="flex items-center gap-2 px-3 py-2.5">
                    <span className="flex-1 truncate text-sm text-slate-600">{String(rp.created_at).slice(0, 10)}{rp.view_count ? ` · 浏览 ${rp.view_count}` : ''}{rp.status !== 'ready' ? ` · ${rp.status}` : ''}</span>
                    <button onClick={() => navigator.clipboard?.writeText(u)} className="rounded-lg border border-slate-200 p-1.5 text-slate-400"><Copy className="h-3.5 w-3.5" /></button>
                    <a href={u} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 p-1.5 text-slate-400"><ExternalLink className="h-3.5 w-3.5" /></a>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* log a follow-up */}
      <FollowupForm clientId={client.id} onSaved={refresh} />

      {/* activity timeline */}
      <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm font-bold text-slate-700">活动时间线</div>
        {timeline.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">还没有跟进或客户行为记录。</div>
        ) : (
          <div className="space-y-2.5">
            {timeline.map((t, i) =>
              t.kind === 'interaction'
                ? <InteractionItem key={`i-${t.it.id || i}`} it={t.it} />
                : <EngagementItem key={`e-${i}`} ev={t.ev} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function CompareModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<CompareSearchProject[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<CompareSearchProject[]>([])
  const [phase, setPhase] = useState<'pick' | 'generating' | 'ready'>('pick')
  const [steps, setSteps] = useState<{ key: string; label: string; done: boolean }[]>([])
  const [shareCode, setShareCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const url = shareCode ? `${window.location.origin}/cr/${shareCode}` : ''

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    setSearching(true)
    const id = setTimeout(() => {
      searchProjectsForCompare(q.trim())
        .then((ps) => setResults(ps))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 250)
    return () => clearTimeout(id)
  }, [q])

  const isPicked = (id: number) => picked.some((p) => p.id === id)
  const toggle = (p: CompareSearchProject) => {
    setPicked((prev) => {
      if (prev.some((x) => x.id === p.id)) return prev.filter((x) => x.id !== p.id)
      if (prev.length >= 4) return prev
      return [...prev, p]
    })
  }

  const canGenerate = picked.length >= 2 && picked.length <= 4

  const generate = async () => {
    if (!canGenerate) return
    setPhase('generating'); setSteps([]); setError(null); setShareCode(null)
    try {
      const { shareCode: code } = await generateCompareReport({ client_id: clientId, project_ids: picked.map((p) => p.id) })
      setShareCode(code)
      pollRef.current = setInterval(async () => {
        try {
          const s = await getClientReportStatus(code)
          if (s.progress) setSteps(s.progress)
          if (s.status === 'ready') { clearInterval(pollRef.current!); setPhase('ready') }
          else if (s.status === 'error') { clearInterval(pollRef.current!); setError('生成失败'); setPhase('pick') }
        } catch { /* keep polling */ }
      }, 1500)
    } catch (e: any) { setError(e?.message || '生成失败'); setPhase('pick') }
  }

  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="flex items-center gap-2 text-base font-bold"><Scale className="h-5 w-5 text-teal-500" />生成对比报告</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        {phase === 'pick' ? (
          <>
            <div className="overflow-y-auto px-5 py-4">
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="搜项目名 / 区域"
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                />
              </div>

              {/* picked chips */}
              {picked.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {picked.map((p) => (
                    <button key={p.id} onClick={() => toggle(p)} className="flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 ring-1 ring-teal-200">
                      {p.project_name}<X className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              )}

              {searching ? (
                <div className="py-8 text-center text-sm text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
              ) : results.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-400">{q.trim() ? '没有匹配的项目。' : '输入关键词搜索项目，选 2-4 个对比。'}</div>
              ) : (
                <div className="space-y-2">
                  {results.map((p) => {
                    const on = isPicked(p.id)
                    const disabled = !on && picked.length >= 4
                    return (
                      <button
                        key={p.id}
                        onClick={() => toggle(p)}
                        disabled={disabled}
                        className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition disabled:opacity-40 ${on ? 'border-teal-400 bg-teal-50/60 ring-1 ring-teal-200' : 'border-slate-200 hover:border-teal-300'}`}
                      >
                        {p.primary_image
                          ? <img src={p.primary_image} alt={p.project_name} className="h-12 w-16 flex-shrink-0 rounded-lg object-cover" />
                          : <div className="flex h-12 w-16 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-300"><ImageOff className="h-5 w-5" /></div>}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-slate-800">{p.project_name}</div>
                          <div className="truncate text-xs text-slate-400">{p.area || '—'}{p.min_price != null ? <> · 起 <DirhamSymbol size="0.7em" className="text-slate-400" />{formatMoneyCompact(p.min_price, 'zh')}</> : ''}</div>
                        </div>
                        <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${on ? 'bg-teal-500 text-white' : 'border border-slate-300'}`}>{on && <Check className="h-3 w-3" />}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 px-5 py-3">
              {error && <div className="mb-2 text-xs text-rose-500">{error}</div>}
              <button
                onClick={generate}
                disabled={!canGenerate}
                className="w-full rounded-xl bg-teal-500 py-2.5 font-semibold text-white hover:bg-teal-600 disabled:bg-slate-200 disabled:text-slate-400"
              >
                {canGenerate ? `生成对比报告（${picked.length} 个项目）` : '选 2-4 个项目'}
              </button>
            </div>
          </>
        ) : (
          <div className="px-5 py-5">
            <div className="space-y-2.5">
              {steps.map((s) => (
                <div key={s.key} className="flex items-center gap-2.5 text-sm">
                  {s.done ? <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-3 w-3" /></span> : <Loader2 className="h-5 w-5 animate-spin text-slate-300" />}
                  <span className={s.done ? 'text-slate-700' : 'text-slate-400'}>{s.label}</span>
                </div>
              ))}
              {!steps.length && phase === 'generating' && <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />正在启动…</div>}
            </div>
            {phase === 'ready' && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <div className="mb-2 text-xs font-semibold text-slate-400">分享链接</div>
                <div className="flex items-center gap-2">
                  <input readOnly value={url} className="flex-1 truncate rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600" />
                  <button onClick={() => navigator.clipboard?.writeText(url)} className="rounded-lg border border-slate-200 p-2 text-slate-500"><Copy className="h-4 w-4" /></button>
                  <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg bg-teal-500 px-3 py-2 text-sm font-semibold text-white"><ExternalLink className="h-4 w-4" />打开报告</a>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function InteractionItem({ it }: { it: ClientInteraction }) {
  const km = kindMeta(it.kind)
  const Icon = km.icon
  return (
    <div className="flex gap-3 rounded-xl border border-teal-100 bg-teal-50/50 p-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-teal-600"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-slate-700">{km.label}</span>
          {it.outcome && <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-teal-700 ring-1 ring-teal-200">{outcomeLabel(it.outcome)}</span>}
          <span className="ml-auto shrink-0 text-[11px] text-slate-400">{ago(it.created_at)}</span>
        </div>
        {it.note && <div className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{it.note}</div>}
        {it.next_followup_at && <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400"><CalendarClock className="h-3 w-3" />下次跟进 {dateStr(it.next_followup_at)}</div>}
      </div>
    </div>
  )
}

function EngagementItem({ ev }: { ev: ClientEngagement }) {
  const info = engagementInfo(ev)
  const Icon = info.icon
  return (
    <div className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-500"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-600">{info.label}</span>
          <span className="ml-auto shrink-0 text-[11px] text-slate-400">{ago(ev.created_at)}</span>
        </div>
        <div className="mt-0.5 text-[11px] text-slate-400">客户行为</div>
      </div>
    </div>
  )
}

function FollowupForm({ clientId, onSaved }: { clientId: string; onSaved: () => void }) {
  const [kind, setKind] = useState<InteractionKind>('call')
  const [note, setNote] = useState('')
  const [outcome, setOutcome] = useState<'' | InteractionOutcome>('')
  const [followup, setFollowup] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      await addInteraction(clientId, {
        kind,
        note: note.trim() || undefined,
        outcome: outcome || undefined,
        next_followup_at: followup || undefined,
      })
      setNote(''); setOutcome(''); setFollowup('')
      onSaved()
    } catch { alert('保存失败') } finally { setSaving(false) }
  }

  return (
    <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 text-sm font-bold text-slate-700">记一条跟进</div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {KINDS.map((k) => {
          const Icon = k.icon
          const active = kind === k.key
          return (
            <button
              key={k.key}
              onClick={() => setKind(k.key)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors ${active ? 'bg-teal-500 text-white ring-teal-500' : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50'}`}
            >
              <Icon className="h-3.5 w-3.5" />{k.label}
            </button>
          )
        })}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="跟进内容…"
        className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
      />

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-slate-500">结果（可选）</span>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as '' | InteractionOutcome)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100">
            <option value="">—</option>
            {OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">下次跟进（可选）</span>
          <input type="date" value={followup} onChange={(e) => setFollowup(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100" />
        </label>
      </div>

      <button onClick={submit} disabled={saving} className="mt-3 w-full rounded-xl bg-teal-500 py-2.5 font-semibold text-white hover:bg-teal-600 disabled:opacity-60">
        {saving ? '保存中…' : '记录跟进'}
      </button>
    </div>
  )
}

function ClientForm({ existing, onClose, onSaved }: { existing: Client | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(existing?.name || '')
  const [background, setBackground] = useState(existing?.background || '')
  const [budget, setBudget] = useState(existing?.budget || '')
  const [expectations, setExpectations] = useState(existing?.expectations || '')
  const [traits, setTraits] = useState(existing?.traits || '')
  const [seeds, setSeeds] = useState<string[]>(() => Array.from({ length: 6 }, rseed))
  const [avatar, setAvatar] = useState<string>(existing?.avatar_url || '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!name.trim()) { alert('请填客户姓名'); return }
    setSaving(true)
    const body = JSON.stringify({ name, avatar_url: avatar || AVA(name), background, budget, expectations, traits })
    try {
      if (existing) await lunaFetch(`/clients/${existing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
      else await lunaFetch('/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      onSaved()
    } catch { alert('保存失败') } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h3 className="text-base font-bold">{existing ? '编辑客户' : '新建客户'}</h3><button onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>

        {/* Cartoon avatar picker */}
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500">卡通头像<button onClick={() => setSeeds(Array.from({ length: 6 }, rseed))} className="flex items-center gap-1 text-teal-600"><RefreshCw className="h-3 w-3" />换一批</button></div>
          <div className="grid grid-cols-6 gap-2">
            {seeds.map((s) => {
              const u = AVA(s)
              return <button key={s} onClick={() => setAvatar(u)} className={`overflow-hidden rounded-full ring-2 ${avatar === u ? 'ring-teal-500' : 'ring-transparent'}`}><img src={u} alt="" className="h-12 w-12 bg-slate-100" /></button>
            })}
          </div>
        </div>

        <div className="space-y-2.5">
          <Field label="姓名 *" value={name} onChange={setName} placeholder="如 陈先生" />
          <Field label="背景" value={background} onChange={setBackground} placeholder="如 香港投资客，首次置业迪拜" textarea />
          <Field label="资金" value={budget} onChange={setBudget} placeholder="如 300万 AED 现金" />
          <Field label="期待" value={expectations} onChange={setExpectations} placeholder="如 5年回报、地铁近、可自住" textarea />
          <Field label="人物特色" value={traits} onChange={setTraits} placeholder="如 谨慎、看重品牌开发商" />
        </div>
        <button onClick={save} disabled={saving} className="mt-4 w-full rounded-xl bg-teal-500 py-2.5 font-semibold text-white hover:bg-teal-600 disabled:opacity-60">
          {saving ? '保存中…' : existing ? <span className="flex items-center justify-center gap-1.5"><Check className="h-4 w-4" />保存</span> : <span className="flex items-center justify-center gap-1.5"><Sparkles className="h-4 w-4" />创建客户</span>}
        </button>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, textarea }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; textarea?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      {textarea
        ? <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={2} className="mt-1 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100" />
        : <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100" />}
    </label>
  )
}
