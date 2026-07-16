/**
 * 本项目 vs 区域租金回报 (Yield vs Area)
 * 有效回报 = 区域租金 ÷ 本盘挂牌价;价格×租金分解说清为什么。数据来自 /insights。
 *
 * i18n: 全部展示串走 t('compare:yieldVsArea.KEY') —— 翻译全在 locales 各语言的
 * compare.json,组件里零翻译内容(多语言 framework 标准范式:JSON + t(),不用内联对象)。
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { ProjectInsights, YieldComparison, YieldFactor } from '../../lib/api'

const VERDICT_STYLE: Record<YieldComparison['verdict'], { dot: string; chip: string }> = {
  above: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  inline: { dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-600 ring-slate-200' },
  below: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
}

const signPp = (v: number | null) => (v == null ? '' : `${v > 0 ? '+' : ''}${v.toFixed(1)}pp`)

/** 因子 → {标题 key, 说明 key, 插值}，纯从结构化字段派生;文案全在 JSON。 */
function factorKeys(f: YieldFactor, premiumPct: number | null): { titleKey: string; detailKey: string; p?: number } {
  if (f.key === 'price') {
    const prem = premiumPct ?? 0
    return {
      titleKey: prem >= 0 ? 'premium' : 'discount',
      detailKey: f.dir === 'up' ? 'priceUpDetail' : 'priceDownDetail',
      p: Math.round(Math.abs(prem)),
    }
  }
  if (f.key === 'rent') {
    if (f.dir === 'flat') return { titleKey: 'rentFlatTitle', detailKey: 'rentFlatDetail' }
    return f.dir === 'up'
      ? { titleKey: 'rentUpTitle', detailKey: 'rentUpDetail' }
      : { titleKey: 'rentDownTitle', detailKey: 'rentDownDetail' }
  }
  return { titleKey: 'offplanTitle', detailKey: 'offplanDetail' }
}

export function YieldVsAreaModule({ insights }: { insights: ProjectInsights; lang?: string }) {
  const { t } = useTranslation('compare')
  // 动态 key(因子等按结构化字段拼),用 any 绕开严格字面量约束;key 由 compare.json 保证存在。
  const tk = (k: string, o?: Record<string, unknown>) => (t as (k: string, o?: Record<string, unknown>) => string)(`yieldVsArea.${k}`, o)
  const [showWhy, setShowWhy] = useState(false)
  const yc = insights.yield_comparison
  if (!yc) return null

  const style = VERDICT_STYLE[yc.verdict]
  const pp = yc.gap_pp.toFixed(1)
  const verdictLabel =
    yc.verdict === 'above' ? tk('verdictAbove', { pp })
    : yc.verdict === 'below' ? tk('verdictBelow', { pp })
    : tk('verdictInline')
  const tierKey = yc.tier === 'development' ? 'tierDevelopment' : yc.tier === 'area' ? 'tierArea' : 'tierZone'
  const conf = tk(yc.confidence === 'high' ? 'confHigh' : yc.confidence === 'medium' ? 'confMed' : 'confLow')

  const range = Math.max(2, Math.abs(yc.gap_pp) * 1.6)
  const dotPct = Math.min(96, Math.max(4, 50 + (yc.gap_pp / range) * 50))

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle>{tk('title')}</CardTitle>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${style.chip}`}>
            <span className={`h-2 w-2 rounded-full ${style.dot}`} />
            {verdictLabel}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              {tk('thisProject')}
              {yc.estimated && (
                <span className="rounded bg-amber-100 px-1 py-px text-[10px] font-medium text-amber-700" title={tk('estTitle')}>{tk('est')}</span>
              )}
            </div>
            <div className="text-2xl font-bold text-teal-600">{yc.estimated && '≈'}{yc.project_yield_pct.toFixed(1)}%</div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs text-slate-500">{tk('areaAverage')}</div>
            <div className="text-2xl font-bold text-slate-700">{yc.area_yield_pct.toFixed(1)}%</div>
          </div>
        </div>

        <div className="mt-6 mb-1 px-1">
          <div className="relative h-2 rounded-full bg-gradient-to-r from-amber-200 via-slate-200 to-emerald-200">
            <div className="absolute -top-1 h-4 w-0.5 bg-slate-500" style={{ left: '50%' }} />
            <div className="absolute -top-2.5 flex flex-col items-center -translate-x-1/2" style={{ left: `${dotPct}%`, transition: 'left .5s cubic-bezier(.22,1,.36,1)' }}>
              <div className={`h-5 w-5 rounded-full ring-2 ring-white shadow ${style.dot}`} />
            </div>
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-slate-400">
            <span>{tk('belowArea')}</span>
            <span className="text-slate-600 font-medium">{tk('area')} {yc.area_yield_pct.toFixed(1)}%</span>
            <span>{tk('aboveArea')}</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
            🎯 {tk(tierKey)}「{insights.area?.label}」
          </span>
          <span>{tk('confidence')} <b className="text-slate-600">{conf}</b></span>
          {yc.sample_n != null && <span>{tk('salesCount', { count: yc.sample_n.toLocaleString() })}</span>}
          {yc.data_through && <span>{tk('through', { date: yc.data_through })}</span>}
        </div>

        {yc.factors.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-slate-500">{tk('whyTitle')}</div>
            <div className="flex flex-col gap-2">
              {yc.factors.map((f) => {
                const { titleKey, detailKey, p } = factorKeys(f, yc.premium_pct)
                const isUp = f.dir === 'up'; const isDown = f.dir === 'down'
                const ic = isUp ? '↑' : isDown ? '↓' : '≈'
                const icCls = isUp ? 'bg-emerald-50 text-emerald-600' : isDown ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-400'
                const valCls = isUp ? 'text-emerald-600' : isDown ? 'text-amber-600' : 'text-slate-400'
                return (
                  <div key={f.key} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${icCls}`}>{ic}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-800">{tk(titleKey, p != null ? { p } : undefined)}</div>
                      <div className="text-[11px] text-slate-400">{tk(detailKey)}</div>
                    </div>
                    <div className={`text-sm font-bold tabular-nums ${valCls}`}>{f.est_pp != null ? signPp(f.est_pp) : '—'}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="mt-4 border-t pt-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>{tk('formula')}</span>
            <button type="button" onClick={() => setShowWhy((v) => !v)} className="font-medium text-primary hover:underline">
              {showWhy ? tk('hide') : tk('how')}
            </button>
          </div>
          {showWhy && <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{tk('methodology')}</p>}
        </div>
      </CardContent>
    </Card>
  )
}
