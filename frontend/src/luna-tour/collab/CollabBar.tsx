/**
 * Luna Collaborative Tour — minimal in-session control bar (§7).
 *
 * A translucent capsule pinned top-right (≈36px tall, never covers the map):
 *   • participant dots (initial + colour, from the socket's participants)
 *   • 💬 chat — toggles a light panel that slides up from the bottom; type to
 *     send, shows received chat (socket messages). Collapsed → takes no space.
 *   • 🎤 mute — DISABLED placeholder. In-app voice is phase 2 (Agora), not here.
 *   • viewer-only, when Free: a centered top pill「已脱离 · 回到 {presenter} 视角」
 *     → follow.returnToPresenter().
 *
 * Clean + collapsible, uses the existing accent (#00E0B8). No camera state here —
 * everything is React UI state from the socket; the camera is driven imperatively
 * elsewhere (performance hard rule).
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Send, X, Mic, MicOff, Phone, PhoneCall, PhoneOff, Loader2, MessageCircle } from 'lucide-react'
import type { ChatEntry, Participant } from './protocol'
import type { CollabVoiceApi } from './useCollabVoice'

const ACCENT = '#00E0B8'

export interface CollabBarProps {
  participants: Participant[]
  messages: ChatEntry[]
  /** local connId, to mark "you" + style own chat bubbles */
  myConnId: string | null
  /** display name used when sending chat */
  myName: string
  onSendChat: (text: string) => void
  /** presenter/peer display name (for the incoming-call banner) */
  presenterName?: string
  /** in-app voice (Agora). Omit → mic stays a disabled placeholder. */
  voice?: CollabVoiceApi
  /** viewer-only: presenter has voice on → show "answer call" prompt */
  voicePrompt?: boolean
  /** true for the presenter (drives call vs answer framing) */
  isPresenter?: boolean
}

function mmss(s: number): string {
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

function dotColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  return `hsl(${h}, 70%, 55%)`
}

function initial(name: string): string {
  const t = (name || '?').trim()
  return t ? t[0].toUpperCase() : '?'
}

export default function CollabBar({
  participants,
  messages,
  myConnId,
  myName,
  onSendChat,
  presenterName,
  voice,
  voicePrompt,
  isPresenter,
}: CollabBarProps) {
  const [chatOpen, setChatOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (chatOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, chatOpen])

  const send = () => {
    const text = draft.trim()
    if (!text) return
    onSendChat(text)
    setDraft('')
  }

  return createPortal(
    <>
      {/* in-session controls — fixed bottom-RIGHT corner (keep the map centre clear
          for drawing/markup). Portaled to <body> so they show on every page. */}
      <div className="fixed bottom-20 right-3 z-[2150] flex w-max items-center gap-2 md:bottom-6">
        <div className="flex h-9 items-center gap-2 rounded-full bg-slate-900/75 px-2.5 shadow-lg backdrop-blur">
          {/* participant dots */}
          <div className="flex -space-x-1.5">
            {participants.slice(0, 5).map((p) => (
              <div
                key={p.connId}
                title={`${p.name}${p.connId === myConnId ? '（你）' : ''} · ${p.role === 'presenter' ? '经纪' : '客户'}`}
                className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white ring-2 ring-slate-900/80"
                style={{ backgroundColor: dotColor(p.connId) }}
              >
                {initial(p.name)}
              </div>
            ))}
            {participants.length === 0 && (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-600 text-[11px] font-bold text-white ring-2 ring-slate-900/80">
                ·
              </div>
            )}
          </div>

          {/* chat toggle */}
          <button
            type="button"
            onClick={() => setChatOpen((v) => !v)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-200 transition hover:bg-white/10"
            title="聊天"
            style={chatOpen ? { color: ACCENT } : undefined}
          >
            <MessageCircle className="h-4 w-4" />
          </button>

          {/* in-app voice (Agora), framed as a phone CALL (not a mic). The mic icon
              only appears once connected, as the mute toggle — so it stays accurate. */}
          {!voice ? (
            <button
              type="button" disabled aria-disabled
              className="flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-full text-slate-500"
              title="语音通话（未启用）"
            >
              <Phone className="h-4 w-4" />
            </button>
          ) : voice.status === 'connecting' ? (
            <div className="flex h-7 items-center gap-1 px-1.5 text-[11px] text-slate-200" title="接通中…">
              <Loader2 className="h-4 w-4 animate-spin" /> 接通中
            </div>
          ) : voice.status === 'live' ? (
            <div className="flex items-center gap-1">
              <span className="flex items-center gap-1 rounded-full bg-white/10 px-1.5 text-[11px] font-medium tabular-nums text-slate-200" title="通话剩余时长（上限）">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" /> {mmss(voice.remainingSeconds)}
              </span>
              <button
                type="button" onClick={voice.toggleMute}
                className="flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-white/10"
                style={{ color: voice.muted ? '#f87171' : ACCENT }}
                title={voice.muted ? '已静音 · 点击说话' : '通话中 · 点击静音'}
              >
                {voice.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              <button
                type="button" onClick={voice.leave}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-500/90 text-white transition hover:bg-rose-500"
                title="挂断"
              >
                <PhoneOff className="h-4 w-4" />
              </button>
            </div>
          ) : voice.status === 'limit' ? (
            <div className="flex h-7 items-center gap-1 px-2 text-[11px] font-medium text-amber-300" title="今日语音已达上限">
              <Phone className="h-4 w-4 text-slate-400" /> 已达上限
            </div>
          ) : voicePrompt ? (
            // viewer: presenter is calling → prominent answer button
            <button
              type="button" onClick={voice.connect}
              className="flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold text-slate-900"
              style={{ backgroundColor: ACCENT }}
              title="接听经纪的语音通话"
            >
              <PhoneCall className="h-4 w-4" /> 接听
            </button>
          ) : (
            // presenter: start a call · viewer (no active call): waiting
            <button
              type="button" onClick={voice.connect}
              className="flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-slate-200 transition hover:bg-white/10"
              title={isPresenter ? '发起语音通话' : voice.status === 'error' ? '连接失败 · 重试' : '经纪还没开启语音'}
            >
              <Phone className="h-4 w-4" style={{ color: ACCENT }} />
              {isPresenter ? <span>语音通话</span> : <span className="text-slate-400">等待经纪</span>}
            </button>
          )}
        </div>
      </div>

      {/* viewer incoming-call banner — bottom-right, above the controls */}
      {voice && voicePrompt && voice.status !== 'live' && voice.status !== 'connecting' && (
        <div className="fixed bottom-32 right-3 z-[2150] w-max">
          <button
            type="button"
            onClick={voice.connect}
            className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-slate-900 shadow-xl transition hover:opacity-90"
            style={{ backgroundColor: ACCENT }}
          >
            <PhoneCall className="h-4 w-4 animate-pulse" />
            接听 {presenterName || '经纪'} 的语音通话
          </button>
        </div>
      )}

      {/* chat panel — opens above the control capsule (bottom-right) */}
      {chatOpen && (
        <div className="fixed bottom-32 right-3 z-[2150] flex w-[min(320px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl bg-slate-900/90 shadow-2xl backdrop-blur md:bottom-20">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
            <span className="text-sm font-semibold text-white">聊天</span>
            <button
              type="button"
              onClick={() => setChatOpen(false)}
              className="rounded-full p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={scrollRef} className="flex max-h-[40vh] min-h-[80px] flex-col gap-2 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div className="py-6 text-center text-xs text-slate-500">还没有消息，开始聊聊吧</div>
            )}
            {messages.map((m, i) => {
              const mine = m.from === myConnId
              return (
                <div key={i} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                  {!mine && <span className="mb-0.5 px-1 text-[10px] text-slate-400">{m.name}</span>}
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm ${
                      mine ? 'text-slate-900' : 'bg-white/10 text-slate-100'
                    }`}
                    style={mine ? { backgroundColor: ACCENT } : undefined}
                  >
                    {m.text}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2.5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder={`以 ${myName} 发言…`}
              className="min-w-0 flex-1 rounded-full bg-white/10 px-3.5 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-white/30"
            />
            <button
              type="button"
              onClick={send}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-slate-900 transition hover:opacity-90"
              style={{ backgroundColor: ACCENT }}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>,
    document.body,
  )
}
