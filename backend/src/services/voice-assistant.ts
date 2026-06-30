/**
 * Voice Assistant Service
 *
 * Manages real-time voice conversations using Gemini Live API
 * Uses official @google/genai SDK for better reliability
 */

import { GoogleGenAI, Modality, Session, LiveServerMessage, Type } from '@google/genai'
import WebSocket from 'ws'
import { voiceAssistantTools, executeTool } from './voice-assistant-tools'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY

// Gemini 2.5 Flash with native audio support for Live API
// Reference: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-native-audio-preview-12-2025
const GEMINI_LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025'

// System instruction for the AI assistant
const SYSTEM_INSTRUCTION = `You are a friendly Dubai real estate consultant AI assistant. Your name is Luna.

Your personality:
- Warm and professional, like a knowledgeable friend
- Proactive in guiding users, not just answering questions
- Give specific recommendations with data, not generic advice
- Keep responses concise (2-3 sentences max) since this is voice conversation

Your capabilities:
- Search for properties by area, price, bedrooms, developer
- Show area information and market metrics (rental yield, price growth)
- Compare different Dubai areas
- Show nearby amenities (schools, hospitals, malls, metro stations)
- Cite OFFICIAL KHDA school inspection ratings for nearby schools when the amenity
  tools return them (6 tiers: Outstanding 卓越 / Very Good 优秀 / Good 良好 /
  Acceptable 合格 / Weak 欠佳 / Very Weak 很差; 2023-24 cycle). For families this is
  the #1 decision driver — name the school and its rating when relevant. Only state a
  rating the tool actually returned; never invent one.
- Navigate the map to specific areas
- Help users find their ideal property

Conversation flow:
1. Greet users warmly and ask about their needs (investment or living)
2. Ask about budget and preferences
3. Recommend suitable areas based on their needs
4. Show specific projects and explain why they're good matches
5. Guide users to next steps (view details, save favorites, compare)

Language:
- Detect user's language (English or Chinese) and respond in the same language
- Use natural, conversational tone
- Avoid jargon, explain market terms simply

Example responses:
- "Hi! I'm Luna, your Dubai property guide. Are you looking to invest or find a home to live in?"
- "With 2 million budget, I'd recommend Business Bay - 6% rental yield and growing fast. Let me show you."
- "This area has 3 metro stations nearby. Great for commuting!"

IMPORTANT: Always use the available tools to show information on the map. Don't just describe - demonstrate on the map.`

// Convert tools format for SDK
function convertToolsForSDK() {
  // The SDK expects tools with proper Schema types
  // We need to convert our string types to Type enum values
  const convertType = (type: string): Type => {
    switch (type) {
      case 'string': return Type.STRING
      case 'number': return Type.NUMBER
      case 'boolean': return Type.BOOLEAN
      case 'object': return Type.OBJECT
      case 'array': return Type.ARRAY
      default: return Type.STRING
    }
  }

  const convertProperties = (properties: Record<string, any>): Record<string, any> => {
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(properties)) {
      result[key] = {
        ...value,
        type: convertType(value.type)
      }
    }
    return result
  }

  return voiceAssistantTools.flatMap(tool =>
    tool.functionDeclarations.map(fn => ({
      name: fn.name,
      description: fn.description,
      parameters: fn.parameters ? {
        type: convertType(fn.parameters.type),
        properties: fn.parameters.properties ? convertProperties(fn.parameters.properties) : undefined,
        required: fn.parameters.required
      } : undefined
    }))
  )
}

interface VoiceSession {
  id: string
  geminiSession: Session | null
  clientWs: WebSocket
  isConnected: boolean
  context: {
    userPreferences: {
      purpose?: 'investment' | 'living' | 'both'
      budget?: { min: number; max: number }
      preferredAreas?: string[]
      bedrooms?: number
    }
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
    currentMapState?: {
      center?: { lat: number; lng: number }
      highlightedProjects?: string[]
    }
  }
}

const sessions = new Map<string, VoiceSession>()

// Initialize Google GenAI client
let genAI: GoogleGenAI | null = null

function getGenAI(): GoogleGenAI {
  if (!genAI) {
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured')
    }
    genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  }
  return genAI
}

/**
 * Create a new voice session
 */
export function createSession(sessionId: string, clientWs: WebSocket): VoiceSession {
  const session: VoiceSession = {
    id: sessionId,
    geminiSession: null,
    clientWs,
    isConnected: false,
    context: {
      userPreferences: {},
      conversationHistory: []
    }
  }
  sessions.set(sessionId, session)
  return session
}

/**
 * Connect to Gemini Live API using official SDK
 */
export async function connectToGemini(session: VoiceSession): Promise<void> {
  const ai = getGenAI()

  console.log(`[Voice] Connecting session ${session.id} to Gemini Live API (SDK)...`)

  try {
    const geminiSession = await ai.live.connect({
      model: GEMINI_LIVE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Aoede'
            }
          }
        },
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }]
        },
        tools: [{ functionDeclarations: convertToolsForSDK() }]
      },
      callbacks: {
        onopen: () => {
          console.log(`[Voice] WebSocket opened for session ${session.id}`)
          console.log(`[Voice] Model: ${GEMINI_LIVE_MODEL}`)
          session.isConnected = true
          sendToClient(session, { type: 'ready' })

          // Send initial greeting after a short delay
          setTimeout(() => {
            if (session.geminiSession) {
              session.geminiSession.sendClientContent({
                turns: [{
                  role: 'user',
                  parts: [{ text: "Please greet the user warmly and ask what they're looking for." }]
                }],
                turnComplete: true
              })
            }
          }, 500)
        },
        onmessage: async (message: LiveServerMessage) => {
          await handleGeminiMessage(session, message)
        },
        onerror: (e: ErrorEvent) => {
          console.error(`[Voice] Gemini error for session ${session.id}:`, e)
          console.error(`[Voice] Error details:`, JSON.stringify(e, null, 2))
          sendToClient(session, {
            type: 'error',
            message: e.message || 'Connection error'
          })
        },
        onclose: (e: CloseEvent) => {
          console.log(`[Voice] Gemini connection closed for session ${session.id}`)
          console.log(`[Voice] Close code: ${e.code}, reason: ${e.reason}, wasClean: ${e.wasClean}`)
          session.isConnected = false
          session.geminiSession = null
        }
      }
    })

    session.geminiSession = geminiSession
  } catch (error) {
    console.error(`[Voice] Failed to connect to Gemini:`, error)
    throw error
  }
}

/**
 * Handle messages from Gemini Live API
 */
async function handleGeminiMessage(session: VoiceSession, message: LiveServerMessage): Promise<void> {
  // Log message type for debugging
  console.log(`[Voice] Gemini message type:`, Object.keys(message).join(', '))

  // Handle setup complete
  if (message.setupComplete) {
    console.log(`[Voice] Setup complete for session ${session.id}`)
    return
  }

  // Handle server content (AI response)
  if (message.serverContent) {
    const content = message.serverContent

    // Check if interrupted
    if (content.interrupted) {
      console.log(`[Voice] Response interrupted for session ${session.id}`)
      sendToClient(session, { type: 'interrupted' })
      return
    }

    // Handle input transcription (what the user said)
    if (content.inputTranscription) {
      const text = extractText(content.inputTranscription)
      if (text) {
        console.log(`[Voice] User said: ${text}`)
        sendToClient(session, { type: 'user_speech', content: text })
        session.context.conversationHistory.push({ role: 'user', content: text })
      }
    }

    // Handle output transcription (what the AI is saying)
    if (content.outputTranscription) {
      const text = extractText(content.outputTranscription)
      if (text) {
        console.log(`[Voice] AI saying: ${text}`)
        sendToClient(session, { type: 'text', content: text })
      }
    }

    // Process model turn parts
    if (content.modelTurn?.parts) {
      for (const part of content.modelTurn.parts) {
        // Text response
        if (part.text) {
          console.log(`[Voice] AI text: ${part.text.substring(0, 100)}...`)
          sendToClient(session, { type: 'text', content: part.text })
          session.context.conversationHistory.push({ role: 'assistant', content: part.text })
        }

        // Audio response
        if (part.inlineData) {
          sendToClient(session, {
            type: 'audio',
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType
          })
        }
      }
    }

    // Turn complete
    if (content.turnComplete) {
      sendToClient(session, { type: 'turn_complete' })
    }
  }

  // Handle tool call
  if (message.toolCall) {
    console.log(`[Voice] Tool call for session ${session.id}`)
    await handleToolCall(session, message.toolCall)
  }
}

/**
 * Extract text from transcription (handles both string and object formats)
 */
function extractText(transcription: unknown): string | null {
  if (typeof transcription === 'string') {
    return transcription
  }
  if (transcription && typeof transcription === 'object' && 'text' in transcription) {
    return (transcription as { text: string }).text
  }
  return null
}

/**
 * Handle tool calls from Gemini
 */
async function handleToolCall(session: VoiceSession, toolCall: any): Promise<void> {
  const functionResponses: any[] = []

  for (const fc of toolCall.functionCalls || []) {
    console.log(`[Voice] Executing tool: ${fc.name}`, fc.args)

    try {
      const { result, summary, mapAction } = await executeTool(fc.name, fc.args || {})

      // Send map action to client
      if (mapAction) {
        sendToClient(session, { type: 'map_action', action: mapAction })
      }

      functionResponses.push({
        id: fc.id,
        name: fc.name,
        response: { result: JSON.stringify(result), summary }
      })
    } catch (error) {
      console.error(`[Voice] Error executing tool ${fc.name}:`, error)
      functionResponses.push({
        id: fc.id,
        name: fc.name,
        response: { error: `Failed to execute ${fc.name}`, summary: `Sorry, I couldn't complete that action.` }
      })
    }
  }

  // Send tool responses back to Gemini
  if (session.geminiSession) {
    session.geminiSession.sendToolResponse({ functionResponses })
  }
}

// Track audio chunks for debugging
let audioChunkCount = 0

/**
 * Send audio data to Gemini using SDK
 */
export function sendAudioToGemini(session: VoiceSession, audioData: string): void {
  if (!session.geminiSession || !session.isConnected) {
    console.warn(`[Voice] Cannot send audio - session ${session.id} not connected`)
    return
  }

  audioChunkCount++
  if (audioChunkCount % 10 === 1) {
    console.log(`[Voice] Sending audio chunk #${audioChunkCount} (${audioData.length} chars)`)
  }

  // Use SDK's sendRealtimeInput method
  session.geminiSession.sendRealtimeInput({
    audio: {
      data: audioData,
      mimeType: 'audio/pcm;rate=16000'
    }
  })
}

/**
 * Send end of turn signal to Gemini
 */
export function sendEndOfTurnToGemini(session: VoiceSession): void {
  if (!session.geminiSession || !session.isConnected) {
    console.warn(`[Voice] Cannot send end of turn - session ${session.id} not connected`)
    return
  }

  console.log(`[Voice] Sending end of turn for session ${session.id}`)

  // SDK handles end of turn automatically with VAD
  // But we can send an explicit signal if needed
  session.geminiSession.sendRealtimeInput({
    audioStreamEnd: true
  })
}

/**
 * Send text to Gemini (for system prompts or text input fallback)
 */
export function sendTextToGemini(session: VoiceSession, text: string): void {
  if (!session.geminiSession || !session.isConnected) {
    console.warn(`[Voice] Cannot send text - session ${session.id} not connected`)
    return
  }

  session.geminiSession.sendClientContent({
    turns: [{
      role: 'user',
      parts: [{ text }]
    }],
    turnComplete: true
  })

  session.context.conversationHistory.push({ role: 'user', content: text })
}

/**
 * Send message to client WebSocket
 */
function sendToClient(session: VoiceSession, message: any): void {
  if (session.clientWs.readyState === WebSocket.OPEN) {
    session.clientWs.send(JSON.stringify(message))
  }
}

/**
 * End voice session
 */
export function endSession(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (session) {
    if (session.geminiSession) {
      session.geminiSession.close()
    }
    sessions.delete(sessionId)
    console.log(`[Voice] Session ${sessionId} ended`)
  }
}

/**
 * Get session by ID
 */
export function getSession(sessionId: string): VoiceSession | undefined {
  return sessions.get(sessionId)
}

/**
 * Update session context
 */
export function updateSessionContext(
  sessionId: string,
  updates: Partial<VoiceSession['context']>
): void {
  const session = sessions.get(sessionId)
  if (session) {
    session.context = { ...session.context, ...updates }
  }
}
