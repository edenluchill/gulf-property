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
 * ── 🔔 2026-08-09:**搬进标题栏的一颗铃铛** ──────────────────────────────
 * owner 提了两次。第一次:「dashboard 上面那些 notification 太脏了」——
 * 我把它缩成一条窄栏,**还是在主栏里**,他圈出来第二次:「占地太多 放在一旁
 * 学学别人怎么设计的」。
 *
 * 别人的做法是一致的(GitHub / Linear / Vercel / Supabase 都一样):
 * **通知不占正文一行** —— 它是标题栏右上角的一颗铃铛 + 未读数,点开才是面板。
 * 理由很简单:通知的量是不可控的(今天 0 条、明天 40 条),任何**跟着内容
 * 一起排版**的写法都会在某一天把真正的动作入口挤下去。铃铛的占地恒定。
 *
 * 🔴 **不要再把它放回文档流。** 收起来、缩窄、挪到页尾 —— 都还是占一行。
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Bell, Check } from 'lucide-react'
import { lunaFetch } from '../lunaApi'

/** 后端存的渲染参数。null = 2026-08-09 之前的历史行(那些 title/body 是中文成品)。 */
interface NoteParams {
  known?: boolean
  who?: string | null
  tour?: string | null
  project?: string | null
}

interface Note {
  id: string
  kind: 'tour_complete' | 'cta' | 'favorite' | string
  /** ⚠️ 兜底用。**有 params 就别读它** —— 它是写入时定死的中文。 */
  title: string
  body: string | null
  params?: NoteParams | null
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

/**
 * 通知文案 —— **按经纪当前的界面语言渲染**,不读库里存的那份。
 *
 * 🔴 库里的 title/body 是写入那一刻拼成的**中文成品**。一个英文界面的经纪
 *    会看到「有人点了「联系经纪」」(owner 2026-08-09 实拍工作台)。
 *    语言只有在渲染时才知道:他换语言,历史通知也要跟着换。
 *
 * params 为空(2026-08-09 之前的行)才回落到存着的原文 —— 全库当时只有 7 行。
 */
function noteText(n: Note, t: (k: string, o?: Record<string, unknown>) => string): { title: string; body: string | null } {
  const p = n.params
  if (!p) return { title: n.title, body: n.body }
  const known = !!p.known
  const v = { who: p.who || '', tour: p.tour || '', project: p.project || '' }
  const hasProject = !!p.project

  /**
   * ⚠️ 键**全部写成字面量,不拼**(`sig.title_tour_${suffix}` 那种)。
   *    i18n-key-check.mjs 是扫源码的:拼出来的键它看不见 —— 漏翻了不报警。
   *    多打几行字换一个能自检的表,值。
   */
  const T = {
    tour_complete: known ? t('lunaTour:sig.title_tour_known', v) : t('lunaTour:sig.title_tour_anon', v),
    cta: known ? t('lunaTour:sig.title_cta_known', v) : t('lunaTour:sig.title_cta_anon', v),
    // 收藏可能不知道是哪一套(projectId 没传过来)—— 那就别硬塞一个空的书名号
    favorite: known
      ? (hasProject ? t('lunaTour:sig.title_fav_known', v) : t('lunaTour:sig.title_fav_known_any', v))
      : (hasProject ? t('lunaTour:sig.title_fav_anon', v) : t('lunaTour:sig.title_fav_anon_any', v)),
  }
  const B = {
    tour_complete: known ? t('lunaTour:sig.body_tour_known', v) : t('lunaTour:sig.body_tour_anon', v),
    cta: known ? t('lunaTour:sig.body_cta_known', v) : t('lunaTour:sig.body_cta_anon', v),
    favorite: known ? t('lunaTour:sig.body_fav_known', v) : t('lunaTour:sig.body_fav_anon', v),
  }
  const k = (n.kind === 'tour_complete' || n.kind === 'cta' || n.kind === 'favorite') ? n.kind : null
  // 认不出的 kind(以后新加的)回落到库里存的原文,总比什么都不显示强
  if (!k) return { title: n.title, body: n.body }
  return { title: T[k], body: B[k] }
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
  /** 面板默认关。**轮询绝不自动打开它** —— 未读靠角标说话,
   *  一个每分钟自己弹开的浮层比通知本身还烦。 */
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

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

  // 点面板外面 / Esc 关掉 —— 浮层不给关法是最招人烦的一种
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const markAll = async () => {
    setUnread(0)
    setNotes((cur) => cur.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })))
    await lunaFetch('/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => {})
  }

  // 一条都没有 → 连铃铛都不画(新经纪的标题栏不该挂一个永远是 0 的图标)
  if (loaded && notes.length === 0) return null

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button type="button" onClick={() => setOpen((v) => !v)}
        aria-label={t('lunaTour:buyingSignals')} title={t('lunaTour:buyingSignals')}
        className={`relative flex h-9 w-9 items-center justify-center rounded-xl border transition ${
          open ? 'border-slate-300 bg-slate-100 text-slate-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
        }`}>
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold tabular-nums text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        /* 面板锚在铃铛右下。宽度用 min() 收口 —— 窄屏下 24rem 会顶出屏幕右边。
           z-30 够了:它不是 modal,不需要盖住页头。 */
        <div className="absolute end-0 z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3.5 py-2.5">
            <span className="text-sm font-semibold text-slate-800">{t('lunaTour:buyingSignals')}</span>
            {unread > 0 && (
              <button onClick={markAll} className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-800">
                <Check className="h-3.5 w-3.5" />{t('lunaTour:markAllRead')}
              </button>
            )}
          </div>

          <div className="max-h-[min(26rem,60vh)] divide-y divide-slate-50 overflow-y-auto">
            {notes.slice(0, 20).map((n) => {
              const txt = noteText(n, t)
              return (
              <div key={n.id} className={`flex items-start gap-2.5 px-3.5 py-2.5 ${n.read_at ? '' : 'bg-teal-50/60'}`}>
                <span className="mt-0.5 text-base leading-none">{ICON[n.kind] || '🔔'}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[13px] font-semibold text-slate-800">{txt.title}</span>
                    <span className="text-[11px] text-slate-400">{ago(n.created_at, t)}</span>
                  </div>
                  {txt.body && (
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{renderBody(txt.body)}</p>
                  )}
                  {/**
                    * 🔴 **只有真的知道是谁,才给「去跟进」。**
                    * 匿名访客给一个跟进按钮 = 骗经纪点进去,然后发现联系不上任何人。
                    * 那比不给更伤 —— 他会觉得这个产品在忽悠他。
                    */}
                  {n.client_id ? (
                    <Link to="/agent/clients" onClick={() => setOpen(false)}
                      className="mt-1 inline-block text-[11px] font-semibold text-teal-600 underline-offset-2 hover:underline">
                      {t('lunaTour:openProfile')}
                    </Link>
                  ) : (
                    <span className="mt-1 inline-block rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                      {t('lunaTour:anonymous2')}
                    </span>
                  )}
                </div>
              </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
