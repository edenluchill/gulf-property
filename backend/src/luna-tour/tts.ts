/**
 * Luna Tour — Gemini text-to-speech (single voice = Aoede).
 *
 * Synthesizes a beat's narration into a browser-playable WAV using the Gemini
 * TTS model. This is what makes the MAIN tour narration the same voice as the
 * Live Q&A (both Aoede) — replacing the browser speechSynthesis fallback.
 *
 * ISOLATION: lives under backend/src/luna-tour/. Uses only @google/genai + the
 * GEMINI_API_KEY already in .env. Delete the luna-tour dir to remove it.
 *
 * Gemini TTS returns RAW PCM (signed 16-bit, 24 kHz, mono). Browsers can't play
 * raw PCM, so we wrap it in a 44-byte WAV header → an <audio>-playable Blob.
 */
import { GoogleGenAI } from '@google/genai'
import { TTS_CHAIN } from '../services/ai/models'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

// Try the configured model first, then known TTS preview names. The first that
// returns audio wins (mirrors tour-generator's model-fallback resilience).
const TTS_MODELS = TTS_CHAIN.filter(Boolean) as string[]

const PCM_SAMPLE_RATE = 24000
const PCM_CHANNELS = 1
const PCM_BITS = 16

/** Wrap raw little-endian PCM (s16le) in a minimal WAV container. */
export function pcmToWav(
  pcm: Buffer,
  sampleRate = PCM_SAMPLE_RATE,
  channels = PCM_CHANNELS,
  bitsPerSample = PCM_BITS
): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8
  const blockAlign = (channels * bitsPerSample) / 8
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // PCM fmt chunk size
  header.writeUInt16LE(1, 20) // audio format = PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/** The first TTS model that successfully produced audio this process (cached). */
let resolvedModel: string | null = null

export interface SynthOptions {
  /** Prebuilt voice name (Aoede/Puck/Charon/Kore/Fenrir). Default Aoede. */
  voice?: string
  /** Optional style hint prepended as a TTS instruction (not read aloud). */
  style?: string
}

/**
 * Synthesize narration → WAV Buffer. Returns null on total failure (caller then
 * leaves audio_url empty so the client falls back to browser TTS for that beat).
 */
export async function synthesizeSpeech(text: string, opts: SynthOptions = {}): Promise<Buffer | null> {
  if (!text?.trim()) return null
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[luna-tts] GEMINI_API_KEY not set — skipping TTS')
    return null
  }
  const voice = opts.voice || 'Aoede'
  const prompt = opts.style ? `${opts.style}\n\n${text}` : text
  const models = resolvedModel ? [resolvedModel] : TTS_MODELS

  for (const model of models) {
    try {
      const resp = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
        },
      })
      const data = resp.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
      if (!data) continue
      resolvedModel = model
      return pcmToWav(Buffer.from(data, 'base64'))
    } catch (err) {
      console.warn(`[luna-tts] model ${model} failed:`, err instanceof Error ? err.message : err)
    }
  }
  return null
}
