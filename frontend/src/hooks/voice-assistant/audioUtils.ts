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
 * Audio Player — Ring Buffer Streaming
 *
 * Instead of creating a separate AudioBufferSourceNode per chunk (which
 * causes clicks at node boundaries), we push decoded PCM samples into a
 * ring buffer. A single ScriptProcessorNode continuously reads from the
 * ring buffer, producing seamless, click-free audio.
 *
 * - Zero boundary clicks (single continuous output)
 * - ~85 ms latency (one ScriptProcessor buffer at 24 kHz)
 * - Fade-in on each speech turn to eliminate model startup transient
 * - Automatic speaking-state detection based on buffer occupancy
 */
export class AudioPlayer {
  private ctx: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
  private onSpeakingChange: ((speaking: boolean) => void) | null = null

  // Ring buffer (producer = play(), consumer = onaudioprocess)
  private ring: Float32Array
  private wPos = 0
  private rPos = 0
  private readonly cap: number

  // State
  private speaking = false
  private silentFrames = 0
  private newTurn = true
  // Anti-stutter: never start draining a near-empty ring buffer. We hold (output
  // silence) until ~PRIME_SAMPLES are buffered, then drain continuously. On a real
  // mid-turn underrun we re-prime. This is what kills the choppy start ("开头一卡一卡").
  private primed = false
  private primeWaitFrames = 0

  // ~340 ms of silence before we consider speech finished (4 × 2048 / 24000)
  private static readonly SILENCE_THRESHOLD = 4
  // 20 ms fade-in at 24 kHz
  private static readonly FADE_SAMPLES = 480
  // ScriptProcessor output buffer (≈ 85 ms)
  private static readonly PROC_SIZE = 2048
  // ~150 ms cushion buffered before (re)starting playback — smooths bursty chunks
  private static readonly PRIME_SAMPLES = 3600
  // ...but if audio is present and we've waited this many frames (~680 ms), start
  // anyway so very short replies aren't swallowed waiting for a cushion.
  private static readonly PRIME_MAX_WAIT = 8

  constructor(onSpeakingChange?: (speaking: boolean) => void) {
    this.onSpeakingChange = onSpeakingChange || null
    // 30 s ring buffer — more than enough for any speech turn
    this.cap = 24000 * 30
    this.ring = new Float32Array(this.cap)
  }

  /** Samples available for reading. */
  private available(): number {
    return (this.wPos - this.rPos + this.cap) % this.cap
  }

  /** Warm up AudioContext + ScriptProcessor so first play() is instant. */
  async prewarm(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: 24000 })
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }
    if (this.processor) return

    this.processor = this.ctx.createScriptProcessor(
      AudioPlayer.PROC_SIZE, 1, 1
    )

    this.processor.onaudioprocess = (e: AudioProcessingEvent) => {
      const out = e.outputBuffer.getChannelData(0)
      const avail = this.available()

      // (Re)prime: hold until a cushion is buffered, so we never start draining a
      // near-empty buffer (the cause of the choppy start). Start anyway once we've
      // waited PRIME_MAX_WAIT frames with some audio, so short replies still play.
      if (!this.primed) {
        if (avail >= AudioPlayer.PRIME_SAMPLES ||
            (avail > 0 && ++this.primeWaitFrames >= AudioPlayer.PRIME_MAX_WAIT)) {
          this.primed = true
          this.primeWaitFrames = 0
        } else {
          out.fill(0)
          if (this.speaking && ++this.silentFrames >= AudioPlayer.SILENCE_THRESHOLD) {
            this.speaking = false
            this.onSpeakingChange?.(false)
          }
          return
        }
      }

      if (avail === 0) {
        // Real underrun mid-turn — re-prime (rebuild cushion) instead of emitting gaps.
        out.fill(0)
        this.primed = false
        if (this.speaking && ++this.silentFrames >= AudioPlayer.SILENCE_THRESHOLD) {
          this.speaking = false
          this.onSpeakingChange?.(false)
        }
        return
      }

      // We have data — mark as speaking
      this.silentFrames = 0
      if (!this.speaking) {
        this.speaking = true
        this.onSpeakingChange?.(true)
      }

      // Read from ring buffer
      const n = Math.min(out.length, avail)
      for (let i = 0; i < n; i++) {
        out[i] = this.ring[this.rPos]
        this.rPos = (this.rPos + 1) % this.cap
      }
      // Pad remainder with silence
      for (let i = n; i < out.length; i++) {
        out[i] = 0
      }
    }

    this.processor.connect(this.ctx.destination)
  }

  /** Push a base64-encoded PCM chunk into the ring buffer. */
  async play(base64Data: string): Promise<void> {
    // Lazy init if prewarm wasn't called yet
    if (!this.ctx || !this.processor) {
      await this.prewarm()
    }
    if (this.ctx?.state === 'suspended') {
      await this.ctx.resume()
    }

    const buf = base64ToArrayBuffer(base64Data)
    const pcm = new Int16Array(buf)
    const samples = int16ToFloat32(pcm)

    // Fade-in on first chunk of a new speech turn
    if (this.newTurn) {
      const fadeLen = Math.min(samples.length, AudioPlayer.FADE_SAMPLES)
      for (let i = 0; i < fadeLen; i++) {
        samples[i] *= i / fadeLen
      }
      this.newTurn = false
    }

    // Write to ring buffer
    for (let i = 0; i < samples.length; i++) {
      this.ring[this.wPos] = samples[i]
      this.wPos = (this.wPos + 1) % this.cap
    }
  }

  /** Clear buffer and prepare for next speech turn. */
  stop(): void {
    this.wPos = 0
    this.rPos = 0
    this.newTurn = true
    this.silentFrames = 0
    this.primed = false
    this.primeWaitFrames = 0
    if (this.speaking) {
      this.speaking = false
      this.onSpeakingChange?.(false)
    }
  }

  /** Tear down audio context entirely. */
  close(): void {
    this.stop()
    this.processor?.disconnect()
    this.processor = null
    this.ctx?.close()
    this.ctx = null
  }
}
