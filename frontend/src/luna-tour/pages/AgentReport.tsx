/**
 * Luna Tour — agent "选房报告" tab (route: /agent/report).
 *
 * Enter a client profile → AI matches real best-fit projects and produces a
 * client-facing report: 5-year ROI projection (computed from real price) +
 * optimistic / base / conservative scenarios + key risks, per property.
 * Read-only; calls POST /api/luna/agent/report.
 */
import { useState } from 'react'
import { lunaFetch } from '../lunaApi'

interface Projection {
  buy: number
  future: number
  total_profit_5yr: number
  rental_income_5yr: number
  appreciation_5yr: number
  annualized_return_pct: number
  yield_pct: number
  payback_years: number | null
}

interface ReportProperty {
  id: string
  name: string
  area: string | null
  developer: string | null
  image: string | null
  reason: string
  projection: Projection | null
  scenarios: { optimistic: string; base: string; conservative: string } | null
  risks: string[]
}

interface ClientReport {
  client_name: string
  profile: string
  summary: string
  properties: ReportProperty[]
  assumptions: string
  disclaimer: string
}

const fmtAED = (n: number) => `AED ${Math.round(n).toLocaleString()}`

export default function AgentReport() {
  const [clientName, setClientName] = useState('')
  const [oneLiner, setOneLiner] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [report, setReport] = useState<ClientReport | null>(null)

  const canRun = !!(clientName.trim() || oneLiner.trim())

  const run = async () => {
    setLoading(true)
    setErr('')
    setReport(null)
    try {
      const r = await lunaFetch(`/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: clientName.trim() ? { name: clientName.trim() } : {}, one_liner: oneLiner }),
      })
      const d = await r.json()
      if (!r.ok) setErr(d.error || '生成失败')
      else if (!d.report?.properties?.length) setErr('没有匹配到合适的楼盘，试着补充预算/区域等画像。')
      else setReport(d.report)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '网络错误')
    }
    setLoading(false)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">选房报告</h1>
      <p className="text-sm text-slate-500 mb-6">填客户画像 → AI 找合适房源 + 5 年收益预测与可能发生的情景，生成可发给客户的报告</p>

      <div className="rounded-xl border border-slate-200 bg-white p-4 mb-6 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2">
          <input
            className="border rounded-lg px-3 py-2 text-sm"
            placeholder="客户名字 (如 陈先生)"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
          />
          <input
            className="border rounded-lg px-3 py-2 text-sm"
            placeholder="客户画像 (如「香港投资客, 预算300万, 重回报, 想要地铁近」)"
            value={oneLiner}
            onChange={(e) => setOneLiner(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button
            disabled={!canRun || loading}
            onClick={run}
            className="bg-emerald-500 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? '生成中… (~15s)' : '生成选房报告'}
          </button>
          {err && <span className="text-sm text-red-500">❌ {err}</span>}
        </div>
      </div>

      {report && (
        <div className="space-y-5">
          {/* header / summary */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-5">
            <div className="text-lg font-bold text-slate-900">
              {report.client_name ? `${report.client_name} 的选房报告` : '客户选房报告'}
            </div>
            {report.profile && <div className="text-xs text-slate-500 mt-0.5">画像：{report.profile}</div>}
            {report.summary && <p className="text-sm text-slate-700 mt-3 leading-relaxed">{report.summary}</p>}
            <div className="text-xs text-slate-400 mt-3">{report.assumptions}</div>
          </div>

          {/* per-property */}
          {report.properties.map((p, i) => (
            <div key={p.id} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="flex gap-4 p-4">
                {p.image ? (
                  <img src={p.image} alt="" className="w-28 h-28 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-28 h-28 rounded-lg bg-slate-100 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-emerald-600 font-semibold">候选 {i + 1}</div>
                  <div className="text-lg font-bold text-slate-900 truncate">{p.name}</div>
                  <div className="text-xs text-slate-500">{[p.area, p.developer].filter(Boolean).join(' · ') || 'Dubai'}</div>
                  <div className="text-sm text-slate-600 mt-1.5">为何适合：{p.reason}</div>
                </div>
              </div>

              {/* projection */}
              {p.projection && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-slate-100 border-y border-slate-100">
                  <Metric label="买入价" v={fmtAED(p.projection.buy)} />
                  <Metric label="5 年后约" v={fmtAED(p.projection.future)} accent />
                  <Metric label="年化回报" v={`${p.projection.annualized_return_pct}%`} />
                  <Metric label="回本年限" v={p.projection.payback_years ? `${p.projection.payback_years} 年` : '—'} />
                </div>
              )}

              {/* scenarios */}
              {p.scenarios && (
                <div className="p-4 grid gap-2 md:grid-cols-3">
                  <Scenario tone="up" label="乐观" text={p.scenarios.optimistic} />
                  <Scenario tone="mid" label="基准" text={p.scenarios.base} />
                  <Scenario tone="down" label="保守" text={p.scenarios.conservative} />
                </div>
              )}

              {/* risks */}
              {p.risks.length > 0 && (
                <div className="px-4 pb-4 -mt-1">
                  <div className="text-xs font-semibold text-slate-500 mb-1.5">⚠️ 需要留意</div>
                  <div className="flex flex-wrap gap-1.5">
                    {p.risks.map((r, j) => (
                      <span key={j} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-0.5">
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          <p className="text-[11px] text-slate-400 leading-relaxed">{report.disclaimer}</p>
        </div>
      )}
    </div>
  )
}

function Metric({ label, v, accent }: { label: string; v: string; accent?: boolean }) {
  return (
    <div className="bg-white p-3 text-center">
      <div className={`text-sm font-bold ${accent ? 'text-emerald-600' : 'text-slate-800'}`}>{v}</div>
      <div className="text-[11px] text-slate-400 mt-0.5">{label}</div>
    </div>
  )
}

function Scenario({ tone, label, text }: { tone: 'up' | 'mid' | 'down'; label: string; text: string }) {
  const c =
    tone === 'up'
      ? 'border-emerald-200 bg-emerald-50/60'
      : tone === 'down'
        ? 'border-slate-200 bg-slate-50'
        : 'border-sky-200 bg-sky-50/60'
  if (!text) return null
  return (
    <div className={`rounded-lg border ${c} p-3`}>
      <div className="text-xs font-semibold text-slate-700 mb-1">{label}情景</div>
      <div className="text-xs text-slate-600 leading-relaxed">{text}</div>
    </div>
  )
}
