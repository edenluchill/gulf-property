/**
 * 「功能记录」tab —— 把散落的功能产出集中一处,左侧分区切换:
 *   Luna 导览生成 / Luna 对话 / 实时带看 / Sales Offer 报价单 / 买家报告。
 * 每个分区懒加载。Luna对话/实时带看点开详情弹窗(复用 SessionViewer / CollabReport)。
 */
import { useEffect, useState } from 'react'
import { Loader2, Wand2, Mic, Map as MapIcon, FileText, ClipboardList, Eye, Pencil } from 'lucide-react'
import {
  fetchFeatureTours, fetchFeatureSalesOffers, fetchFeatureReports, fetchSessions, fetchCollabSessions,
  type TourScriptRow, type SalesOfferRow, type BuyerReportRow, type SessionRow, type CollabSessionRow,
} from '../../lib/analyticsApi'
import SessionViewer from './SessionViewer'
import CollabReportModal from './CollabReport'

type SectionId = 'tours' | 'luna' | 'collab' | 'sales' | 'reports'
const SECTIONS: { id: SectionId; label: string; Icon: typeof Wand2 }[] = [
  { id: 'tours', label: 'Luna 导览生成', Icon: Wand2 },
  { id: 'luna', label: 'Luna 对话', Icon: Mic },
  { id: 'collab', label: '实时带看', Icon: MapIcon },
  { id: 'sales', label: 'Sales Offer', Icon: FileText },
  { id: 'reports', label: '买家报告', Icon: ClipboardList },
]

const fmtTime = (s: string) => s.slice(0, 16).replace('T', ' ')
const fmtMoney = (n: number | null) => (n == null ? '—' : `${n.toLocaleString()} AED`)

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-10 text-center text-sm text-slate-400">{text}</p>
}
function Rows({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-slate-50">{children}</div>
}

export default function FeatureLog() {
  const [section, setSection] = useState<SectionId>('tours')
  const [openSession, setOpenSession] = useState<string | null>(null)
  const [openCollab, setOpenCollab] = useState<string | null>(null)

  // 每个分区独立懒加载 + 缓存(切回不重拉)
  const [tours, setTours] = useState<TourScriptRow[] | null>(null)
  const [luna, setLuna] = useState<SessionRow[] | null>(null)
  const [collab, setCollab] = useState<CollabSessionRow[] | null>(null)
  const [sales, setSales] = useState<SalesOfferRow[] | null>(null)
  const [reports, setReports] = useState<BuyerReportRow[] | null>(null)

  useEffect(() => {
    if (section === 'tours' && tours == null) fetchFeatureTours().then(setTours).catch(() => setTours([]))
    if (section === 'luna' && luna == null) fetchSessions().then(setLuna).catch(() => setLuna([]))
    if (section === 'collab' && collab == null) fetchCollabSessions().then(setCollab).catch(() => setCollab([]))
    if (section === 'sales' && sales == null) fetchFeatureSalesOffers().then(setSales).catch(() => setSales([]))
    if (section === 'reports' && reports == null) fetchFeatureReports().then(setReports).catch(() => setReports([]))
  }, [section, tours, luna, collab, sales, reports])

  const count = (id: SectionId): number | null => {
    const m: Record<SectionId, unknown[] | null> = { tours, luna, collab, sales, reports }
    return m[id]?.length ?? null
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      {/* 左侧分区(手机横滑) */}
      <aside className="shrink-0 md:w-48">
        <nav className="flex gap-1 overflow-x-auto md:flex-col md:gap-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SECTIONS.map((s) => {
            const c = count(s.id)
            const active = section === s.id
            return (
              <button key={s.id} onClick={() => setSection(s.id)}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  active ? 'bg-teal-50 text-teal-700' : 'text-slate-600 hover:bg-slate-100/80'
                }`}>
                <s.Icon className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap">{s.label}</span>
                {c != null && <span className={`ms-auto hidden rounded-full px-1.5 text-[10px] md:inline ${active ? 'bg-teal-100 text-teal-600' : 'bg-slate-100 text-slate-400'}`}>{c}</span>}
              </button>
            )
          })}
        </nav>
      </aside>

      {/* 右侧内容 */}
      <div className="min-w-0 flex-1">
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
          {/* ── Luna 导览生成 ── */}
          {section === 'tours' && (
            tours == null ? <Load /> : tours.length === 0 ? <Empty text="还没有生成过 Luna 导览。" /> : (
              <Rows>
                {tours.map((t) => (
                  <div key={String(t.id)} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-800">{t.title}</span>
                        {t.edited_by_agent && <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-px text-[10px] text-indigo-500"><Pencil className="inline h-2.5 w-2.5" /> 已编辑</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        {t.agent_name || t.agent_email || '未知经纪'}
                        {t.total_ms ? ` · ${Math.round(t.total_ms / 1000)}s` : ''}
                        {t.language ? ` · ${t.language}` : ''}
                        {t.status ? ` · ${t.status}` : ''}
                      </div>
                    </div>
                    <span className="shrink-0 text-[11px] text-slate-400">{fmtTime(t.created_at)}</span>
                  </div>
                ))}
              </Rows>
            )
          )}

          {/* ── Luna 对话 ── */}
          {section === 'luna' && (
            luna == null ? <Load /> : luna.length === 0 ? <Empty text="还没有 Luna 对话。" /> : (
              <Rows>
                {luna.map((s) => (
                  <button key={s.id} onClick={() => setOpenSession(s.session_id)}
                    className="flex w-full items-start justify-between gap-3 px-4 py-3 text-start hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-700">
                        {fmtTime(s.created_at)} · <span className={s.email ? 'text-slate-700' : 'text-slate-400'}>{s.email || (s.short_id ? `#${s.short_id}` : '匿名')}</span>
                      </div>
                      {s.summary
                        ? <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{s.summary}</div>
                        : <div className="mt-0.5 text-xs italic text-slate-300">暂无摘要</div>}
                      <div className="mt-0.5 text-xs text-slate-400">
                        {s.turn_count || 0} 句 · {s.tool_call_count || 0} 工具{s.had_error ? ' · ⚠️ 有错误' : ''}
                        {/* 补录 = 浏览器结束时没上报成功,服务端从每轮日志还原的。
                            标出来是因为它少了 metrics/打断次数 —— 看到「工具 0」时
                            要知道是没记到,不是真没查。 */}
                        {s.source === 'rebuilt' && (
                          <span className="ms-1.5 rounded bg-amber-50 px-1 py-px text-[10px] text-amber-600"
                                title="浏览器结束时没上报成功,这条是服务端从每轮日志补回来的">补录</span>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">{s.duration_ms ? `${Math.round(s.duration_ms / 1000)}s` : '—'}</span>
                  </button>
                ))}
              </Rows>
            )
          )}

          {/* ── 实时带看 ── */}
          {section === 'collab' && (
            collab == null ? <Load /> : collab.length === 0 ? <Empty text="还没有带看记录。" /> : (
              <Rows>
                {collab.map((c) => (
                  <button key={c.code} onClick={() => setOpenCollab(c.code)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start hover:bg-slate-50">
                    <div className="min-w-0">
                      <div className="text-sm text-slate-700">
                        {fmtTime(c.last_event_at || c.created_at)}{c.name ? ` · ${c.name}` : ''}
                        <span className="ms-1 font-mono text-xs text-slate-400">{c.code}</span>
                      </div>
                      <div className="text-xs text-slate-400">{c.chat_count} 条聊天 · {c.event_count} 事件 · 峰值 {c.peak_participants} 人</div>
                    </div>
                    <span className="shrink-0 text-xs text-teal-500">查看报告 →</span>
                  </button>
                ))}
              </Rows>
            )
          )}

          {/* ── Sales Offer 报价单 ── */}
          {section === 'sales' && (
            sales == null ? <Load /> : sales.length === 0 ? <Empty text="还没有生成过 Sales Offer 报价单。" /> : (
              <Rows>
                {sales.map((o) => (
                  <div key={String(o.id)} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-800">{o.project_name}{o.unit_name ? ` · ${o.unit_name}` : ''}</div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        {o.agent_name || o.created_by_email || '未知经纪'} · {fmtMoney(o.price)}
                        {o.original_price && o.original_price !== o.price ? ` (原 ${fmtMoney(o.original_price)})` : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-[11px] text-slate-400">
                      <span className="inline-flex items-center gap-0.5"><Eye className="h-3 w-3" />{o.view_count}</span>
                      <span>{fmtTime(o.created_at)}</span>
                    </div>
                  </div>
                ))}
              </Rows>
            )
          )}

          {/* ── 买家 / 品牌报告 ── */}
          {section === 'reports' && (
            reports == null ? <Load /> : reports.length === 0 ? <Empty text="还没有生成过报告。" /> : (
              <Rows>
                {reports.map((r) => (
                  <div key={`${r.kind}-${r.id}`} className="flex items-center gap-3 px-4 py-3">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${r.kind === 'client' ? 'bg-teal-50 text-teal-600' : 'bg-amber-50 text-amber-600'}`}>
                      {r.kind === 'client' ? '买家意向' : '品牌项目'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-800">{r.title}</div>
                      <div className="mt-0.5 text-xs text-slate-400">{r.agent_name || '未知经纪'}{r.status ? ` · ${r.status}` : ''}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-[11px] text-slate-400">
                      <span className="inline-flex items-center gap-0.5"><Eye className="h-3 w-3" />{r.view_count}</span>
                      <span>{fmtTime(r.created_at)}</span>
                    </div>
                  </div>
                ))}
              </Rows>
            )
          )}
        </div>
      </div>

      {openSession && <SessionViewer sessionId={openSession} onClose={() => setOpenSession(null)} />}
      {openCollab && <CollabReportModal code={openCollab} onClose={() => setOpenCollab(null)} />}
    </div>
  )
}

function Load() {
  return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>
}
