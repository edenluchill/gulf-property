/**
 * 选项目 → 选户型(共享组件)。
 *
 * 选项目的逻辑此前在 AgentTours/AgentReport/AgentClients 各写了一遍(250–300ms
 * 防抖 + 本地 picked[]),这里收敛成一个可复用件,并且走**匿名可用**的公开搜索
 * 接口(见 lib/roi/priors.ts:searchProjectsPublic)—— agent 接口不能给未登录买家用。
 *
 * 户型选择契约抄 pages/ProjectDetailPage/UnitTypesSubPage.tsx 的受控模式
 * (selectedUnitId + onUnitSelect),那是现有最干净的一个。
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X, Loader2, Bed, Maximize } from 'lucide-react'
import { searchProjectsPublic, fetchRoiProject, type RoiProject, type RoiProjectHit } from '../../lib/roi/priors'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../DirhamSymbol'
import { cn } from '../../lib/utils'

interface Props {
  project: RoiProject | null
  selectedUnitId: string | null
  onProjectSelect: (p: RoiProject | null) => void
  onUnitSelect: (unitId: string) => void
  /**
   * 外部要求预加载的项目 id(?project= 深链)。
   * ⚠️ 必须传**稳定**的值(在父组件用 useState 冻住初始值)。传 `params.get('project')`
   * 会在 URL 同步那一刻变成 null,cleanup 把在途请求标记作废 → 深链静默失效。
   */
  autoLoadProjectId?: string | null
  /** 预加载有结果(成功或失败)时回调一次 —— 父组件据此才敢开始改写 URL。 */
  onAutoLoadSettled?: () => void
}

export default function ProjectUnitPicker({
  project,
  selectedUnitId,
  onProjectSelect,
  onUnitSelect,
  autoLoadProjectId,
  onAutoLoadSettled,
}: Props) {
  const { t, i18n } = useTranslation('roi')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<RoiProjectHit[]>([])
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(false)
  const [limited, setLimited] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // 深链预加载(?project=)。只在 id 变化时跑一次。
  useEffect(() => {
    if (!autoLoadProjectId) return
    let alive = true
    setLoading(true)
    fetchRoiProject(autoLoadProjectId)
      .then((p) => {
        if (!alive) return
        if (p) onProjectSelect(p)
      })
      .finally(() => {
        if (!alive) return
        setLoading(false)
        onAutoLoadSettled?.()
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoadProjectId])

  // 防抖搜索(280ms)。后端按 IP 限流,前端再抖一层是为了不浪费额度而不是当安全措施。
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(() => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      searchProjectsPublic(q, ac.signal)
        .then((r) => {
          setResults(r)
          setLimited(false)
        })
        .catch((e: Error) => {
          if (e.name === 'AbortError') return
          setResults([])
          setLimited(e.message === 'rate_limited')
        })
        .finally(() => setSearching(false))
    }, 280)
    return () => clearTimeout(timer)
  }, [query])

  const pick = async (hit: RoiProjectHit) => {
    setQuery('')
    setResults([])
    setLoading(true)
    const p = await fetchRoiProject(hit.id)
    setLoading(false)
    if (p) onProjectSelect(p)
  }

  const clear = () => {
    onProjectSelect(null)
    setQuery('')
    setResults([])
  }

  return (
    <div className="space-y-3">
      {!project ? (
        <div className="relative">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('picker.searchPlaceholder')}
              className="w-full rounded-lg border border-slate-300 bg-white ps-9 pe-9 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
            />
            {(searching || loading) && (
              <Loader2 className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
            )}
          </div>
          {limited && <p className="mt-1.5 text-xs text-amber-600">{t('picker.rateLimited')}</p>}
          {results.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => void pick(r)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-start hover:bg-slate-50"
                  >
                    {r.primary_image ? (
                      <img src={r.primary_image} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                    ) : (
                      <div className="h-9 w-9 shrink-0 rounded bg-slate-100" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{r.project_name}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {[r.area, r.developer].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {r.min_price != null && (
                      <span className="shrink-0 text-xs font-medium text-teal-700">
                        <DirhamSymbol /> {formatMoneyCompact(r.min_price, i18n.language)}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!searching && query.trim().length >= 2 && results.length === 0 && !limited && (
            <p className="mt-1.5 text-xs text-slate-400">{t('picker.noResults')}</p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-900">{project.name}</div>
              <div className="truncate text-xs text-slate-500">
                {[project.area, project.developer].filter(Boolean).join(' · ')}
              </div>
            </div>
            <button
              type="button"
              onClick={clear}
              aria-label={t('picker.change')}
              className="shrink-0 rounded p-1 text-slate-400 hover:bg-white hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {project && (
        project.units.length === 0 ? (
          <p className="text-xs text-slate-500">{t('picker.noUnits')}</p>
        ) : (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-600">{t('picker.unitLabel')}</div>
            <div className="max-h-56 space-y-1 overflow-y-auto pe-0.5">
              {project.units.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => onUnitSelect(u.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-start transition',
                    u.id === selectedUnitId
                      ? 'border-teal-500 bg-teal-50'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-900">{u.unit_type_name}</span>
                    <span className="flex items-center gap-2 text-xs text-slate-500">
                      {u.bedrooms != null && (
                        <span className="flex items-center gap-0.5">
                          <Bed className="h-3 w-3" />
                          {u.bedrooms}
                        </span>
                      )}
                      {u.area != null && (
                        <span className="flex items-center gap-0.5">
                          <Maximize className="h-3 w-3" />
                          {Math.round(u.area).toLocaleString('en-US')} ft²
                        </span>
                      )}
                    </span>
                  </span>
                  {u.price != null && (
                    <span className="shrink-0 text-xs font-semibold text-teal-700">
                      <DirhamSymbol /> {formatMoneyCompact(u.price, i18n.language)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  )
}
