/**
 * 本项目 vs 区域租金回报 (Yield vs Area) — 功能 2
 * 项目(开发体)自身回报 vs 所在社区均值，并用「价格×租金」的精确分解说清为什么。
 * 数据来自 /insights 的 yield_comparison(后端已算，无需二次请求)。
 *
 * 诚实：只有拿到独立开发体回报时才对比(项目太新→只知区域→整块不渲染，
 * 投资评估卡已覆盖区域口径)。因子文案由结构化字段(key/dir/est_pp/premium)
 * 在前端按语言组装，不吃后端中文串。
 */
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { ProjectInsights, YieldComparison, YieldFactor } from '../../lib/api'

const VERDICT_STYLE: Record<YieldComparison['verdict'], { dot: string; chip: string }> = {
  above: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  inline: { dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-600 ring-slate-200' },
  below: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
}

const TIER_LABEL = (tier: string, zh: boolean) =>
  tier === 'development' ? (zh ? '本开发体' : 'Development') : tier === 'area' ? (zh ? '本社区' : 'Community') : zh ? '所在区域' : 'Area'

const signPp = (v: number | null) => (v == null ? '' : `${v > 0 ? '+' : ''}${v.toFixed(1)}pp`)

/** 因子 → 双语 {标题, 说明}，纯从结构化字段组装。 */
function factorText(f: YieldFactor, premiumPct: number | null, zh: boolean): { title: string; detail: string } {
  if (f.key === 'price') {
    const prem = premiumPct ?? 0
    const up = f.dir === 'up'
    return {
      title: prem >= 0 ? (zh ? `溢价 ${Math.round(prem)}%` : `+${Math.round(prem)}% price`) : zh ? `折价 ${Math.round(-prem)}%` : `−${Math.round(-prem)}% price`,
      detail: up
        ? zh ? '本盘挂牌价低于区域成交中位，同等租金下抬升回报' : 'Listed below the area median — lifts effective yield'
        : zh ? '本盘挂牌价高于区域成交中位，同等租金下摊薄回报' : 'Listed above the area median — dilutes effective yield',
    }
  }
  if (f.key === 'rent') {
    if (f.dir === 'flat') {
      return {
        title: zh ? '租金按区域估算' : 'Rent assumed = area',
        detail: zh ? '本开发体暂无稳定租赁记录，租金以区域水平估算；实际跑赢则回报更高' : 'No settled rentals yet — rent assumed at area level; real outperformance lifts it',
      }
    }
    const up = f.dir === 'up'
    return {
      title: up ? (zh ? '租金高于区域' : 'Rent above area') : zh ? '租金低于区域' : 'Rent below area',
      detail: up
        ? zh ? '本开发体新签租金/㎡ 高于区域，多因户型偏小、楼龄或精装' : 'Higher new-lease rent/㎡ — smaller units, newer or fitted'
        : zh ? '本开发体新签租金/㎡ 低于区域，多因大户型占比高或楼龄' : 'Lower new-lease rent/㎡ — larger units or older stock',
    }
  }
  return {
    title: zh ? '期房阶段' : 'Off-plan',
    detail: zh ? '尚无稳定实收租金，回报按区域现房口径估算' : 'No settled rent yet — estimated at area ready-home basis',
  }
}

export function YieldVsAreaModule({ insights, lang }: { insights: ProjectInsights; lang: string }) {
  const [showWhy, setShowWhy] = useState(false)
  const zh = (lang || 'en').startsWith('zh')
  const yc = insights.yield_comparison
  if (!yc) return null // 无独立开发体回报 → 不硬造对比(投资评估卡已覆盖区域口径)

  const style = VERDICT_STYLE[yc.verdict]
  const verdictLabel =
    yc.verdict === 'above'
      ? zh ? `高于区域均值 +${yc.gap_pp.toFixed(1)}pp` : `+${yc.gap_pp.toFixed(1)}pp vs area`
      : yc.verdict === 'below'
      ? zh ? `低于区域均值 ${yc.gap_pp.toFixed(1)}pp` : `${yc.gap_pp.toFixed(1)}pp vs area`
      : zh ? '与区域基本持平' : 'In line with area'

  // 两点式对比表：区域均值居中，项目点按 gap 左右偏移(避免伪造分布)。
  const range = Math.max(2, Math.abs(yc.gap_pp) * 1.6)
  const dotPct = Math.min(96, Math.max(4, 50 + (yc.gap_pp / range) * 50))
  const label = TIER_LABEL(yc.tier, zh)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle>{zh ? '本项目 vs 区域租金回报' : 'Yield vs area'}</CardTitle>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${style.chip}`}>
            <span className={`h-2 w-2 rounded-full ${style.dot}`} />
            {verdictLabel}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {/* 两个大数 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              {zh ? '本项目回报' : 'This project'}
              {yc.estimated && (
                <span className="rounded bg-amber-100 px-1 py-px text-[10px] font-medium text-amber-700" title={zh ? '按区域租金估算' : 'estimated at area rents'}>
                  {zh ? '估算' : 'est.'}
                </span>
              )}
            </div>
            <div className="text-2xl font-bold text-teal-600">
              {yc.estimated && '≈'}{yc.project_yield_pct.toFixed(1)}%
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs text-slate-500">{zh ? '区域平均' : 'Area average'}</div>
            <div className="text-2xl font-bold text-slate-700">{yc.area_yield_pct.toFixed(1)}%</div>
          </div>
        </div>

        {/* 相对区域的偏移表(区域居中) */}
        <div className="mt-6 mb-1 px-1">
          <div className="relative h-2 rounded-full bg-gradient-to-r from-amber-200 via-slate-200 to-emerald-200">
            <div className="absolute -top-1 h-4 w-0.5 bg-slate-500" style={{ left: '50%' }} />
            <div
              className="absolute -top-2.5 flex flex-col items-center -translate-x-1/2"
              style={{ left: `${dotPct}%`, transition: 'left .5s cubic-bezier(.22,1,.36,1)' }}
            >
              <div className={`h-5 w-5 rounded-full ring-2 ring-white shadow ${style.dot}`} />
            </div>
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-slate-400">
            <span>{zh ? '低于区域' : 'Below area'}</span>
            <span className="text-slate-600 font-medium">{zh ? '区域均值 ' : 'Area '}{yc.area_yield_pct.toFixed(1)}%</span>
            <span>{zh ? '高于区域' : 'Above area'}</span>
          </div>
        </div>

        {/* 匹配口径 */}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
            🎯 {label}「{insights.area?.label}」
          </span>
          <span>{zh ? '置信度 ' : 'Confidence '}<b className="text-slate-600">{yc.confidence === 'high' ? (zh ? '高' : 'high') : yc.confidence === 'medium' ? (zh ? '中' : 'med') : zh ? '低' : 'low'}</b></span>
          {yc.sample_n != null && <span>{zh ? `样本 ${yc.sample_n.toLocaleString()} 笔` : `${yc.sample_n.toLocaleString()} sales`}</span>}
          {yc.data_through && <span>{zh ? `截止 ${yc.data_through}` : `through ${yc.data_through}`}</span>}
        </div>

        {/* 为什么:因子分解 */}
        {yc.factors.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-slate-500">
              {zh ? '为什么？（价格 × 租金分解）' : 'Why? (price × rent split)'}
            </div>
            <div className="flex flex-col gap-2">
              {yc.factors.map((f) => {
                const tx = factorText(f, yc.premium_pct, zh)
                const isUp = f.dir === 'up'
                const isDown = f.dir === 'down'
                const ic = isUp ? '↑' : isDown ? '↓' : '≈'
                const icCls = isUp ? 'bg-emerald-50 text-emerald-600' : isDown ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-400'
                const valCls = isUp ? 'text-emerald-600' : isDown ? 'text-amber-600' : 'text-slate-400'
                return (
                  <div key={f.key} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${icCls}`}>{ic}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-800">{tx.title}</div>
                      <div className="text-[11px] text-slate-400">{tx.detail}</div>
                    </div>
                    <div className={`text-sm font-bold tabular-nums ${valCls}`}>{f.est_pp != null ? signPp(f.est_pp) : '—'}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 诚实口径 */}
        <div className="mt-4 border-t pt-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>{zh ? '回报 = 中位新签租金/㎡ ÷ 中位成交价/㎡' : 'Yield = median new-lease rent/㎡ ÷ median sale price/㎡'}</span>
            <button type="button" onClick={() => setShowWhy((v) => !v)} className="font-medium text-primary hover:underline">
              {showWhy ? (zh ? '收起' : 'Hide') : zh ? '怎么算的' : 'How?'}
            </button>
          </div>
          {showWhy && (
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              {zh
                ? '有效回报 = 区域中位租金/㎡ ÷ 本盘挂牌中位价/㎡ ——「按你实际支付的挂牌价买入、按区域租金水平出租」能拿到多少。所以本盘 vs 区域的差主要来自价格定位:挂牌溢价越高，同等租金下有效回报越低。这是估算(新盘无本盘租赁史);若实际租金跑赢区域，回报会更高。数据为 DLD 定期快照，登记通常滞后 4–8 周。'
                : 'Effective yield = area median rent/㎡ ÷ this project’s listed median price/㎡ — what you’d earn buying at the price you actually pay and renting at area rates. The gap vs area is therefore driven by price positioning: the higher the listed premium, the lower the effective yield at the same rent. An estimate (no rental history at the new price); real rents outperforming the area would raise it. DLD periodic snapshot; registrations lag 4–8 weeks.'}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
