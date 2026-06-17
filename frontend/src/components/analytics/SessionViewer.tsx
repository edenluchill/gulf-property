import { useEffect, useState } from 'react'
import { X, Loader2, Wrench } from 'lucide-react'
import { fetchSession, SessionDetail } from '../../lib/analyticsApi'

/** Modal that loads + renders one Luna conversation transcript (verbatim). */
export default function SessionViewer({
  sessionId,
  onClose,
}: {
  sessionId: string
  onClose: () => void
}) {
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchSession(sessionId)
      .then((d) => {
        if (!alive) return
        setDetail(d.session)
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
  }, [sessionId])

  const messages = detail?.transcript?.messages || []
  const toolCalls = detail?.transcript?.toolCalls || []

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Luna 对话回看</h3>
            {detail && (
              <p className="text-xs text-slate-400">
                {detail.created_at.slice(0, 16).replace('T', ' ')} · {messages.length} 句 ·{' '}
                {detail.duration_ms ? `${Math.round(detail.duration_ms / 1000)}s` : '—'}
                {detail.user_email ? ` · ${detail.user_email}` : ''}
              </p>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {loading && (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-teal-500" />
            </div>
          )}
          {error && <p className="text-sm text-rose-500">加载失败</p>}
          {!loading && !error && messages.length === 0 && (
            <p className="text-sm text-slate-400">这段会话没有文字记录。</p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  m.role === 'user' ? 'bg-teal-500 text-white' : 'bg-slate-100 text-slate-800'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}

          {toolCalls.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="mb-2 text-xs font-medium text-slate-500">工具调用 ({toolCalls.length})</p>
              <div className="space-y-1">
                {toolCalls.map((tc, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-slate-500">
                    <Wrench className="h-3 w-3 text-slate-400" />
                    <span className="font-mono text-slate-700">{tc.name}</span>
                    {tc.duration != null && <span className="text-slate-400">{tc.duration}ms</span>}
                    {tc.error && <span className="text-rose-500">error</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
