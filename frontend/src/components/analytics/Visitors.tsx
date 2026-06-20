/**
 * Per-visitor drill-down for the owner dashboard: a table of UNIQUE visitors
 * (one row per browser/visitor_id) with an intent score + stage, and a slide-over
 * panel showing one visitor's behaviour timeline and a derived prediction.
 */
import { useEffect, useState } from 'react'
import { Loader2, X, Flame, Eye, Search as SearchIcon, Mic, FileText, MousePointerClick, Building2 } from 'lucide-react'
import { fetchVisitors, fetchVisitor, VisitorRow, VisitorDetail, Stage } from '../../lib/analyticsApi'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../DirhamSymbol'

const STAGE: Record<Stage, { label: string; cls: string; dot: string }> = {
  hot: { label: '热', cls: 'bg-rose-50 text-rose-600 ring-rose-200', dot: 'bg-rose-500' },
  warm: { label: '温', cls: 'bg-amber-50 text-amber-600 ring-amber-200', dot: 'bg-amber-500' },
  cooling: { label: '转冷', cls: 'bg-sky-50 text-sky-600 ring-sky-200', dot: 'bg-sky-500' },
  cold: { label: '冷', cls: 'bg-slate-100 text-slate-500 ring-slate-200', dot: 'bg-slate-400' },
}

const ago = (iso: string) => {
  const m = (Date.now() - new Date(iso).getTime()) / 60000
  if (m < 60) return `${Math.max(1, Math.round(m))} 分钟前`
  if (m < 1440) return `${Math.round(m / 60)} 小时前`
  return `${Math.round(m / 1440)} 天前`
}
const shortId = (id: string) => id.replace(/^v_/, '').slice(0, 8)

function StageBadge({ stage }: { stage: Stage }) {
  const s = STAGE[stage]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

export default function Visitors({ days }: { days: number }) {
  const [rows, setRows] = useState<VisitorRow[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setRows(null)
    fetchVisitors(days).then((r) => alive && setRows(r)).catch(() => alive && setRows([]))
    return () => { alive = false }
  }, [days])

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-800">访客明细</h3>
        <span className="text-xs text-slate-400">{rows ? `${rows.length} 位独立访客` : ''}</span>
      </div>
      {!rows ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-teal-500" /></div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-xs text-slate-400">这段时间没有访客。</p>
      ) : (
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left font-medium">访客</th>
                <th className="px-2 py-2 text-left font-medium">意向</th>
                <th className="px-2 py-2 text-right font-medium">评分</th>
                <th className="px-2 py-2 text-right font-medium">浏览</th>
                <th className="px-2 py-2 text-right font-medium">搜索</th>
                <th className="px-2 py-2 text-right font-medium">Luna</th>
                <th className="px-4 py-2 text-right font-medium">最近活跃</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((v) => (
                <tr key={v.visitor_id} onClick={() => setSelected(v.visitor_id)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-700">{v.user_email || <span className="font-mono text-slate-500">#{shortId(v.visitor_id)}</span>}</div>
                    {v.user_email && <div className="font-mono text-[10px] text-slate-400">#{shortId(v.visitor_id)}</div>}
                  </td>
                  <td className="px-2 py-2.5"><StageBadge stage={v.stage} /></td>
                  <td className="px-2 py-2.5 text-right font-semibold text-slate-700">{v.score}</td>
                  <td className="px-2 py-2.5 text-right text-slate-500">{v.views}</td>
                  <td className="px-2 py-2.5 text-right text-slate-500">{v.searches}</td>
                  <td className="px-2 py-2.5 text-right text-slate-500">{v.luna_opens || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-slate-400">{ago(v.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && <VisitorDrawer id={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

const TYPE_META: Record<string, { icon: typeof Eye; color: string }> = {
  property_view: { icon: Building2, color: 'text-emerald-500' },
  search: { icon: SearchIcon, color: 'text-sky-500' },
  search_result_click: { icon: MousePointerClick, color: 'text-indigo-500' },
  luna_open: { icon: Mic, color: 'text-violet-500' },
  luna_close: { icon: Mic, color: 'text-slate-400' },
  page_view: { icon: FileText, color: 'text-slate-400' },
}

function nextAction(d: VisitorDetail): string {
  const p = d.prediction
  if (d.stage === 'hot' && p.hasContact) return '🔥 热 lead——建议立即人工 WhatsApp/电话跟进。'
  if (d.stage === 'hot' && !p.hasContact) return '🔥 高意向但匿名——在其常看的项目页加引流弹窗,尽快拿到联系方式。'
  if (!p.usedLuna && d.counts.views >= 2) return '看了多个项目但没用 Luna——可推送语音助手主动引导答疑。'
  if (p.topAreas[0]) return `关注「${p.topAreas[0].name}」——推送该区域新盘/同类房源。`
  if (d.counts.searches > 0 && d.counts.views === 0) return '只搜索未看房——优化搜索结果或推荐热门项目。'
  return '浏览较浅,持续观察即可。'
}

function VisitorDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<VisitorDetail | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchVisitor(id).then((r) => { if (alive) { setD(r.visitor); setLoading(false) } }).catch(() => alive && setLoading(false))
    return () => { alive = false }
  }, [id])

  const lang = 'zh-CN'
  return (
    <>
      <div className="fixed inset-0 z-[10000] bg-black/40" onClick={onClose} />
      <div className="fixed right-0 top-0 z-[10001] flex h-full w-full max-w-md flex-col bg-slate-50 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-800">
              {d?.user_email || <span className="font-mono">访客 #{shortId(id)}</span>}
            </div>
            <div className="font-mono text-[10px] text-slate-400">{id}</div>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        {loading || !d ? (
          <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {/* Prediction card */}
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Flame className="h-4 w-4 text-rose-500" />
                  <span className="text-sm font-semibold text-slate-800">意向预测</span>
                  <StageBadge stage={d.stage} />
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-slate-900">{d.score}</div>
                  <div className="text-[10px] text-slate-400">意向评分</div>
                </div>
              </div>

              {d.prediction.budget && (
                <div className="mb-2 flex items-center gap-1.5 text-sm">
                  <span className="text-slate-400">预估预算</span>
                  <DirhamSymbol size="0.85em" className="text-slate-400" />
                  <span className="font-semibold text-slate-700">
                    {formatMoneyCompact(d.prediction.budget.min, lang)} – {formatMoneyCompact(d.prediction.budget.max, lang)}
                  </span>
                </div>
              )}

              {d.prediction.topAreas.length > 0 && (
                <div className="mb-2">
                  <div className="mb-1 text-xs text-slate-400">关注区域</div>
                  <div className="flex flex-wrap gap-1.5">
                    {d.prediction.topAreas.map((a) => (
                      <span key={a.name} className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">{a.name} · {a.count}</span>
                    ))}
                  </div>
                </div>
              )}

              {d.prediction.searchTerms.length > 0 && (
                <div className="mb-2">
                  <div className="mb-1 text-xs text-slate-400">搜索词</div>
                  <div className="flex flex-wrap gap-1.5">
                    {d.prediction.searchTerms.map((t, i) => (
                      <span key={i} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{t}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-3 rounded-xl bg-slate-900 px-3 py-2 text-[12px] leading-relaxed text-white">
                <span className="font-semibold text-slate-300">下一步建议:</span> {nextAction(d)}
              </div>
            </div>

            {/* Viewed projects */}
            {d.prediction.viewedProjects.length > 0 && (
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
                <div className="mb-2 text-sm font-semibold text-slate-800">看过的项目 ({d.prediction.viewedProjects.length})</div>
                <div className="space-y-1.5">
                  {d.prediction.viewedProjects.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <span className="truncate font-medium text-slate-700">{p.name}</span>
                        {p.area && <span className="ml-1 text-xs text-slate-400">{p.area}</span>}
                      </div>
                      <div className="flex shrink-0 items-center gap-1 text-xs text-slate-500">
                        {p.minPrice != null && <><DirhamSymbol size="0.8em" className="text-slate-400" />{formatMoneyCompact(p.minPrice, lang)}</>}
                        {p.count > 1 && <span className="ml-1 rounded-full bg-slate-100 px-1.5 text-[10px]">×{p.count}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Timeline */}
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">行为时间线</span>
                <span className="text-xs text-slate-400">{d.counts.events} 次事件</span>
              </div>
              <div className="text-[11px] text-slate-400">
                首次 {d.first_seen.slice(0, 16).replace('T', ' ')} · 最近 {ago(d.last_seen)}
              </div>
              <div className="mt-3 space-y-2.5">
                {[...d.timeline].reverse().map((e, i) => {
                  const meta = TYPE_META[e.type] || { icon: FileText, color: 'text-slate-300' }
                  const Icon = meta.icon
                  let text = e.type
                  if (e.type === 'property_view') text = `看了 ${e.projectName || '项目'}${e.area ? ` · ${e.area}` : ''}`
                  else if (e.type === 'search') text = `搜索 "${e.query || ''}"${e.kind ? ` · ${e.kind}` : ''}`
                  else if (e.type === 'search_result_click') text = `点开 ${e.projectName || '结果'}`
                  else if (e.type === 'luna_open') text = '打开 Luna 语音助手'
                  else if (e.type === 'luna_close') text = '关闭 Luna'
                  else if (e.type === 'page_view') text = `访问 ${e.path || '页面'}`
                  return (
                    <div key={i} className="flex items-start gap-2.5">
                      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${meta.color}`} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] text-slate-700">{text}</div>
                        <div className="text-[10px] text-slate-400">{e.at.slice(5, 16).replace('T', ' ')}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
