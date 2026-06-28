/**
 * Voice Assistant Debug Logger
 *
 * Records detailed session logs for debugging and UX optimization
 * Only active in development mode
 */

export interface TimingEvent {
  event: string
  timestamp: number
  elapsed: number  // ms since session start
  delta?: number   // ms since last event
  data?: any
}

export interface ToolCallLog {
  id: string
  name: string
  params: any
  startTime: number
  endTime?: number
  duration?: number
  result?: any
  error?: string
}

export interface SessionLog {
  sessionId: string
  startTime: number
  endTime?: number
  duration?: number
  events: TimingEvent[]
  toolCalls: ToolCallLog[]
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
    timestamp: number
    latency?: number  // Time since user stopped speaking (for assistant messages)
  }>
  errors: Array<{
    type: string
    message: string
    timestamp: number
    stack?: string
  }>
  metrics: {
    // Connection
    tokenFetchTime?: number      // Time to get ephemeral token
    connectionTime?: number      // Time from token to connected
    totalConnectTime?: number    // Button click to ready

    // First interaction
    firstGreetingTime?: number   // Time until AI starts greeting

    // Response latency
    avgResponseLatency?: number  // Avg time from user speech end to AI response
    maxResponseLatency?: number
    minResponseLatency?: number

    // Tool calls
    avgToolCallTime?: number
    totalToolCalls?: number
    failedToolCalls?: number

    // Audio
    audioChunksSent?: number
    audioChunksReceived?: number
    totalUserSpeechTime?: number
    totalAISpeechTime?: number

    // Interruptions
    interruptionCount?: number
  }
}

import { visitorId as appVisitorId } from '../../lib/track'

const isDev = import.meta.env.DEV
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000'

class VoiceDebugLogger {
  private currentSession: SessionLog | null = null
  private lastEventTime: number = 0
  private userSpeechStart: number = 0
  private sessions: SessionLog[] = []

  startSession(): string {
    const sessionId = `voice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()

    this.currentSession = {
      sessionId,
      startTime: now,
      events: [],
      toolCalls: [],
      messages: [],
      errors: [],
      metrics: {
        audioChunksSent: 0,
        audioChunksReceived: 0,
        totalToolCalls: 0,
        failedToolCalls: 0,
        interruptionCount: 0
      }
    }
    this.lastEventTime = now

    this.log('SESSION_START', { sessionId })

    if (isDev) {
      console.group(`🎙️ Voice Session: ${sessionId}`)
      console.log('Session started at', new Date(now).toISOString())
    }

    return sessionId
  }

  endSession(): SessionLog | null {
    if (!this.currentSession) return null

    // Flush any pending utterances so a trailing user/assistant turn isn't lost
    // (e.g. session ends right after the customer speaks).
    this.finalizeUserMessage()
    this.finalizeAssistantMessage()

    const now = Date.now()
    this.currentSession.endTime = now
    this.currentSession.duration = now - this.currentSession.startTime

    // Calculate final metrics
    this.calculateMetrics()

    this.log('SESSION_END', {
      duration: this.currentSession.duration,
      metrics: this.currentSession.metrics
    })

    if (isDev) {
      this.printSessionSummary()
      console.groupEnd()
    }

    // Store session for later export
    this.sessions.push(this.currentSession)

    const session = this.currentSession
    this.currentSession = null

    // Auto-save full debug log to file backend in dev mode only.
    if (isDev) {
      this.saveToBackend(session)
    }

    // Persist to DB for the analytics dashboard (ALL environments). Best-effort.
    // Skip empty/aborted sessions (e.g. a reconnect close with no conversation).
    if (session.messages.length > 0 || session.toolCalls.length > 0) {
      this.persistSession(session)
    }

    return session
  }

  /**
   * Persist a finished session to luna_sessions (always-on, fire-and-forget).
   * Separate from saveToBackend (dev-only file logs). See analytics spec §3.
   */
  private async persistSession(session: SessionLog): Promise<void> {
    try {
      const body = JSON.stringify({ session, visitor_id: appVisitorId() })
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([body], { type: 'application/json' })
        if (navigator.sendBeacon(`${API_BASE}/api/sync/voice-session`, blob)) return
      }
      await fetch(`${API_BASE}/api/sync/voice-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      })
    } catch {
      // Never let archival disrupt anything.
    }
  }

  // Save session to backend for persistent storage
  private async saveToBackend(session: SessionLog): Promise<void> {
    try {
      const response = await fetch(`${API_BASE}/api/voice/debug/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session)
      })

      if (response.ok) {
        const data = await response.json()
        console.log(`📁 Session saved to: ${data.file}`)
      } else {
        console.warn('Failed to save session to backend')
      }
    } catch (err) {
      console.warn('Could not save session to backend:', err)
    }
  }

  log(event: string, data?: any): void {
    if (!this.currentSession) return

    const now = Date.now()
    const elapsed = now - this.currentSession.startTime
    const delta = now - this.lastEventTime

    const entry: TimingEvent = {
      event,
      timestamp: now,
      elapsed,
      delta,
      data
    }

    this.currentSession.events.push(entry)
    this.lastEventTime = now

    if (isDev) {
      const emoji = this.getEventEmoji(event)
      console.log(
        `${emoji} [+${elapsed}ms] ${event}`,
        delta > 0 ? `(Δ${delta}ms)` : '',
        data ? data : ''
      )
    }
  }

  // Specific logging methods for common events
  logTokenFetch(startTime: number): void {
    if (!this.currentSession) return
    const duration = Date.now() - startTime
    this.currentSession.metrics.tokenFetchTime = duration
    this.log('TOKEN_FETCHED', { duration })
  }

  logConnected(connectStartTime: number): void {
    if (!this.currentSession) return
    const duration = Date.now() - connectStartTime
    this.currentSession.metrics.connectionTime = duration
    this.currentSession.metrics.totalConnectTime = Date.now() - this.currentSession.startTime
    this.log('CONNECTED', {
      connectionTime: duration,
      totalConnectTime: this.currentSession.metrics.totalConnectTime
    })
  }

  logFirstGreeting(): void {
    if (!this.currentSession) return
    this.currentSession.metrics.firstGreetingTime = Date.now() - this.currentSession.startTime
    this.log('FIRST_GREETING', { time: this.currentSession.metrics.firstGreetingTime })
  }

  logRecordingStart(): void {
    this.userSpeechStart = Date.now()
    this.log('RECORDING_START')
  }

  logRecordingStop(): void {
    if (!this.currentSession) return
    const duration = Date.now() - this.userSpeechStart
    this.currentSession.metrics.totalUserSpeechTime =
      (this.currentSession.metrics.totalUserSpeechTime || 0) + duration
    this.log('RECORDING_STOP', { duration })
  }

  // Track accumulated messages instead of fragments
  private currentUserText = ''
  private currentAssistantText = ''
  private lastUserMsgTime = 0

  logUserMessage(content: string): void {
    if (!this.currentSession) return
    // Just accumulate, don't log each fragment
    this.currentUserText += content
    this.lastUserMsgTime = Date.now()
  }

  // Call this when user turn is complete
  finalizeUserMessage(): void {
    if (!this.currentSession || !this.currentUserText.trim()) return
    this.currentSession.messages.push({
      role: 'user',
      content: this.currentUserText.trim(),
      timestamp: this.lastUserMsgTime
    })
    this.log('USER_MESSAGE', { content: this.currentUserText.trim().substring(0, 100) })
    this.currentUserText = ''
  }

  logAssistantMessage(content: string): void {
    if (!this.currentSession) return
    // Just accumulate, don't log each fragment
    this.currentAssistantText += content
  }

  // Call this when assistant turn is complete
  finalizeAssistantMessage(): void {
    if (!this.currentSession || !this.currentAssistantText.trim()) return
    const now = Date.now()

    const lastUserMsg = [...this.currentSession.messages]
      .reverse()
      .find(m => m.role === 'user')
    const latency = lastUserMsg ? now - lastUserMsg.timestamp : undefined

    this.currentSession.messages.push({
      role: 'assistant',
      content: this.currentAssistantText.trim(),
      timestamp: now,
      latency
    })

    this.log('ASSISTANT_MESSAGE', {
      content: this.currentAssistantText.trim().substring(0, 100),
      latency
    })
    this.currentAssistantText = ''
  }

  logAudioChunkSent(): void {
    if (!this.currentSession) return
    this.currentSession.metrics.audioChunksSent =
      (this.currentSession.metrics.audioChunksSent || 0) + 1
    // Don't log individual chunks - too verbose
  }

  logAudioChunkReceived(): void {
    if (!this.currentSession) return
    this.currentSession.metrics.audioChunksReceived =
      (this.currentSession.metrics.audioChunksReceived || 0) + 1
    // Don't log individual chunks - too verbose
  }

  logToolCallStart(id: string, name: string, params: any): void {
    if (!this.currentSession) return

    this.currentSession.toolCalls.push({
      id,
      name,
      params,
      startTime: Date.now()
    })
    this.currentSession.metrics.totalToolCalls =
      (this.currentSession.metrics.totalToolCalls || 0) + 1

    this.log('TOOL_CALL_START', { id, name, params })
  }

  logToolCallEnd(id: string, result: any, error?: string): void {
    if (!this.currentSession) return

    const toolCall = this.currentSession.toolCalls.find(t => t.id === id)
    if (toolCall) {
      toolCall.endTime = Date.now()
      toolCall.duration = toolCall.endTime - toolCall.startTime
      toolCall.result = result
      toolCall.error = error

      if (error) {
        this.currentSession.metrics.failedToolCalls =
          (this.currentSession.metrics.failedToolCalls || 0) + 1
      }
    }

    this.log('TOOL_CALL_END', {
      id,
      duration: toolCall?.duration,
      success: !error,
      error
    })
  }

  logInterruption(): void {
    if (!this.currentSession) return
    this.currentSession.metrics.interruptionCount =
      (this.currentSession.metrics.interruptionCount || 0) + 1
    this.log('INTERRUPTION')
  }

  logError(type: string, message: string, stack?: string): void {
    if (!this.currentSession) return

    this.currentSession.errors.push({
      type,
      message,
      timestamp: Date.now(),
      stack
    })

    this.log('ERROR', { type, message })

    if (isDev) {
      console.error(`❌ [Voice Error] ${type}:`, message)
    }
  }

  private calculateMetrics(): void {
    if (!this.currentSession) return

    const { messages, toolCalls, metrics } = this.currentSession

    // Response latency stats
    const responseTimes = messages
      .filter(m => m.role === 'assistant' && m.latency !== undefined)
      .map(m => m.latency!)

    if (responseTimes.length > 0) {
      metrics.avgResponseLatency = Math.round(
        responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      )
      metrics.maxResponseLatency = Math.max(...responseTimes)
      metrics.minResponseLatency = Math.min(...responseTimes)
    }

    // Tool call stats
    const toolTimes = toolCalls
      .filter(t => t.duration !== undefined)
      .map(t => t.duration!)

    if (toolTimes.length > 0) {
      metrics.avgToolCallTime = Math.round(
        toolTimes.reduce((a, b) => a + b, 0) / toolTimes.length
      )
    }
  }

  private printSessionSummary(): void {
    if (!this.currentSession) return

    const { metrics, errors, toolCalls, messages } = this.currentSession

    console.log('\n📊 Session Summary:')
    console.table({
      'Total Duration': `${this.currentSession.duration}ms`,
      'Connect Time': `${metrics.totalConnectTime}ms`,
      'First Greeting': `${metrics.firstGreetingTime}ms`,
      'Messages': messages.length,
      'Tool Calls': `${metrics.totalToolCalls} (${metrics.failedToolCalls} failed)`,
      'Avg Response Latency': `${metrics.avgResponseLatency}ms`,
      'Interruptions': metrics.interruptionCount,
      'Errors': errors.length
    })

    if (toolCalls.length > 0) {
      console.log('\n🔧 Tool Calls:')
      console.table(toolCalls.map(t => ({
        Name: t.name,
        Duration: `${t.duration}ms`,
        Success: !t.error
      })))
    }

    if (errors.length > 0) {
      console.log('\n❌ Errors:')
      errors.forEach(e => console.error(`  - ${e.type}: ${e.message}`))
    }

    // UX Warnings
    console.log('\n⚠️ UX Checks:')
    const issues: string[] = []

    if ((metrics.totalConnectTime || 0) > 3000) {
      issues.push(`Slow connection: ${metrics.totalConnectTime}ms (target: <3s)`)
    }
    if ((metrics.firstGreetingTime || 0) > 5000) {
      issues.push(`Slow first greeting: ${metrics.firstGreetingTime}ms (target: <5s)`)
    }
    if ((metrics.avgResponseLatency || 0) > 2000) {
      issues.push(`High response latency: ${metrics.avgResponseLatency}ms (target: <2s)`)
    }
    if ((metrics.failedToolCalls || 0) > 0) {
      issues.push(`${metrics.failedToolCalls} tool calls failed`)
    }

    if (issues.length === 0) {
      console.log('  ✅ All UX metrics within acceptable range')
    } else {
      issues.forEach(i => console.warn(`  ⚠️ ${i}`))
    }
  }

  private getEventEmoji(event: string): string {
    const emojis: Record<string, string> = {
      'SESSION_START': '🚀',
      'SESSION_END': '🏁',
      'TOKEN_FETCHED': '🎫',
      'CONNECTED': '🔗',
      'FIRST_GREETING': '👋',
      'RECORDING_START': '🎤',
      'RECORDING_STOP': '🔇',
      'USER_MESSAGE': '💬',
      'ASSISTANT_MESSAGE': '🤖',
      'TOOL_CALL_START': '🔧',
      'TOOL_CALL_END': '✅',
      'INTERRUPTION': '🛑',
      'ERROR': '❌',
      'AUDIO_PLAY': '🔊'
    }
    return emojis[event] || '📝'
  }

  // Export session logs for analysis
  exportSessions(): string {
    return JSON.stringify(this.sessions, null, 2)
  }

  downloadLogs(): void {
    const data = this.exportSessions()
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `voice-sessions-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Get current session for display
  getCurrentSession(): SessionLog | null {
    return this.currentSession
  }

  getAllSessions(): SessionLog[] {
    return this.sessions
  }
}

// Singleton instance
export const voiceDebugLogger = new VoiceDebugLogger()

// Expose to window for console access in dev mode
if (isDev) {
  (window as any).voiceDebugLogger = voiceDebugLogger
}
