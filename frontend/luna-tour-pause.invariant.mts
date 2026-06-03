/**
 * Headless invariant test for TimelineEngine pause/resume (single-clock contract).
 * Run: npx tsx tmp-pause-invariant.mts   (temp file — delete after).
 *
 * Stubs performance.now / rAF / Audio / speechSynthesis so the real engine runs
 * deterministically in Node. Asserts the pause/resume invariants that the real
 * machine must hold (the "命脉").
 */

// ---- controllable environment (set BEFORE constructing the engine) ----
let now = 0
let rafId = 0
const rafMap = new Map<number, FrameRequestCallback>()

class FakeAudio {
  static instances: FakeAudio[] = []
  src: string
  paused = true
  ended = false
  duration = NaN
  currentTime = 0
  muted = false
  onloadedmetadata: (() => void) | null = null
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(src: string) {
    this.src = src
    FakeAudio.instances.push(this)
  }
  play() {
    this.paused = false
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
  // test helpers
  fireMeta(durationSec: number) {
    this.duration = durationSec
    this.onloadedmetadata?.()
  }
  fireEnded() {
    this.ended = true
    this.paused = true
    this.onended?.()
  }
}

let lastUtterance: { onend: (() => void) | null; onerror: (() => void) | null } | null = null
class FakeUtterance {
  text: string
  lang = ''
  voice: unknown = null
  rate = 1
  pitch = 1
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) {
    this.text = text
    lastUtterance = this
  }
}

const g = globalThis as unknown as Record<string, unknown>
g.performance = { now: () => now }
g.requestAnimationFrame = (cb: FrameRequestCallback) => {
  const id = ++rafId
  rafMap.set(id, cb)
  return id
}
g.cancelAnimationFrame = (id: number) => {
  rafMap.delete(id)
}
g.Audio = FakeAudio as unknown
g.SpeechSynthesisUtterance = FakeUtterance as unknown
const speechSynthesis = {
  getVoices: () => [],
  speak: (_u: unknown) => {
    /* does NOT auto-fire onend → narration stays pending until we fire it */
  },
  cancel: () => {},
  onvoiceschanged: null as unknown,
}
g.window = { speechSynthesis, setTimeout, clearTimeout }
g.speechSynthesis = speechSynthesis

/** Advance fake time by dt and run every currently-registered rAF callback once
 *  (each may re-register, modelling a continuous loop). */
function step(dt: number) {
  now += dt
  const cbs = [...rafMap.values()]
  rafMap.clear()
  for (const cb of cbs) cb(now)
}
function run(totalMs: number, dt = 16) {
  for (let t = 0; t < totalMs; t += dt) step(dt)
}
/** Flush microtasks so the engine's playFrom await-chain (beat → next beat) can
 *  proceed; then a short run() lets the new beat emit its snapshot. */
const flush = () => new Promise<void>((r) => setImmediate(r))
async function settle() {
  await flush()
  run(100)
}

// ---- import the REAL engine after globals are in place ----
const { TimelineEngine } = await import('./src/luna-tour/engine/TimelineEngine.ts')
import type { TourScript, PropertySnapshot } from './src/luna-tour/types.ts'

// ---- mocks ----
let jumpToCount = 0
let lastCenter: [number, number] | null = null
const map = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === 'jumpTo')
        return (s: { center: [number, number] }) => {
          jumpToCount++
          lastCenter = s.center
        }
      return () => {}
    },
  }
) as never

function beat(id: string, audio: string | undefined, narration = 'hello world this is luna') {
  return {
    id,
    narration,
    audio_url: audio,
    duration_ms: 4000,
    camera: [{ type: 'orbit', at_ms: 0, center: [55, 25] as [number, number], degrees: 60, duration_ms: 4000 }],
    overlays: [],
  }
}

function makeScript(audio = true): TourScript {
  const a = (n: string) => (audio ? `http://x/${n}.mp3` : undefined)
  return {
    version: 2,
    voice: 'Aoede',
    language: 'en-US',
    total_ms: 12000,
    intro: beat('intro', a('intro')),
    acts: [{ id: 'act0', property_id: 'p0', beats: [beat('b0', a('b0'))] }],
    outro: beat('outro', a('outro')),
  }
}

const props = new Map<string, PropertySnapshot>([
  ['p0', { name: 'P0', coords: [55, 25] }],
])

// ---- assertions ----
let failures = 0
function ok(cond: boolean, msg: string) {
  if (cond) console.log(`  ✅ ${msg}`)
  else {
    console.log(`  ❌ ${msg}`)
    failures++
  }
}

function freshEngine(audio = true) {
  FakeAudio.instances = []
  jumpToCount = 0
  lastCenter = null
  now = 0
  rafMap.clear()
  let snap: { state: string; actIndex: number; segmentKey: string } | null = null
  let prevKey = ''
  const engine = new TimelineEngine({
    script: makeScript(audio),
    properties: props,
    map,
    onUpdate: (s) => {
      snap = s as never
      const k = (s as { segmentKey: string }).segmentKey
      if (k !== prevKey) {
        if (process.env.DBG) console.log(`    [transition @${now}ms] ${prevKey || '∅'} -> ${k}`)
        prevKey = k
      }
    },
  })
  return { engine, getSnap: () => snap }
}

// ========================================================================
console.log('TEST 1 — mp3 pause/resume: clock continues, camera keeps moving')
{
  const { engine, getSnap } = freshEngine(true)
  engine.start()
  // intro beat audio element created → fire metadata (4s clip → camScale 1)
  const a0 = FakeAudio.instances[0]
  ok(!!a0, 'audio element created for intro beat')
  a0.fireMeta(4)
  run(2000) // play ~2s into the 4s beat
  const jumpsBefore = jumpToCount
  ok(jumpsBefore > 50, `camera sampled every frame before pause (${jumpsBefore} jumpTo)`)
  const keyBefore = getSnap()?.segmentKey

  engine.pause()
  ok(getSnap()?.state === 'paused', 'state = paused')
  ok(a0.paused === true, 'mp3 element paused IN PLACE (resumable, onended still armed)')
  const jumpsAtPause = jumpToCount

  // simulate a LONG pause (e.g. talking to Luna) — far past the 60s backstop.
  run(70000)
  ok(jumpToCount === jumpsAtPause, 'no camera frames while paused')
  ok(getSnap()?.segmentKey === keyBefore, 'backstop did NOT advance the beat during pause')
  ok(FakeAudio.instances.length === 1, 'no new audio element created during pause')

  // resume — mp3 should resume in place, clock continues, camera moves again
  engine.play()
  ok(a0.paused === false, 'mp3 resumed in place (not restarted)')
  ok(FakeAudio.instances.length === 1, 'resume did NOT create a new audio element (in-place)')
  run(2500) // run out the rest of the camera move (clip is 4s, paused at ~2s)
  ok(jumpToCount > jumpsAtPause, 'camera KEEPS MOVING after resume (not frozen)')

  // finish the line → beat advances (camera also done by now)
  a0.fireEnded()
  await settle()
  ok(getSnap()?.segmentKey !== keyBefore, 'beat advances once narration truly ends')
}

// ========================================================================
console.log('TEST 2 — repeated pause/resume does not corrupt the clock')
{
  const { engine, getSnap } = freshEngine(true)
  engine.start()
  const a0 = FakeAudio.instances[0]
  a0.fireMeta(4)
  run(50) // pump one tick so the first snapshot is emitted
  const key = getSnap()?.segmentKey
  for (let i = 0; i < 6; i++) {
    run(300)
    engine.pause()
    engine.pause() // double-pause must be idempotent
    run(1000) // idle while paused
    engine.play()
  }
  ok(getSnap()?.segmentKey === key, 'still on the same beat after 6 pause/resume cycles')
  ok(getSnap()?.state === 'playing' || getSnap()?.state === 'reveal', 'state is playing after resume')
  const jumps = jumpToCount
  run(300)
  ok(jumpToCount > jumps, 'camera still moving after the horizontal-jumping stress')
  run(4000) // let the camera finish its move
  a0.fireEnded()
  await settle()
  ok(getSnap()?.segmentKey !== key, 'beat advances normally afterwards')
}

// ========================================================================
console.log('TEST 3 — backstop still bounds a real stall (audio never ends)')
{
  const { engine, getSnap } = freshEngine(true)
  engine.start()
  const a0 = FakeAudio.instances[0]
  a0.fireMeta(4) // backstop = max(60s, 4s+5s) = 60s
  run(50) // pump first snapshot
  const key = getSnap()?.segmentKey
  run(58000)
  ok(getSnap()?.segmentKey === key, 'still on beat just before backstop')
  run(4000) // cross 60s
  await settle()
  ok(getSnap()?.segmentKey !== key, 'backstop advanced the stalled beat past 60s')
}

// ========================================================================
console.log('TEST 4 — TTS fallback resume restarts the beat clock (no frozen cam)')
{
  const { engine, getSnap } = freshEngine(false) // no audio_url → TTS path
  engine.start()
  ok(FakeAudio.instances.length === 0, 'no audio element on TTS path')
  ok(!!lastUtterance, 'TTS utterance created')
  run(2000)
  const jumpsBefore = jumpToCount
  ok(jumpsBefore > 50, 'camera moving on TTS beat')
  engine.pause()
  run(1000)
  engine.play() // TTS can't resume → restartBeatClock + re-speak
  ok(!!lastUtterance, 're-spoke narration on resume')
  const jumpsAfterResume = jumpToCount
  run(500)
  ok(jumpToCount > jumpsAfterResume, 'camera moving again after TTS resume (clock restarted, not frozen)')
}

console.log('')
console.log(failures === 0 ? '🎉 ALL INVARIANTS HELD' : `💥 ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
