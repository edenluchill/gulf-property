/**
 * 经纪产品教练面板 —— **教经纪怎么用这个系统**。
 *
 * 2026-08-11 owner 在真实 Luna 会话里看到经纪问：
 * 「我怎么样联系客人，我怎么样把这个软件发给客人。」
 *
 * 那类问题不该挤在 Luna 里 —— Luna 是**房产顾问**，对着客户说话。
 * 产品教学做成它的副业，就会变成 2026-08-10 那个故障：客户问房子、她背手册。
 *
 * 这里是文字的、给经纪的、能边看边点的：
 *   · 回答带**编号步骤**和**点哪里**（不是散文）
 *   · 主动说坑（导览默认是草稿这类）
 *   · 相关功能给**直达按钮**，别让人自己找
 *
 * 知识库与 Luna 共用 `backend/services/product-guide.ts`（唯一真相源）。
 */
import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { HelpCircle, X, Send, Loader2, ArrowRight, AlertTriangle } from 'lucide-react'
import { API_BASE_URL } from '../lib/config'
import { supabase } from '../lib/supabase'

interface CoachFeature {
  id: string
  name: string
  where: string
  caveat?: string
  cost?: string
  href?: string
}
interface Msg { role: 'user' | 'coach'; text: string; features?: CoachFeature[] }

/** 新手最常问的三件事 —— 直接给按钮，省得他先想「该问什么」。 */
const STARTERS = [
  { zh: '怎么把资料发给客户？', en: 'How do I send this to my client?' },
  { zh: '怎么和客户一起看地图？', en: 'How do I view the map together with a client?' },
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
      setMsgs(m => [...m, { role: 'coach', text: j.answer, features: j.features }])
    } catch {
      setMsgs(m => [...m, {
        role: 'coach',
        text: zh ? '暂时连不上，稍后再试一次。' : "Can't reach the coach right now — try again in a moment.",
      }])
    } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-24 end-4 z-[1200] flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-lg transition hover:border-teal-300 hover:text-teal-700 xl:bottom-6"
        aria-label={zh ? '怎么用' : 'How to use'}
      >
        <HelpCircle className="h-4 w-4 text-teal-600" />
        {zh ? '怎么用' : 'How to'}
      </button>
    )
  }

  return (
    <div className="fixed bottom-24 end-4 z-[1200] flex max-h-[70vh] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl xl:bottom-6">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-teal-600" />
          <span className="text-sm font-medium text-slate-800">{zh ? '怎么用这个系统' : 'How to use this'}</span>
        </div>
        <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {msgs.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">
              {zh ? '问我怎么操作 —— 我只讲这个系统里真实存在的功能，会告诉你点哪里，也会提醒容易踩的坑。'
                  : "Ask me how to do something. I only describe features that actually exist here, tell you where to click, and flag the gotchas."}
            </p>
            {STARTERS.map((s, i) => (
              <button key={i} onClick={() => ask(zh ? s.zh : s.en)}
                className="block w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-left text-xs text-slate-600 hover:border-teal-300 hover:bg-teal-50">
                {zh ? s.zh : s.en}
              </button>
            ))}
          </div>
        )}

        {msgs.map((m, i) => m.role === 'user' ? (
          <div key={i} className="ms-auto w-fit max-w-[85%] rounded-2xl rounded-ee-sm bg-teal-600 px-3 py-1.5 text-xs text-white">{m.text}</div>
        ) : (
          <div key={i} className="space-y-2">
            <div className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{m.text}</div>
            {m.features?.map(f => (
              <div key={f.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-800">{f.name}</span>
                  {f.href && (
                    <button onClick={() => { nav(f.href!); setOpen(false) }}
                      className="flex shrink-0 items-center gap-0.5 rounded bg-teal-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-teal-700">
                      {zh ? '去这里' : 'Go'} <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">{f.where}</p>
                {/* 坑要显眼 —— 这是人最容易栽的地方，比功能介绍值钱 */}
                {f.caveat && (
                  <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-700">
                    <AlertTriangle className="mt-px h-3 w-3 shrink-0" />{f.caveat}
                  </p>
                )}
                {f.cost && <p className="mt-0.5 text-[11px] text-slate-400">{f.cost}</p>}
              </div>
            ))}
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
          placeholder={zh ? '比如：客户看不到我发的导览？' : 'e.g. my client can\'t see the tour I sent'}
          className="max-h-24 flex-1 resize-none rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none"
        />
        <button onClick={() => ask(input)} disabled={!input.trim() || busy}
          className="rounded-full bg-teal-600 p-1.5 text-white disabled:bg-slate-200">
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
