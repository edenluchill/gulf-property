/**
 * AI 买房决策报告 (功能 E)
 * 问卷 → 推荐区域 + 5年区间预测(保守/中性/乐观) + 假设与免责 + 可打印导出
 * 复用功能 C 区域分级 + investment-calculator。预测一律给区间，绝不给单一"稳赚"数字。
 */
import { useState, useEffect } from 'react'
import { generateBuyingReport, BuyingReport, Proj5yr } from '../lib/api'

interface AgentBrand { name: string; agency: string; rera: string; phone: string }
const BRAND_KEY = 'pinzos_agent_brand'

const GOALS = [
  { v: 'invest_growth', l: '投资 · 资本增值优先' },
  { v: 'invest_rent', l: '投资 · 租金收益优先' },
  { v: 'invest_both', l: '投资 · 增值与收租兼顾' },
  { v: 'self_use', l: '自住' },
  { v: 'self_invest', l: '自住兼投资' }
]
const TAG_STYLE: Record<string, string> = {
  growth: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  mature: 'bg-sky-50 text-sky-700 ring-sky-200',
  future: 'bg-violet-50 text-violet-700 ring-violet-200',
  supply_pressure: 'bg-amber-50 text-amber-700 ring-amber-200',
  stable: 'bg-slate-100 text-slate-600 ring-slate-200',
  insufficient: 'bg-slate-100 text-slate-400 ring-slate-200'
}
const f = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'))

function ScenCol({ title, p, accent }: { title: string; p: Proj5yr | null; accent: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className={`text-xs font-medium ${accent}`}>{title}</div>
      {p ? (
        <>
          <div className="mt-1 text-lg font-bold text-slate-800">{p.annualized_return_pct}%<span className="text-xs font-normal text-slate-400"> /年</span></div>
          <div className="mt-1 text-[11px] text-slate-500">5年总收益 ≈ {f(p.total_profit_5yr)} AED</div>
          <div className="text-[11px] text-slate-400">租金 {f(p.rental_income_5yr)} · 增值 {f(p.appreciation_5yr)}</div>
        </>
      ) : <div className="mt-1 text-sm text-slate-400">—</div>}
    </div>
  )
}

export default function BuyingReportPage() {
  const [goal, setGoal] = useState('invest_both')
  const [budget, setBudget] = useState('')
  const [report, setReport] = useState<BuyingReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [brand, setBrand] = useState<AgentBrand>({ name: '', agency: '', rera: '', phone: '' })
  const [showBrand, setShowBrand] = useState(false)

  useEffect(() => {
    try {
      const s = localStorage.getItem(BRAND_KEY)
      if (s) setBrand(JSON.parse(s))
    } catch { /* ignore */ }
  }, [])
  const saveBrand = (b: AgentBrand) => {
    setBrand(b)
    try { localStorage.setItem(BRAND_KEY, JSON.stringify(b)) } catch { /* ignore */ }
  }
  const hasBrand = !!(brand.name || brand.agency)

  const run = async () => {
    setLoading(true)
    const r = await generateBuyingReport({
      goal,
      budgetMax: budget ? Number(budget) : undefined
    })
    setReport(r)
    setLoading(false)
  }

  return (
    <div className="flex-1 overflow-auto pb-20 md:pb-8">
    <div className="container mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-bold text-slate-800">AI 买房决策报告</h1>
      <p className="mt-1 text-sm text-slate-500">
        告诉我你的目标与预算，基于 DLD 真实成交生成结构化建议与 5 年区间预测。
      </p>

      {/* 问卷 */}
      <div className="mt-5 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 print:hidden">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs text-slate-500 sm:col-span-2">
            目标
            <select value={goal} onChange={e => setGoal(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800">
              {GOALS.map(g => <option key={g.v} value={g.v}>{g.l}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            预算上限 (AED，可留空)
            <input value={budget} onChange={e => setBudget(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="例如 2000000"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" />
          </label>
        </div>
        <button onClick={run} disabled={loading}
          className="mt-4 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
          {loading ? '生成中…' : '生成报告'}
        </button>

        {/* 经纪人品牌（可选）—— 报告导出时带自己的署名 */}
        <div className="mt-4 border-t border-slate-100 pt-3">
          <button onClick={() => setShowBrand(s => !s)}
            className="text-xs font-medium text-primary hover:underline">
            {showBrand ? '收起经纪人品牌' : `经纪人品牌${hasBrand ? '（已设置）' : '（可选）'}`}
          </button>
          {showBrand && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {([
                ['name', '姓名'], ['agency', '机构'], ['rera', 'RERA / BRN 号'], ['phone', '联系电话']
              ] as [keyof AgentBrand, string][]).map(([k, label]) => (
                <label key={k} className="flex flex-col gap-1 text-xs text-slate-500">
                  {label}
                  <input
                    value={brand[k]}
                    onChange={e => saveBrand({ ...brand, [k]: e.target.value })}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
                  />
                </label>
              ))}
              <p className="sm:col-span-2 text-[11px] text-slate-400">
                填写后，打印 / 导出 PDF 的报告顶部会带你的署名。信息仅保存在本机浏览器。
              </p>
            </div>
          )}
        </div>
      </div>

      {report && (
        <div className="mt-6">
          {/* 经纪人品牌抬头（屏幕淡显，打印时完整呈现） */}
          {hasBrand && (
            <div className="mb-4 flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4">
              <div>
                <div className="text-base font-bold text-slate-800">{brand.name || brand.agency}</div>
                <div className="text-xs text-slate-500">
                  {[brand.agency && brand.name ? brand.agency : '', brand.rera && `RERA/BRN: ${brand.rera}`, brand.phone]
                    .filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="text-right text-[11px] text-slate-400">
                Powered by Pinzos · DLD 数据
              </div>
            </div>
          )}

          <div className="flex items-center justify-between print:hidden">
            <div className="text-sm text-slate-500">
              目标：<span className="font-medium text-slate-700">{report.goalLabel}</span>
              {report.budgetMax ? ` · 预算 ≤ ${f(report.budgetMax)} AED` : ''}
              {' · '}生成于 {report.generatedAt}
            </div>
            <button onClick={() => window.print()}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
              打印 / 导出 PDF
            </button>
          </div>

          {report.recommendations.length === 0 && (
            <p className="mt-4 text-sm text-slate-400">该条件下暂无满足流动性要求的区域，建议放宽预算或目标。</p>
          )}

          <div className="mt-4 space-y-5">
            {report.recommendations.map((r, i) => (
              <div key={i} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-slate-800">#{i + 1} {r.area}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${TAG_STYLE[r.tag] || TAG_STYLE.stable}`}>{r.label}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    参考价 {f(r.assumedPrice)} AED · 回本约 {r.paybackYears ?? '—'} 年
                  </div>
                </div>

                <ul className="mt-3 list-disc pl-5 text-xs text-slate-600 space-y-1">
                  {r.why.map((w, j) => <li key={j}>{w}</li>)}
                </ul>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <ScenCol title="保守" p={r.projection.conservative} accent="text-sky-600" />
                  <ScenCol title="中性" p={r.projection.neutral} accent="text-slate-700" />
                  <ScenCol title="乐观" p={r.projection.optimistic} accent="text-emerald-600" />
                </div>
                {r.dataQualityNote && (
                  <p className="mt-2 text-[11px] text-amber-600">⚠ {r.dataQualityNote}</p>
                )}

                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                  <div><span className="font-medium text-slate-700">投资视角：</span>{r.perspective.invest}</div>
                  <div className="mt-1"><span className="font-medium text-slate-700">自住视角：</span>{r.perspective.live}</div>
                </div>

                {r.matchingProjects.length > 0 && (
                  <div className="mt-3 text-xs text-slate-500">
                    平台在售匹配项目：{r.matchingProjects.length} 个
                    （{r.matchingProjects.map(p => p.developer).filter(Boolean).join('、') || '—'}）
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 假设与免责 —— 必须显著 */}
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-sm font-semibold text-amber-800">假设与免责声明</div>
            <ul className="mt-2 list-disc pl-5 text-xs text-amber-800 space-y-1">
              {report.assumptions.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-amber-800">{report.disclaimer}</p>
          </div>
        </div>
      )}
    </div>
    </div>
  )
}
