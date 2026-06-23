/**
 * Audio playback simulator — lets us TEST the AudioPlayer with no browser/mic/Gemini.
 * Mocks AudioContext with a virtual clock, feeds synthetic PCM chunks at a realistic
 * (and adversarial) arrival cadence, and checks the resulting schedule for:
 *   - firstSoundDelay: latency the player itself adds after the first chunk (≈ LEAD)
 *   - gaps: silent holes between consecutive scheduled buffers = audible stutter
 *   - coverage: scheduled audio duration vs input duration = dropped audio
 *
 *   cd frontend && node --experimental-strip-types scripts/audio-sim.ts
 */
const SR = 24000

// ── Mock Web Audio with a virtual clock ───────────────────────────────────────
let vclock = 0 // seconds
const scheduled: { start: number; duration: number }[] = []

class MockParam { setValueAtTime() {} linearRampToValueAtTime() {} value = 1 }
class MockGain { gain = new MockParam(); connect() {} disconnect() {} }
class MockBuffer {
  length: number; duration: number; private d: Float32Array
  constructor(_ch: number, len: number, sr: number) { this.length = len; this.duration = len / sr; this.d = new Float32Array(len) }
  getChannelData() { return this.d }
}
class MockSource {
  buffer: any = null; onended: (() => void) | null = null
  connect() {} disconnect() {}
  start(t: number) { scheduled.push({ start: t, duration: this.buffer.duration }) }
  stop() {}
}
class MockCtx {
  state = 'running'; destination = {}
  get currentTime() { return vclock }
  createGain() { return new MockGain() }
  createBuffer(ch: number, len: number, sr: number) { return new MockBuffer(ch, len, sr) }
  createBufferSource() { return new MockSource() }
  async resume() { this.state = 'running' }
  async close() {}
}
;(globalThis as any).AudioContext = MockCtx

function chunkB64(samples: number): string {
  const i16 = new Int16Array(samples)
  for (let i = 0; i < samples; i++) i16[i] = Math.round(3000 * Math.sin(i / 8))
  return Buffer.from(new Uint8Array(i16.buffer)).toString('base64')
}

const { AudioPlayer } = await import('../src/hooks/voice-assistant/audioUtils.ts')

async function run(label: string, arrivals: { at: number; ms: number }[]) {
  scheduled.length = 0
  vclock = 0
  const player = new (AudioPlayer as any)(() => {})
  await player.prewarm()
  let inputDur = 0
  for (const a of arrivals) {
    vclock = a.at
    inputDur += a.ms / 1000
    await player.play(chunkB64(Math.round((a.ms / 1000) * SR)))
  }
  scheduled.sort((x, y) => x.start - y.start)
  const firstArrival = arrivals[0].at
  const firstDelay = (scheduled[0].start - firstArrival) * 1000
  let gaps = 0, gapTotal = 0
  for (let i = 1; i < scheduled.length; i++) {
    const prevEnd = scheduled[i - 1].start + scheduled[i - 1].duration
    const gap = scheduled[i].start - prevEnd
    if (gap > 1e-4) { gaps++; gapTotal += gap }
  }
  const cover = scheduled.reduce((s, x) => s + x.duration, 0)
  console.log(`\n[${label}]`)
  console.log(`  chunks=${arrivals.length}  firstSoundDelay=${firstDelay.toFixed(0)}ms (LEAD)`)
  console.log(`  gaps(stutter)=${gaps}  gapTotal=${(gapTotal * 1000).toFixed(0)}ms`)
  console.log(`  coverage scheduled=${cover.toFixed(2)}s vs input=${inputDur.toFixed(2)}s  (dropped=${((inputDur - cover) * 1000).toFixed(0)}ms)`)
}

// Scenario A — ideal: model streams ahead of realtime (chunks arrive every 50ms).
const A: { at: number; ms: number }[] = []
for (let i = 0; i < 25; i++) A.push({ at: 2.0 + i * 0.05, ms: 120 })

// Scenario B — realistic jitter: mostly streams ahead, occasional ~180ms inter-arrival
// (network/main-thread blip ~60ms over realtime). Should be absorbed by the 200ms buffer.
const B: { at: number; ms: number }[] = []
let t = 2.0
for (let i = 0; i < 25; i++) {
  B.push({ at: t, ms: 120 })
  t += i % 4 === 0 ? 0.18 : 0.06 // bursty arrivals (ahead) with periodic 180ms blips
}

// Scenario C — extreme: repeated chunks arriving far slower than realtime (bad network).
// Gaps here are physically unavoidable (can't play audio that hasn't arrived yet).
const C: { at: number; ms: number }[] = []
let tc = 2.0
for (let i = 0; i < 20; i++) { C.push({ at: tc, ms: 120 }); tc += 0.30 }

await run('A ideal (streams ahead)', A)
await run('B realistic jitter', B)
await run('C extreme (bad network)', C)
