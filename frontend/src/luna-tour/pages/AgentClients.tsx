/**
 * Luna Tour — agent "客户" tab (route: /agent/clients).
 * Create a client profile (cartoon avatar + background/funds/expectations/traits),
 * then from the client generate an investment proposal or a tour.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, X, Loader2, Check, ExternalLink, Copy, Sparkles, RefreshCw, ChevronLeft, FileText, Map as MapIcon } from 'lucide-react'
import { lunaFetch } from '../lunaApi'

const AVA = (seed: string) => `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,ffd5dc,ffdfbf`
const rseed = () => Math.random().toString(36).slice(2, 9)

interface Client { id: string; name: string; avatar_url: string | null; background: string | null; budget: string | null; expectations: string | null; traits: string | null; report_count?: number }

export default function AgentClients() {
  const [clients, setClients] = useState<Client[]>([])
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [sel, setSel] = useState<Client | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const load = () => lunaFetch('/clients').then((r) => r.json()).then((j) => setClients(j.clients || [])).catch(() => {})
  useEffect(() => { load() }, [])

  const openDetail = (c: Client) => { setSel(c); setView('detail') }

  return (
    <div className="max-w-3xl">
      {view === 'list' ? (
        <>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">客户</h1>
              <p className="text-sm text-slate-500">先建客户画像，再从客户生成投资提案或导览。</p>
            </div>
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white"><Plus className="h-4 w-4" />新建客户</button>
          </div>
          {clients.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-12 text-center text-sm text-slate-400">还没有客户，点「新建客户」开始。</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {clients.map((c) => (
                <button key={c.id} onClick={() => openDetail(c)} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-teal-300">
                  <img src={c.avatar_url || AVA(c.name)} alt={c.name} className="h-12 w-12 rounded-full bg-slate-100 ring-1 ring-slate-200" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-800">{c.name}</div>
                    <div className="truncate text-xs text-slate-400">{c.budget || '—'}{c.report_count ? ` · ${c.report_count} 份报告` : ''}</div>
                  </div>
                </button>
              ))}
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

function ClientDetail({ client, onBack, onEdit }: { client: Client; onBack: () => void; onEdit: () => void }) {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<'idle' | 'generating' | 'ready'>('idle')
  const [steps, setSteps] = useState<any[]>([])
  const [shareCode, setShareCode] = useState<string | null>(null)
  const [reports, setReports] = useState<any[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const url = shareCode ? `${window.location.origin}/cr/${shareCode}` : ''

  useEffect(() => { lunaFetch(`/clients/${client.id}`).then((r) => r.json()).then((j) => setReports(j.reports || [])).catch(() => {}) }, [client.id])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const genReport = async () => {
    setPhase('generating'); setSteps([]); setShareCode(null)
    try {
      const r = await (await lunaFetch('/client-reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: client.id }) })).json()
      if (!r.shareCode) { setPhase('idle'); alert(r.error || '生成失败'); return }
      setShareCode(r.shareCode)
      pollRef.current = setInterval(async () => {
        const s = await (await lunaFetch(`/client-reports/${r.shareCode}/status`)).json()
        if (s.progress) setSteps(s.progress)
        if (s.status === 'ready') { clearInterval(pollRef.current!); setPhase('ready') }
      }, 1500)
    } catch { setPhase('idle'); alert('生成失败') }
  }

  const fields: [string, string | null][] = [['背景', client.background], ['资金', client.budget], ['期待', client.expectations], ['特色', client.traits]]
  return (
    <div>
      <button onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ChevronLeft className="h-4 w-4" />返回客户列表</button>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <img src={client.avatar_url || AVA(client.name)} alt={client.name} className="h-16 w-16 rounded-full bg-slate-100 ring-1 ring-slate-200" />
          <div className="flex-1"><div className="text-xl font-bold text-slate-900">{client.name}</div></div>
          <button onClick={onEdit} className="text-sm text-slate-400 hover:text-slate-600">编辑</button>
        </div>
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {fields.map(([k, v]) => v && <div key={k} className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-[11px] text-slate-400">{k}</div><div className="mt-0.5 text-sm text-slate-700">{v}</div></div>)}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button onClick={genReport} disabled={phase === 'generating'} className="flex items-center justify-center gap-2 rounded-xl bg-teal-500 px-4 py-3 font-semibold text-white hover:bg-teal-600 disabled:opacity-60">
            {phase === 'generating' ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5" />}生成投资提案
          </button>
          <button onClick={() => navigate('/agent/tour')} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 font-semibold text-slate-700 hover:bg-slate-50">
            <MapIcon className="h-5 w-5 text-teal-500" />生成导览
          </button>
        </div>

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
