/**
 * 🔎 Luna 对这份大纲的意见 —— 「缺了什么」。
 *
 * 经纪拿到草稿时间线,面对十几拍旁白,**不知道该看什么** ——
 * 于是要么全盘接受(那两段式就白做了),要么随便改两个字。
 *
 * Luna 读一遍,直接告诉他**缺了什么、为什么这会让他丢单**,
 * 并且每一条都给一句**可以直接打给 AI 编辑器的指令** —— 点一下就改。
 *
 * ⚠️ **不阻塞。** 意见只是意见,他可以无视,直接发布。
 *    剧本糙 → 成交难,那是他的选择,不是我们的门禁。
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, RefreshCw, Sparkles, Wand2 } from 'lucide-react'
import { lunaFetch } from '../lunaApi'

interface Note {
  kind: 'gap' | 'risk' | 'idea'
  title: string
  why: string
  fix?: string
}

const TONE: Record<Note['kind'], { icon: string; ring: string; bg: string; label: string }> = {
  risk: { icon: '⚠️', ring: 'ring-rose-200', bg: 'bg-rose-50/60', label: '会伤到你' },
  gap: { icon: '🕳️', ring: 'ring-amber-200', bg: 'bg-amber-50/60', label: '缺一拍' },
  idea: { icon: '💡', ring: 'ring-indigo-200', bg: 'bg-indigo-50/60', label: '可以更强' },
}

export default function StoryboardReview({
  sessionId,
  onApplyFix,
}: {
  sessionId: string
  /** 点「让 Luna 改」→ 把这句指令交给 AI 编辑器 */
  onApplyFix?: (instruction: string) => void
}) {
  const { t: tRaw, i18n } = useTranslation('lunaTour')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const zh = !!i18n.language?.startsWith('zh')

  // 🔴 不再进页面就自动烧 AI(慢 + 费钱)。null = 还没读;点按钮才触发。
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [loading, setLoading] = useState(false)

  const run = async () => {
    setLoading(true)
    try {
      const r = await lunaFetch(`/sessions/${sessionId}/review`)
      const d = await r.json()
      setNotes(d.notes || [])
    } catch {
      setNotes([])
    }
    setLoading(false)
  }

  // 还没读 → 只给一个按钮,经纪想听意见时才点(省一次 AI 调用)
  if (notes === null) {
    return (
      <button
        onClick={() => void run()}
        disabled={loading}
        className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-3 py-2.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-60"
      >
        {loading
          ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('lunaTour:lunaIsReadingThe')}</>
          : <><Sparkles className="h-3.5 w-3.5" /> {zh ? '让 Luna 读一遍，挑毛病' : 'Let Luna review this outline'}</>}
      </button>
    )
  }

  // 挑不出毛病 → 说一句就好，别硬凑（凑数的意见会让人把真正重要的一起划走）
  if (!notes.length) {
    return (
      <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-emerald-50/70 px-3 py-2 text-xs font-medium text-emerald-800 ring-1 ring-emerald-100">
        <span>✅ {t('lunaTour:lunaReadItNothing')}</span>
        <button onClick={() => void run()} disabled={loading} className="shrink-0 text-emerald-600 hover:text-emerald-800 disabled:opacity-50" title={zh ? '再读一遍' : 'Re-read'}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    )
  }

  return (
    <div className="mb-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-slate-600">
          {t('lunaTour:lunaSNotes', { notes_length: notes.length })}
        </div>
        <button onClick={() => void run()} disabled={loading} className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-700 disabled:opacity-50">
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> {zh ? '重读' : 'Re-read'}
        </button>
      </div>
      {notes.map((n, i) => {
        const tone = TONE[n.kind] ?? TONE.idea
        return (
          <div key={i} className={`rounded-xl p-3 ring-1 ${tone.ring} ${tone.bg}`}>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-sm leading-none">{tone.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-800">{n.title}</div>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{n.why}</p>
                {n.fix && onApplyFix && (
                  <button
                    onClick={() => onApplyFix(n.fix!)}
                    className="mt-2 inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-slate-700"
                  >
                    <Wand2 className="h-3 w-3" />
                    {t('lunaTour:letLunaFixIt')}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
