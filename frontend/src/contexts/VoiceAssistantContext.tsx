/**
 * Voice Assistant Context
 *
 * Phase-based voice assistant with transient bubble UI:
 * - Single-tap: idle → connect + auto-mic (VAD mode)
 * - Single-tap again: deactivate everything
 * - Gemini handles VAD turn detection (always-on mic)
 * - Latest assistant message shown as transient bubble (auto-fade 8s)
 * - 200ms throttled bubble updates for transcription fragments
 * - Auto-reconnect with exponential backoff (3 attempts)
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  ReactNode
} from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { GoogleGenAI, Modality, LiveServerMessage, StartSensitivity, EndSensitivity } from '@google/genai'
import {
  VoicePhase,
  BubbleContent,
  MapAction,
  MessageAttachment
} from '../hooks/voice-assistant/types'
import { AudioRecorder, AudioPlayer } from '../hooks/voice-assistant/audioUtils'
import { buildBubbleAttachment } from '../hooks/voice-assistant/buildAttachment'
import { voiceDebugLogger } from '../hooks/voice-assistant/debugLogger'
import { trackEvent, visitorId } from '../lib/track'
import { reportMetric } from '../lib/telemetry'
import { useAuth } from './AuthContext'

// ── Live 语音的成本上报 ─────────────────────────────────────────────────────
// 后端**不在这条链路上**(浏览器直连 Gemini Live),所以服务端永远拿不到
// usageMetadata。不从这里报,Luna 语音在成本看板上就是一个 0 —— 而它用的
// native-audio 模型,音频输出单价是文本的 6 倍,大概率是单位时间最贵的一项。
//
// usageMetadata 是**按连接累计**的(重连归零),所以按 (dir,modality) 记住上次的
// 累计值、只报增量。钱在**后端**按单价算 —— 客户端只报 token 数。
const liveSeen = new Map<string, number>()

/** 新连接 → Gemini 的累计计数从 0 重新开始。 */
function resetLiveUsage(): void { liveSeen.clear() }

function reportLiveUsage(u: LiveServerMessage['usageMetadata']): void {
  try {
    if (!u) return
    const send = (dir: 'in' | 'out', modality: string, total: number) => {
      const key = `${dir}:${modality}`
      const delta = Math.max(0, total - (liveSeen.get(key) || 0))
      liveSeen.set(key, total)
      if (delta > 0) reportMetric('rum.luna_live.tokens', delta, { dir, modality })
    }
    type Detail = { modality?: string; tokenCount?: number }
    const dirs: Array<['in' | 'out', Detail[] | undefined, number | undefined]> = [
      ['in', u.promptTokensDetails as Detail[] | undefined, u.promptTokenCount ?? undefined],
      ['out', u.responseTokensDetails as Detail[] | undefined, u.responseTokenCount ?? undefined],
    ]
    for (const [dir, details, fallbackTotal] of dirs) {
      if (details?.length) {
        // 同一模态可能出现多条 → 先合并再比对累计值
        const byModality = new Map<string, number>()
        for (const d of details) {
          const m = (d.modality || 'text').toLowerCase()
          byModality.set(m, (byModality.get(m) || 0) + (d.tokenCount || 0))
        }
        for (const [m, n] of byModality) send(dir, m === 'audio' ? 'audio' : 'text', n)
      } else if (fallbackTotal != null) {
        // 拆不出模态时,语音会话按音频算 —— 宁可高估也别把最贵的一项记成文本价
        send(dir, 'audio', fallbackTotal)
      }
    }
  } catch { /* 静默:埋点绝不能影响通话 */ }
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000'
// 兜底值。**真正生效的是后端 /api/voice/token 返回的 model** ——
// 模型名的单一真相源在 backend/src/services/ai/models.ts 的 LIVE_AUDIO,
// 这样换模型不用发前端。这里只在 token 没带 model 时用。
const GEMINI_MODEL_FALLBACK = 'gemini-3.1-flash-live-preview'
const BUBBLE_FLUSH_MS = 200
const AUTO_RECONNECT_MAX = 3
const AUTO_RECONNECT_BASE_MS = 1000
// A conversation record ends after 5 min of no activity (or on page close); tap-close
// only disconnects so a re-open within this window is the SAME record.
const CONVO_IDLE_MS = 5 * 60 * 1000
// TOKEN-based daily quota. Luna is metered by Gemini Live tokens consumed per Dubai
// calendar day (persisted in localStorage). Anonymous gets a smaller budget → prompt
// login; logged-in free tier gets a larger budget → prompt upgrade. Resets at Dubai
// midnight.
const ANON_DAILY_TOKENS = 250_000   // not-logged-in daily budget (~10 min of voice; tune on real use)
const FREE_DAILY_TOKENS = 700_000   // logged-in free tier daily budget (~2.5–3× anon)
const LUNA_QUOTA_KEY = 'pinzos_luna_quota'  // { day: 'YYYY-MM-DD' (Dubai), tokens: number }
// Dubai (GST, UTC+4, no DST) calendar day + ms until next Dubai midnight.
const dubaiDayKey = () => new Date(Date.now() + 4*3600e3).toISOString().slice(0, 10)
const msUntilDubaiReset = () => { const s = Date.now() + 4*3600e3; return Math.ceil(s/86400e3)*86400e3 - s }
const getDailyTokens = () => { try { const q = JSON.parse(localStorage.getItem(LUNA_QUOTA_KEY) || '{}'); return q.day === dubaiDayKey() ? (q.tokens || 0) : 0 } catch { return 0 } }
const setDailyTokens = (n:number) => { try { localStorage.setItem(LUNA_QUOTA_KEY, JSON.stringify({ day: dubaiDayKey(), tokens: Math.max(0, Math.round(n)) })) } catch {} }
const addDailyTokens = (delta:number) => setDailyTokens(getDailyTokens() + Math.max(0, delta))

// 🔴 **工具声明不再写在前端。**
//
// 后端 `/api/voice/token` 随 token 一起下发完整的 23 个声明
// (`backend/src/services/luna-live-manifest.ts`)。理由见那个文件顶部:
// **工具的 description 就是模型的能力清单** —— 2026-08-10 我把 17 个具体工具
// 砍成一个抽象的 `ask_luna`,Live 从「语义匹配」被迫改做「元判断」,
// 于是它开始不查就自己答(owner 看到的「AI 说能卖二手房」)。
//
// 现在 Live 重新看到 get_investment_breakdown / rent_vs_buy / purchase_costs …
// 但**执行全部走 Brain**:下面的 executeTool 统一拦截,把它想调的工具名
// 当作**意图信号**转给 `/api/voice/tools/ask`,由 Brain 决定真正调什么。
//
// 好处:三处声明漂移(前端/后端/跑分)的老毛病到此为止 ——
// 见 memory `voice-tool-declaration-drift`。
//
// ⚠️ 只有 capture_contact 仍在前端直连(纯写库,不查数据),它也来自同一份 manifest。
// (capture_contact 在 executeTool 里按名字直接分支处理,不需要单独的集合)

export interface TextMsg { id: string; role: 'user' | 'assistant'; text: string; attachment?: MessageAttachment }

interface VoiceAssistantContextType {
  // Phase-based state
  phase: VoicePhase
  latestBubble: BubbleContent | null
  toolStatus: string | null
  userTranscript: string   // live caption of the user's own speech

  // Actions
  activate: () => Promise<void>
  deactivate: () => void

  // Map action handler registration (for MapPage)
  registerMapActionHandler: (handler: (action: MapAction) => void) => void
  unregisterMapActionHandler: () => void

  // Navigate to project
  navigateToProject: (projectId: string) => void
  dismissBubble: () => void
  // Token-based daily quota gate. Non-null → show the modal; reason drives the CTA
  // (anon → login, upgrade → pricing). resetMs = ms until the Dubai-midnight reset.
  lunaGate: { reason: 'anon' | 'upgrade'; resetMs: number } | null
  dismissGate: () => void
  // Reactive gauge data (used / daily limit / remaining / percent used).
  lunaQuota: { used: number; limit: number; remaining: number; pct: number }
  // True in a shared tour (/v/:code, /t/:code, ?toursession) — Luna is unmetered there.
  quotaExempt: boolean

  // Text mode (方案 B): typed input, audio-free, separate from voice.
  textOpen: boolean
  openText: () => void
  closeText: () => void
  sendText: (text: string) => Promise<void>
  textPending: boolean
  textThread: TextMsg[]

  // Hide the global Luna pill (e.g. during a collab live tour)
  hidden: boolean
  setHidden: (v: boolean) => void
}

const VoiceAssistantContext = createContext<VoiceAssistantContextType | null>(null)

export function VoiceAssistantProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { i18n } = useTranslation()
  const { user } = useAuth()

  // Token-based daily quota: anonymous gets ANON_DAILY_TOKENS/day, logged-in free tier
  // gets FREE_DAILY_TOKENS/day. Usage accrues from Gemini Live usageMetadata deltas.
  const loggedInRef = useRef(false)
  loggedInRef.current = !!user
  // Shared-tour exemption: when a recipient opens an agent-shared Luna Tour (/v/:code),
  // collab live tour (/t/:code) or the homepage tour form (?toursession=), Luna must be
  // FULLY unlimited — no quota, no login/upgrade prompt. That's the agent's demo, not a
  // free-tier visitor burning their own allowance.
  const quotaExemptRef = useRef(false)
  quotaExemptRef.current =
    location.pathname.startsWith('/v/') ||
    location.pathname.startsWith('/t/') ||
    new URLSearchParams(location.search).has('toursession')
  // Last CUMULATIVE totalTokenCount seen on the current WS connection (resets to 0 on
  // reconnect → we track deltas). onopen resets this.
  const lastConnTokensRef = useRef(0)
  const [quotaUsed, setQuotaUsed] = useState(() => getDailyTokens()) // reactive gauge value
  // Non-null → show the quota modal. reason: 'anon' (prompt login) | 'upgrade' (prompt pricing).
  const [lunaGate, setLunaGate] = useState<{ reason: 'anon' | 'upgrade'; resetMs: number } | null>(null)
  const dailyLimit = useCallback(() => (loggedInRef.current ? FREE_DAILY_TOKENS : ANON_DAILY_TOKENS), [])
  const overLimit = useCallback(() => !quotaExemptRef.current && getDailyTokens() >= dailyLimit(), [dailyLimit])
  const openGate = useCallback(() => setLunaGate({ reason: loggedInRef.current ? 'upgrade' : 'anon', resetMs: msUntilDubaiReset() }), [])
  const dismissGate = useCallback(() => setLunaGate(null), [])

  // Phase-based state
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [latestBubble, setLatestBubble] = useState<BubbleContent | null>(null)
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  // Live caption of the USER's own speech (so they can see what they're saying)
  const [userTranscript, setUserTranscript] = useState<string>('')

  // Text mode: a running thread for THIS open session (scrollable history; cleared on
  // close — that's fine per product). Luna's reply STREAMS into the current assistant
  // message so text appears progressively; the panel is fixed-height + scrolls so it
  // never grows with the text.
  const [textOpen, setTextOpen] = useState(false)
  const [textPending, setTextPending] = useState(false)
  const [textThread, setTextThread] = useState<TextMsg[]>([])
  const turnAsstIdRef = useRef<string | null>(null) // id of the assistant msg for the current turn
  // Text mode reuses the SAME voice Live session but: no mic, no audio playback, and
  // Luna's words route to the panel (lastExchange) instead of the voice bubble. Every
  // voice-path change is guarded by this ref; when false the voice flow is byte-identical.
  const textModeRef = useRef(false)
  // Set in an effect after activate() is defined so sendText (defined earlier) can call
  // it without a TDZ error — mirrors the startRecordingRef pattern below.
  const activateRef = useRef<(() => Promise<void>) | null>(null)

  // Refs
  const sessionRef = useRef<any>(null)
  const connectingRef = useRef(false)
  const recorderRef = useRef<AudioRecorder | null>(null)
  const playerRef = useRef<AudioPlayer | null>(null)
  const mapActionHandlerRef = useRef<((action: MapAction) => void) | null>(null)
  // Half-duplex: true while Luna is speaking. We don't forward mic audio then, so her
  // own voice (picked up by the speaker→mic path) can't trigger a false interruption.
  const lunaSpeakingRef = useRef(false)
  const pendingActionRef = useRef<MapAction | null>(null)
  const systemInstructionRef = useRef<string>('')
  const startRecordingRef = useRef<(() => Promise<void>) | null>(null)

  // Live user-speech caption: accumulate this utterance; userTurnFreshRef flips true
  // after the assistant speaks so the NEXT user words start a fresh caption.
  const userTextAccumRef = useRef<string>('')
  const userTurnFreshRef = useRef<boolean>(true)
  // Latency diagnostics: stamp when this turn's user speech is first/last seen so we
  // can print the exact gap to Luna's first reply token in the console.
  const turnUserFirstTsRef = useRef<number>(0)
  // 这一轮 Luna 有没有问过 Brain,以及问出了哪些工具。
  // 上报给 /tools/turn —— **没问 Brain 就开口的轮次是幻觉高危区**,
  // 后端只有靠这个才看得见它们。
  const turnAskedBrainRef = useRef<boolean>(false)
  const turnToolsRef = useRef<string[]>([])
  /** 后端下发的 Live 模型名（换模型不用发前端）。 */
  const liveModelRef = useRef<string>('')
  /** 后端下发的工具声明（唯一真相源，随 /api/voice/token 返回）。 */
  const liveToolsRef = useRef<Array<{ name: string; description: string; parameters?: unknown }>>([])
  /** 这一轮客户实际说的话 —— 转给 Brain 当 question，比模型的转述可靠。 */
  const turnUserSaidRef = useRef<string>('')
  /** 客户说完 → Luna 第一个音（体感延迟）。落库用。 */
  const turnFirstAudioMsRef = useRef<number>(0)
  /** 客户说了多久。 */
  const turnUserSpeechMsRef = useRef<number>(0)
  /** Live 这一轮想调的工具（意图信号），上报用。 */
  const turnIntendedToolRef = useRef<string>('')
  const turnUserLastTsRef = useRef<number>(0)
  const turnReplyLoggedRef = useRef<boolean>(false)

  // Bubble accumulation: collect fragments, flush at most every 200ms
  const assistantTextAccumRef = useRef<string>('')
  const pendingAttachmentRef = useRef<MessageAttachment | null>(null)
  const stickyAttachmentRef = useRef<MessageAttachment | null>(null) // persists across turns
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFlushRef = useRef<number>(0)

  // Auto-reconnect
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intentionalDisconnectRef = useRef(false)
  // Idle-finalize timer: a conversation record ends after CONVO_IDLE_MS of no activity.
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Gemini Live session resumption: the server periodically sends a handle that
  // captures full conversation state. We keep the latest so a reconnect resumes
  // WITH context (Luna doesn't forget). Cleared on a fresh, user-initiated open.
  const resumeHandleRef = useRef<string | null>(null)

  const currentLanguage = i18n.language?.startsWith('zh') ? 'zh' : 'en'

  // ─── Conversation record lifecycle (separate from the WebSocket connection) ───
  // "Disconnect" tears down the socket; "finalize" persists the debug session (= ends
  // the record). Tapping the pill to close only disconnects — the record is finalized
  // ONLY by the idle timer or pagehide, so a re-open within CONVO_IDLE_MS resumes the
  // SAME record. Placed early so handleMessage/activate/deactivate can call them TDZ-free.
  const endConversationNow = useCallback(() => {
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null }
    intentionalDisconnectRef.current = true
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
    recorderRef.current?.stop()
    recorderRef.current = null
    playerRef.current?.stop()
    sessionRef.current?.close?.()
    sessionRef.current = null
    connectingRef.current = false
    voiceDebugLogger.endSession()
    setPhase('idle')
    setLatestBubble(null) // clear any lingering reply so it doesn't block the map
    setToolStatus(null)
  }, [])

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null }
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null
      endConversationNow()
    }, CONVO_IDLE_MS)
  }, [endConversationNow])

  // Tool display names
  //
  // 表里除 ask_luna / capture_contact 外的名字现在由**后端 Brain** 内部调用,
  // Live 层已经看不到它们了(2026-08-10 两层架构)。留着是因为文字模式和
  // 回放视图仍按工具名显示状态 —— 删了那两处会掉成 "Processing..."。
  const getToolDisplayName = useCallback((toolName: string): string => {
    const names: Record<string, string> = {
      'ask_luna': currentLanguage === 'zh' ? '查询中...' : 'Looking that up...',
      'search_projects': currentLanguage === 'zh' ? '搜索项目中...' : 'Searching projects...',
      'fly_to_area': currentLanguage === 'zh' ? '定位区域中...' : 'Locating area...',
      'get_area_info': currentLanguage === 'zh' ? '获取区域信息...' : 'Getting area info...',
      'compare_areas': currentLanguage === 'zh' ? '对比区域中...' : 'Comparing areas...',
      'show_nearby_pois': currentLanguage === 'zh' ? '显示周边设施...' : 'Showing nearby places...',
      'navigate_to_project': currentLanguage === 'zh' ? '打开项目详情...' : 'Opening project...',
      'reset_map': currentLanguage === 'zh' ? '重置地图...' : 'Resetting map...',
      'recommend_by_budget': currentLanguage === 'zh' ? '按预算分析中...' : 'Analyzing by budget...',
      'get_investment_breakdown': currentLanguage === 'zh' ? '计算投资回报...' : 'Crunching ROI...',
      'compare_market': currentLanguage === 'zh' ? '对比市场数据...' : 'Comparing market...',
      'area_investment_report': currentLanguage === 'zh' ? '生成投资报告...' : 'Building report...',
      'check_affordability': currentLanguage === 'zh' ? '测算可负担...' : 'Checking affordability...',
      'project_value_check': currentLanguage === 'zh' ? '对标片区价格...' : 'Checking value...',
      'purchase_costs': currentLanguage === 'zh' ? '计算购房费用...' : 'Calculating costs...',
      'rent_vs_buy': currentLanguage === 'zh' ? '对比租与买...' : 'Rent vs buy...'
    }
    return names[toolName] || (currentLanguage === 'zh' ? '处理中...' : 'Processing...')
  }, [currentLanguage])

  // Flush accumulated assistant text to bubble
  const flushBubble = useCallback(() => {
    // Text mode: STREAM Luna's words into the current assistant message so text
    // appears progressively (慢慢显示). The panel is fixed-height + scrolls, so it
    // never grows with the text. Throttled to BUBBLE_FLUSH_MS.
    if (textModeRef.current) {
      const id = turnAsstIdRef.current
      if (id) {
        const t = assistantTextAccumRef.current.trim()
        const att = pendingAttachmentRef.current || stickyAttachmentRef.current
        if (pendingAttachmentRef.current) stickyAttachmentRef.current = pendingAttachmentRef.current
        if (t || att) setTextThread(prev => prev.map(m => m.id === id ? { ...m, text: t, attachment: att || m.attachment } : m))
      }
      lastFlushRef.current = Date.now()
      flushTimerRef.current = null
      return
    }
    const text = assistantTextAccumRef.current.trim()
    // Use pending attachment, or carry forward the sticky one from previous turns
    const attachment = pendingAttachmentRef.current || stickyAttachmentRef.current
    if (!text && !attachment) return
    // Update sticky ref whenever we have a new pending attachment
    if (pendingAttachmentRef.current) {
      stickyAttachmentRef.current = pendingAttachmentRef.current
    }
    setLatestBubble({
      text,
      attachment: attachment || undefined,
      timestamp: Date.now()
    })
    lastFlushRef.current = Date.now()
    flushTimerRef.current = null
  }, [])

  // Throttled bubble update: accumulate text, flush at most every 200ms
  const scheduleBubbleFlush = useCallback(() => {
    const elapsed = Date.now() - lastFlushRef.current
    if (elapsed >= BUBBLE_FLUSH_MS) {
      flushBubble()
    } else if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(flushBubble, BUBBLE_FLUSH_MS - elapsed)
    }
  }, [flushBubble])

  // Handle map action
  const handleMapAction = useCallback((action: MapAction) => {
    console.log('[VoiceContext] Map action:', action, 'path:', location.pathname)

    if (action.type === 'navigate' && action.path) {
      navigate(action.path)
      return
    }

    if ((location.pathname === '/' || location.pathname === '/map') && mapActionHandlerRef.current) {
      mapActionHandlerRef.current(action)
      return
    }

    if (['fly_to', 'highlight_projects', 'show_pois', 'toggle_transport', 'show_area_info', 'highlight_areas', 'reset', 'measure_distance', 'amenity_spokes', 'guided_tour'].includes(action.type)) {
      pendingActionRef.current = action
      navigate('/')
    }
  }, [location.pathname, navigate])

  // Register/unregister map action handler
  const registerMapActionHandler = useCallback((handler: (action: MapAction) => void) => {
    mapActionHandlerRef.current = handler
    if (pendingActionRef.current) {
      handler(pendingActionRef.current)
      pendingActionRef.current = null
    }
  }, [])

  const unregisterMapActionHandler = useCallback(() => {
    mapActionHandlerRef.current = null
  }, [])

  // Navigate to project
  const navigateToProject = useCallback((projectId: string) => {
    navigate(`/project/${projectId}`)
  }, [navigate])

  // Dismiss the lingering voice reply bubble (so it never blocks the map after a
  // conversation ends or drops).
  const dismissBubble = useCallback(() => setLatestBubble(null), [])

  // ─── Text mode (方案 B): typed input over the SAME voice Live session ───
  // Reuses the working front-end Gemini Live pipeline (the backend /api/voice/text path
  // picks tools unreliably from the Hetzner region). We just don't open the mic or play
  // audio, and route replies to the panel. See docs/luna-text-mode-plan-2026-07-01.md.
  const openText = useCallback(() => setTextOpen(true), []) // lazy-connect on first send
  // deactivate is defined further down; call it via a ref to avoid a TDZ reference here.
  const deactivateRef = useRef<(() => void) | null>(null)
  const closeText = useCallback(() => {
    setTextOpen(false)
    setTextThread([])          // history is per-open-session; clearing on close is fine
    turnAsstIdRef.current = null
    if (textModeRef.current && sessionRef.current) {
      deactivateRef.current?.()   // stops recorder / closes session / ends debug session
      textModeRef.current = false
      setTextPending(false)
    }
  }, [])

  const sendText = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || textPending) return
    if (overLimit()) { openGate(); return } // daily token quota used up

    const asstId = `a_${Date.now()}`
    turnAsstIdRef.current = asstId
    setTextPending(true)
    // Append the user's message + an empty assistant message (streams in via flushBubble).
    setTextThread(prev => [...prev, { id: `u_${Date.now()}`, role: 'user', text: trimmed }, { id: asstId, role: 'assistant', text: '' }])
    textModeRef.current = true

    try {
      // Lazy-connect: if there's no live session yet, open one (no mic in text mode) and
      // wait for it to be ready to accept client content.
      if (!sessionRef.current?.sendClientContent) {
        await activateRef.current?.()
        const deadline = Date.now() + 8000
        while (!sessionRef.current?.sendClientContent && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 50))
        }
        if (!sessionRef.current?.sendClientContent) {
          throw new Error('Live session not ready')
        }
      }

      // 🔴 打字模式的用户输入必须**手动**进 transcript。
      //
      // 语音模式靠 `inputTranscription` 回调喂 logUserMessage —— 打字模式不开麦克风,
      // 那个回调永远不来。结果:2026-08-10 审计的 10 场会话里 **8 场没有用户的话**,
      // 后台「Luna 对话」回看等于只能看 Luna 自言自语,根本没法诊断她答得对不对。
      // (2026-06-25 修过一次同款 —— 那次是语音路径漏调 finalize,这次是打字路径
      //  压根没接上。**加任何新的输入形态都要问一句:它进 transcript 了吗?**)
      voiceDebugLogger.logUserMessage(trimmed)
      voiceDebugLogger.finalizeUserMessage()
      turnUserSaidRef.current = trimmed   // 打字模式没有转写回调,手动交给 Brain

      // Send the typed turn; the reply (text + tool map actions + card) arrives
      // asynchronously through handleMessage, and textPending clears on turnComplete.
      sessionRef.current.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: trimmed }] }],
        turnComplete: true,
      })
      resetIdleTimer() // text activity counts → push the idle finalize back
    } catch (err) {
      console.error('[Voice Text] send error:', err)
      const reply = currentLanguage === 'zh'
        ? '刚刚有点忙不过来，麻烦再说一次？'
        : 'Something went wrong — please try again.'
      setTextThread(prev => prev.map(m => m.id === asstId ? { ...m, text: reply } : m))
      setTextPending(false)
      turnAsstIdRef.current = null
    }
  }, [textPending, currentLanguage, resetIdleTimer, overLimit, openGate])

  // Execute tool
  const executeTool = useCallback(async (toolName: string, params: any, callId: string) => {
    voiceDebugLogger.logToolCallStart(callId, toolName, params)
    setPhase('processing')
    setToolStatus(getToolDisplayName(toolName))
    // Clear sticky attachment when new tool call starts — new results will replace
    stickyAttachmentRef.current = null

    // Lead capture is browser-local (needs the visitor_id to tie prior behaviour
    // to the lead) — handle it here, not via the generic backend tool path.
    // See docs/analytics-dashboard-spec.md §6.3.
    if (toolName === 'capture_contact') {
      try {
        const resp = await fetch(`${API_BASE}/api/leads/contact`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            visitor_id: visitorId(),
            name: params?.name,
            email: params?.email,
            phone: params?.phone,
            whatsapp: params?.whatsapp || params?.phone,
            source: 'luna',
          }),
        })
        const ok = resp.ok
        voiceDebugLogger.logToolCallEnd(callId, { ok })
        setToolStatus(null)
        return {
          success: ok,
          summary: ok
            ? '联系方式已记录,稍后把详细资料发过去。'
            : '暂时没能保存联系方式,可以稍后再留一次。',
        }
      } catch (err) {
        voiceDebugLogger.logToolCallEnd(callId, null, String(err))
        setToolStatus(null)
        return { success: false, summary: '暂时没能保存联系方式。' }
      }
    }

    /**
     * 🧠 **所有工具调用的统一出口** —— 无论 Live 想调哪个，都到 Brain 这里。
     *
     * Live 看到完整的 23 个声明(后端 manifest 下发)是为了**知道自己能干什么**
     * —— 那是它决定「该查」的唯一线索。但它没有数据、只按名字挑，**选错是常态**。
     * 所以它选的工具在这里降级成 `intendedTool`(意图信号),由 Brain 决定
     * 真正调什么、怎么组织话术。护栏(数据边界/诚实/澄清出路)全在 Brain。
     *
     * `userSaid` 比模型填的参数可靠 —— 那是客户的原话，不是模型的转述。
     *
     * 见 `docs/luna-tool-routing-spec.md`。
     */
    {
      const more = toolName === 'ask_luna_more'
      turnAskedBrainRef.current = true
      turnToolsRef.current = [...turnToolsRef.current, toolName]
      if (!turnIntendedToolRef.current) turnIntendedToolRef.current = toolName
      try {
        const response = await fetch(`${API_BASE}/api/voice/tools/${more ? 'ask-more' : 'ask'}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // 客户原话优先；转写没拿到时退回模型填的 question 参数。
            question: turnUserSaidRef.current?.trim() || params?.question || params?.area_name || params?.area || '',
            intendedTool: toolName,
            intendedParams: params || {},
            context: params?.context,
            language: currentLanguage,
            sessionId: voiceDebugLogger.currentSessionId,
            visitorId: visitorId(),
          })
        })
        const data = await response.json()

        if (data.mapAction) handleMapAction(data.mapAction)

        // 气泡卡片。**拆层最容易碰掉的就是这里** —— buildBubbleAttachment 靠
        // 工具名分派,所以 Brain 必须把它内部调用过的工具名回传。后来的覆盖
        // 先前的,与旧的「每次工具调用覆盖一次」行为一致。
        for (const a of (data.attachments || [])) {
          const attachment = buildBubbleAttachment(a.toolName, a.result, a.params)
          if (attachment) pendingAttachmentRef.current = attachment

          // navigate_to_project 仍然在飞行动画之后自动打开详情页。
          if (a.toolName === 'navigate_to_project' && a.result?.projectId) {
            setTimeout(() => {
              handleMapAction({ type: 'navigate', path: `/project/${a.result.projectId}` })
            }, 2500)
          }
        }

        voiceDebugLogger.logToolCallEnd(callId, { speech: data.speech, pending: data.pending, ...data.debug })

        // 第一段只是过渡句 —— 把 pending 原样交回,Live 层的 prompt 靠它决定
        // 要不要接着调 ask_luna_more。**丢了这个字段 Luna 就会说完
        // 「我看一下」然后再也不出声。**
        if (data.pending) {
          // 过渡句期间保持「查询中...」的视觉反馈,别让气泡先清掉
          setToolStatus(getToolDisplayName('ask_luna'))
          return { speech: data.speech, pending: true }
        }

        // speech 是**最终稿**。字段名就叫 speech,配合 Live 层 prompt 的
        // 「照念不改」—— 换成 result/data 之类的名字模型会当成素材去改写。
        return { speech: data.speech }
      } catch (err) {
        console.error('[Voice] ask_luna failed:', err)
        voiceDebugLogger.logToolCallEnd(callId, null, String(err))
        setToolStatus(null)
        // 语音链路上返回错误对象 = 一段死寂。永远给一句能说出口的话。
        return {
          speech: currentLanguage === 'zh'
            ? '这个我得再查一下。你先说说预算和想看的区域?'
            : "Let me look into that one. What's your budget and which area are you thinking about?",
        }
      }
    }

    // 到这里是不可达的 —— 上面的块无条件返回。
    // 旧的 `/api/voice/tools/execute` 直连路径已删:任何工具都必须过 Brain,
    // 否则那一路的返回就绕开了全部护栏(数据边界/诚实规则/澄清出路)。
  }, [getToolDisplayName, handleMapAction, currentLanguage])

  // Handle Gemini messages
  const handleMessage = useCallback(async (message: LiveServerMessage) => {
    // Any inbound model message = activity → push the idle finalize back.
    resetIdleTimer()

    // Cost telemetry — runs for EVERY session, including quota-exempt shared tours.
    // Quota exemption is a billing decision for the agent; the tokens are still spent
    // and still cost us money. Skipping them here is how Luna's real cost stayed at
    // zero on the dashboard: the backend isn't in this path at all (the browser talks
    // to Gemini Live directly), so this report is the ONLY place the spend is visible.
    reportLiveUsage(message.usageMetadata)

    // Token metering: usageMetadata.totalTokenCount is CUMULATIVE per WS connection
    // (resets to 0 on reconnect). Track the delta and add it to the daily quota.
    // Skipped entirely in a shared tour — that usage is the agent's demo, unmetered.
    if (!quotaExemptRef.current && message.usageMetadata?.totalTokenCount != null) {
      const total = message.usageMetadata.totalTokenCount
      const delta = Math.max(0, total - lastConnTokensRef.current)
      lastConnTokensRef.current = total
      if (delta > 0) { addDailyTokens(delta); setQuotaUsed(getDailyTokens()) }
      // Over the daily budget → gate + end the conversation (no paid tier yet).
      if (getDailyTokens() >= dailyLimit()) { openGate(); endConversationNow() }
    }
    // Log the gap from the user's speech to Luna's first reply token (once per turn).
    const logReplyLatency = (kind: string) => {
      if (turnReplyLoggedRef.current || !turnUserFirstTsRef.current) return
      turnReplyLoggedRef.current = true
      const now = performance.now()
      /**
       * 🔴 **体感延迟落库**（原来只有 console.log）。
       *
       * 「客户说话到 AI 回话隔了多久」是 owner 最想看的数字，而它一直只存在于
       * 开发者自己的 DevTools 里 —— 线上一条都没有。现在存进 ref，
       * 每轮结束随 /tools/turn 上报。
       */
      turnFirstAudioMsRef.current = Math.round(now - turnUserLastTsRef.current)
      turnUserSpeechMsRef.current = Math.round(turnUserLastTsRef.current - turnUserFirstTsRef.current)
      console.log(
        `[VoiceTiming] Luna reply START (${kind}) — ` +
        `${Math.round(now - turnUserLastTsRef.current)}ms after user STOPPED, ` +
        `${Math.round(now - turnUserFirstTsRef.current)}ms after user STARTED`
      )
    }
    // Session resumption: stash the latest handle (only when the server says this
    // point is resumable — not mid-tool-call/generation, which would lose state).
    if (message.sessionResumptionUpdate) {
      const u = message.sessionResumptionUpdate
      if (u.resumable && u.newHandle) resumeHandleRef.current = u.newHandle
    }
    // GoAway: the server is about to terminate this connection (session/rate limit).
    // Log it so we can SEE why drops happen; the close → auto-reconnect then resumes
    // via the handle above, so context survives.
    if (message.goAway) {
      console.warn('[Voice] GoAway — server will close soon, timeLeft:', message.goAway.timeLeft)
      voiceDebugLogger.log('GO_AWAY', { timeLeft: message.goAway.timeLeft })
    }

    if (message.serverContent) {
      const content = message.serverContent

      // Interruption
      if (content.interrupted) {
        voiceDebugLogger.logInterruption()
        // Commit whatever Luna had said so far as its OWN message. Without this the
        // accumulated text survives into the next turn and gets string-concatenated
        // onto the next reply (turnComplete is the only other flush point), which
        // silently corrupts the transcript and makes truncation impossible to measure.
        voiceDebugLogger.finalizeAssistantMessage({ interrupted: true })
        playerRef.current?.stop()
        // User barged in → start a fresh caption for the new utterance
        userTurnFreshRef.current = true
        setPhase('listening')
        return
      }

      // Input transcription (user speech) — show a live caption of the user's words
      if (content.inputTranscription) {
        const text = typeof content.inputTranscription === 'string'
          ? content.inputTranscription
          : (content.inputTranscription as any).text
        if (text) {
          // First fragment after the assistant spoke = a new utterance → reset caption
          if (userTurnFreshRef.current) {
            userTextAccumRef.current = ''
            userTurnFreshRef.current = false
            turnUserFirstTsRef.current = performance.now()
            turnReplyLoggedRef.current = false
            console.log('[VoiceTiming] user speech START')
          }
          turnUserLastTsRef.current = performance.now()
          userTextAccumRef.current += text
          // 客户原话 —— 转给 Brain 当 question。比模型转述的参数可靠得多。
          turnUserSaidRef.current = userTextAccumRef.current
          setUserTranscript(userTextAccumRef.current.trim())
          voiceDebugLogger.logUserMessage(text)
        }
      }

      // Output transcription (assistant speech) — accumulate + throttled flush
      if (content.outputTranscription) {
        let text = typeof content.outputTranscription === 'string'
          ? content.outputTranscription
          : (content.outputTranscription as any).text
        if (text) {
          // Strip control characters (e.g. <ctrl46>) that Gemini sometimes outputs
          text = text.replace(/<ctrl\d+>/gi, '').replace(/[\x00-\x1F\x7F]/g, '')
          if (text.trim()) {
            logReplyLatency('text')
            // Clear thinking bubble once real response arrives
            setToolStatus(null)
            // Luna is responding → the user's turn just ended. Commit the user's
            // utterance to the transcript now (idempotent — no-op if already flushed),
            // so the saved conversation includes what the customer said.
            voiceDebugLogger.finalizeUserMessage()
            // Luna is responding → hide the user caption and show her bubble (which
            // then persists after she finishes); next user input starts a fresh caption.
            userTurnFreshRef.current = true
            setUserTranscript('')
            assistantTextAccumRef.current += text
            voiceDebugLogger.logAssistantMessage(text)
            scheduleBubbleFlush()
          }
        }
      }

      // Audio output — skipped entirely in text mode (no playback, no speaking phase).
      if (!textModeRef.current && content.modelTurn?.parts) {
        for (const part of content.modelTurn.parts) {
          if (part.inlineData?.data && typeof part.inlineData.data === 'string') {
            logReplyLatency('audio')
            setPhase('speaking')
            voiceDebugLogger.logAudioChunkReceived()
            playerRef.current?.play(part.inlineData.data)
          }
        }
      }

      // Turn complete
      if (content.turnComplete) {
        /**
         * 🔴 **每轮都上报，不等 endSession。**
         *
         * 关键是 `askedBrain` —— 这一轮 Luna 到底问没问 Brain。
         * 所有护栏(数据边界/诚实规则/澄清出路)都在 Brain 里,Live 绕过它
         * 直接开口时**后端完全不知道这轮存在过**,而且必然裸奔。
         * owner 报的「AI 说自己能卖二手房」就是这么冒出来的 ——
         * 同样的问题直接问 Brain,答案是对的。
         *
         * 也不能等 `endSession` 才上报:它只在正常结束时跑,用户关标签页
         * 就永远丢。实测 12 小时内 luna_sessions 一行都没有,而人明明用过。
         */
        const spokenThisTurn = assistantTextAccumRef.current.trim()
        if (spokenThisTurn || turnAskedBrainRef.current) {
          fetch(`${API_BASE}/api/voice/tools/turn`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            keepalive: true,   // 页面正在关也要发出去
            body: JSON.stringify({
              sessionId: voiceDebugLogger.currentSessionId,
              visitorId: visitorId(),
              speech: spokenThisTurn.slice(0, 4000),
              userSaid: turnUserSaidRef.current.slice(0, 2000),
              askedBrain: turnAskedBrainRef.current,
              tools: turnToolsRef.current,
              intendedTool: turnIntendedToolRef.current || undefined,
              // 三个延迟:客户说了多久 / 说完到第一个音(体感) / 说完到说完
              userSpeechMs: turnUserSpeechMsRef.current || undefined,
              toFirstAudioMs: turnFirstAudioMsRef.current || undefined,
              totalMs: turnUserLastTsRef.current ? Math.round(performance.now() - turnUserLastTsRef.current) : undefined,
              ms: turnUserFirstTsRef.current ? Math.round(performance.now() - turnUserFirstTsRef.current) : undefined,
            }),
          }).catch(() => { /* 观测失败绝不影响对话 */ })
        }
        turnAskedBrainRef.current = false
        turnToolsRef.current = []
        turnUserSaidRef.current = ''
        turnFirstAudioMsRef.current = 0
        turnUserSpeechMsRef.current = 0
        turnIntendedToolRef.current = ''

        if (textModeRef.current) {
          // Finalize the current assistant message (text already streamed in).
          const id = turnAsstIdRef.current
          const text = assistantTextAccumRef.current.trim()
          const attachment = pendingAttachmentRef.current || stickyAttachmentRef.current
          if (pendingAttachmentRef.current) stickyAttachmentRef.current = pendingAttachmentRef.current
          if (id) setTextThread(prev => prev.map(m => m.id === id ? { ...m, text, attachment: attachment || m.attachment } : m))
          setTextPending(false) // text turn done → re-enable input
          turnAsstIdRef.current = null
        } else {
          // Final flush of any remaining text
          if (assistantTextAccumRef.current.trim() || pendingAttachmentRef.current) {
            flushBubble()
          }
        }
        assistantTextAccumRef.current = ''
        pendingAttachmentRef.current = null
        setToolStatus(null) // Safety: clear thinking bubble
        setPhase('listening')
        voiceDebugLogger.finalizeAssistantMessage()
        voiceDebugLogger.log('TURN_COMPLETE')
      }
    }

    // Tool calls
    if (message.toolCall?.functionCalls) {
      logReplyLatency('tool')
      // A tool call means the user's request just ended → commit their utterance
      // (idempotent) so the transcript pairs the question with the tool/answer.
      voiceDebugLogger.finalizeUserMessage()
      voiceDebugLogger.log('TOOL_CALLS_RECEIVED', {
        count: message.toolCall.functionCalls.length
      })

      const functionResponses: Array<{
        id: string
        name: string
        response: { output: string }
      }> = []

      for (const fc of message.toolCall.functionCalls) {
        if (!fc.name) continue
        const callId = fc.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`
        console.log('[Voice] Tool call:', fc.name, 'id:', callId, 'args:', fc.args)

        try {
          const result = await executeTool(fc.name, fc.args || {}, callId)

          /**
           * 🔴 **交回给 Live 的只有 speech,不再有原始数据。**
           *
           * 这里原本有 80 行「把工具结果加工成 detailedOutput 喂回模型」的逻辑
           * (项目列表/户型/POI/地标/区域指标…),那是**拆层前**的做法:
           * 模型自己读数据、自己组织话术。
           *
           * 两层架构下那 80 行是**幻觉的来源** —— Brain 已经写好了话术,
           * 再把原始数字塞回去,等于请 Live 再创作一遍。它就是这么开始
           * 自己编项目名和收益率的。
           *
           * 现在契约只有一条:**speech 照念。**
           */
          const spoken = (result as { speech?: string })?.speech
            || (result as { summary?: string })?.summary
            || 'Action completed.'

          functionResponses.push({
            id: callId,
            name: fc.name,
            response: { output: spoken }
          })
        } catch (toolError) {
          console.error('[Voice] Tool execution failed:', toolError)
          functionResponses.push({
            id: callId,
            name: fc.name,
            response: { output: 'Tool execution failed. Please try again.' }
          })
        }
      }

      if (sessionRef.current?.sendToolResponse && functionResponses.length > 0) {
        voiceDebugLogger.log('SENDING_TOOL_RESPONSE', { count: functionResponses.length })
        try {
          sessionRef.current.sendToolResponse({ functionResponses })
          voiceDebugLogger.log('TOOL_RESPONSE_SENT')
        } catch (err) {
          voiceDebugLogger.logError('TOOL_RESPONSE_ERROR', String(err))
          console.error('[Voice] Tool response error:', err)
        }
      }
    }
  }, [executeTool, scheduleBubbleFlush, flushBubble, resetIdleTimer, openGate, endConversationNow, dailyLimit])

  // Initialize audio player
  useEffect(() => {
    const initAudio = () => {
      if (!playerRef.current) {
        playerRef.current = new AudioPlayer((speaking) => {
          lunaSpeakingRef.current = speaking
          // Only transition to listening when audio finishes and we're in speaking phase
          if (!speaking) {
            setPhase(prev => prev === 'speaking' ? 'listening' : prev)
          }
        })
        playerRef.current.prewarm?.()
      }
    }

    const handler = () => {
      initAudio()
      document.removeEventListener('click', handler)
      document.removeEventListener('touchstart', handler)
    }

    document.addEventListener('click', handler)
    document.addEventListener('touchstart', handler)
    initAudio()

    return () => {
      document.removeEventListener('click', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [])

  // Start recording helper
  const startRecording = useCallback(async () => {
    if (!sessionRef.current || recorderRef.current) return

    try {
      voiceDebugLogger.logRecordingStart()
      recorderRef.current = new AudioRecorder()
      await recorderRef.current.start((base64) => {
        // NOTE: full-duplex. Self-interruption is handled by (1) not leaking the mic
        // to the speaker and (2) browser echo cancellation — NOT by gating the mic,
        // which made the user's words + Luna's reply lag several seconds while she
        // spoke the welcome message. (lunaSpeakingRef kept for possible future use.)
        if (sessionRef.current?.sendRealtimeInput) {
          voiceDebugLogger.logAudioChunkSent()
          sessionRef.current.sendRealtimeInput({
            audio: {
              data: base64,
              mimeType: 'audio/pcm;rate=16000'
            }
          })
        }
      })
      setPhase('listening')
    } catch (e) {
      voiceDebugLogger.logError('MICROPHONE_ERROR', String(e))
      setPhase('error')
      setTimeout(() => setPhase('idle'), 3000)
    }
  }, [])

  // Store ref for delayed call after connect
  useEffect(() => {
    startRecordingRef.current = startRecording
  }, [startRecording])

  // Activate: connect + auto-start mic
  const activate = useCallback(async () => {
    if (sessionRef.current || connectingRef.current) {
      console.log('[Voice] Already connected or connecting, skipping')
      return
    }
    // Daily token quota used up → prompt login/upgrade instead of opening.
    if (overLimit()) { openGate(); return }

    // A debug session may still be alive here because of (a) an auto-reconnect, or
    // (b) a tap-close whose idle window hasn't elapsed (user tapped to close + re-open).
    // In BOTH cases we RESUME it so it stays ONE record. Cancel the pending idle end.
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null }
    const resuming = !!voiceDebugLogger.getCurrentSession()

    // Behaviour analytics: only a genuinely fresh open (not a reconnect/grace-resume).
    if (!resuming) trackEvent('luna_open')

    connectingRef.current = true
    intentionalDisconnectRef.current = false
    reconnectAttemptsRef.current = 0
    if (resuming) {
      voiceDebugLogger.log('RECONNECTED', { resuming: !!resumeHandleRef.current })
    } else {
      resumeHandleRef.current = null // fresh conversation → don't resume an old one
      voiceDebugLogger.startSession()
    }
    setPhase('connecting')
    // Arm the idle finalize so an idle-but-connected conversation still ends after 5 min.
    resetIdleTimer()

    // "Ready" chime on user-initiated open: UX feedback + warms the audio pipeline
    // so Luna's first buffer doesn't glitch on a cold context. Runs on this tap
    // gesture, so the AudioContext is allowed to resume.
    if (!resuming && !textModeRef.current) playerRef.current?.chime?.()

    try {
      const tokenFetchStart = Date.now()
      voiceDebugLogger.log('TOKEN_FETCH_START', { language: currentLanguage })

      const tokenResponse = await fetch(`${API_BASE}/api/voice/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: currentLanguage })
      })
      const tokenData = await tokenResponse.json()

      if (!tokenData.token) {
        throw new Error('Failed to get token')
      }

      voiceDebugLogger.logTokenFetch(tokenFetchStart)
      systemInstructionRef.current = tokenData.systemInstruction
      if (typeof tokenData.model === 'string' && tokenData.model) liveModelRef.current = tokenData.model
      // 工具声明的唯一真相源 —— 后端 manifest。前端不再硬编码。
      if (Array.isArray(tokenData.tools) && tokenData.tools.length) {
        liveToolsRef.current = tokenData.tools
      }

      const connectStart = Date.now()
      voiceDebugLogger.log('WEBSOCKET_CONNECT_START')

      const ai = new GoogleGenAI({
        apiKey: tokenData.token,
        httpOptions: { apiVersion: 'v1alpha' }
      })

      const session = await ai.live.connect({
        model: liveModelRef.current || GEMINI_MODEL_FALLBACK,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Aoede' }
            }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          // VAD tuning — the START and END sides are tuned INDEPENDENTLY:
          //   END side (endOfSpeechSensitivity + silenceDurationMs) controls how fast
          //   Luna replies AFTER the user stops → kept AGGRESSIVE (HIGH + 350ms) so
          //   she answers ~instantly. (The old LOW + 800ms here caused 10s+ latency.)
          //   START side (startOfSpeechSensitivity + prefixPaddingMs) controls how
          //   eagerly noise/breath is treated as a barge-in. Sensitivity stays HIGH
          //   (LOW made Gemini miss speech onset entirely → "说半天没反应"); the
          //   debounce against false barge-ins is prefixPaddingMs — that is the ONLY
          //   knob to touch here.
          // 2026-07-20: prefixPaddingMs 300 → 700. Production transcript analysis showed
          // assistant messages ending with no terminal punctuation (i.e. cut off
          // mid-sentence: "您好，我是" / "What would you like to do? We can") in 27.1% of
          // sessions that had an interruption vs 13.3% of sessions without one — so most
          // clipped endings are false barge-ins from background noise, not real ones.
          // If endings still get clipped, raise prefixPaddingMs further;
          // if replies feel slow again, lower silenceDurationMs — don't cross-tune,
          // and don't "fix" either problem by moving a sensitivity enum.
          realtimeInputConfig: {
            automaticActivityDetection: {
              startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
              endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
              prefixPaddingMs: 700,
              silenceDurationMs: 350,
            },
          },
          systemInstruction: {
            parts: [{ text: systemInstructionRef.current }]
          },
          // 后端下发的完整清单(23 个)。拿不到就退化成空 —— 宁可 Luna 说"我查一下"
          // 也不能让它以为自己什么都不用查。
          tools: liveToolsRef.current.length
            ? [{ functionDeclarations: liveToolsRef.current as any }]
            : undefined,
          // Survive WebSocket drops WITH full context: the server sends resumption
          // handles (captured in handleMessage); on reconnect we pass the latest so
          // Luna remembers the conversation instead of starting over ("找不到…").
          // contextWindowCompression keeps long sessions from hitting the token cap.
          sessionResumption: { handle: resumeHandleRef.current || undefined },
          contextWindowCompression: { slidingWindow: {} },
        },
        callbacks: {
          onopen: () => {
            console.log('[Voice] Connected!')
            connectingRef.current = false
            reconnectAttemptsRef.current = 0
            // New connection → Gemini's cumulative token count restarts at 0.
            lastConnTokensRef.current = 0
            resetLiveUsage()
            voiceDebugLogger.logConnected(connectStart)

            // Text mode never opens the mic — it drives the session via sendClientContent.
            if (!textModeRef.current) {
              voiceDebugLogger.log('AUTO_START_RECORDING')
              setTimeout(() => {
                startRecordingRef.current?.()
              }, 100)
            }
          },
          onmessage: handleMessage,
          onerror: (e) => {
            console.error('[Voice] Error:', e)
            connectingRef.current = false
            voiceDebugLogger.logError('CONNECTION_ERROR', String(e))
            setPhase('error')
            setTimeout(() => setPhase('idle'), 3000)
          },
          onclose: (e?: CloseEvent) => {
            // Capture WHY it closed (code/reason) so drops are diagnosable, not a mystery.
            console.log('[Voice] Connection closed', e?.code, e?.reason, 'wasClean:', e?.wasClean)
            voiceDebugLogger.log('CONNECTION_CLOSED', {
              code: e?.code, reason: e?.reason, wasClean: e?.wasClean
            })

            if (recorderRef.current) {
              recorderRef.current.stop()
              recorderRef.current = null
            }

            connectingRef.current = false
            sessionRef.current = null

            // Auto-reconnect if not intentional
            if (!intentionalDisconnectRef.current &&
                reconnectAttemptsRef.current < AUTO_RECONNECT_MAX) {
              // Involuntary drop → keep the debug session OPEN so the whole
              // conversation stays in one record across the reconnect.
              voiceDebugLogger.log('RECONNECT_PENDING')
              const attempt = reconnectAttemptsRef.current
              const delayMs = AUTO_RECONNECT_BASE_MS * Math.pow(2, attempt)
              console.log(`[Voice] Auto-reconnect attempt ${attempt + 1}/${AUTO_RECONNECT_MAX} in ${delayMs}ms`)
              reconnectAttemptsRef.current = attempt + 1
              setPhase('connecting')
              reconnectTimerRef.current = setTimeout(() => {
                reconnectTimerRef.current = null
                activate()
              }, delayMs)
            } else {
              // Intentional close (deactivate) OR reconnect-exhausted → just drop to
              // idle. The record persists; the idle timer (or pagehide) finalizes it,
              // so a re-open within CONVO_IDLE_MS resumes the SAME record.
              setPhase('idle')
              resetIdleTimer()
            }
          }
        }
      })

      sessionRef.current = session
    } catch (err) {
      console.error('[Voice] Connect error:', err)
      connectingRef.current = false
      voiceDebugLogger.logError('CONNECT_ERROR', String(err))

      // Auto-reconnect on connect failure too
      if (!intentionalDisconnectRef.current &&
          reconnectAttemptsRef.current < AUTO_RECONNECT_MAX) {
        const attempt = reconnectAttemptsRef.current
        const delayMs = AUTO_RECONNECT_BASE_MS * Math.pow(2, attempt)
        reconnectAttemptsRef.current = attempt + 1
        setPhase('connecting')
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null
          activate()
        }, delayMs)
      } else {
        setPhase('error')
        setTimeout(() => setPhase('idle'), 3000)
        // Record persists; the idle timer (or pagehide) finalizes it.
        resetIdleTimer()
      }
    }
  }, [currentLanguage, handleMessage, resetIdleTimer, overLimit, openGate])

  // Mirror activate() into a ref so sendText (defined earlier) can call it without a
  // TDZ error — same pattern as startRecordingRef above.
  useEffect(() => {
    activateRef.current = activate
  }, [activate])

  // Deactivate = DISCONNECT ONLY (tap-close / interrupt path): tear down the WebSocket
  // and reset transient UI, but do NOT end the debug session. The conversation record
  // lives on and is finalized only by the idle timer (armed below) or pagehide, so a
  // re-open within CONVO_IDLE_MS resumes the SAME record.
  const deactivate = useCallback(() => {
    trackEvent('luna_close')  // Behaviour analytics: user-initiated close.
    textModeRef.current = false
    intentionalDisconnectRef.current = true // socket close must not trigger a reconnect
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    recorderRef.current?.stop()
    recorderRef.current = null
    playerRef.current?.stop()
    sessionRef.current?.close?.()
    sessionRef.current = null
    connectingRef.current = false
    assistantTextAccumRef.current = ''
    pendingAttachmentRef.current = null
    stickyAttachmentRef.current = null
    reconnectAttemptsRef.current = 0
    userTextAccumRef.current = ''
    userTurnFreshRef.current = true
    setPhase('idle')
    setLatestBubble(null)
    setToolStatus(null)
    setUserTranscript('')
    // Record lives on; finalizes after CONVO_IDLE_MS unless re-opened.
    resetIdleTimer()
  }, [resetIdleTimer])

  // Mirror deactivate() into a ref so closeText (defined earlier) can call it TDZ-free.
  useEffect(() => {
    deactivateRef.current = deactivate
  }, [deactivate])

  // Persist the session if the tab is closed/backgrounded mid-conversation.
  // Needed because auto-reconnect no longer ends the session on every drop — a
  // close that's really a page unload would otherwise lose the record. endSession()
  // persists via navigator.sendBeacon, which is built for exactly this moment.
  useEffect(() => {
    const onPageHide = () => {
      if (!voiceDebugLogger.getCurrentSession()) return
      intentionalDisconnectRef.current = true // don't try to reconnect during unload
      if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null }
      voiceDebugLogger.endSession() // persist NOW (the 5-min window can't survive unload)
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [])

  // Keep the gauge in sync: refresh on mount and every 60s so a Dubai-midnight day
  // rollover (quota reset) reflects in the UI without a page reload.
  useEffect(() => {
    setQuotaUsed(getDailyTokens())
    const id = setInterval(() => setQuotaUsed(getDailyTokens()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Logging in bumps the daily budget (anon → free tier). Re-evaluate: if the new
  // limit isn't yet exceeded, lift the gate; refresh the gauge either way.
  useEffect(() => {
    if (!overLimit()) setLunaGate(null)
    setQuotaUsed(getDailyTokens())
  }, [user, overLimit])

  // Latest state + callbacks mirrored into a ref so the test hook below can read them
  // WITHOUT re-registering on every render (re-registering deleted/re-added
  // window.__lunaTest each render, leaving a gap that crashed automated polling).
  const lunaLiveRef = useRef<any>({})
  lunaLiveRef.current = { phase, latestBubble, userTranscript, toolStatus, activate, deactivate }

  // QA/test hook (guarded): drive Luna with TEXT instead of the mic so the full real
  // flow — Gemini, tool calls, map actions, bubbles — can be automated + screenshotted
  // without speech. Enabled ONLY with ?lunatest=1 (or localStorage luna_test=1); never
  // exposed to customers. Registered ONCE; reads live values via lunaLiveRef.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const enabled =
      new URLSearchParams(window.location.search).has('lunatest') ||
      window.localStorage?.getItem('luna_test') === '1'
    if (!enabled) return
    ;(window as any).__lunaTest = {
      say: (text: string) => {
        if (!sessionRef.current?.sendClientContent) return 'no active session — open Luna first'
        sessionRef.current.sendClientContent({
          turns: [{ role: 'user', parts: [{ text }] }],
          turnComplete: true,
        })
        return `sent: ${text}`
      },
      open: () => { lunaLiveRef.current.activate?.(); return 'opening' },
      close: () => { lunaLiveRef.current.deactivate?.(); return 'closing' },
      // Stop the mic so the fake-audio test device can't trigger VAD — text turns only.
      stopMic: () => { recorderRef.current?.stop(); recorderRef.current = null; return 'mic stopped' },
      connected: () => !!sessionRef.current?.sendClientContent,
      state: () => {
        const s = lunaLiveRef.current
        return { phase: s.phase, bubble: s.latestBubble, userTranscript: s.userTranscript, toolStatus: s.toolStatus }
      },
    }
    return () => { delete (window as any).__lunaTest }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recorderRef.current?.stop()
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    }
  }, [])

  // Gauge data, recomputed each render from the reactive used-tokens + current tier.
  const quotaLimit = dailyLimit()
  const lunaQuota = {
    used: quotaUsed,
    limit: quotaLimit,
    remaining: Math.max(0, quotaLimit - quotaUsed),
    pct: quotaLimit > 0 ? Math.min(100, Math.round(quotaUsed / quotaLimit * 100)) : 0,
  }

  return (
    <VoiceAssistantContext.Provider value={{
      phase,
      latestBubble,
      toolStatus,
      userTranscript,
      activate,
      deactivate,
      registerMapActionHandler,
      unregisterMapActionHandler,
      navigateToProject,
      dismissBubble,
      lunaGate,
      dismissGate,
      lunaQuota,
      quotaExempt: quotaExemptRef.current,
      textOpen,
      openText,
      closeText,
      sendText,
      textPending,
      textThread,
      hidden,
      setHidden
    }}>
      {children}
    </VoiceAssistantContext.Provider>
  )
}

export function useVoiceAssistantContext() {
  const context = useContext(VoiceAssistantContext)
  if (!context) {
    throw new Error('useVoiceAssistantContext must be used within VoiceAssistantProvider')
  }
  return context
}
