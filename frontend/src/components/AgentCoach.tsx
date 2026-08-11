/**
 * 经纪产品教练面板 —— **教经纪怎么用这个系统**。
 *
 * 2026-08-11 owner 在真实 Luna 会话里看到经纪问：
 * 「我怎么样联系客人，我怎么样把这个软件发给客人。」
 * 那类问题不该挤在 Luna 里 —— Luna 是**房产顾问**，对着客户说话。
 *
 * ## 第二版：owner 对第一版的三条反馈，都在这里
 *
 * 1. **「感觉不好看」** —— 第一版渲染的是模型吐的 markdown，而项目里没有
 *    markdown 库，于是满屏 `**粗体**` 和裸星号。现在后端返回
 *    `{lead, steps[], caveats[]}` 结构化数据，这里画成真正的步骤卡。
 *
 * 2. **「每次都要等一会几秒，这些不是 standard 的吗」** —— 他是对的。
 *    后端现在对「怎么用 X」这类固定问题走**预置组装**（零 LLM），
 *    模型答案也缓存。这里把来源显示出来（⚡ 即时 / 想了一下），
 *    让人知道什么时候该等、什么时候不该等。
 *
 * 3. **「没有 animation 感觉很难 follow」** —— 步骤**逐条淡入**（每条差 90ms），
 *    序号是实心圆点，眼睛能跟着走。这不是装饰：一次性糊上来一整块文字，
 *    人根本不知道从哪读起。
 */
import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { HelpCircle, X, Send, Loader2, ArrowRight, AlertTriangle, Zap } from 'lucide-react'
import { API_BASE_URL } from '../lib/config'
import { supabase } from '../lib/supabase'

interface CoachFeature { id: string; name: string; where: string; caveat?: string; cost?: string; href?: string }
interface CoachStep { text: string; where: string | null }
interface CoachReply {
  lead: string
  steps: CoachStep[]
  caveats: string[]
  features: CoachFeature[]
  source?: string
  ms?: number
}
type Msg = { role: 'user'; text: string } | ({ role: 'coach' } & CoachReply)

/** 新手最常问的三件事 —— 直接给按钮，省得他先想「该问什么」。 */
const STARTERS = [
  { zh: '怎么把资料发给客户？', en: 'How do I send this to my client?' },
  { zh: '怎么和客户一起看地图？', en: 'How do I view the map with a client?' },
  { zh: '怎么做一份客户报告？', en: 'How do I make a client report?' },
]

export default function AgentCoach() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  const loc = useLocation()
  const zh = typeof document !== 'undefined' && document.documentElement.lang?.startsWith('zh')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  const ask = async (q: string) => {
    const question = q.trim()
    if (!question || busy) return
    setInput('')
    setMsgs(m => [...m, { role: 'user', text: question }])
    setBusy(true)
    try {
      const { data } = await supabase.auth.getSession()
      const res = await fetch(`${API_BASE_URL}/api/agent/coach`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}),
        },
        // path 让它能说「你现在这个页面上…」
        body: JSON.stringify({ question, language: zh ? 'zh' : 'en', path: loc.pathname }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const j = await res.json()
      setMsgs(m => [...m, {
        role: 'coach',
        lead: j.lead, steps: j.steps || [], caveats: j.caveats || [], features: j.features || [],
        source: j.debug?.source, ms: j.debug?.ms,
      }])
    } catch {
      setMsgs(m => [...m, {
        role: 'coach',
        lead: zh ? '暂时连不上，稍后再试一次。' : "Can't reach the coach right now — try again in a moment.",
        steps: [], caveats: [], features: [],
      }])
    } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-24 end-4 z-[1200] flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 shadow-lg transition hover:border-teal-300 hover:text-teal-700 xl:bottom-6"
        aria-label={zh ? '怎么用' : 'How to use'}
      >
        <HelpCircle className="h-4 w-4 text-teal-600" />
        {zh ? '怎么用' : 'How to'}
      </button>
    )
  }

  return (
    <div className="fixed bottom-24 end-4 z-[1200] flex max-h-[72vh] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl xl:bottom-6">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-teal-600" />
          <span className="text-sm font-medium text-slate-800">{zh ? '怎么用这个系统' : 'How to use this'}</span>
        </div>
        <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-400 hover:bg-slate-200/60" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-3.5 overflow-y-auto px-3.5 py-3">
        {msgs.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs leading-relaxed text-slate-500">
              {zh ? '问我怎么操作 —— 我只讲这个系统里真实存在的功能，会告诉你点哪里，也会提醒容易踩的坑。'
                  : "Ask me how to do something. I only describe features that actually exist here, tell you where to click, and flag the gotchas."}
            </p>
            {STARTERS.map((s, i) => (
              <button key={i} onClick={() => ask(zh ? s.zh : s.en)}
                className="block w-full rounded-lg border border-slate-200 px-2.5 py-2 text-left text-xs text-slate-600 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800">
                {zh ? s.zh : s.en}
              </button>
            ))}
          </div>
        )}

        {msgs.map((m, i) => m.role === 'user' ? (
          <div key={i} className="ms-auto w-fit max-w-[85%] rounded-2xl rounded-ee-sm bg-teal-600 px-3 py-1.5 text-xs text-white">{m.text}</div>
        ) : (
          <div key={i} className="space-y-2.5">
            {/* 结论 */}
            <p className="text-[13px] font-medium leading-relaxed text-slate-800">{m.lead}</p>

            {/* 步骤 —— 逐条淡入，眼睛跟着序号走 */}
            {m.steps.length > 0 && (
              <ol className="space-y-2">
                {m.steps.map((s, si) => (
                  <li
                    key={si}
                    className="coach-step flex gap-2.5"
                    style={{ animationDelay: `${si * 90}ms` }}
                  >
                    <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-teal-600 text-[10px] font-bold text-white">
                      {si + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs leading-relaxed text-slate-700">{s.text}</p>
                      {s.where && <p className="mt-0.5 text-[11px] leading-snug text-slate-400">📍 {s.where}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {/* 坑 —— 比功能介绍值钱，单独画 */}
            {m.caveats.map((c, ci) => (
              <div key={ci} className="coach-step flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5"
                style={{ animationDelay: `${(m.steps.length + ci) * 90}ms` }}>
                <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-amber-600" />
                <p className="text-[11px] leading-relaxed text-amber-800">{c}</p>
              </div>
            ))}

            {/* 直达 */}
            {m.features.filter(f => f.href).map(f => (
              <button key={f.id} onClick={() => { nav(f.href!); setOpen(false) }}
                className="coach-step flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-left transition hover:border-teal-400 hover:bg-teal-50"
                style={{ animationDelay: `${(m.steps.length + m.caveats.length) * 90}ms` }}>
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-slate-800">{f.name}</span>
                  <span className="block truncate text-[11px] text-slate-400">{f.where}</span>
                </span>
                <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-teal-700">
                  {zh ? '去这里' : 'Go'} <ArrowRight className="h-3 w-3" />
                </span>
              </button>
            ))}

            {/* 来源 —— 让人知道什么时候该等、什么时候不该等 */}
            {m.source && (
              <p className="text-[10px] text-slate-300">
                {m.source === 'preset' || m.source === 'cache'
                  ? <span className="inline-flex items-center gap-0.5"><Zap className="h-2.5 w-2.5" />{zh ? '即时' : 'instant'}</span>
                  : `${zh ? '想了' : 'thought for '}${Math.round((m.ms || 0) / 100) / 10}s`}
              </p>
            )}
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Loader2 className="h-3 w-3 animate-spin" />{zh ? '想一下…' : 'Thinking…'}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-end gap-1.5 border-t border-slate-100 p-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input) } }}
          rows={1}
          placeholder={zh ? '比如：客户看不到我发的导览？' : "e.g. my client can't see the tour I sent"}
          className="max-h-24 flex-1 resize-none rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none"
        />
        <button onClick={() => ask(input)} disabled={!input.trim() || busy}
          className="rounded-full bg-teal-600 p-1.5 text-white transition disabled:bg-slate-200">
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
