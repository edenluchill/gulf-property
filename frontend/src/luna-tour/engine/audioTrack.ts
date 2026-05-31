/**
 * Luna Tour — audio track.
 *
 * Plays a beat's narration: pre-generated mp3 (audio_url) when present, else
 * browser speechSynthesis fallback (§4.5 "MVP 阶段可先全程浏览器 TTS 兜底").
 *
 * The master timeline (TimelineEngine) owns timing — audio is layered on top and
 * never blocks the clock, so camera/overlay sync stays deterministic even if a
 * voice is slower/faster than the authored beat duration.
 */
export class AudioTrack {
  private audioEl: HTMLAudioElement | null = null
  private muted = false
  private lang = 'zh-CN'
  private preferredVoice: SpeechSynthesisVoice | null = null

  constructor(language: string) {
    this.lang = language?.startsWith('zh') ? 'zh-CN' : language || 'en-US'
    this.loadVoices()
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      // voices populate async on some browsers
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

  setMuted(m: boolean) {
    this.muted = m
    if (m) this.stop()
  }

  /** Play one beat's narration. Best-effort, fire-and-forget. */
  play(narration: string, audioUrl?: string) {
    this.stop()
    if (this.muted) return
    if (audioUrl && /^https?:\/\//.test(audioUrl)) {
      this.audioEl = new Audio(audioUrl)
      this.audioEl.play().catch(() => this.speak(narration))
      return
    }
    this.speak(narration)
  }

  private speak(text: string) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = this.lang
      if (this.preferredVoice) u.voice = this.preferredVoice
      u.rate = 1.02
      u.pitch = 1.05
      window.speechSynthesis.speak(u)
    } catch {
      /* ignore TTS errors — silent narration is acceptable */
    }
  }

  pause() {
    this.audioEl?.pause()
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.pause()
      } catch {
        /* ignore */
      }
    }
  }

  resume() {
    if (this.muted) return
    this.audioEl?.play().catch(() => {})
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.resume()
      } catch {
        /* ignore */
      }
    }
  }

  stop() {
    if (this.audioEl) {
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
