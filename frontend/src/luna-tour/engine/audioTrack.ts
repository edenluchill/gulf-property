/**
 * Luna Tour — audio track.
 *
 * Plays a beat's narration: pre-generated mp3 (audio_url) when present, else
 * browser speechSynthesis fallback (§4.5).
 *
 * EVENT-DRIVEN: play() takes an onDone callback fired when the narration ACTUALLY
 * finishes (mp3 `ended` / TTS `onend`). The engine uses this to advance beats —
 * never a guessed duration — so a line is never cut off mid-sentence regardless
 * of language / TTS / speed. (A safety backstop lives in the engine's pausable
 * clock, not here, so it survives pause.)
 */
export class AudioTrack {
  private audioEl: HTMLAudioElement | null = null
  private muted = false
  private lang = 'zh-CN'
  private preferredVoice: SpeechSynthesisVoice | null = null
  private doneCb: (() => void) | null = null

  constructor(language: string) {
    this.lang = language?.startsWith('zh') ? 'zh-CN' : language || 'en-US'
    this.loadVoices()
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => this.loadVoices()
    }
  }

  private loadVoices() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const voices = window.speechSynthesis.getVoices()
    const langPrefix = this.lang.split('-')[0]
    this.preferredVoice =
      voices.find((v) => v.lang?.toLowerCase().startsWith(langPrefix) && /female|google|mei|ting|hua/i.test(v.name)) ||
      voices.find((v) => v.lang?.toLowerCase().startsWith(langPrefix)) ||
      null
  }

  get isMuted() {
    return this.muted
  }

  setMuted(m: boolean) {
    this.muted = m
    if (m) this.stop()
  }

  private fireDone() {
    const cb = this.doneCb
    this.doneCb = null
    if (cb) cb()
  }

  /**
   * Play one beat's narration; call onDone when it FINISHES (or immediately when
   * muted / no audio available). Best-effort — any failure resolves via onDone so
   * the tour never stalls.
   */
  play(
    narration: string,
    audioUrl: string | undefined,
    onDone: () => void,
    onMeta?: (durationMs: number) => void
  ) {
    this.stop()
    this.doneCb = onDone
    if (this.muted) {
      this.fireDone() // nothing to wait for — visuals gate the beat
      return
    }
    if (audioUrl && /^https?:\/\//.test(audioUrl)) {
      const a = new Audio(audioUrl)
      this.audioEl = a
      // Report the real clip length so the engine can size its safety backstop
      // to the actual narration (so it never fires before the line finishes).
      a.onloadedmetadata = () => {
        if (onMeta && Number.isFinite(a.duration) && a.duration > 0) onMeta(a.duration * 1000)
      }
      a.onended = () => this.fireDone()
      a.onerror = () => this.speak(narration)
      a.play().catch(() => this.speak(narration))
      return
    }
    this.speak(narration)
  }

  private speak(text: string) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) {
      this.fireDone()
      return
    }
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = this.lang
      if (this.preferredVoice) u.voice = this.preferredVoice
      u.rate = 1.02
      u.pitch = 1.05
      u.onend = () => this.fireDone()
      u.onerror = () => this.fireDone()
      window.speechSynthesis.speak(u)
    } catch {
      this.fireDone()
    }
  }

  /**
   * Pause playback so the engine can resume it IN PLACE (single-clock contract).
   * - An mp3/wav element mid-clip → pause it; `onended` + doneCb stay armed, so
   *   resume continues to a REAL finish and the engine clock/camera stay in
   *   lock-step (no desync, no frozen camera).
   * - TTS (or an already-ended element) → cancel it and drop the done callback;
   *   the engine re-speaks from the start on resume.
   * Returns true iff playback is resumable in place (an mp3/wav was paused).
   */
  pausePlayback(): boolean {
    if (this.audioEl && !this.audioEl.ended) {
      this.audioEl.pause()
      return true
    }
    this.doneCb = null
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel()
      } catch {
        /* ignore */
      }
    }
    return false
  }

  /**
   * Resume an mp3/wav paused by pausePlayback(). Returns true iff it resumed an
   * existing, non-ended element; false if there was nothing to resume (TTS path
   * / element already finished) — the engine then re-speaks.
   */
  resumePlayback(): boolean {
    if (this.audioEl && this.audioEl.paused && !this.audioEl.ended) {
      if (!this.muted) this.audioEl.play().catch(() => {})
      return true
    }
    return false
  }

  /** Stop playback WITHOUT firing onDone (caller is abandoning this beat). */
  stop() {
    this.doneCb = null
    if (this.audioEl) {
      this.audioEl.onended = null
      this.audioEl.onerror = null
      this.audioEl.pause()
      this.audioEl = null
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel()
      } catch {
        /* ignore */
      }
    }
  }

  dispose() {
    this.stop()
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = null
    }
  }
}
