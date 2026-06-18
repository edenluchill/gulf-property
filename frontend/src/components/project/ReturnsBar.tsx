import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../DirhamSymbol'

/**
 * 5-year returns breakdown as a single stacked bar: rental income vs capital
 * appreciation. Pure presentation; no chart dependency. Reused on the overview
 * investment scorecard and (later) per-unit detail.
 */
export default function ReturnsBar({
  rental,
  appreciation,
  lang,
}: {
  rental: number
  appreciation: number
  lang: string
}) {
  const zh = lang?.startsWith('zh')
  const total = rental + appreciation
  if (total <= 0) return null
  const rentalPct = (rental / total) * 100

  const Amount = ({ v }: { v: number }) => (
    <span className="tabular-nums">
      <DirhamSymbol size="0.85em" className="mr-0.5 text-slate-400" />
      {formatMoneyCompact(v, lang)}
    </span>
  )

  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-teal-400" style={{ width: `${rentalPct}%` }} />
        <div className="h-full bg-emerald-500" style={{ width: `${100 - rentalPct}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-teal-400" />
          {zh ? '租金收入' : 'Rental'} <Amount v={rental} />
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          {zh ? '增值' : 'Appreciation'} <Amount v={appreciation} />
        </span>
        <span className="ml-auto font-medium text-slate-800">
          {zh ? '5 年合计 ' : '5yr total '}+<Amount v={total} />
        </span>
      </div>
    </div>
  )
}
