/**
 * 附近同类项目横评（对比分析 tab · 区块 B）
 * 本盘 + 最近 N 个项目一张表横向比：起价 / 回报 / 涨幅 / 5年年化 / 溢价。
 * 本盘高亮置顶。缺数据列「—」不编。数据 /nearby-compare(复用各盘缓存 insights)。
 */
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { CompareRow, fetchNearbyCompare } from '../../lib/api'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../../components/DirhamSymbol'

const km = (m: number | null) => (m == null ? '' : m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`)
const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`)

export function NearbyProjectsCompare({ projectId, lang }: { projectId: string; lang: string }) {
  const zh = (lang || 'en').startsWith('zh')
  const [data, setData] = useState<{ subject: CompareRow; nearby: CompareRow[] } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchNearbyCompare(projectId).then((d) => { if (alive) { setData(d); setLoading(false) } })
    return () => { alive = false }
  }, [projectId])

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>{zh ? '附近同类项目' : 'Nearby projects'}</CardTitle></CardHeader>
        <CardContent><div className="text-sm text-slate-400">{zh ? '正在比对附近项目…' : 'Comparing nearby projects…'}</div></CardContent>
      </Card>
    )
  }
  if (!data || data.nearby.length === 0) return null

  const rows = [data.subject, ...data.nearby]
  const cols: { key: string; label: string; render: (r: CompareRow) => React.ReactNode; align?: string }[] = [
    {
      key: 'name', label: zh ? '项目' : 'Project', align: 'left',
      render: (r) => (
        <div className="min-w-[9rem]">
          <div className="font-semibold text-slate-800 truncate">{r.name || '—'}</div>
          <div className="text-[11px] text-slate-400 truncate">
            {r.developer || ''}{r.distance_m ? ` · ${km(r.distance_m)}` : ''}
          </div>
        </div>
      ),
    },
    { key: 'price', label: zh ? '起价' : 'From', render: (r) => r.starting_price ? <><DirhamSymbol size="0.75em" className="text-slate-400" />{formatMoneyCompact(r.starting_price, lang)}</> : '—' },
    { key: 'yield', label: zh ? '回报' : 'Yield', render: (r) => pct(r.yield_pct) },
    { key: 'growth', label: zh ? '涨幅' : 'Growth', render: (r) => <span className={r.growth_pct != null && r.growth_pct < 0 ? 'text-rose-600' : r.growth_pct != null ? 'text-emerald-600' : ''}>{pct(r.growth_pct)}</span> },
    { key: 'cagr', label: zh ? '5年年化' : '5yr', render: (r) => pct(r.annualized_5yr) },
    { key: 'premium', label: zh ? '溢价' : 'Premium', render: (r) => r.premium_pct != null ? <span className={r.premium_pct > 0 ? 'text-amber-600' : 'text-emerald-600'}>{r.premium_pct > 0 ? '+' : ''}{r.premium_pct.toFixed(0)}%</span> : '—' },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>{zh ? '附近同类项目横评' : 'Nearby projects compared'}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto -mx-2 px-2">
          <table className="w-full text-sm" style={{ minWidth: 520 }}>
            <thead>
              <tr className="border-b text-[11px] uppercase tracking-wide text-slate-400">
                {cols.map((c) => (
                  <th key={c.key} className={`py-2 font-medium ${c.align === 'left' ? 'text-left pr-3' : 'text-right px-2'}`}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isSubject = i === 0
                return (
                  <tr key={r.id} className={`border-b last:border-0 ${isSubject ? 'bg-primary/[0.06]' : ''}`}>
                    {cols.map((c) => (
                      <td key={c.key} className={`py-2.5 tabular-nums ${c.align === 'left' ? 'text-left pr-3' : 'text-right px-2 text-slate-700'}`}>
                        {c.key === 'name' && isSubject ? (
                          <div className="flex items-center gap-1.5">
                            <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold text-white">{zh ? '本盘' : 'This'}</span>
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
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          {zh
            ? '回报/涨幅/溢价为各项目匹配到的开发体或所在区域口径（新盘多为区域级）。起价为已录入最低户型价。数据来自 DLD 定期快照，仅供横向参考。'
            : 'Yield / growth / premium reflect each project’s matched development or area (new launches are usually area-level). “From” is the lowest listed unit price. DLD periodic snapshot — for side-by-side reference only.'}
        </p>
      </CardContent>
    </Card>
  )
}
