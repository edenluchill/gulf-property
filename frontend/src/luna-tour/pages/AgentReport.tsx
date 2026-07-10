/**
 * Luna Tour — agent "客户投资提案" tab (route: /agent/report).
 *
 * Enter a client profile → async-generates a comprehensive, shareable, printable
 * investment proposal (real DLD data per project + market/policy/trends). Shows
 * generation progress; on ready gives a /cr/:code link to send the client.
 */
import { useEffect, useRef, useState } from 'react'
import { Loader2, Check, ExternalLink, Copy, Sparkles } from 'lucide-react'
import { lunaFetch } from '../lunaApi'

interface Step { key: string; label: string; done: boolean }

export default function AgentReport() {
  const [clientName, setClientName] = useState('')
  const [oneLiner, setOneLiner] = useState('')
  const [phase, setPhase] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle')
  const [steps, setSteps] = useState<Step[]>([])
  const [shareCode, setShareCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState('')
  const [history, setHistory] = useState<any[]>([])
  const [offers, setOffers] = useState<any[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const canRun = !!(clientName.trim() || oneLiner.trim())
  const url = shareCode ? `${window.location.origin}/cr/${shareCode}` : ''

  const loadHistory = () => { lunaFetch('/client-reports').then((r) => r.json()).then((j) => setHistory(j.reports || [])).catch(() => {}) }
  useEffect(() => { loadHistory() }, [])
  // Sales Offer 报价单生成记录(在项目详情页生成;60 天有效,过期行保留)
  useEffect(() => { lunaFetch('/payplans').then((r) => r.json()).then((j) => setOffers(j.offers || [])).catch(() => {}) }, [])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const run = async () => {
    setPhase('generating'); setErr(''); setShareCode(null); setSteps([])
    try {
      const r = await lunaFetch('/client-reports', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: clientName.trim() ? { name: clientName.trim() } : {}, one_liner: oneLiner }),
      })
      const d = await r.json()
      if (!d.shareCode) { setErr(d.error || '生成失败，请确认已登录'); setPhase('error'); return }
      setShareCode(d.shareCode)
      pollRef.current = setInterval(async () => {
        try {
          const s = await (await lunaFetch(`/client-reports/${d.shareCode}/status`)).json()
          if (s.progress) setSteps(s.progress)
          if (s.status === 'ready') { clearInterval(pollRef.current!); setPhase('ready'); loadHistory() }
          else if (s.status === 'error') { clearInterval(pollRef.current!); setErr('生成失败'); setPhase('error') }
        } catch { /* keep polling */ }
      }, 1500)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '网络错误'); setPhase('error')
    }
  }

  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* */ } }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold">秒出提案</h1>
      <p className="mb-6 text-sm text-slate-500">填客户画像 → 生成一份用真实 DLD 数据 + 市场政策趋势的综合提案，可分享链接、可存 PDF 发给客户。</p>

      <div className="mb-6 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="grid gap-3 md:grid-cols-2">
          <input className="rounded-lg border px-3 py-2 text-sm" placeholder="客户名字（如 陈先生）" value={clientName} onChange={(e) => setClientName(e.target.value)} />
          <input className="rounded-lg border px-3 py-2 text-sm" placeholder="客户画像（如「预算300万, 重5年回报, 想地铁近」）" value={oneLiner} onChange={(e) => setOneLiner(e.target.value)} />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button disabled={!canRun || phase === 'generating'} onClick={run}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {phase === 'generating' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {phase === 'generating' ? '生成中…' : '生成投资提案'}
          </button>
          {err && <span className="text-sm text-red-500">❌ {err}</span>}
        </div>
      </div>

      {/* Progress */}
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
            {!steps.length && <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />正在启动…</div>}
          </div>

          {phase === 'ready' && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <div className="mb-2 text-sm font-semibold text-slate-800">✅ 提案已生成，可直接发给客户：</div>
              <div className="flex items-center gap-2">
                <input readOnly value={url} className="flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600" />
                <button onClick={copy} className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">{copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}</button>
                <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg bg-teal-500 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-600"><ExternalLink className="h-4 w-4" />打开</a>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">客户打开后可点「保存 PDF」。链接公开，无需登录。</p>
            </div>
          )}
        </div>
      )}

      {/* History — past client proposals, findable + re-shareable */}
      {history.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-bold text-slate-700">我的客户报告（{history.length}）</h2>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
            {history.map((h) => {
              const u = `${window.location.origin}/cr/${h.share_code}`
              return (
                <div key={h.share_code} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-800">{h.client_name || '未命名客户'}</span>
                      {h.status === 'generating' && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">生成中</span>}
                      {h.status === 'error' && <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-600">失败</span>}
                    </div>
                    <div className="truncate text-xs text-slate-400">{h.brief || '—'} · {String(h.created_at).slice(0, 10)}{h.view_count ? ` · 浏览 ${h.view_count}` : ''}</div>
                  </div>
                  <button onClick={() => { navigator.clipboard?.writeText(u) }} title="复制链接" className="flex-shrink-0 rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><Copy className="h-4 w-4" /></button>
                  <a href={u} target="_blank" rel="noreferrer" title="打开" className="flex-shrink-0 rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><ExternalLink className="h-4 w-4" /></a>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Sales Offer 报价单记录(在项目详情页「生成 Sales Offer」产出;60 天有效) */}
      {offers.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-bold text-slate-700">我的 Sales Offer 报价单({offers.length})</h2>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
            {offers.map((o) => {
              const u = `${window.location.origin}/pp/${o.share_code}`
              return (
                <div key={o.share_code} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-800">{o.project_name}</span>
                      {o.unit_name && <span className="truncate text-xs text-slate-400">{o.unit_name}</span>}
                      {o.expired && <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">已过期</span>}
                    </div>
                    <div className="truncate text-xs text-slate-400">
                      AED {Number(o.price).toLocaleString('en-US')}
                      {o.original_price && ` (原价 ${Number(o.original_price).toLocaleString('en-US')})`}
                      {' · '}{String(o.created_at).slice(0, 10)}
                      {o.view_count ? ` · 浏览 ${o.view_count}` : ''}
                    </div>
                  </div>
                  <button onClick={() => { navigator.clipboard?.writeText(u) }} title="复制链接" className="flex-shrink-0 rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><Copy className="h-4 w-4" /></button>
                  <a href={u} target="_blank" rel="noreferrer" title="打开" className="flex-shrink-0 rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><ExternalLink className="h-4 w-4" /></a>
                </div>
              )
            })}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">报价单有效期 60 天(5 积分/份);过期后客户打开会提示联系你获取最新报价。</p>
        </div>
      )}
    </div>
  )
}
