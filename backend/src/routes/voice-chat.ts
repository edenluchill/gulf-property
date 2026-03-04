/**
 * Voice Chat WebSocket Route
 *
 * Handles WebSocket connections for real-time voice chat with AI assistant
 */

import { Router } from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { Server } from 'http'
import { v4 as uuidv4 } from 'uuid'
import {
  createSession,
  connectToGemini,
  sendAudioToGemini,
  sendTextToGemini,
  sendEndOfTurnToGemini,
  endSession,
  getSession,
  updateSessionContext
} from '../services/voice-assistant'

const router = Router()

// Store WebSocket server reference
let wss: WebSocketServer | null = null

/**
 * Initialize WebSocket server for voice chat
 */
export function initVoiceChatWebSocket(server: Server): void {
  wss = new WebSocketServer({
    server,
    path: '/api/voice-chat'
  })

  console.log('🎤 Voice chat WebSocket server initialized at /api/voice-chat')

  wss.on('connection', async (ws: WebSocket, _req) => {
    const sessionId = uuidv4()
    console.log(`[Voice] New connection: ${sessionId}`)

    // Create session
    const session = createSession(sessionId, ws)

    // Send session ID to client
    ws.send(JSON.stringify({
      type: 'session_created',
      sessionId
    }))

    // Connect to Gemini Live API
    try {
      await connectToGemini(session)
    } catch (error) {
      console.error(`[Voice] Failed to connect to Gemini:`, error)
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to connect to AI service'
      }))
      ws.close()
      return
    }

    // Handle messages from client
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString())
        handleClientMessage(sessionId, message)
      } catch (error) {
        // If not JSON, might be raw audio data
        console.warn('[Voice] Non-JSON message received')
      }
    })

    // Handle client disconnect
    ws.on('close', () => {
      console.log(`[Voice] Connection closed: ${sessionId}`)
      endSession(sessionId)
    })

    ws.on('error', (error) => {
      console.error(`[Voice] WebSocket error for ${sessionId}:`, error)
      endSession(sessionId)
    })
  })
}

/**
 * Handle messages from client
 */
function handleClientMessage(sessionId: string, message: any): void {
  const session = getSession(sessionId)
  if (!session) {
    console.warn(`[Voice] Session not found: ${sessionId}`)
    return
  }

  switch (message.type) {
    case 'audio':
      // Client sending audio chunk
      if (message.data) {
        // Log occasionally to verify audio is flowing
        if (Math.random() < 0.1) {
          console.log(`[Voice] Received audio from client: ${message.data.length} bytes`)
        }
        sendAudioToGemini(session, message.data)
      }
      break

    case 'text':
      // Client sending text (fallback or debug)
      if (message.content) {
        sendTextToGemini(session, message.content)
      }
      break

    case 'end_turn':
      // Client indicates they're done speaking
      // Send explicit signal to Gemini to process the input
      console.log(`[Voice] End of turn signal for session ${sessionId}`)
      sendEndOfTurnToGemini(session)
      break

    case 'update_context':
      // Client updating preferences or map state
      if (message.context) {
        updateSessionContext(sessionId, message.context)
      }
      break

    case 'ping':
      // Keep-alive ping
      session.clientWs.send(JSON.stringify({ type: 'pong' }))
      break

    default:
      console.warn(`[Voice] Unknown message type: ${message.type}`)
  }
}

// Health check endpoint
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    websocket: wss ? 'initialized' : 'not initialized',
    activeConnections: wss ? wss.clients.size : 0
  })
})

export default router
