/**
 * 🔔 购买意向提醒 —— 「谁刚看完、谁点了联系、谁收藏了哪套」。
 *
 * 行为数据一直在采,但之前**没有任何人被告知** —— 经纪只有主动去翻才看得见。
 * 最值钱的一刻是客户**刚看完的那一分钟**,所以这块在工作台的**第一屏**。
 *
 * ── ⚠️ 但它是**信号**,不是线索(owner 定调)────────────────────────────
 *
 * Luna Tour 的访客是**匿名的**:我们没有他的电话、没有微信。
 * 实测:10 场 tour **6 场完全匿名**;剩下 4 场绑了客户,而那 4 个客户
 * **0 个有电话、0 个有 WhatsApp**。
 *
 * 我上一版写的是「陈先生想联系你」+ 一个「去跟进」按钮 —— 而经纪点进去
 * **根本联系不上任何人**。这跟 leads tab 被下架是同一个病。
 * **一个联系不上的"线索"不是线索,是噪音。**
 *
 * 所以:
 *   • 知道是谁(这场 tour 是发给某个客户的)→ 指名道姓,可以去他的档案
 *   • 不知道是谁(公开链接)→ **明说不知道**,并告诉他下次怎么做才能知道
 *
 * ── 📉 2026-08-09:**默认收起** ────────────────────────────────────────
 * owner:「dashboard 上面那些 notification 太脏了 应该放在不太显眼或者一个信息栏」。
 * 之前是六条卡片糊在工作台第一屏,把真正的动作入口挤到了折叠线以下。
 * 现在缩成一条:`🔔 N 条新动静` —— **有未读才自动展开**,读过的要点一下才看。
 * 🔴 别改回默认展开:这块是**信号**不是待办,它不该比「开始带看」还抢眼。
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Bell, Check, ChevronDown } from 'lucide-react'
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

/** 加粗 body 里的 **…**（后端用它标「我们不知道他是谁」这种要害的话）。 */
function renderBody(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? <b key={i} className="text-slate-700">{part}</b> : <span key={i}>{part}</span>
  )
}

function ago(iso: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 1) return t('lunaTour:justNow3')
  if (m < 60) return t('lunaTour:mAgo', { m })
  const h = Math.round(m / 60)
  if (h < 24) return t('lunaTour:hAgo', { h })
  const d = Math.round(h / 24)
  return t('lunaTour:dAgo', { d })
}

export default function IntentFeed() {
  const { t: tRaw } = useTranslation('lunaTour')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string

  const [notes, setNotes] = useState<Note[]>([])
  const [unread, setUnread] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  /** 用户手动收/放过就以他的意思为准。
   *  ⚠️ 必须是 ref 不是 state:轮询用的是 useEffect([]) 里那份闭包,
   *     state 会永远停在 false —— 他收起来,下一分钟又被弹开。 */
  const touched = useRef(false)

  const load = () => {
    void lunaFetch('/notifications')
      .then((r) => r.json())
      .then((d) => {
        setNotes(d.notifications || [])
        setUnread(d.unread || 0)
        if (!touched.current) setOpen((d.unread || 0) > 0)
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
    <div className="mb-5 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
      {/* 一条窄栏 —— 整行可点开合 */}
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button type="button" onClick={() => { touched.current = true; setOpen((v) => !v) }}
          className="flex min-w-0 flex-1 items-center gap-2 text-start">
          <Bell className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="truncate text-sm font-medium text-slate-600">{t('lunaTour:buyingSignals')}</span>
          <span className="shrink-0 text-xs tabular-nums text-slate-400">{notes.length}</span>
          {unread > 0 && (
            <span className="shrink-0 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {unread}
            </span>
          )}
          <ChevronDown className={`ms-auto h-4 w-4 shrink-0 text-slate-300 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {unread > 0 && open && (
          <button onClick={markAll} className="flex shrink-0 items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-800">
            <Check className="h-3.5 w-3.5" /> {t('lunaTour:markAllRead')}
          </button>
        )}
      </div>

      <div className={`space-y-1.5 px-3 pb-3 ${open ? '' : 'hidden'}`}>
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
                <span className="text-[11px] text-slate-400">{ago(n.created_at, t)}</span>
              </div>
              {n.body && (
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{renderBody(n.body)}</p>
              )}
            </div>
            {/**
              * 🔴 **只有真的知道是谁,才给「去跟进」。**
              *
              * 匿名访客给一个跟进按钮 = 骗经纪点进去,然后发现联系不上任何人。
              * 那比不给更伤 —— 他会觉得这个产品在忽悠他。
              */}
            {n.client_id ? (
              <Link
                to="/agent/clients"
                className="shrink-0 self-center rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-slate-700"
              >
                {t('lunaTour:openProfile')}
              </Link>
            ) : (
              <span className="shrink-0 self-center rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-400">
                {t('lunaTour:anonymous2')}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
