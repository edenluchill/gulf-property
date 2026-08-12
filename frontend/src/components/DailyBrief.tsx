/**
 * 迪拜每日成交速报 —— 成交页「还没搜任何东西」时占的那块地。
 *
 * ## 为什么在这里，而不是新开一页
 *
 * owner：「做进 transaction 的页面里面，能看日报也能搜 transaction，
 * 不过不能太臃肿，也不能互相掣肘。」
 *
 * 所以它**不加 tab、不加路由、不抢地方** —— 只在没有筛选条件时出现，
 * 一旦搜了什么就自动让位给结果。两者服务的是两种意图（**闲逛 vs 找特定东西**），
 * 永远不会同时争夺注意力。
 *
 * ## 为什么要有它
 *
 * 我们把每天更新的 DLD 数据做成了「查询工具」—— 有需求才来，
 * 一个人一年买一次房就一年来一次。而同样的数据做成「每日速报」，
 * 就是行业每天要刷的东西（DXBInteract 的整个模式：
 * *"Listings are marketing. Transactions are truth."*）。
 *
 * ## 「复制给客户」才是重点
 *
 * 经纪每天的真实痛点不是看数据，是**找个理由联系客户而不显得在催单**。
 * 「你上周看的那个区，昨天成交了 73 套」是天然不尴尬的搭话理由，而且每天都新。
 * 数据站给不了这个 —— 他们没有经纪这一层，经纪只能截图。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TrendingUp, TrendingDown, Copy, Check, Flame } from 'lucide-react'
import { API_BASE_URL } from '../lib/config'
import { formatMoneyCompact } from '../lib/money'
import DirhamSymbol from './DirhamSymbol'

interface Brief {
  date: string
  lagDays: number
  sales: { count: number; totalAed: number; medianPrice: number | null; offplanCount: number; offplanPct: number }
  vsPrev: { date: string; count: number; pct: number } | null
  topAreas: Array<{ name: string; count: number; medianPrice: number | null }>
  topSale: { area: string | null; building: string | null; project: string | null; price: number; rooms: string | null; sizeSqft: number | null; isOffplan: boolean } | null
  rentContracts: number
}

/** 区名点一下就搜它 —— 速报不是死的，是搜索的入口。 */
export default function DailyBrief({ onPickArea }: { onPickArea?: (area: string) => void }) {
  const { i18n } = useTranslation()
  const zh = i18n.language?.startsWith('zh')
  const [b, setB] = useState<Brief | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/market/daily-brief`)
      .then(r => r.json())
      .then(j => { if (j.success) setB(j.data) })
      .catch(() => { /* 速报拿不到就整块不出现，不打扰主流程 */ })
  }, [])

  if (!b || !b.sales.count) return null

  const lang = i18n.language || 'en'
  const money = (v: number | null | undefined) => (v == null ? '—' : formatMoneyCompact(v, lang))
  const dayLabel = new Date(b.date).toLocaleDateString(zh ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })

  /** 一段能直接粘进 WhatsApp 的话 —— 这是给经纪的弹药，不是给我们看的报表。 */
  const shareText = zh
    ? `迪拜 ${dayLabel} 成交速报\n` +
      `全市成交 ${b.sales.count} 套，总额 ${money(b.sales.totalAed)} 迪拉姆，中位价 ${money(b.sales.medianPrice)}。\n` +
      `期房占 ${b.sales.offplanPct}%。\n` +
      `最活跃：${b.topAreas.slice(0, 3).map(a => `${a.name} ${a.count} 套`).join('、')}。\n` +
      (b.topSale ? `当日最高：${b.topSale.project || b.topSale.building || b.topSale.area} ${money(b.topSale.price)}。\n` : '') +
      `（数据来源：迪拜土地局 DLD）`
    : `Dubai market · ${dayLabel}\n` +
      `${b.sales.count} homes sold for ${money(b.sales.totalAed)} AED, median ${money(b.sales.medianPrice)}.\n` +
      `Off-plan was ${b.sales.offplanPct}%.\n` +
      `Busiest: ${b.topAreas.slice(0, 3).map(a => `${a.name} (${a.count})`).join(', ')}.\n` +
      (b.topSale ? `Top sale: ${b.topSale.project || b.topSale.building || b.topSale.area} at ${money(b.topSale.price)}.\n` : '') +
      `(Source: Dubai Land Department)`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* 剪贴板被拒就算了，不弹错 */ }
  }

  const up = (b.vsPrev?.pct ?? 0) >= 0

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white md:mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-orange-500" />
          <h2 className="text-sm font-semibold text-slate-800">
            {zh ? `${dayLabel} 全市成交速报` : `Dubai market · ${dayLabel}`}
          </h2>
          {/* 数据滞后要写在脸上 —— 说成"今天"是骗人，DLD 本来就有 ~2 天延迟 */}
          <span className="text-[11px] text-slate-400">
            {zh ? `DLD 数据 · 滞后 ${b.lagDays} 天` : `DLD data · ${b.lagDays}d lag`}
          </span>
        </div>
        <button
          onClick={copy}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? (zh ? '已复制' : 'Copied') : (zh ? '复制给客户' : 'Copy for client')}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-px bg-slate-100 md:grid-cols-4">
        {[
          { label: zh ? '成交套数' : 'Homes sold', value: b.sales.count.toLocaleString(), sub: b.vsPrev
              ? { up, text: `${up ? '+' : ''}${b.vsPrev.pct}% ${zh ? '环比' : 'vs prev'}` } : null },
          { label: zh ? '总成交额' : 'Total value', value: money(b.sales.totalAed), currency: true },
          { label: zh ? '中位价' : 'Median price', value: money(b.sales.medianPrice), currency: true },
          { label: zh ? '期房占比' : 'Off-plan share', value: `${b.sales.offplanPct}%`,
            sub: { up: true, text: `${b.sales.offplanCount} ${zh ? '套' : 'units'}`, muted: true } },
        ].map((k, i) => (
          <div key={i} className="bg-white px-3 py-2.5 md:px-4 md:py-3">
            <div className="text-[11px] text-slate-500">{k.label}</div>
            <div className="mt-0.5 flex items-baseline gap-1 text-base font-semibold text-slate-800 md:text-lg">
              {k.currency && <DirhamSymbol size="0.7em" className="text-slate-400" />}
              {k.value}
            </div>
            {k.sub && (
              <div className={`mt-0.5 flex items-center gap-0.5 text-[11px] ${
                k.sub.muted ? 'text-slate-400' : k.sub.up ? 'text-emerald-600' : 'text-rose-600'}`}>
                {!k.sub.muted && (k.sub.up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />)}
                {k.sub.text}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 🔴 手机上右下角常驻着 Luna 浮标 + 打字按钮，会把这一区的右侧内容压住
          （实测 414 宽度下「Me'Aisem First」整个被盖）。给它让出位置。 */}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3 px-3 pb-4 pe-16 pt-3 md:px-4 md:pe-4 md:py-3">
        <div className="min-w-[200px] flex-1">
          <div className="mb-1.5 text-[11px] font-medium text-slate-500">{zh ? '最活跃区域' : 'Busiest areas'}</div>
          <div className="flex flex-wrap gap-1.5">
            {b.topAreas.map(a => (
              // 点一下直接搜这个区 —— 速报是搜索的入口，不是终点
              <button key={a.name} onClick={() => onPickArea?.(a.name)}
                className="group flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-xs transition hover:border-teal-400 hover:bg-teal-50">
                <span className="font-medium text-slate-700 group-hover:text-teal-700">{a.name}</span>
                <span className="text-slate-400">{a.count}</span>
                {a.medianPrice != null && <span className="text-slate-300">·</span>}
                {a.medianPrice != null && <span className="text-slate-400">{money(a.medianPrice)}</span>}
              </button>
            ))}
          </div>
        </div>

        {b.topSale && (
          <div className="min-w-[180px]">
            <div className="mb-1.5 text-[11px] font-medium text-slate-500">{zh ? '当日最高价' : 'Top sale'}</div>
            <div className="text-xs font-medium text-slate-800">
              {b.topSale.project || b.topSale.building || b.topSale.area}
            </div>
            <div className="mt-0.5 flex items-baseline gap-1 text-sm font-semibold text-slate-900">
              <DirhamSymbol size="0.7em" className="text-slate-400" />{money(b.topSale.price)}
            </div>
            <div className="text-[11px] text-slate-400">
              {[b.topSale.rooms, b.topSale.sizeSqft ? `${b.topSale.sizeSqft.toLocaleString()} sqft` : null,
                b.topSale.isOffplan ? (zh ? '期房' : 'off-plan') : (zh ? '现房' : 'ready')].filter(Boolean).join(' · ')}
            </div>
          </div>
        )}

        {b.rentContracts > 0 && (
          <div className="min-w-[110px]">
            <div className="mb-1.5 text-[11px] font-medium text-slate-500">{zh ? '当日租约' : 'Leases filed'}</div>
            <div className="text-sm font-semibold text-slate-800">{b.rentContracts.toLocaleString()}</div>
          </div>
        )}
      </div>
    </section>
  )
}
