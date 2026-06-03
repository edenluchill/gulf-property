/**
 * Luna Tour — live Q&A hook (§4.6).
 *
 * Connects the paused tour to Gemini Live (same voice = Aoede, same audio
 * plumbing as the main voice assistant) so the customer can hold-to-talk and ask
 * Luna anything. Tool calls run through the existing /api/voice/tools/execute,
 * and any returned mapAction is routed to the TOUR map handle (so answers are
 * drawn on the same cinematic map). Token + system instruction come from the
 * parameterized /live-token endpoint (agent + current property + spoken-so-far).
 *
 * ISOLATION: self-contained. Reuses AudioRecorder/AudioPlayer hooks only. Delete
 * this file + the TourOverlay wiring to remove Live; the rest of the tour is
 * unaffected.
 */
import { useCallback, useRef, useState } from 'react'
import { GoogleGenAI, Modality, Type, type LiveServerMessage } from '@google/genai'
import { AudioRecorder, AudioPlayer } from '../hooks/voice-assistant/audioUtils'
import { API_BASE_URL } from '../lib/config'
import type { MapTourHandle } from './map/mapTourHandle'

const GEMINI_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025'

export type TourLivePhase = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error'

// Minimal map-focused tools — executed server-side, drawn on the tour map.
const TOUR_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'measure_distance',
        description: 'Draw distance lines on the map from a center place to destinations, each labeled with km. Use for "how far is X from the metro/beach/mall/airport".',
        parameters: {
          type: Type.OBJECT,
          properties: {
            places: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'First item = center; the rest get a line+distance from it.' },
          },
          required: ['places'],
        },
      },
      {
        name: 'analyze_area_amenities',
        description: 'Analyze how convenient an area is — nearest hospital/school/mall/metro/supermarket with distances + a 0-100 score, drawn as radial spokes. Use for "how convenient/livable is X".',
        parameters: {
          type: Type.OBJECT,
          properties: { area_name: { type: Type.STRING, description: 'Dubai area or project name' } },
          required: ['area_name'],
        },
      },
      {
        name: 'fly_to',
        description: 'Move the map camera to a Dubai area or place.',
        parameters: {
          type: Type.OBJECT,
          properties: { area: { type: Type.STRING, description: 'Area/place name' } },
          required: ['area'],
        },
      },
      {
        name: 'show_nearby_pois',
        description: 'Show (or hide) a category of points-of-interest on the map as labeled markers — the SAME filter the customer can toggle by hand. Use for "show the schools / hospitals / malls / parks nearby" or "hide the restaurants". Pass hide=true to hide.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            category: {
              type: Type.STRING,
              description: 'hospital, clinic, pharmacy, school, university, mall, supermarket, restaurant, cafe, bank, atm, gas_station, hotel, mosque, church, park, gym, beach, cinema, police, fire_station, post_office, embassy',
            },
            hide: { type: Type.BOOLEAN, description: 'true → hide this category instead of showing it' },
          },
          required: ['category'],
        },
      },
    ],
  },
]

interface TourLiveContext {
  shareCode: string
  propertyName?: string
  propertyArea?: string
  spokenSoFar?: string
}

export function useTourLive(
  getMap: () => MapTourHandle | null,
  onPoiCategory?: (category: string, hide?: boolean) => void
) {
  const [phase, setPhase] = useState<TourLivePhase>('idle')
  const [lastReply, setLastReply] = useState('')
  const sessionRef = useRef<{ close: () => void; sendRealtimeInput: (i: unknown) => void; sendToolResponse: (r: unknown) => void } | null>(null)
  const recorderRef = useRef<AudioRecorder | null>(null)
  const playerRef = useRef<AudioPlayer | null>(null)
  const connectingRef = useRef(false)

  const routeMapAction = useCallback(
    (action: { type?: string; points?: [number, number][]; center?: [number, number]; spokes?: { label: string; distance_km?: number; distanceKm?: number }[]; score?: number; tier?: string; lat?: number; lng?: number; zoom?: number; category?: string; hide?: boolean }) => {
      const map = getMap()
      if (!action?.type) return
      // POI filter is host-map state (not a tour-map overlay) → route to the
      // shared filter the customer also controls, even if the map handle is null.
      if (action.type === 'show_pois' && action.category) {
        onPoiCategory?.(action.category, action.hide)
        return
      }
      if (!map) return
      if (action.type === 'measure_distance' && action.points?.length) {
        const [hub, ...rest] = action.points
        rest.forEach((to) => map.drawDistanceLine({ from: hub, to, label: '' }))
      } else if (action.type === 'amenity_spokes' && action.center) {
        map.showAmenitySpokes({
          center: action.center,
          spokes: (action.spokes || []).map((s) => ({ label: s.label, distance_km: s.distance_km ?? s.distanceKm ?? 0 })),
          score: action.score ?? 0,
          tier: action.tier,
        })
      } else if (action.type === 'fly_to' && action.lat != null && action.lng != null) {
        void map.flyTo({ center: [action.lng, action.lat], zoom: action.zoom ?? 14, pitch: 55, duration: 1800 })
      }
    },
    [getMap, onPoiCategory]
  )

  const executeTool = useCallback(async (toolName: string, params: unknown): Promise<unknown> => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/voice/tools/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName, params }),
      })
      const data = await r.json()
      if (data.mapAction) routeMapAction(data.mapAction)
      return data.result ?? { ok: true }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'tool failed' }
    }
  }, [routeMapAction])

  const handleMessage = useCallback(
    async (message: LiveServerMessage) => {
      // audio out
      const parts = message.serverContent?.modelTurn?.parts
      if (parts) {
        for (const p of parts) {
          const inline = (p as { inlineData?: { data?: string } }).inlineData
          if (inline?.data) {
            setPhase('speaking')
            await playerRef.current?.play(inline.data)
          }
        }
      }
      const outText = message.serverContent?.outputTranscription?.text
      if (outText) setLastReply((prev) => prev + outText)
      // tool calls
      const calls = message.toolCall?.functionCalls
      if (calls?.length) {
        const responses = []
        for (const fc of calls) {
          const result = await executeTool(fc.name as string, fc.args || {})
          responses.push({ id: fc.id, name: fc.name, response: { result } })
        }
        sessionRef.current?.sendToolResponse({ functionResponses: responses })
      }
      if (message.serverContent?.turnComplete) setPhase('listening')
    },
    [executeTool]
  )

  const connect = useCallback(
    async (ctx: TourLiveContext) => {
      if (connectingRef.current || sessionRef.current) return
      connectingRef.current = true
      setPhase('connecting')
      setLastReply('')
      try {
        const tr = await fetch(`${API_BASE_URL}/api/luna/public/v/${encodeURIComponent(ctx.shareCode)}/live-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            property_name: ctx.propertyName,
            property_area: ctx.propertyArea,
            spoken_so_far: ctx.spokenSoFar,
          }),
        })
        const td = await tr.json()
        if (!td.token) throw new Error('no token')

        playerRef.current = new AudioPlayer((speaking) => setPhase(speaking ? 'speaking' : 'listening'))
        await playerRef.current.prewarm()

        const ai = new GoogleGenAI({ apiKey: td.token, httpOptions: { apiVersion: 'v1alpha' } })
        const session = await ai.live.connect({
          model: GEMINI_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction: { parts: [{ text: td.systemInstruction }] },
            tools: TOUR_TOOLS as never,
          },
          callbacks: {
            onopen: () => {
              connectingRef.current = false
              setPhase('listening')
              const rec = new AudioRecorder()
              recorderRef.current = rec
              void rec.start((b64) => {
                sessionRef.current?.sendRealtimeInput({ audio: { data: b64, mimeType: 'audio/pcm;rate=16000' } })
              })
            },
            onmessage: handleMessage,
            onerror: () => {
              connectingRef.current = false
              setPhase('error')
            },
            onclose: () => {
              recorderRef.current?.stop()
              recorderRef.current = null
              connectingRef.current = false
              sessionRef.current = null
            },
          },
        })
        sessionRef.current = session as unknown as typeof sessionRef.current
      } catch {
        connectingRef.current = false
        setPhase('error')
        setTimeout(() => setPhase('idle'), 2500)
      }
    },
    [handleMessage]
  )

  const disconnect = useCallback(() => {
    recorderRef.current?.stop()
    recorderRef.current = null
    playerRef.current?.close()
    playerRef.current = null
    try {
      sessionRef.current?.close()
    } catch {
      /* ignore */
    }
    sessionRef.current = null
    connectingRef.current = false
    setPhase('idle')
  }, [])

  return { phase, lastReply, connect, disconnect }
}
