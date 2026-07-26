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
import { useTranslation } from 'react-i18next'
import { Send, X, Mic, MicOff, Phone, PhoneCall, PhoneOff, Loader2, MessageCircle, Globe, Video, VideoOff, SwitchCamera } from 'lucide-react'
import type { ChatEntry, Participant } from './protocol'
import type { FollowMode } from './useCollabFollow'
import type { CollabVoiceApi } from './useCollabVoice'
import { MAX_VIDEO_VIEWERS } from './useCollabVoice'

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
  // ── merged session-bar controls (one unified bottom bar) ──────────────────
  followMode?: FollowMode
  onDetach?: () => void
  onReturnToPresenter?: () => void
  offMap?: boolean
  onReturnToMap?: () => void
  onExit?: () => void
  /** presenter-only:点参与者头像可踢出(自己以外)。 */
  onKick?: (connId: string) => void
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
  followMode,
  onDetach,
  onReturnToPresenter,
  offMap,
  onReturnToMap,
  onExit,
  onKick,
}: CollabBarProps) {
  const { t: tRaw, i18n } = useTranslation('lunaTour')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const zh = (i18n.language || 'en').startsWith('zh')
  const toggleLang = () => i18n.changeLanguage(zh ? 'en' : 'zh-CN')
  const isFree = followMode === 'free'
  const [chatOpen, setChatOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  /**
   * 🔴 **未读红点。**
   *
   * owner:「聊天发信息不会有红点显示告诉客户有人聊天,或者客户聊天留信息,经纪那里
   *        也不会显示有信息。**在对话 button 上面加个几个信息的点就够了。**」
   *
   * 之前:消息**静悄悄地进到一个折叠面板里** —— 两边都不知道对方说了话。
   * 一场带看里最要命的沉默,就是「他问了,我没看见」。
   *
   * 口径(故意做到最简,就按 owner 说的「加个点就够了」):
   *   • 只数**别人**发的(自己发的不算未读)
   *   • 面板**开着**时不累计 —— 他正在看
   *   • 一打开就清零
   */
  const [readCount, setReadCount] = useState(messages.length)
  // ChatEntry.from = 发送者的 connId
  const othersCount = messages.filter((m) => m.from !== myConnId).length
  const unread = chatOpen ? 0 : Math.max(0, othersCount - readCount)

  useEffect(() => {
    if (chatOpen) {
      setReadCount(othersCount)   // 打开 = 看过了
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, chatOpen, othersCount])

  const send = () => {
    const text = draft.trim()
    if (!text) return
    onSendChat(text)
    setDraft('')
  }

  return createPortal(
    <>
      {/* ONE unified in-session bar, bottom-centre, above the app nav. Viewer is
          chromeless (no nav) → hug the edge; presenter clears the mobile nav.
          Portaled to <body> so it shows on every page. */}
      {/* 底栏定位:
          • safe-area-inset-bottom —— 手机浏览器底部 UI(Safari 地址栏/手势条)会盖住
            裸的 bottom-4。客户全在手机上,这条必须守。
          • max-w 留 0.75rem 边距 + overflow-x-auto —— 装不下就横向滚,不溢出屏幕。
          • ⚠️ 内部每个按钮都必须 shrink-0:否则 flex 会在挤不下时**压扁**它们
            (图标变形、互相叠住),这比横向滚动难看得多。 */}
      <div
        className="fixed left-1/2 z-[2150] flex w-max max-w-[calc(100vw-0.75rem)] -translate-x-1/2 items-center"
        style={{ bottom: `calc(env(safe-area-inset-bottom, 0px) + ${isPresenter ? '5rem' : '1rem'})` }}
      >
        <div className="flex h-9 items-center gap-1 overflow-x-auto rounded-full bg-slate-900/85 px-2 shadow-lg ring-1 ring-white/10 backdrop-blur scrollbar-hide sm:gap-1.5 sm:px-2.5">
          {/* live status */}
          <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full" style={{ backgroundColor: isFree ? '#94a3b8' : ACCENT }} />
          {/* viewer follow / detach toggle */}
          {!isPresenter && onDetach && (isFree ? (
            <button type="button" onClick={onReturnToPresenter} className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold text-slate-900" style={{ backgroundColor: ACCENT }}>{t('lunaTour:rejoin')}</button>
          ) : (
            <button type="button" onClick={onDetach} className="shrink-0 rounded-full px-2 py-0.5 text-xs text-white ring-1 ring-white/25 transition hover:bg-white/10">{t('lunaTour:explore')}</button>
          ))}
          {offMap && onReturnToMap && (
            <button type="button" onClick={onReturnToMap} className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium text-slate-900" style={{ backgroundColor: ACCENT }}>{t('lunaTour:map')}</button>
          )}
          <span className="mx-0.5 h-4 w-px shrink-0 bg-white/10" />
          {/* participant dots */}
          <div className="flex shrink-0 -space-x-1.5">
            {participants.slice(0, 5).map((p) => {
              const label = `${p.name}${p.connId === myConnId ? '（你）' : ''} · ${p.role === 'presenter' ? '经纪' : '客户'}`
              const canKick = !!onKick && p.role === 'viewer' && p.connId !== myConnId
              if (!canKick) {
                return (
                  <div
                    key={p.connId}
                    title={label}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white ring-2 ring-slate-900/80"
                    style={{ backgroundColor: dotColor(p.connId) }}
                  >
                    {initial(p.name)}
                  </div>
                )
              }
              return (
                <button
                  key={p.connId}
                  onClick={() => { if (window.confirm(`把「${p.name}」移出这场带看?`)) onKick!(p.connId) }}
                  title={`${label} · 点击移出`}
                  className="group relative flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white ring-2 ring-slate-900/80 transition hover:ring-rose-400"
                  style={{ backgroundColor: dotColor(p.connId) }}
                >
                  {initial(p.name)}
                  <span className="pointer-events-none absolute -end-1 -top-1 hidden h-3 w-3 items-center justify-center rounded-full bg-rose-500 text-[8px] font-bold leading-none text-white group-hover:flex">×</span>
                </button>
              )
            })}
            {participants.length === 0 && (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-600 text-[11px] font-bold text-white ring-2 ring-slate-900/80">
                ·
              </div>
            )}
          </div>

          {/* chat toggle —— 带未读红点(owner:「加个点就够了」) */}
          <button
            type="button"
            onClick={() => setChatOpen((v) => !v)}
            className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-200 transition hover:bg-white/10"
            title={unread > 0 ? `${unread} 条新消息` : '聊天'}
            style={chatOpen ? { color: ACCENT } : undefined}
          >
            <MessageCircle className="h-4 w-4" />
            {unread > 0 && (
              <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-slate-900">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {/* in-app voice (Agora), framed as a phone CALL (not a mic). The mic icon
              only appears once connected, as the mute toggle — so it stays accurate. */}
          {!voice ? (
            <button
              type="button" disabled aria-disabled
              className="flex h-7 w-7 shrink-0 cursor-not-allowed items-center justify-center rounded-full text-slate-500"
              title="语音通话（未启用）"
            >
              <Phone className="h-4 w-4" />
            </button>
          ) : voice.status === 'connecting' ? (
            <div className="flex h-7 shrink-0 items-center gap-1 px-1.5 text-[11px] text-slate-200" title="接通中…">
              <Loader2 className="h-4 w-4 animate-spin" /> 接通中
            </div>
          ) : voice.status === 'live' ? (
            <div className="flex shrink-0 items-center gap-1">
              {/* 通话无限时长(2026-07-26 owner 定,成本按积分计量刹车)—— 不再显示倒计时,
                  只留一个「通话中」呼吸点。额度快没了由经纪专属的 videoNotice 提示。 */}
              <span className="hidden items-center gap-1 rounded-full bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-slate-200 sm:flex" title="通话中">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" /> 通话中
              </span>
              <button
                type="button" onClick={voice.toggleMute}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition hover:bg-white/10"
                style={{ color: voice.muted ? '#f87171' : ACCENT }}
                title={voice.muted ? '已静音 · 点击说话' : '通话中 · 点击静音'}
              >
                {voice.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              {/* 摄像头(presenter 专属)—— 客户端永远不显示,他们不需要开摄像头。
                  额度/人数不足时置灰并说明原因,绝不静默失效。 */}
              {isPresenter && (
                <>
                  <button
                    type="button"
                    onClick={voice.videoBlock ? undefined : voice.toggleCamera}
                    disabled={!!voice.videoBlock}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition ${
                      voice.videoBlock ? 'cursor-not-allowed text-slate-500' : 'hover:bg-white/10'
                    }`}
                    style={!voice.videoBlock ? { color: voice.cameraOn ? ACCENT : '#cbd5e1' } : undefined}
                    title={
                      voice.videoBlock === 'quota' ? '视频额度已用完（语音不受影响）'
                        : voice.videoBlock === 'viewers' ? `观看人数超过 ${MAX_VIDEO_VIEWERS} 人，无法开视频`
                        : voice.videoBlock === 'upgrade' ? '升级套餐可用带看视频'
                        : voice.cameraOn ? '关闭摄像头'
                        // -1 = 无限(owner/白名单)。别显示「剩余 -1 分钟」。
                        : voice.videoFreeLeft < 0 ? '开摄像头（无限额度）'
                        : `开摄像头 · 本月剩余 ${voice.videoFreeLeft} 分钟`
                    }
                  >
                    {voice.cameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                  </button>
                  {voice.cameraOn && (
                    <button
                      type="button" onClick={voice.flipCamera} disabled={voice.flipping}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
                      title={voice.facing === 'environment' ? '切到前置（自拍）' : '切到后置（拍沙盘）'}
                    >
                      <SwitchCamera className="h-4 w-4" />
                    </button>
                  )}
                </>
              )}
              <button
                type="button" onClick={voice.leave}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-500/90 text-white transition hover:bg-rose-500"
                title="挂断"
              >
                <PhoneOff className="h-4 w-4" />
              </button>
            </div>
          ) : voice.status === 'limit' ? (
            // 无限时长后,'limit' 只可能来自积分耗尽的 stopCall(不再是时间到)
            <div className="flex h-7 shrink-0 items-center gap-1 px-2 text-[11px] font-medium text-amber-300" title="通话额度已用完">
              <Phone className="h-4 w-4 text-slate-400" /> 额度用完
            </div>
          ) : voicePrompt ? (
            // viewer: presenter is calling → prominent answer button
            <button
              type="button" onClick={voice.connect}
              className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold text-slate-900"
              style={{ backgroundColor: ACCENT }}
              title="接听经纪的语音通话"
            >
              <PhoneCall className="h-4 w-4" /> 接听
            </button>
          ) : (
            // presenter: start a call · viewer (no active call): waiting
            <button
              type="button" onClick={voice.connect}
              className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-slate-200 transition hover:bg-white/10"
              title={isPresenter ? '发起语音通话' : voice.status === 'error' ? '连接失败 · 重试' : '经纪还没开启语音'}
            >
              <Phone className="h-4 w-4" style={{ color: ACCENT }} />
              {isPresenter
                ? <span className="hidden sm:inline">语音通话</span>
                : <span className="hidden text-slate-400 sm:inline">等待经纪</span>}
            </button>
          )}

          {/* language + exit (merged in from the old separate session bar) */}
          <span className="mx-0.5 h-4 w-px shrink-0 bg-white/10" />
          <button
            type="button"
            onClick={toggleLang}
            className="flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs text-slate-200 transition hover:bg-white/10"
            title={t('lunaTour:switchLanguage')}
          >
            <Globe className="h-3.5 w-3.5" /> {t('lunaTour:en')}
          </button>
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              className="shrink-0 rounded-full px-2 py-0.5 text-xs text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              {isPresenter ? (t('lunaTour:end')) : (t('lunaTour:leave'))}
            </button>
          )}
        </div>
      </div>

      {/* 视频额度提示 —— **只给经纪看**。客户看到「经纪额度不够」是难堪的,
          所以严格 isPresenter 门控。8 秒自动消失,也可手动关。 */}
      {isPresenter && voice?.videoNotice && (
        <div className="fixed left-1/2 z-[2160] w-[min(360px,calc(100vw-1.5rem))] -translate-x-1/2"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8rem)' }}>
          <div className="flex items-start gap-2 rounded-xl bg-amber-500/95 px-3 py-2 text-[12px] font-medium leading-snug text-amber-950 shadow-xl">
            <Video className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{voice.videoNotice}</span>
            <button type="button" onClick={voice.dismissVideoNotice} className="shrink-0 rounded p-0.5 transition hover:bg-black/10">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* viewer incoming-call banner — bottom-right, above the controls */}
      {voice && voicePrompt && voice.status !== 'live' && voice.status !== 'connecting' && (
        <div className="fixed left-1/2 z-[2150] w-max max-w-[calc(100vw-1.5rem)] -translate-x-1/2"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 4rem)' }}>
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
        <div
          className="fixed left-1/2 z-[2150] flex w-[min(320px,calc(100vw-1.5rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl bg-slate-900/90 shadow-2xl backdrop-blur"
          style={{ bottom: `calc(env(safe-area-inset-bottom, 0px) + ${isPresenter ? '8rem' : '4rem'})` }}
        >
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
