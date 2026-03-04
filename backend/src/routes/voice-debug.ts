/**
 * Voice Debug API
 *
 * Saves voice session debug logs to files for analysis
 * Only active in development mode
 */

import { Router } from 'express'
import fs from 'fs'
import path from 'path'

const router = Router()

// Debug logs directory
const DEBUG_DIR = path.join(process.cwd(), 'voice-debug-logs')

// Ensure directory exists
if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true })
}

/**
 * POST /api/voice/debug/session
 * Save a complete session log
 */
router.post('/session', async (req, res) => {
  // Only allow in development
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Debug logs disabled in production' })
  }

  try {
    const sessionLog = req.body

    if (!sessionLog || !sessionLog.sessionId) {
      return res.status(400).json({ error: 'Invalid session log' })
    }

    const filename = `session-${sessionLog.sessionId}.json`
    const filepath = path.join(DEBUG_DIR, filename)

    // Write session log to file
    fs.writeFileSync(filepath, JSON.stringify(sessionLog, null, 2))

    // Also append a summary to a master log file
    const summaryFile = path.join(DEBUG_DIR, 'sessions-summary.log')
    const summary = formatSessionSummary(sessionLog)
    fs.appendFileSync(summaryFile, summary + '\n\n')

    console.log(`[Voice Debug] Saved session: ${filename}`)

    res.json({
      success: true,
      file: filename,
      path: filepath
    })
  } catch (error) {
    console.error('[Voice Debug] Error saving session:', error)
    res.status(500).json({ error: 'Failed to save session log' })
  }
})

/**
 * GET /api/voice/debug/sessions
 * List all saved sessions
 */
router.get('/sessions', async (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Debug logs disabled in production' })
  }

  try {
    const files = fs.readdirSync(DEBUG_DIR)
      .filter(f => f.startsWith('session-') && f.endsWith('.json'))
      .map(f => {
        const filepath = path.join(DEBUG_DIR, f)
        const stat = fs.statSync(filepath)
        const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'))
        return {
          filename: f,
          sessionId: content.sessionId,
          startTime: content.startTime,
          duration: content.duration,
          messageCount: content.messages?.length || 0,
          toolCallCount: content.metrics?.totalToolCalls || 0,
          errorCount: content.errors?.length || 0,
          createdAt: stat.mtime
        }
      })
      .sort((a, b) => b.startTime - a.startTime)

    res.json({ sessions: files })
  } catch (error) {
    console.error('[Voice Debug] Error listing sessions:', error)
    res.status(500).json({ error: 'Failed to list sessions' })
  }
})

/**
 * GET /api/voice/debug/session/:id
 * Get a specific session log
 */
router.get('/session/:id', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Debug logs disabled in production' })
  }

  try {
    const filename = `session-${req.params.id}.json`
    const filepath = path.join(DEBUG_DIR, filename)

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'))
    res.json(content)
  } catch (error) {
    console.error('[Voice Debug] Error reading session:', error)
    res.status(500).json({ error: 'Failed to read session' })
  }
})

/**
 * GET /api/voice/debug/latest
 * Get the most recent session with full analysis
 */
router.get('/latest', async (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Debug logs disabled in production' })
  }

  try {
    const files = fs.readdirSync(DEBUG_DIR)
      .filter(f => f.startsWith('session-') && f.endsWith('.json'))

    if (files.length === 0) {
      return res.status(404).json({ error: 'No sessions found' })
    }

    // Find most recent
    let latest = { file: '', time: 0 }
    for (const f of files) {
      const content = JSON.parse(fs.readFileSync(path.join(DEBUG_DIR, f), 'utf-8'))
      if (content.startTime > latest.time) {
        latest = { file: f, time: content.startTime }
      }
    }

    const content = JSON.parse(fs.readFileSync(path.join(DEBUG_DIR, latest.file), 'utf-8'))
    const analysis = analyzeSession(content)

    res.json({
      session: content,
      analysis
    })
  } catch (error) {
    console.error('[Voice Debug] Error:', error)
    res.status(500).json({ error: 'Failed to get latest session' })
  }
})

function formatSessionSummary(session: any): string {
  const date = new Date(session.startTime).toISOString()
  const duration = session.duration ? `${(session.duration / 1000).toFixed(1)}s` : 'N/A'
  const metrics = session.metrics || {}

  return `
========================================
Session: ${session.sessionId}
Time: ${date}
Duration: ${duration}
----------------------------------------
Connection:
  - Token fetch: ${metrics.tokenFetchTime || 'N/A'}ms
  - WebSocket connect: ${metrics.connectionTime || 'N/A'}ms
  - Total connect: ${metrics.totalConnectTime || 'N/A'}ms
  - First greeting: ${metrics.firstGreetingTime || 'N/A'}ms

Conversation:
  - Messages: ${session.messages?.length || 0}
  - User speech time: ${metrics.totalUserSpeechTime || 0}ms
  - Avg response latency: ${metrics.avgResponseLatency || 'N/A'}ms
  - Interruptions: ${metrics.interruptionCount || 0}

Tools:
  - Total calls: ${metrics.totalToolCalls || 0}
  - Failed: ${metrics.failedToolCalls || 0}
  - Avg duration: ${metrics.avgToolCallTime || 'N/A'}ms

Errors: ${session.errors?.length || 0}
${session.errors?.map((e: any) => `  - ${e.type}: ${e.message}`).join('\n') || '  None'}

UX Issues:
${getUXIssues(metrics).map(i => `  ⚠️ ${i}`).join('\n') || '  ✅ All good'}
========================================`
}

function getUXIssues(metrics: any): string[] {
  const issues: string[] = []

  if ((metrics.totalConnectTime || 0) > 3000) {
    issues.push(`Slow connection: ${metrics.totalConnectTime}ms (target: <3000ms)`)
  }
  if ((metrics.firstGreetingTime || 0) > 5000) {
    issues.push(`Slow first greeting: ${metrics.firstGreetingTime}ms (target: <5000ms)`)
  }
  if ((metrics.avgResponseLatency || 0) > 2000) {
    issues.push(`High response latency: ${metrics.avgResponseLatency}ms (target: <2000ms)`)
  }
  if ((metrics.failedToolCalls || 0) > 0) {
    issues.push(`${metrics.failedToolCalls} tool call(s) failed`)
  }

  return issues
}

function analyzeSession(session: any): any {
  const metrics = session.metrics || {}
  const events = session.events || []
  const toolCalls = session.toolCalls || []
  const messages = session.messages || []
  const errors = session.errors || []

  return {
    summary: {
      duration: session.duration,
      totalConnectTime: metrics.totalConnectTime,
      firstGreetingTime: metrics.firstGreetingTime,
      messageCount: messages.length,
      toolCallCount: toolCalls.length,
      errorCount: errors.length
    },
    uxScore: calculateUXScore(metrics),
    issues: getUXIssues(metrics),
    timeline: events.map((e: any) => ({
      event: e.event,
      elapsed: e.elapsed,
      delta: e.delta
    })),
    toolCallDetails: toolCalls.map((t: any) => ({
      name: t.name,
      duration: t.duration,
      success: !t.error,
      params: t.params
    })),
    conversationFlow: messages.map((m: any) => ({
      role: m.role,
      preview: m.content?.substring(0, 100),
      latency: m.latency
    })),
    errors: errors.map((e: any) => ({
      type: e.type,
      message: e.message,
      timestamp: e.timestamp
    }))
  }
}

function calculateUXScore(metrics: any): { score: number; grade: string; details: string[] } {
  let score = 100
  const details: string[] = []

  // Connection time (target: <2s, acceptable: <3s)
  const connectTime = metrics.totalConnectTime || 0
  if (connectTime > 3000) {
    score -= 20
    details.push(`Connection slow: ${connectTime}ms (-20)`)
  } else if (connectTime > 2000) {
    score -= 10
    details.push(`Connection moderate: ${connectTime}ms (-10)`)
  } else {
    details.push(`Connection good: ${connectTime}ms`)
  }

  // First greeting (target: <3s, acceptable: <5s)
  const greetingTime = metrics.firstGreetingTime || 0
  if (greetingTime > 5000) {
    score -= 20
    details.push(`Greeting very slow: ${greetingTime}ms (-20)`)
  } else if (greetingTime > 3000) {
    score -= 10
    details.push(`Greeting slow: ${greetingTime}ms (-10)`)
  } else {
    details.push(`Greeting good: ${greetingTime}ms`)
  }

  // Response latency (target: <1.5s, acceptable: <2s)
  const responseLatency = metrics.avgResponseLatency || 0
  if (responseLatency > 2000) {
    score -= 20
    details.push(`Response latency high: ${responseLatency}ms (-20)`)
  } else if (responseLatency > 1500) {
    score -= 10
    details.push(`Response latency moderate: ${responseLatency}ms (-10)`)
  } else if (responseLatency > 0) {
    details.push(`Response latency good: ${responseLatency}ms`)
  }

  // Tool failures
  const failedTools = metrics.failedToolCalls || 0
  if (failedTools > 0) {
    score -= failedTools * 15
    details.push(`Tool failures: ${failedTools} (-${failedTools * 15})`)
  }

  // Grade
  let grade = 'A'
  if (score < 60) grade = 'F'
  else if (score < 70) grade = 'D'
  else if (score < 80) grade = 'C'
  else if (score < 90) grade = 'B'

  return { score: Math.max(0, score), grade, details }
}

export default router
