/**
 * Luna Tour — audio track.
 *
 * Plays a beat's narration as a pre-generated mp3 (audio_url) when present.
 *
 * 🔴 **没有真语音时,绝不念浏览器机器人音(owner:「宁愿无配音也不要机器人语音」)。**
 *    草稿(未渲染)/无配音发布的拍子没有 audio_url —— 以前会回落到浏览器
 *    speechSynthesis 的机器音,效果极差。现在改成**静默停留**:字幕照常显示,
 *    按阅读时长给足时间(并把镜头拉伸到同一时长),只是没有声音。
 *
 * EVENT-DRIVEN: play() takes an onDone callback fired when the narration ACTUALLY
 * finishes (mp3 `ended`) or, for a silent beat, after its estimated reading time.
 * The engine uses this to advance beats — never a blindly guessed duration — so a
 * line is never cut off mid-sentence regardless of language / speed. (A safety
 * backstop lives in the engine's pausable clock, not here, so it survives pause.)
 */

/** 静默停留时长 —— 按字幕的可读时间估(CJK ~4.2 字/s + 拉丁 ~2.6 词/s + 收尾)。 */
function estimateReadMs(text: string): number {
  if (!text) return 2000
  const cjk = (text.match(/[一-鿿　-〿＀-￯]/g) || []).length
  const latin = text.replace(/[一-鿿　-〿＀-￯]/g, ' ').trim()
  const words = latin ? latin.split(/\s+/).filter(Boolean).length : 0
  return Math.max(2500, Math.round((cjk / 4.2 + words / 2.6 + 0.8) * 1000))
}

export class AudioTrack {
  private audioEl: HTMLAudioElement | null = null
  private muted = false
  private doneCb: (() => void) | null = null
  private silentTimer: number | null = null

  // language 现在只影响真语音的选择(mp3 已按语言生成),静默路径不需要它,
  // 但保留签名不变,免得调用方全改。
  constructor(_language: string) {}

  get isMuted() {
    return this.muted
  }

  setMuted(m: boolean) {
    this.muted = m
    if (m) this.stop()
  }

  private clearSilentTimer() {
    if (this.silentTimer !== null) {
      window.clearTimeout(this.silentTimer)
      this.silentTimer = null
    }
  }

  private fireDone() {
    const cb = this.doneCb
    this.doneCb = null
    if (cb) cb()
  }

  /**
   * Play one beat's narration; call onDone when it FINISHES (or immediately when
   * muted). Best-effort — any failure resolves via onDone so the tour never stalls.
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
      a.onerror = () => this.silentHold(narration, onMeta)
      a.play().catch(() => this.silentHold(narration, onMeta))
      return
    }
    this.silentHold(narration, onMeta)
  }

  /**
   * 没有真语音 → 静默停留一段可读时长(不发任何声音)。把估算时长报给引擎,让它
   * 把镜头拉伸到同一时长、并把安全网延到这个时长之后,拍子的节奏就跟有配音时一致。
   */
  private silentHold(text: string, onMeta?: (durationMs: number) => void) {
    const ms = estimateReadMs(text)
    if (onMeta) onMeta(ms)
    if (typeof window === 'undefined') {
      this.fireDone()
      return
    }
    this.clearSilentTimer()
    this.silentTimer = window.setTimeout(() => {
      this.silentTimer = null
      this.fireDone()
    }, ms)
  }

  /**
   * Pause playback so the engine can resume it IN PLACE (single-clock contract).
   * - An mp3/wav element mid-clip → pause it; `onended` + doneCb stay armed, so
   *   resume continues to a REAL finish and the engine clock/camera stay in
   *   lock-step (no desync, no frozen camera).
   * - A silent hold (or an already-ended element) → drop the done callback; the
   *   engine re-holds from the start on resume.
   * Returns true iff playback is resumable in place (an mp3/wav was paused).
   */
  pausePlayback(): boolean {
    if (this.audioEl && !this.audioEl.ended) {
      this.audioEl.pause()
      return true
    }
    this.clearSilentTimer()
    this.doneCb = null
    return false
  }

  /**
   * Resume an mp3/wav paused by pausePlayback(). Returns true iff it resumed an
   * existing, non-ended element; false if there was nothing to resume (silent path
   * / element already finished) — the engine then re-holds.
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
    this.clearSilentTimer()
    if (this.audioEl) {
      this.audioEl.onended = null
      this.audioEl.onerror = null
      this.audioEl.pause()
      this.audioEl = null
    }
  }

  dispose() {
    this.stop()
  }
}
