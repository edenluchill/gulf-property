import { useEffect, useState } from 'react'
import { X, Loader2, MapPin, Building2, Sparkles, MessageSquare, Users } from 'lucide-react'
import { fetchCollabReport, CollabReport as Report } from '../../lib/analyticsApi'

const LEVEL_STYLE: Record<string, string> = {
  高: 'bg-rose-100 text-rose-700',
  中: 'bg-amber-100 text-amber-700',
  低: 'bg-slate-100 text-slate-500',
  未知: 'bg-slate-100 text-slate-400',
}

/** Modal: loads + renders a post-tour buyer-intent report for one collab room. */
export default function CollabReport({ code, onClose }: { code: string; onClose: () => void }) {
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchCollabReport(code)
      .then((d) => {
        if (!alive) return
        setReport(d.report)
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        setError(true)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [code])

  const mins = report?.duration_ms ? Math.round(report.duration_ms / 60000) : null

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">带看意向报告 · {code}</h3>
            {report && (
              <p className="text-xs text-slate-400">
                {report.created_at.slice(0, 16).replace('T', ' ')}
                {mins != null ? ` · ${mins} 分钟` : ''}
                {` · 峰值 ${report.peak_participants} 人`}
                {report.name ? ` · ${report.name}` : ''}
              </p>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {loading && (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-teal-500" />
            </div>
          )}
          {error && <p className="text-sm text-rose-500">加载失败</p>}
          {!loading && !error && !report && <p className="text-sm text-slate-400">没有这次带看的记录。</p>}

          {report && (
            <>
              {/* AI 意向判断 + 跟进话术 */}
              {report.ai ? (
                <div className="rounded-2xl bg-gradient-to-br from-teal-50 to-emerald-50 p-4 ring-1 ring-teal-100">
                  <div className="mb-2 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-teal-600" />
                    <span className="text-sm font-semibold text-slate-800">AI 意向分析</span>
                    <span className={`ms-auto rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_STYLE[report.ai.interest_level] || LEVEL_STYLE['未知']}`}>
                      意向{report.ai.interest_level}
                    </span>
                  </div>
                  {report.ai.summary && <p className="text-sm text-slate-700">{report.ai.summary}</p>}
                  {report.ai.signals.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {report.ai.signals.map((s, i) => (
                        <li key={i} className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-teal-700">{s}</li>
                      ))}
                    </ul>
                  )}
                  {report.ai.follow_up && (
                    <div className="mt-3 rounded-xl bg-white/80 p-3">
                      <p className="mb-1 text-xs font-medium text-slate-500">跟进话术草稿</p>
                      <p className="text-sm text-slate-700">{report.ai.follow_up}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-400">
                  互动信息有限,暂无 AI 意向分析。
                </p>
              )}

              {/* 行为事实 */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {report.areas_visited.length > 0 && (
                  <Fact icon={<MapPin className="h-4 w-4 text-teal-500" />} title="去过的区域">
                    {report.areas_visited.join('、')}
                  </Fact>
                )}
                {report.projects.length > 0 && (
                  <Fact icon={<Building2 className="h-4 w-4 text-teal-500" />} title={`看过的项目 (${report.projects.length})`}>
                    {report.projects.map((p) => p.name || p.id.slice(0, 8)).join('、')}
                  </Fact>
                )}
                {report.luna_actions.length > 0 && (
                  <Fact icon={<Sparkles className="h-4 w-4 text-teal-500" />} title="Luna 数据查询">
                    {report.luna_actions.map((a) => `${a.type}×${a.count}`).join('、')}
                  </Fact>
                )}
                {report.participants.length > 0 && (
                  <Fact icon={<Users className="h-4 w-4 text-teal-500" />} title="参与者">
                    {report.participants.map((p) => `${p.name}${p.role === 'presenter' ? '(经纪)' : ''}`).join('、')}
                  </Fact>
                )}
                {report.contacts.length > 0 && (
                  <Fact icon={<Users className="h-4 w-4 text-emerald-500" />} title={`买家联系方式 (${report.contacts.length})`}>
                    <div className="space-y-1">
                      {report.contacts.map((c, i) => (
                        <div key={i} className="text-sm">
                          <span className="font-medium text-slate-700">{c.name}</span>
                          {c.phone && <span className="ms-2 text-slate-500">📞 {c.phone}</span>}
                          {c.whatsapp && <span className="ms-2 text-slate-500">💬 {c.whatsapp}</span>}
                          {!c.phone && !c.whatsapp && <span className="ms-2 text-slate-400">(未留联系方式)</span>}
                        </div>
                      ))}
                    </div>
                  </Fact>
                )}
              </div>

              {/* 聊天记录 */}
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-slate-400" />
                  <span className="text-sm font-medium text-slate-600">聊天记录 ({report.chat.length})</span>
                </div>
                {report.chat.length === 0 ? (
                  <p className="text-xs text-slate-400">这次带看没有文字聊天。</p>
                ) : (
                  <div className="space-y-2">
                    {report.chat.map((c, i) => (
                      <div key={i} className={`flex ${c.from === 'agent' ? 'justify-start' : 'justify-end'}`}>
                        <div
                          className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                            c.from === 'agent' ? 'bg-slate-100 text-slate-800' : 'bg-teal-500 text-white'
                          }`}
                        >
                          {c.name && <span className="me-1 text-[10px] opacity-60">{c.name}</span>}
                          {c.text}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {report.truncated && (
                <p className="text-xs text-amber-500">⚠️ 事件过多,记录已截断,部分细节未展示。</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Fact({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {icon}
        {title}
      </div>
      <p className="text-sm text-slate-700">{children}</p>
    </div>
  )
}
