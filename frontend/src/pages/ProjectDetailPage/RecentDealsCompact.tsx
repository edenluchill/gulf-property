/**
 * 近期真实成交（对比分析 tab · 证据层）
 * 本盘匹配到的开发体最近几笔真实 DLD 成交——让"挂牌价 vs 区域"的对比有实锤支撑。
 * 匹配不到时如实说明,不编。
 */
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { ProjectTransactions, fetchProjectTransactions } from '../../lib/api'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../../components/DirhamSymbol'

export function RecentDealsCompact({ projectId, lang }: { projectId: string; lang: string }) {
  const zh = (lang || 'en').startsWith('zh')
  const [data, setData] = useState<ProjectTransactions | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchProjectTransactions(projectId).then((d) => { if (alive) { setData(d); setLoading(false) } })
    return () => { alive = false }
  }, [projectId])

  if (loading || !data) return null
  const sales = (data.sales || []).slice(0, 6)
  if (!data.matched || sales.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <CardTitle>{zh ? '近期真实成交' : 'Recent real deals'}</CardTitle>
          {data.development && <span className="text-[11px] text-slate-400">{zh ? '本开发体 · ' : ''}{data.development}</span>}
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto -mx-2 px-2">
          <table className="w-full text-sm" style={{ minWidth: 440 }}>
            <thead>
              <tr className="border-b text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 text-left pr-3 font-medium">{zh ? '日期' : 'Date'}</th>
                <th className="py-2 text-left pr-3 font-medium">{zh ? '楼栋/户型' : 'Unit'}</th>
                <th className="py-2 text-right px-2 font-medium">{zh ? '面积' : 'Size'}</th>
                <th className="py-2 text-right px-2 font-medium">{zh ? '成交价' : 'Price'}</th>
                <th className="py-2 text-right pl-2 font-medium">AED/m²</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s, i) => (
                <tr key={i} className="border-b last:border-0 text-slate-700">
                  <td className="py-2.5 pr-3 tabular-nums text-slate-500">{s.date || '—'}</td>
                  <td className="py-2.5 pr-3">
                    <span className="truncate">{s.building || '—'}</span>
                    {s.rooms && <span className="ml-1.5 text-[11px] text-slate-400">{s.rooms}</span>}
                    <span className={`ml-1.5 rounded px-1 py-0.5 text-[10px] ${s.saleType === 'offplan' ? 'bg-violet-50 text-violet-600' : 'bg-slate-100 text-slate-500'}`}>
                      {s.saleType === 'offplan' ? (zh ? '期房' : 'off-plan') : (zh ? '现房' : 'ready')}
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-right tabular-nums text-slate-500">{s.sizeSqm ? `${s.sizeSqm}m²` : '—'}</td>
                  <td className="py-2.5 px-2 text-right tabular-nums">{s.price ? <><DirhamSymbol size="0.7em" className="text-slate-400" />{formatMoneyCompact(s.price, lang)}</> : '—'}</td>
                  <td className="py-2.5 pl-2 text-right tabular-nums">{s.pricePerSqm ? s.pricePerSqm.toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-slate-400">
          {zh ? '本开发体近期已登记的真实成交(DLD)。用来对照上面的挂牌价与区域中位——挂牌高、成交低,溢价就更值得斟酌。' : 'Recent registered DLD deals for this development — cross-check against the listed price and area median above.'}
        </p>
      </CardContent>
    </Card>
  )
}
