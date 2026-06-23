/**
 * Audio Utilities for Voice Assistant
 *
 * Handles audio recording, PCM conversion, and playback
 */

/**
 * Convert Float32 audio data to Int16 PCM
 */
export function float32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length)
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]))
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
  }
  return int16Array
}

/**
 * Convert Int16 PCM to Float32 (for playback)
 */
export function int16ToFloat32(int16Array: Int16Array): Float32Array {
  const float32Array = new Float32Array(int16Array.length)
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0
  }
  return float32Array
}

/**
 * Convert ArrayBuffer to base64 string
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Convert base64 string to ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * Create an AudioBuffer from PCM data for playback
 */
export function createAudioBufferFromPCM(
  audioContext: AudioContext,
  pcmData: Int16Array,
  sampleRate: number = 24000
): AudioBuffer {
  const floatData = int16ToFloat32(pcmData)
  const audioBuffer = audioContext.createBuffer(1, floatData.length, sampleRate)
  // Use Float32Array with explicit ArrayBuffer type
  const channelData = new Float32Array(floatData.buffer as ArrayBuffer, floatData.byteOffset, floatData.length)
  audioBuffer.copyToChannel(channelData, 0)
  return audioBuffer
}

/**
 * Play an AudioBuffer
 */
export function playAudioBuffer(
  audioContext: AudioContext,
  audioBuffer: AudioBuffer,
  onEnded?: () => void
): AudioBufferSourceNode {
  const source = audioContext.createBufferSource()
  source.buffer = audioBuffer
  source.connect(audioContext.destination)
  if (onEnded) {
    source.onended = onEnded
  }
  source.start()
  return source
}

/**
 * Audio Recorder class for capturing microphone input
 */
export class AudioRecorder {
  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private onAudioData: ((base64: string) => void) | null = null

  async start(onAudioData: (base64: string) => void): Promise<void> {
    this.onAudioData = onAudioData

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    })

    this.audioContext = new AudioContext({ sampleRate: 16000 })
    this.source = this.audioContext.createMediaStreamSource(this.stream)
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1)

    let chunkCount = 0
    this.processor.onaudioprocess = (e) => {
      if (!this.onAudioData) return

      const inputData = e.inputBuffer.getChannelData(0)
      const pcmData = float32ToInt16(inputData)
      const base64 = arrayBufferToBase64(pcmData.buffer as ArrayBuffer)

      chunkCount++
      if (chunkCount % 10 === 1) {
        console.log(`[AudioRecorder] Sending chunk #${chunkCount}, size: ${base64.length}`)
      }

      this.onAudioData(base64)
    }

    this.source.connect(this.processor)
    this.processor.connect(this.audioContext.destination)
  }

  stop(): void {
    this.processor?.disconnect()
    this.source?.disconnect()
    this.audioContext?.close()
    this.stream?.getTracks().forEach(track => track.stop())

    this.processor = null
    this.source = null
    this.audioContext = null
    this.stream = null
    this.onAudioData = null
  }
}

/**
 * Audio Player — sample-accurate buffer scheduling.
 *
 * Each incoming PCM chunk becomes an AudioBuffer scheduled back-to-back on the
 * audio clock (playhead += duration). The Web Audio engine plays scheduled
 * buffers on the AUDIO thread, so playback is immune to main-thread jank (map
 * rendering, React) — that jank starving a main-thread ScriptProcessor was the
 * cause of the stutter. Contiguous, sample-accurate scheduling = no clicks
 * between chunks and no dropped head.
 *
 * - LEAD (~120ms) cushion before the first buffer so a slightly-late first chunk
 *   can't underrun the very start.
 * - Short fade-in on a turn's first buffer removes the model startup click.
 * - speaking-state tracked by an end-timer armed at the playhead.
 */
export class AudioPlayer {
  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  private onSpeakingChange: ((speaking: boolean) => void) | null = null

  private playhead = 0                       // ctx time the next chunk should start at
  private sources = new Set<AudioBufferSourceNode>()
  private speaking = false
  private newTurn = true
  private endTimer: ReturnType<typeof setTimeout> | null = null

  // Optional dependency injection (for headless waveform tests with OfflineAudioContext)
  private injectedCtx: AudioContext | null
  private injectedDest: AudioNode | null

  private static readonly SAMPLE_RATE = 24000
  private static readonly LEAD = 0.20        // 200ms jitter buffer before the first buffer — absorbs bursty/late chunks
  private static readonly FADE = 0.02        // 20ms fade-in on a turn's first buffer
  private static readonly END_MARGIN_MS = 140 // grace after playhead before declaring silence

  constructor(
    onSpeakingChange?: (speaking: boolean) => void,
    opts?: { context?: AudioContext; destination?: AudioNode }
  ) {
    this.onSpeakingChange = onSpeakingChange || null
    this.injectedCtx = opts?.context || null
    this.injectedDest = opts?.destination || null
  }

  /** Warm up AudioContext (must run on a user gesture) so first play() is instant. */
  async prewarm(): Promise<void> {
    if (!this.ctx) {
      this.ctx = this.injectedCtx || new AudioContext({ sampleRate: AudioPlayer.SAMPLE_RATE })
      this.gain = this.ctx.createGain()
      this.gain.connect(this.injectedDest || this.ctx.destination)
    }
    // Real (online) contexts start suspended and need resume on a user gesture;
    // an OfflineAudioContext (has startRendering) must NOT be resumed.
    if (this.ctx.state === 'suspended' && typeof (this.ctx as any).startRendering !== 'function') {
      await this.ctx.resume()
    }
  }

  /** Arm the end-of-speech timer to fire just after the last scheduled buffer. */
  private armEndTimer(): void {
    if (this.endTimer) clearTimeout(this.endTimer)
    const ctx = this.ctx
    if (!ctx) return
    const ms = Math.max(0, (this.playhead - ctx.currentTime) * 1000) + AudioPlayer.END_MARGIN_MS
    this.endTimer = setTimeout(() => {
      this.endTimer = null
      this.newTurn = true
      if (this.speaking) {
        this.speaking = false
        this.onSpeakingChange?.(false)
      }
    }, ms)
  }

  /** Decode a base64 PCM chunk and schedule it back-to-back on the audio clock. */
  async play(base64Data: string): Promise<void> {
    if (!this.ctx || !this.gain) {
      await this.prewarm()
    }
    if (this.ctx!.state === 'suspended' && typeof (this.ctx as any).startRendering !== 'function') {
      await this.ctx!.resume()
    }
    const ctx = this.ctx!

    const pcm = new Int16Array(base64ToArrayBuffer(base64Data))
    if (pcm.length === 0) return
    const f32 = int16ToFloat32(pcm)
    const buf = ctx.createBuffer(1, f32.length, AudioPlayer.SAMPLE_RATE)
    buf.getChannelData(0).set(f32)

    const now = ctx.currentTime
    // Idle (drained) or fallen behind → (re)start a turn with a small lead cushion.
    if (this.playhead < now + 0.005) {
      this.playhead = now + AudioPlayer.LEAD
      this.newTurn = true
    }

    const src = ctx.createBufferSource()
    src.buffer = buf
    if (this.newTurn) {
      // Per-buffer fade-in via a gain node to kill the model startup click.
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, this.playhead)
      g.gain.linearRampToValueAtTime(1, this.playhead + AudioPlayer.FADE)
      src.connect(g)
      g.connect(this.gain!)
      this.newTurn = false
    } else {
      src.connect(this.gain!)
    }

    src.start(this.playhead)
    this.playhead += buf.duration

    this.sources.add(src)
    src.onended = () => { this.sources.delete(src) }

    if (!this.speaking) {
      this.speaking = true
      this.onSpeakingChange?.(true)
    }
    this.armEndTimer()
  }

  /** Stop all scheduled audio immediately (barge-in) and reset for the next turn. */
  stop(): void {
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null }
    for (const src of this.sources) {
      try { src.stop() } catch { /* already stopped */ }
      src.disconnect()
    }
    this.sources.clear()
    this.playhead = 0
    this.newTurn = true
    if (this.speaking) {
      this.speaking = false
      this.onSpeakingChange?.(false)
    }
  }

  /** Tear down audio context entirely. */
  close(): void {
    this.stop()
    this.gain?.disconnect()
    this.gain = null
    this.ctx?.close()
    this.ctx = null
  }
}
