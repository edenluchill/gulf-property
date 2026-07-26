/**
 * 带看会话历史 —— 每一场实时带看是谁、进了几个人、聊了什么、看了哪些区/项目、
 * 客户意向如何。点一条 → 打开该场的完整意向报告(CollabReportModal)。
 *
 * 数据/报告端点(fetchCollabSessions / fetchCollabReport)早就有,只是原来埋在
 * 「功能记录」tab 的子分区里,owner 在「实时带看」tab 找不到 →「不知道带看怎么样了」。
 * 这里把它直接摆到「实时带看」tab(遥测下方),owner 在预期的地方就能看到每场经过。
 */
import { useEffect, useState } from 'react'
import { Loader2, Users, MessageSquare, ArrowRight } from 'lucide-react'
import { fetchCollabSessions, type CollabSessionRow } from '../../lib/analyticsApi'
import CollabReportModal from './CollabReport'

const fmtTime = (s: string | null) => {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const durMin = (row: CollabSessionRow): string => {
  if (!row.first_event_at || !row.last_event_at) return '—'
  const ms = new Date(row.last_event_at).getTime() - new Date(row.first_event_at).getTime()
  if (!(ms > 0)) return '<1 分钟'
  const m = Math.round(ms / 60000)
  return m < 1 ? '<1 分钟' : `${m} 分钟`
}

export default function CollabSessionList() {
  const [rows, setRows] = useState<CollabSessionRow[] | null>(null)
  const [openCode, setOpenCode] = useState<string | null>(null)

  useEffect(() => { fetchCollabSessions().then(setRows).catch(() => setRows([])) }, [])

  return (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-800">带看会话历史</h3>
        <span className="text-[11px] text-slate-400">点一条看这场的完整经过 + 客户意向</span>
      </div>
      {rows == null ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-teal-500" /></div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-400">还没有带看记录。</div>
      ) : (
        <div className="divide-y divide-slate-100 border-t border-slate-100">
          {rows.map((c) => (
            <button
              key={c.code}
              onClick={() => setOpenCode(c.code)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start transition hover:bg-slate-50"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-700">
                  {fmtTime(c.last_event_at || c.created_at)}
                  {c.name ? ` · ${c.name}` : ''}
                  <span className="ms-1.5 font-mono text-[11px] text-slate-400">{c.code}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
                  <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />峰值 {c.peak_participants} 人</span>
                  <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" />{c.chat_count} 条聊天</span>
                  <span>{c.event_count} 个动作</span>
                  <span>时长 {durMin(c)}</span>
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-teal-600">
                查看报告 <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </button>
          ))}
        </div>
      )}
      {openCode && <CollabReportModal code={openCode} onClose={() => setOpenCode(null)} />}
    </div>
  )
}
