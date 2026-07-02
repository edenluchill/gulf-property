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
  const actor = detail ? detail.email || (detail.short_id ? `#${detail.short_id}` : '#—') : ''

  return (
    <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
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
                {actor ? <span className="font-mono"> · {actor}</span> : ''}
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
          {!loading && !error && detail?.summary && (
            <div className="rounded-xl bg-teal-50 px-3 py-2.5 text-[13px] leading-relaxed text-teal-900 ring-1 ring-teal-100">
              <span className="font-semibold text-teal-700">AI 摘要:</span> {detail.summary}
            </div>
          )}
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
              <div className="space-y-2">
                {toolCalls.map((tc, i) => {
                  const hasParams = tc.params != null && (typeof tc.params !== 'object' || Object.keys(tc.params as object).length > 0)
                  const hasResult = tc.result !== undefined && tc.result !== null
                  return (
                    <div key={i} className="rounded-lg bg-slate-50 px-2.5 py-2 ring-1 ring-slate-100">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Wrench className="h-3 w-3 text-slate-400" />
                        <span className="font-mono font-medium text-slate-700">{tc.name}</span>
                        {tc.duration != null && <span className="text-slate-400">{tc.duration}ms</span>}
                        {tc.error && <span className="rounded bg-rose-50 px-1.5 text-rose-600">出错</span>}
                      </div>
                      {hasParams && (
                        <div className="mt-1.5">
                          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">参数</div>
                          <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-words rounded bg-white px-2 py-1 font-mono text-[11px] leading-snug text-slate-600 ring-1 ring-slate-100">{JSON.stringify(tc.params, null, 2)}</pre>
                        </div>
                      )}
                      {hasResult && (
                        <details className="mt-1.5">
                          <summary className="cursor-pointer text-[10px] font-medium uppercase tracking-wide text-slate-400 hover:text-slate-600">返回结果</summary>
                          <pre className="mt-0.5 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-white px-2 py-1 font-mono text-[11px] leading-snug text-slate-600 ring-1 ring-slate-100">{JSON.stringify(tc.result, null, 2)}</pre>
                        </details>
                      )}
                      {tc.error && (
                        <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-words rounded bg-rose-50 px-2 py-1 font-mono text-[11px] leading-snug text-rose-700">{String(tc.error)}</pre>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
