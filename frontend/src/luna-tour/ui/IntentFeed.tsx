/**
 * 🔔 客户动静 —— 「谁刚看完、谁想联系你、谁收藏了哪套」。
 *
 * 🔴 这是这个产品**唯一真正的护城河**,而它之前是假的:行为数据一直在采
 *    (lt_engagement_events),但**没有任何人被告知** —— 经纪只有主动去翻才看得见。
 *
 * 最值钱的一刻是客户**刚看完的那一分钟**:他此刻正在想这件事。晚一天再打电话,
 * 热度就没了。所以这块必须在工作台的**第一屏**,而不是藏在某个 tab 里。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Bell, Check } from 'lucide-react'
import { lunaFetch } from '../lunaApi'

interface Note {
  id: string
  kind: 'tour_complete' | 'cta' | 'favorite' | string
  title: string
  body: string | null
  share_code: string | null
  client_id: string | null
  read_at: string | null
  created_at: string
}

const ICON: Record<string, string> = {
  tour_complete: '🎬',
  cta: '📞',
  favorite: '❤️',
}

function ago(iso: string, zh: boolean): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 1) return zh ? '刚刚' : 'just now'
  if (m < 60) return zh ? `${m} 分钟前` : `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return zh ? `${h} 小时前` : `${h}h ago`
  const d = Math.round(h / 24)
  return zh ? `${d} 天前` : `${d}d ago`
}

export default function IntentFeed() {
  const { i18n } = useTranslation()
  const zh = !!i18n.language?.startsWith('zh')
  const L = (a: string, b: string) => (zh ? a : b)

  const [notes, setNotes] = useState<Note[]>([])
  const [unread, setUnread] = useState(0)
  const [loaded, setLoaded] = useState(false)

  const load = () => {
    void lunaFetch('/notifications')
      .then((r) => r.json())
      .then((d) => {
        setNotes(d.notifications || [])
        setUnread(d.unread || 0)
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }
  useEffect(() => {
    load()
    // 客户可能正在看 —— 每分钟刷一次,不用等他刷新页面
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  const markAll = async () => {
    setUnread(0)
    setNotes((cur) => cur.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })))
    await lunaFetch('/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => {})
  }

  // 一条都没有 → 不占地方（新经纪的工作台不该挂一个空盒子）
  if (loaded && notes.length === 0) return null

  return (
    <div className="mb-6 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-teal-600" />
          <span className="font-semibold">{L('客户动静', 'Client activity')}</span>
          {unread > 0 && (
            <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-bold text-white">
              {unread}
            </span>
          )}
        </div>
        {unread > 0 && (
          <button onClick={markAll} className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
            <Check className="h-3.5 w-3.5" /> {L('全部标为已读', 'Mark all read')}
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        {notes.slice(0, 6).map((n) => (
          <div
            key={n.id}
            className={`flex items-start gap-3 rounded-xl p-2.5 transition ${
              n.read_at ? 'bg-white' : 'bg-teal-50/70 ring-1 ring-teal-100'
            }`}
          >
            <span className="mt-0.5 text-lg leading-none">{ICON[n.kind] || '🔔'}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-semibold text-slate-800">{n.title}</span>
                <span className="text-[11px] text-slate-400">{ago(n.created_at, zh)}</span>
              </div>
              {n.body && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{n.body}</p>}
            </div>
            {n.client_id && (
              <Link
                to="/agent/clients"
                className="shrink-0 self-center rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-slate-700"
              >
                {L('去跟进', 'Follow up')}
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
