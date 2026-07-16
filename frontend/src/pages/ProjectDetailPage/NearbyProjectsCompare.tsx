/**
 * 附近同类项目横评（对比分析 tab · 区块 B）
 * i18n: t('compare:nearby.*')。数据 /nearby-compare。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { CompareRow, fetchNearbyCompare } from '../../lib/api'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../../components/DirhamSymbol'

const km = (m: number | null) => (m == null ? '' : m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`)
const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`)

export function NearbyProjectsCompare({ projectId, lang }: { projectId: string; lang: string }) {
  const { t } = useTranslation('compare')
  const tk = (k: string) => (t as (k: string) => string)(`nearby.${k}`)
  const [data, setData] = useState<{ subject: CompareRow; nearby: CompareRow[] } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchNearbyCompare(projectId).then((d) => { if (alive) { setData(d); setLoading(false) } })
    return () => { alive = false }
  }, [projectId])

  if (loading) {
    return <Card><CardHeader><CardTitle>{tk('loadingTitle')}</CardTitle></CardHeader><CardContent><div className="text-sm text-slate-400">{tk('loading')}</div></CardContent></Card>
  }
  if (!data || data.nearby.length === 0) return null

  const rows = [data.subject, ...data.nearby]
  const cols: { key: string; label: string; render: (r: CompareRow) => React.ReactNode; align?: string }[] = [
    {
      key: 'name', label: tk('colProject'), align: 'left',
      render: (r) => (
        <div className="min-w-[9rem]">
          <div className="font-semibold text-slate-800 truncate">{r.name || '—'}</div>
          <div className="text-[11px] text-slate-400 truncate">{r.developer || ''}{r.distance_m ? ` · ${km(r.distance_m)}` : ''}</div>
        </div>
      ),
    },
    { key: 'price', label: tk('colFrom'), render: (r) => r.starting_price ? <><DirhamSymbol size="0.75em" className="text-slate-400" />{formatMoneyCompact(r.starting_price, lang)}</> : '—' },
    { key: 'yield', label: tk('colYield'), render: (r) => pct(r.yield_pct) },
    { key: 'growth', label: tk('colGrowth'), render: (r) => <span className={r.growth_pct != null && r.growth_pct < 0 ? 'text-rose-600' : r.growth_pct != null ? 'text-emerald-600' : ''}>{pct(r.growth_pct)}</span> },
    { key: 'cagr', label: tk('col5yr'), render: (r) => pct(r.annualized_5yr) },
    { key: 'premium', label: tk('colPremium'), render: (r) => r.premium_pct != null ? <span className={r.premium_pct > 0 ? 'text-amber-600' : 'text-emerald-600'}>{r.premium_pct > 0 ? '+' : ''}{r.premium_pct.toFixed(0)}%</span> : '—' },
  ]

  return (
    <Card>
      <CardHeader><CardTitle>{tk('title')}</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto -mx-2 px-2">
          <table className="w-full text-sm" style={{ minWidth: 520 }}>
            <thead>
              <tr className="border-b text-[11px] uppercase tracking-wide text-slate-400">
                {cols.map((c) => (<th key={c.key} className={`py-2 font-medium ${c.align === 'left' ? 'text-start pe-3' : 'text-end px-2'}`}>{c.label}</th>))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isSubject = i === 0
                return (
                  <tr key={r.id} className={`border-b last:border-0 ${isSubject ? 'bg-primary/[0.06]' : ''}`}>
                    {cols.map((c) => (
                      <td key={c.key} className={`py-2.5 tabular-nums ${c.align === 'left' ? 'text-start pe-3' : 'text-end px-2 text-slate-700'}`}>
                        {c.key === 'name' && isSubject ? (
                          <div className="flex items-center gap-1.5">
                            <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold text-white">{tk('thisBadge')}</span>
                            {c.render(r)}
                          </div>
                        ) : c.render(r)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">{tk('footer')}</p>
      </CardContent>
    </Card>
  )
}
