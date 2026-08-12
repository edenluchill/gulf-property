/**
 * 成交记录查询页 (功能 B) —— 直接面向 DLD 真实成交数据
 * 多维筛选 → 聚合指标 + 月度趋势 + 明细分页
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import DailyBrief from '../components/DailyBrief'
import { Helmet } from 'react-helmet-async'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal, ChevronDown, Search, X } from 'lucide-react'
import {
  fetchTxFilters, fetchTxSummary, fetchTxList, fetchTxSuggest, fetchDataFreshness,
  TxFilters, TxSummary, TxRow, DataFreshness, TxSuggestion
} from '../lib/api'
import DirhamSymbol from '../components/DirhamSymbol'
import { formatMoneyCompact } from '../lib/money'
import { pricePerSqmToPerSqft, sqmToSqft } from '../lib/units'
import RentView from './TransactionsPage/RentView'
import { CONSUMER_SEGMENT } from '../lib/marketSegment'
import { useScrollChrome } from '../hooks/useScrollChrome'

// 价格区间预设(成交总价 AED)。min/max 各一个下拉,避免手机上敲 7 位数字。
const SALE_PRICE_STEPS = [500000, 1000000, 1500000, 2000000, 3000000, 5000000, 10000000, 20000000, 50000000]

type SaleType = 'all' | 'ready' | 'offplan'
type Mode = 'sales' | 'rent'

/**
 * 一条已选筛选条件。区域有两种来源:搜索框选的(DLD area_name,无 id)和
 * 地图深链带来的(dubai_areas UUID,手绘区只能这样定位)。
 */
type Pick = { type: 'area' | 'project' | 'building'; name: string; id?: string }

/** 已选条件小标签。所有筛选(含抽屉里的)统一用它呈现,一眼看清、一点即removed。 */
function Chip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary/10 py-1 pe-1 ps-2.5 text-xs text-primary ring-1 ring-primary/20">
      <span className="truncate">{children}</span>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 rounded-full p-0.5 text-primary/50 hover:bg-primary/10 hover:text-primary"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}

function fmt(n: number | null | undefined) {
  // 面积/单价换算成 sqft 后会带小数(如 1,555.291),而这页所有数字(成交量/总价/
  // 面积/单价)都该是整数 → 统一取整,别把「344.445 sqft」这种念不出口的数摆出来。
  return n == null ? '—' : Math.round(n).toLocaleString('en-US')
}

function TrendChart({ trend }: { trend: TxSummary['trend'] }) {
  if (!trend.length) return null
  const w = 720, h = 160, pad = 28
  const maxCount = Math.max(...trend.map(t => t.count), 1)
  const meds = trend.map(t => t.medianPps)
  const minMed = Math.min(...meds), maxMed = Math.max(...meds)
  const medSpan = Math.max(maxMed - minMed, 1)
  const bw = (w - pad * 2) / trend.length
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      {trend.map((t, i) => {
        const bh = (t.count / maxCount) * (h - pad * 2)
        return (
          <rect key={i} x={pad + i * bw + 1} y={h - pad - bh}
            width={Math.max(bw - 2, 1)} height={bh} fill="#dbeafe" />
        )
      })}
      <polyline
        fill="none" stroke="#2563eb" strokeWidth={2}
        points={trend.map((t, i) => {
          const x = pad + i * bw + bw / 2
          const y = h - pad - ((t.medianPps - minMed) / medSpan) * (h - pad * 2)
          return `${x},${y}`
        }).join(' ')}
      />
      {trend.map((t, i) => (
        i % 3 === 0 ? (
          <text key={i} x={pad + i * bw + bw / 2} y={h - 8}
            fontSize={9} fill="#94a3b8" textAnchor="middle">{t.month.slice(2)}</text>
        ) : null
      ))}
    </svg>
  )
}

export default function TransactionsPage() {
  const { t, i18n } = useTranslation(['transactions', 'common', 'misc'])
  // 手机/pad 下滑收起顶部导航,到顶才回来(全站统一滚动收纳机制)
  const scrollChromeRef = useRef<HTMLDivElement>(null)
  useScrollChrome(scrollChromeRef)
  const [mode, setMode] = useState<Mode>('sales')
  const [filters, setFilters] = useState<TxFilters>({ areas: [], rooms: [] })
  // 统一搜索:区域 / 楼盘 / 楼栋三类候选进同一个框,选中的一律进 picks。
  // 楼盘 = 该盘全部楼栋;楼栋 = 只看这一栋 —— 经纪要的「社区名查全部 or 分栋单查」。
  const [picks, setPicks] = useState<Pick[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<TxSuggestion[]>([])
  const searchRef = useRef<HTMLDivElement>(null)
  const [rooms, setRooms] = useState('')
  // 默认口径走 lib/marketSegment.ts 单点配置（2026-07-02 起默认全部；用户可切期房/现房）
  const [type, setType] = useState<SaleType>(CONSUMER_SEGMENT)
  const [year, setYear] = useState('')  // '' = 不限(默认按最新)
  const [minPrice, setMinPrice] = useState('')  // 成交总价区间(AED)
  const [maxPrice, setMaxPrice] = useState('')
  const [advOpen, setAdvOpen] = useState(false)  // 低频筛选抽屉(户型/价格/年份)
  const [summary, setSummary] = useState<TxSummary | null>(null)
  const [freshness, setFreshness] = useState<DataFreshness | null>(null)
  const [rows, setRows] = useState<TxRow[]>([])
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  // 请求失败 ≠ 无数据：失败显示"重试"，不误导用户以为该筛选没成交
  const [loadError, setLoadError] = useState(false)
  const [retryTick, setRetryTick] = useState(0)

  const limit = 25
  const query = useMemo(() => {
    const projects = picks.filter(p => p.type === 'project').map(p => p.name)
    const buildings = picks.filter(p => p.type === 'building').map(p => p.name)
    const areaPick = picks.find(p => p.type === 'area')
    return {
      // 地图深链传的是 dubai_areas UUID(手绘区没有 DLD area_name,只能用 id);
      // 搜索框选的是 DLD area_name。两条路都走 buildTxFilter 的既有参数。
      areaId: areaPick?.id || undefined,
      area: areaPick && !areaPick.id ? areaPick.name : undefined,
      project: projects.length ? projects : undefined,
      building: buildings.length ? buildings : undefined,
      rooms: rooms || undefined,
      type: type === 'all' ? undefined : type,
      from: year ? `${year}-01-01` : undefined,
      to: year ? `${year}-12-31` : undefined,
      minPrice: minPrice || undefined,
      maxPrice: maxPrice || undefined,
    }
  }, [picks, rooms, type, year, minPrice, maxPrice])

  useEffect(() => { fetchTxFilters().then(setFilters) }, [])
  // 数据截止日 —— 与筛选无关,只拉一次
  useEffect(() => { fetchDataFreshness().then(setFreshness) }, [])

  // 地图区域弹窗 → 「查看该区成交」深链(?areaId=<uuid>&label=<显示名>)。
  // 只在首次挂载读一次:之后用户在本页的增删不该被 URL 覆写。
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const areaId = sp.get('areaId')
    const label = sp.get('label')
    const areaName = sp.get('area')
    // 弹窗里已经下钻到某楼盘/楼栋时,深链带的是它而不是整个区(见 AreaRecentTx)
    const project = sp.get('project')
    const building = sp.get('building')
    if (project) setPicks([{ type: 'project', name: project }])
    else if (building) setPicks([{ type: 'building', name: building }])
    else if (areaId && label) setPicks([{ type: 'area', name: label, id: areaId }])
    else if (areaName) setPicks([{ type: 'area', name: areaName }])
  }, [])

  // 统一搜索建议(250ms 防抖)。空串也拉 —— 点开就给最活跃的区域,省得对着空框发呆。
  useEffect(() => {
    let stale = false
    const id = setTimeout(() => {
      fetchTxSuggest(searchQuery.trim()).then(s => { if (!stale) setSuggestions(s) })
    }, 250)
    return () => { stale = true; clearTimeout(id) }
  }, [searchQuery])

  // 点击外部关掉建议框(下拉是 absolute,不关会盖住指标卡)
  useEffect(() => {
    if (!suggestOpen) return
    const onDown = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSuggestOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [suggestOpen])

  const togglePick = (s: TxSuggestion) => {
    setPicks(prev => {
      const hit = prev.find(p => p.type === s.type && p.name === s.name)
      if (hit) return prev.filter(p => p !== hit)
      // 区域是单选(两个区域取交集必然是空集);楼盘/楼栋可多选
      const base = s.type === 'area' ? prev.filter(p => p.type !== 'area') : prev
      return [...base, { type: s.type, name: s.name }]
    })
    setSearchQuery('')
    setSuggestOpen(false)
  }
  const removePick = (target: Pick) => setPicks(prev => prev.filter(p => p !== target))
  const clearAll = () => {
    setPicks([]); setRooms(''); setYear(''); setMinPrice(''); setMaxPrice('')
  }
  const advCount = (rooms ? 1 : 0) + (year ? 1 : 0) + (minPrice || maxPrice ? 1 : 0)  // 抽屉里生效的条数
  const activeCount = picks.length + advCount

  useEffect(() => {
    setLoading(true)
    setPage(0)
    setLoadError(false)
    fetchTxSummary(query).then(s => {
      setSummary(s)
      setLoadError(s === null)
      setLoading(false)
    })
  }, [query, retryTick])

  useEffect(() => {
    fetchTxList({ ...query, limit: String(limit), offset: String(page * limit) })
      .then(r => setRows(r.rows))
  }, [query, page])

  // DLD 的单价/面积原生都是 per-m² / m²,但全站 UI 讲 sqft(经纪和买家的锚点),
  // 在展示边界统一换算(见 lib/units.ts)。DLD 数据本身不动。
  const ppsRaw = summary?.pricePerSqm
  const pps = ppsRaw && {
    min: pricePerSqmToPerSqft(ppsRaw.min),
    p25: pricePerSqmToPerSqft(ppsRaw.p25),
    median: pricePerSqmToPerSqft(ppsRaw.median),
    p75: pricePerSqmToPerSqft(ppsRaw.p75),
    max: pricePerSqmToPerSqft(ppsRaw.max),
    avg: pricePerSqmToPerSqft(ppsRaw.avg),
  }

  // DLD 官方多久没发新成交了。成交本该日更 → 2 天以上就该主动说明,
  // 否则用户看到最新一条停在几天前,只会以为是我们的页面坏了。
  // 用 txPublishedAt(源 API 自带的发布时间),不是成交日 —— 后者天然滞后一两天。
  const staleDays = freshness?.txPublishedAt
    ? Math.floor((Date.now() - new Date(freshness.txPublishedAt).getTime()) / 86_400_000)
    : null

  // 筛选摘要不再需要:已选条件全部以 chip 常驻显示,折叠的只有「没选就没内容」的抽屉。

  return (
    <div ref={scrollChromeRef} className="flex-1 overflow-auto pb-20 md:pb-8">
    {/* SEO meta 用英文字面量,理由同 AreaInsightsPage */}
    <Helmet>
      <title>Dubai Property Transactions — Real DLD Sale &amp; Rent Records | Pinzos</title>
      <meta
        name="description"
        content="Search real Dubai Land Department transaction records: sale prices, price per sqft, off-plan vs ready, and rental contracts. Filter by area, project, price and bedrooms, with monthly trends."
      />
      <link rel="canonical" href="https://www.pinzos.com/transactions" />
    </Helmet>
    <div className="container mx-auto px-4 py-3 md:py-6 max-w-6xl">
      <h1 className="text-xl md:text-2xl font-bold text-slate-800">{t('title')}</h1>
      <p className="mt-1 hidden md:block text-sm text-slate-500">
        {t('description')}
      </p>

      {/* 成交 / 租金 切换 */}
      <div className="mt-3 inline-flex rounded-lg bg-slate-100 p-0.5">
        {(['sales', 'rent'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {m === 'sales' ? (t('misc:sales2')) : (t('misc:rent'))}
          </button>
        ))}
      </div>

      {mode === 'rent' ? <RentView /> : (
      <>
      {/* 筛选 —— 一个主搜索框 + 口径三档,其余全部收进「筛选」抽屉。
          买家视角:绝大多数人只想搜一个社区名看看成交,不该一上来面对 6 个并排下拉。
          已选条件一律以 chip 呈现(含抽屉里选的),折叠状态下也一眼看得清、点得掉。 */}
      <div className="mt-3 md:mt-5 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 md:p-4">
        {/* 主行:搜索框 + 口径 */}
        <div className="flex flex-col gap-2.5 md:flex-row md:items-center">
          <div className="relative flex-1" ref={searchRef}>
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setSuggestOpen(true) }}
              onFocus={() => setSuggestOpen(true)}
              placeholder={t('filter.searchPlaceholder')}
              className="w-full rounded-lg border border-slate-300 py-2.5 ps-9 pe-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {suggestOpen && (suggestions.length > 0 || searchQuery.trim().length >= 2) && (
              <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                {suggestions.length === 0 ? (
                  <div className="px-3 py-6 text-center text-sm text-slate-400">{t('filter.noMatch')}</div>
                ) : suggestions.map(s => {
                  const picked = picks.some(p => p.type === s.type && p.name === s.name)
                  return (
                    <button
                      key={`${s.type}:${s.name}`}
                      type="button"
                      onMouseDown={e => { e.preventDefault(); togglePick(s) }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-start hover:bg-slate-50 ${picked ? 'bg-primary/5' : ''}`}
                    >
                      {/* 类型徽标:让「这是区域还是楼栋」一眼可辨,不用读名字猜 */}
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        s.type === 'area' ? 'bg-emerald-50 text-emerald-700'
                        : s.type === 'project' ? 'bg-blue-50 text-blue-700'
                        : 'bg-slate-100 text-slate-600'}`}>
                        {t(`filter.kind.${s.type}`)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-slate-800">{s.name}</span>
                        {(s.type === 'building' ? s.project : s.area) && (
                          <span className="block truncate text-xs text-slate-400">
                            {s.type === 'building' ? s.project : s.area}
                            {s.type === 'project' && s.buildings && s.buildings > 1
                              ? ` · ${t('filter.nBuildings', { count: s.buildings })}` : ''}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-slate-400">{fmt(s.count)}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {/* 口径 —— 买家切换最频繁(现房 vs 期房),值得留在主行 */}
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-300 text-sm">
            {(['all', 'ready', 'offplan'] as SaleType[]).map(tp => (
              <button
                key={tp}
                onClick={() => setType(tp)}
                className={`flex-1 px-3 py-2 md:flex-none ${type === tp ? 'bg-primary text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {t(`saleType.${tp}`)}
              </button>
            ))}
          </div>
          {/* 抽屉开关也留在主行 —— 独占一行时那行几乎是空的,白白撑高卡片。
              有筛选生效时显示计数,不用展开就知道抽屉里还压着几条。 */}
          <button
            onClick={() => setAdvOpen(o => !o)}
            className={`flex shrink-0 items-center justify-center gap-1 rounded-lg border px-3 py-2 text-sm font-medium ${
              advOpen || advCount > 0
                ? 'border-primary/30 bg-primary/5 text-primary'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            {t('filter.toggle')}
            {advCount > 0 && <span className="tabular-nums">({advCount})</span>}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* 已选条件 —— 没选就整行不渲染(而不是留个空行) */}
        {activeCount > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {picks.map(p => (
              <Chip key={`${p.type}:${p.name}`} onRemove={() => removePick(p)}>{p.name}</Chip>
            ))}
            {rooms && <Chip onRemove={() => setRooms('')}>{rooms}</Chip>}
            {(minPrice || maxPrice) && (
              <Chip onRemove={() => { setMinPrice(''); setMaxPrice('') }}>
                {`${minPrice ? formatMoneyCompact(Number(minPrice), i18n.language) : ''}~${maxPrice ? formatMoneyCompact(Number(maxPrice), i18n.language) : ''}`}
              </Chip>
            )}
            {year && <Chip onRemove={() => setYear('')}>{t('filter.yearLabel', { year })}</Chip>}
            {activeCount > 1 && (
              <button onClick={clearAll} className="ms-1 text-xs text-slate-400 underline hover:text-slate-600">
                {t('filter.clearAll')}
              </button>
            )}
          </div>
        )}

        {/* 抽屉:低频筛选。默认收起 —— 这四项加起来的使用率远低于「搜个社区」 */}
        {advOpen && (
          <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              {t('filter.rooms')}
              <select
                value={rooms}
                onChange={e => setRooms(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
              >
                <option value="">{t('filter.allRooms')}</option>
                {filters.rooms.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <div className="flex flex-col gap-1 text-xs text-slate-500 sm:col-span-2">
              {t('filter.priceRange', { defaultValue: t('misc:price') })}
              <div className="flex items-center gap-1.5">
                <select
                  value={minPrice}
                  onChange={e => setMinPrice(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-800"
                >
                  <option value="">{t('misc:min')}</option>
                  {SALE_PRICE_STEPS.map(v => <option key={v} value={v}>{formatMoneyCompact(v, i18n.language)}</option>)}
                </select>
                <span className="text-slate-400">–</span>
                <select
                  value={maxPrice}
                  onChange={e => setMaxPrice(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-800"
                >
                  <option value="">{t('misc:max')}</option>
                  {SALE_PRICE_STEPS.map(v => <option key={v} value={v}>{formatMoneyCompact(v, i18n.language)}</option>)}
                </select>
              </div>
            </div>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              {t('filter.year')}
              <select
                value={year}
                onChange={e => setYear(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
              >
                <option value="">{t('filter.anyYear')}</option>
                {['2026', '2025', '2024', '2023', '2022', '2021', '2020', '2019', '2018'].map(y => (
                  <option key={y} value={y}>{t('filter.yearLabel', { year: y })}</option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {/* 指标卡 */}
      {loading ? (
        <div className="mt-6 text-sm text-slate-400">{t('loading')}</div>
      ) : loadError ? (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>{t('loadFailed')}</span>
          <button
            onClick={() => setRetryTick(x => x + 1)}
            className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700"
          >
            {t('retry')}
          </button>
        </div>
      ) : summary && summary.count > 0 ? (
        <>
          {/* 🔴 **速报只占「还没搜任何东西」时的那块地。**
              owner 的要求是「不能太臃肿，也不能互相掣肘」——
              所以它不加 tab、不加路由，一旦有了筛选条件就自动让位给结果。
              两者服务的是两种意图（闲逛 vs 找特定东西），永远不会同时抢注意力。 */}
          {activeCount === 0 && (
            <DailyBrief onPickArea={(area) => togglePick({ type: 'area', name: area } as TxSuggestion)} />
          )}
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Kpi label={t('kpi.count')} value={fmt(summary.count)} />
            <Kpi label={t('kpi.medianPps')} value={fmt(pps?.median)} currency />
            <Kpi label={t('kpi.medianTotal')} value={fmt(summary.medianUnitPrice)} currency />
            <Kpi label={t('kpi.avgSize')} value={fmt(summary.avgSizeSqm != null ? sqmToSqft(summary.avgSizeSqm) : summary.avgSizeSqm)} />
          </div>
          {pps && (
            <div className="mt-2 text-xs text-slate-500">
              {t('ppsRange', {
                min: fmt(pps.min),
                median: fmt(pps.median),
                max: fmt(pps.max),
                p25: fmt(pps.p25),
                p75: fmt(pps.p75)
              })}
            </div>
          )}
          {/* 数据截止日。DLD 停发时(2026-07-08 起停了 6 天)最新一条会停住不动,
              不标出来就会被当成我们的 bug —— 这事已经发生过一次。 */}
          {freshness?.txThrough && (
            <div className="mt-1 text-xs text-slate-400">
              {t('dataThrough', { date: freshness.txThrough.slice(0, 10) })}
              {staleDays != null && staleDays >= 2 && (
                <span className="text-amber-600"> · {t('dataStale', { days: staleDays })}</span>
              )}
            </div>
          )}

          {/* 趋势 */}
          <div className="mt-6 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="mb-2 text-sm font-medium text-slate-700">{t('trend.title')}</div>
            <TrendChart trend={summary.trend} />
          </div>

          {/* 明细 */}
          <div className="mt-6 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            {/* 移动端：卡片(价格优先,所有信息一屏看全,无需横向滚动) */}
            <div className="divide-y divide-slate-100 md:hidden">
              {rows.map((r, i) => (
                <div key={i} className="p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-1 text-base font-bold text-slate-900">
                      <DirhamSymbol size="0.8em" className="text-slate-400" />
                      {fmt(r.price)}
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${r.saleType === 'offplan' ? 'bg-violet-50 text-violet-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {r.saleType === 'offplan' ? t('saleType.offplan') : t('saleType.readyShort')}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-sm text-slate-700" title={r.building}>{r.building}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                    {r.area && <span>{r.area}</span>}
                    {r.rooms && <span>{r.rooms}</span>}
                    {r.sizeSqm != null && <span>{fmt(sqmToSqft(r.sizeSqm))} sqft</span>}
                    {r.pricePerSqm != null && <span className="inline-flex items-center gap-0.5"><DirhamSymbol size="0.75em" className="text-slate-400" />{fmt(pricePerSqmToPerSqft(r.pricePerSqm))}/sqft</span>}
                    <span className="text-slate-400">{r.date}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* 桌面端：完整表格 */}
            <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-start text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">{t('table.date')}</th>
                  <th className="px-3 py-2">{t('table.area')}</th>
                  <th className="px-3 py-2">{t('table.building')}</th>
                  <th className="px-3 py-2">{t('table.rooms')}</th>
                  <th className="px-3 py-2 text-end">{t('table.size')}</th>
                  <th className="px-3 py-2 text-end">{t('table.price')}</th>
                  <th className="px-3 py-2 text-end">{t('table.pps')}</th>
                  <th className="px-3 py-2">{t('table.type')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-500">{r.date}</td>
                    <td className="px-3 py-2">{r.area}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate" title={r.building}>{r.building}</td>
                    <td className="px-3 py-2">{r.rooms}</td>
                    <td className="px-3 py-2 text-end">{fmt(r.sizeSqm != null ? sqmToSqft(r.sizeSqm) : r.sizeSqm)}</td>
                    <td className="px-3 py-2 text-end">{fmt(r.price)}</td>
                    <td className="px-3 py-2 text-end">{fmt(r.pricePerSqm != null ? pricePerSqmToPerSqft(r.pricePerSqm) : r.pricePerSqm)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${r.saleType === 'offplan' ? 'bg-violet-50 text-violet-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {r.saleType === 'offplan' ? t('saleType.offplan') : t('saleType.readyShort')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
              <span>{t('pagination.page', { page: page + 1 })}</span>
              <div className="flex gap-2">
                <button
                  disabled={page === 0}
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
                >{t('pagination.prev')}</button>
                <button
                  disabled={rows.length < limit}
                  onClick={() => setPage(p => p + 1)}
                  className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
                >{t('pagination.next')}</button>
              </div>
            </div>
          </div>

          <p className="mt-3 text-xs text-slate-400">{summary.note}</p>
        </>
      ) : (
        /* 空态要能自救 —— 干巴巴一句「暂无成交数据」会让买家以为页面坏了。
           最常见的元凶是户型:DLD 对别墅/联排(登记成 Land 的那批,如 DAMAC
           Lagoons 全系)**根本不填 rooms**,所以一选户型这些社区就整体消失。
           实测 PORTOFINO 不带户型 1299 笔、加「3 房」变 0。 */
        <div className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-8 text-center">
          <p className="text-sm text-slate-500">{t('empty')}</p>
          {rooms && picks.length > 0 && (
            <p className="mx-auto mt-2 max-w-md text-xs text-slate-400">{t('emptyRoomsHint')}</p>
          )}
          {activeCount > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {rooms && (
                <button
                  onClick={() => setRooms('')}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                >
                  {t('emptyDropRooms')}
                </button>
              )}
              <button
                onClick={clearAll}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                {t('filter.clearAll')}
              </button>
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
    </div>
  )
}

function Kpi({ label, value, currency }: { label: string; value: string; currency?: boolean }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 flex items-center gap-1 text-xl font-bold text-slate-800">
        {currency && value !== '—' && <DirhamSymbol size="0.8em" className="text-slate-500" />}
        {value}
      </div>
    </div>
  )
}
