/**
 * Luna Tour — pre-generate narration audio for a session (one voice = Aoede).
 *
 * For every spoken beat (intro + each act beat + outro) we TTS the narration
 * with Gemini, wrap as WAV, upload to R2, and write the public URL back into the
 * stored TourScript's `beat.audio_url`. The watch page then plays REAL Gemini
 * audio (same voice as Live Q&A) instead of the browser speechSynthesis fallback.
 *
 * ISOLATION: backend/src/luna-tour/ only. Reads/writes lt_tour_scripts +
 * lt_audio_assets (both lt_-prefixed). Reuses tts.ts + r2-storage.uploadBufferToR2.
 *
 * Resilient: a beat whose TTS fails is left without audio_url (client falls back
 * to browser TTS for just that beat) and recorded status='failed' — generation
 * never throws so it can't block session creation.
 */
import pool from '../db/pool'
import { synthesizeSpeech } from './tts'
import { uploadBufferToR2 } from '../services/r2-storage'
import { TourScript, Beat } from './tour-script.types'

/** Retry a flaky async op (Gemini / R2 over a shaky link) with linear backoff. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 1200): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)))
    }
  }
  throw lastErr
}

/** Run async jobs with a small concurrency cap (keep API + memory sane). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** Every beat that gets spoken, in playback order (transitions are not voiced). */
function spokenBeats(script: TourScript): Beat[] {
  const beats: Beat[] = [script.intro]
  for (const act of script.acts) beats.push(...act.beats)
  beats.push(script.outro)
  return beats
}

export interface AudioGenResult {
  total: number
  ready: number
  failed: number
  skipped: number
}

export interface AudioGenOptions {
  /** Re-synthesize beats that already have an audio_url. Default false. */
  force?: boolean
  /** Concurrency. Default 4. */
  concurrency?: number
}

/**
 * Generate + attach audio for one session. Loads its TourScript, synthesizes
 * each beat, uploads to R2, and persists the enriched script. Idempotent: skips
 * beats that already have audio unless `force`.
 */
export async function generateSessionAudio(
  sessionId: string,
  opts: AudioGenOptions = {}
): Promise<AudioGenResult> {
  const concurrency = opts.concurrency ?? 2

  const { rows } = await pool.query(
    `SELECT language, voice, script FROM lt_tour_scripts WHERE session_id = $1 LIMIT 1`,
    [sessionId]
  )
  if (rows.length === 0) throw new Error(`no tour script for session ${sessionId}`)

  const language: string = rows[0].language || 'zh'
  const voice: string = rows[0].voice || 'Aoede'
  // pg returns jsonb as a parsed object already
  const script: TourScript = typeof rows[0].script === 'string' ? JSON.parse(rows[0].script) : rows[0].script

  const beats = spokenBeats(script)
  const result: AudioGenResult = { total: beats.length, ready: 0, failed: 0, skipped: 0 }

  await mapLimit(beats, concurrency, async (beat) => {
    if (beat.audio_url && !opts.force) {
      result.skipped++
      return
    }
    try {
      const key = `luna-tour/audio/${sessionId}/${beat.id}-${language}.wav`
      // Synthesize + upload as one retried unit — both legs can flake on a poor
      // link (Gemini ECONNRESET / R2 request timeout). Retrying the pair is
      // simplest and idempotent (same key overwrites).
      const url = await withRetry(async () => {
        const wav = await synthesizeSpeech(beat.narration, { voice })
        if (!wav) throw new Error('tts returned no audio')
        return uploadBufferToR2(key, wav, 'audio/wav')
      })
      beat.audio_url = url
      result.ready++
      await recordAsset(sessionId, beat.id, language, voice, url, 'ready')
    } catch (err) {
      result.failed++
      console.warn(`[luna-audio] beat ${beat.id} failed:`, err instanceof Error ? err.message : err)
      await recordAsset(sessionId, beat.id, language, voice, null, 'failed')
    }
  })

  // Persist the enriched script (now carrying audio_url per beat).
  await pool.query(`UPDATE lt_tour_scripts SET script = $2 WHERE session_id = $1`, [
    sessionId,
    JSON.stringify(script),
  ])

  return result
}

/** Upsert one beat's audio asset row (status tracking / future regen). */
async function recordAsset(
  sessionId: string,
  beatId: string,
  language: string,
  voice: string,
  url: string | null,
  status: 'ready' | 'failed'
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO lt_audio_assets (session_id, beat_id, language, voice, r2_url, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (session_id, beat_id, language)
       DO UPDATE SET r2_url = EXCLUDED.r2_url, voice = EXCLUDED.voice, status = EXCLUDED.status`,
      [sessionId, beatId, language, voice, url, status]
    )
  } catch (err) {
    console.warn('[luna-audio] asset record failed:', err instanceof Error ? err.message : err)
  }
}
