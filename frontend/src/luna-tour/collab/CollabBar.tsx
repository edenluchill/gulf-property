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
import { Send, X, Mic, MicOff, PhoneOff, Loader2, MessageCircle } from 'lucide-react'
import type { ChatEntry, Participant } from './protocol'
import type { FollowMode } from './useCollabFollow'
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
  /** viewer follow state — omit for the presenter (no Free pill) */
  follow?: { mode: FollowMode; returnToPresenter: () => void }
  /** presenter display name for the "回到 X 视角" pill */
  presenterName?: string
  /** in-app voice (Agora). Omit → mic stays a disabled placeholder. */
  voice?: CollabVoiceApi
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
  follow,
  presenterName,
  voice,
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

  const isFree = follow?.mode === 'free'

  return (
    <>
      {/* viewer Free pill — centered top, taps back to following */}
      {isFree && follow && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1006]">
          <button
            type="button"
            onClick={follow.returnToPresenter}
            className="flex items-center gap-2 rounded-full bg-slate-900/90 px-4 py-2 text-sm font-medium text-white shadow-xl backdrop-blur transition hover:bg-slate-900"
          >
            <span className="text-slate-300">已脱离 ·</span>
            <span style={{ color: ACCENT }}>回到 {presenterName || '经纪'} 视角</span>
          </button>
        </div>
      )}

      {/* top-right capsule */}
      <div className="absolute top-3 right-3 z-[1006] flex items-center gap-2">
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

          {/* in-app voice (Agora). Without the voice prop it stays a disabled hint. */}
          {!voice ? (
            <button
              type="button"
              disabled
              aria-disabled
              className="flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-full text-slate-500"
              title="应用内语音（未启用）"
            >
              <Mic className="h-4 w-4" />
            </button>
          ) : voice.status === 'connecting' ? (
            <div className="flex h-7 w-7 items-center justify-center rounded-full text-slate-200" title="连接语音中…">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : voice.status === 'live' ? (
            <div className="flex items-center gap-1">
              <span className="rounded-full bg-white/10 px-1.5 text-[11px] font-medium tabular-nums text-slate-200" title="本场剩余时长（上限）">
                {mmss(voice.remainingSeconds)}
              </span>
              <button
                type="button"
                onClick={voice.toggleMute}
                className="flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-white/10"
                style={{ color: voice.muted ? '#f87171' : ACCENT }}
                title={voice.muted ? '已静音 · 点击说话' : '通话中 · 点击静音'}
              >
                {voice.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={voice.leave}
                className="flex h-7 w-7 items-center justify-center rounded-full text-rose-400 transition hover:bg-white/10"
                title="结束语音"
              >
                <PhoneOff className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={voice.connect}
              className="flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-slate-200 transition hover:bg-white/10"
              title={
                voice.status === 'limit' ? '本场/今日语音已达上限'
                : voice.status === 'unavailable' ? '语音未配置'
                : voice.status === 'no_session' ? '经纪还没开启语音'
                : voice.status === 'error' ? '语音连接失败 · 重试'
                : '开启语音通话'
              }
            >
              <Mic className="h-4 w-4" style={{ color: voice.status === 'limit' ? '#94a3b8' : ACCENT }} />
              {voice.status === 'limit' && <span className="text-amber-300">已达上限</span>}
              {voice.status === 'no_session' && <span className="text-slate-400">等待经纪</span>}
            </button>
          )}
        </div>
      </div>

      {/* chat panel — slides up from the bottom; collapsed takes no space */}
      {chatOpen && (
        <div className="absolute bottom-4 right-3 z-[1006] flex w-[300px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl bg-slate-900/90 shadow-2xl backdrop-blur">
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
    </>
  )
}
