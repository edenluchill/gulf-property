/**
 * 对比分析 tab —— 本盘 vs 区域(回报/价格) + 近期真实成交 + 附近同类项目横评。
 * 把散在概览的 vs-区域对比收敛到这里,再加实锤成交与横向比,帮买家做决策。
 * 顶部一条「怎么看」是可选的谦逊导读:给角度,不替客户下结论。
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Lightbulb } from 'lucide-react'
import { ResidentialProject } from '../../types'
import { ProjectInsights } from '../../lib/api'
import { YieldVsAreaModule } from './YieldVsAreaModule'
import { PriceCheckModule } from './PriceCheckModule'
import { RecentDealsCompact } from './RecentDealsCompact'
import { NearbyProjectsCompare } from './NearbyProjectsCompare'

function CompareGuide({ zh }: { zh: boolean }) {
  const [open, setOpen] = useState(false)
  const points = zh
    ? [
        ['回报对比', '差不多，就说明这盘的租金效率和区域一致；差很多才值得深究。挂牌溢价高的新盘，有效回报通常低于区域——值不值，看你更看重当下现金流还是未来增值。'],
        ['价格体检', '新盘比区域二手贵是常态。关键不是"贵不贵"，而是贵的这部分，能不能被地段、交付时间、装修或未来涨幅补回来。'],
        ['近期真实成交', '挂牌价是要价，真实成交才是市场认的价。两者差得多，说明议价空间或溢价水分值得留意。'],
        ['附近横评', '同区、同价位的盘横着比，比孤立看一个数靠谱。起价、回报、涨幅一起看，别只盯一个指标。'],
      ]
    : [
        ['Yield vs area', 'Close means rent efficiency matches the area; a big gap is worth digging into. New launches with a high premium usually earn a lower effective yield — whether that’s worth it depends on cash-flow vs future growth.'],
        ['Price check', 'New builds priced above area resale is normal. The question isn’t "expensive?" but whether the premium is repaid by location, handover, finish or future growth.'],
        ['Recent real deals', 'The listed price is the ask; registered deals are what the market pays. A wide gap flags negotiation room or premium froth.'],
        ['Nearby compare', 'Same area, same price band, side by side — more reliable than one number in isolation.'],
      ]
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <Lightbulb className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="text-sm font-medium text-slate-700">{zh ? '怎么看这几个对比？（可选）' : 'How to read these (optional)'}</span>
        <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1">
          <p className="mb-3 text-[12px] text-slate-400">{zh ? '下面几个角度供你参考，你也可以有自己的判断：' : 'A few lenses to consider — your own judgment matters too:'}</p>
          <div className="space-y-3">
            {points.map(([t, d]) => (
              <div key={t} className="flex gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                <div className="text-[13px] leading-relaxed text-slate-600">
                  <b className="text-slate-800">{t}</b> —— {d}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function CompareTab({ project, insights }: { project: ResidentialProject; insights?: ProjectInsights | null }) {
  const { i18n } = useTranslation()
  const zh = (i18n.language || 'en').startsWith('zh')

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">{zh ? '对比分析' : 'Comparison'}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {zh ? '本盘 vs 所在区域，配上真实成交与附近同类项目的横向对比，帮你判断这盘值不值。' : 'This project vs its area, backed by real deals and nearby projects, to judge whether it stacks up.'}
        </p>
      </div>

      <CompareGuide zh={zh} />

      {/* 本盘 vs 区域:回报(有效回报=区域租金÷本盘挂牌价) */}
      {insights?.yield_comparison && <YieldVsAreaModule insights={insights} lang={i18n.language} />}

      {/* 本盘 vs 区域:价格体检 */}
      <PriceCheckModule projectId={project.id} />

      {/* 实锤:近期真实成交 */}
      <RecentDealsCompact projectId={project.id} lang={i18n.language} />

      {/* 附近同类项目横评 */}
      <NearbyProjectsCompare projectId={project.id} lang={i18n.language} />
    </div>
  )
}
