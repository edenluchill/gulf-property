/**
 * 地图搜索框 —— 「打一个区域名,直接把你带过去」。
 *
 * 前身是 AreaSearch:一个 176px 宽、text-xs、placeholder 只写 "Search area…"
 * 的灰框,挤在左上角筛选 chips 上面。付费经纪 slavynchuk94@ 用了 22 次首页、
 * 开了 36 次区域详情,**一次都没在它里面打过字**(app_events 里零条文字搜索),
 * 然后写邮件问「能不能打个区域名就直接带我过去」—— 功能一直在,只是没人看见它。
 * 所以这次改的是三件事:
 *   1. **看得出能搜什么** —— 空态直接列出示例("Dubai Marina · JVC · Business Bay"),
 *      结果行带 Area / Project 彩色徽标(和成交页统一搜索同一套语言)。
 *   2. **搜得到** —— 后端换成别名 + 词序无关 + 拼写模糊(见 services/map-search.ts),
 *      并且顺带能搜在售楼盘,不再只有区域。
 *   3. **选了真的会带你去** —— 落地就是把地图飞过去(只飞,不开详情弹窗,
 *      见 MapPage 的 handleSearchSelect)。
 *
 * 键盘:↑↓ 选,Enter 确认,Esc 关。以前完全没有 —— 搜索框缺这个就是半成品。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X, MapPin, Building2, Loader2, Clock } from 'lucide-react'
import { searchMap, MapSuggestion } from '../lib/api'

/** 空态里给的示例 —— 这是「看得出是搜什么的」最直接的一招,别删 */
const EXAMPLES = ['Dubai Marina', 'JVC', 'Business Bay']

// ── 最近搜过 ────────────────────────────────────────────────────────────────
// 经纪一天里翻来覆去就那几个区,每次重新打一遍字是纯粹的浪费(owner 2026-07-29)。
// 存在 localStorage:这是「这台设备上的习惯」,不值得占一张表,也不该跨账号带走。
const RECENT_KEY = 'pinzos-map-search-recent'
const RECENT_MAX = 5

function loadRecent(): MapSuggestion[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    // 存的是历史快照,字段可能来自旧版本 —— 只留还能用的(有 id/name/落点)
    return raw.filter((x) => x && x.id && x.name && x.centroid).slice(0, RECENT_MAX)
  } catch { return [] }
}

function pushRecent(s: MapSuggestion): MapSuggestion[] {
  const next = [s, ...loadRecent().filter((x) => !(x.kind === s.kind && x.id === s.id))].slice(0, RECENT_MAX)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* 无痕模式写不了,不是错误 */ }
  return next
}

export default function MapSearch({
  onSelect,
  autoFocus,
}: {
  onSelect: (s: MapSuggestion) => void
  autoFocus?: boolean
}) {
  const { t: tRaw } = useTranslation('misc')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const [q, setQ] = useState('')
  const [results, setResults] = useState<MapSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const [focused, setFocused] = useState(false)
  const [recent, setRecent] = useState<MapSuggestion[]>(() => loadRecent())
  const boxRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 选中某个结果后会把名字回填进输入框,那次 q 变化不该再触发一轮搜索——
  // 否则结果回来又把刚关掉的下拉重新弹开(选完还杵着一个列表,很怪)。
  const skipNextRef = useRef(false)

  const query = q.trim()

  useEffect(() => {
    if (skipNextRef.current) { skipNextRef.current = false; return }
    if (tRef.current) clearTimeout(tRef.current)
    if (query.length < 2) { setResults([]); setLoading(false); return }
    setLoading(true)
    setOpen(true)   // 先把面板开着显示 loading,别让人对着一个没反应的框等 250ms
    tRef.current = setTimeout(async () => {
      const r = await searchMap(query)
      setResults(r)
      setActive(0)
      setLoading(false)
      setOpen(true)
    }, 250)
    return () => { if (tRef.current) clearTimeout(tRef.current) }
  }, [query])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [])

  // 键盘选中项滚进可视区(列表最多 10 条,超出要滚)
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = useCallback((s: MapSuggestion) => {
    onSelect(s)
    if (s.centroid) setRecent(pushRecent(s))   // 没落点的存了也飞不过去,不进历史
    skipNextRef.current = true
    setQ(s.name.trim())
    setOpen(false)
    if (tRef.current) clearTimeout(tRef.current)   // debounce 里可能还压着一轮请求
  }, [onSelect])

  // 空态提示只在「聚焦了但还没打够字」时出现,不打扰已经在看结果的人。
  // 打够字之后无论有没有结果都要开面板 —— 搜不到时必须明说搜不到,
  // 静默什么都不显示会让人以为「框坏了」(旧版就是这样)。
  const showHint = focused && query.length < 2
  const hasPanel = showHint || (open && query.length >= 2)
  /** 当前面板里**可以按方向键走**的那一列:空态是历史,打了字是结果 */
  const list = showHint ? recent : results

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (!list.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => (i + 1) % list.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive((i) => (i - 1 + list.length) % list.length) }
    else if (e.key === 'Enter') { e.preventDefault(); const s = list[active]; if (s) pick(s) }
  }

  /** 一行候选 —— 结果和「最近搜过」共用同一套行,历史前面换成时钟图标 */
  const renderRow = (s: MapSuggestion, i: number, isRecent: boolean) => {
      const isArea = s.kind === 'area'
      // 区:只在真有在售楼盘时才说,「0 projects」是噪音不是信息。
      // ⚠️ 别写成 {cond && <span/>} —— projectCount 是数字,0 会被 JSX 原样渲染成一个「0」。
      const sub = isArea
        ? (s.projectCount ? t('misc:mapSearch.projectsInArea', { count: s.projectCount }) : '')
        : (s.subtitle || '')
      return (
        <button
          key={`${s.kind}:${s.id}`}
          data-idx={i}
          type="button"
          onMouseEnter={() => setActive(i)}
          onMouseDown={(e) => e.preventDefault()}   // 别让 input 先失焦把下拉关掉
          onClick={() => pick(s)}
          className={`flex w-full items-start gap-2 px-3 py-2 text-start transition-colors ${i === active ? 'bg-slate-100' : ''}`}
        >
          {isRecent
            ? <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            : isArea
              ? <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
              : <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-xs text-slate-800">{s.name.trim()}</span>
              {/* 类型徽标 —— 「这是个区」还是「这是个楼盘」必须一眼看出来,
                  配色与成交页统一搜索一致(area 绿 / project 蓝)。
                  ⚠️ key 不写进三元 —— i18n-key-check 扫不进 t() 里的表达式,
                  写成 t(cond ? 'a' : 'b') 等于这两个键脱离巡检。 */}
              <span
                className={`shrink-0 rounded px-1 py-px text-[9px] font-medium uppercase tracking-wide ${
                  isArea ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
                }`}
              >
                {isArea ? t('misc:mapSearch.kindArea') : t('misc:mapSearch.kindProject')}
              </span>
            </span>
            {sub ? <span className="mt-0.5 block truncate text-[10px] text-slate-400">{sub}</span> : null}
          </span>
          {isArea && s.transactionCount != null && (
            <span className="mt-0.5 shrink-0 text-[10px] text-slate-400">{s.transactionCount.toLocaleString()}</span>
          )}
        </button>
      )
  }

  const panel = (() => {
    if (showHint) {
      // 有历史就先给历史 —— 经纪一天里翻来覆去就那几个区。没有历史(新用户)
      // 才给示例,那时「这框能搜什么」比「你上次搜了什么」重要。
      if (recent.length) {
        return (
          <>
            <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
              <span className="text-[11px] font-medium text-slate-500">{t('misc:mapSearch.recent')}</span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { try { localStorage.removeItem(RECENT_KEY) } catch { /* 无痕模式 */ } setRecent([]) }}
                className="text-[11px] text-slate-400 transition-colors hover:text-slate-600"
              >
                {t('misc:mapSearch.clearRecent')}
              </button>
            </div>
            {recent.map((s, i) => renderRow(s, i, true))}
          </>
        )
      }
      return (
        <>
          <div className="px-3 pt-2.5 text-[11px] font-medium text-slate-500">{t('misc:mapSearch.hint')}</div>
          <div className="flex flex-wrap gap-1.5 px-3 pb-2.5 pt-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setQ(ex)}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-800"
              >
                {ex}
              </button>
            ))}
          </div>
        </>
      )
    }
    if (loading && results.length === 0) {
      return (
        <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('misc:searching')}
        </div>
      )
    }
    if (results.length === 0) {
      return <div className="px-3 py-2.5 text-xs text-slate-400">{t('misc:mapSearch.noResults', { q: query })}</div>
    }
    return results.map((s, i) => renderRow(s, i, false))
  })()

  return (
    // 手机:铺满底部 dock(MapPage 把它放在底栏上方);md+:左上角。
    <div ref={boxRef} className="relative w-full md:w-auto">
      {/* 与地图右上控制卡同一套视觉语言:rounded-2xl / bg-white/95 / ring / shadow。
          ⚠️ 改这里的 py/字号 = 改左上角整摞的高度,指北针的 top-[...] 要同步挪
          (见 MapPage 里那条注释),并且要在 414 / 1180 / 1440 三档截图核对。 */}
      <div
        className={`flex items-center gap-2 rounded-2xl bg-white/95 px-3.5 py-2.5 shadow-lg ring-1 backdrop-blur-sm transition-shadow md:gap-2 md:px-3 md:py-2 ${
          focused ? 'ring-2 ring-blue-500/40' : 'ring-slate-900/[0.06]'
        }`}
      >
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => {
            setFocused(true)
            setActive(0)
            // 桌面版和手机版是**两个实例**,历史存在同一个 localStorage 键上。
            // 聚焦时重读一次,不然另一个实例刚记下的那条这边看不到。
            setRecent(loadRecent())
            if (results.length) setOpen(true)
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          placeholder={t('misc:mapSearch.placeholder')}
          aria-label={t('misc:mapSearch.placeholder')}
          className="w-full min-w-0 flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none md:w-60 md:flex-none"
        />
        {q && (
          <button
            type="button"
            onClick={() => { setQ(''); setResults([]); setOpen(false) }}
            className="shrink-0 rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {hasPanel && (
        // 手机在底部 → 结果向上展开;md+ 在顶部 → 向下展开
        <div
          ref={listRef}
          className="absolute start-0 bottom-full z-[1003] mb-1.5 max-h-72 w-full overflow-y-auto rounded-xl bg-white/95 py-0.5 shadow-xl ring-1 ring-slate-900/[0.06] backdrop-blur md:bottom-auto md:top-full md:mb-0 md:mt-1.5 md:w-72"
        >
          {panel}
        </div>
      )}
    </div>
  )
}
