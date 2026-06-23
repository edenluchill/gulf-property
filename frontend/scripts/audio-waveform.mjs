/**
 * Real-waveform audio test. Renders AudioPlayer's output through a REAL Chromium
 * Web Audio engine (OfflineAudioContext) and inspects the start of the waveform for
 * the click / cut-off-start the user reports. No mic/Gemini needed.
 *
 *   (dev server must be running) node scripts/audio-waveform.mjs
 */
import { chromium } from 'playwright'
const url = process.env.SHOT_URL || 'http://localhost:5174/'
const browser = await chromium.launch()
const page = await browser.newPage()
page.on('console', (m) => console.log('[page]', m.text().slice(0, 200)))
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(3000)

const result = await page.evaluate(async () => {
  const mod = await import('/src/hooks/voice-assistant/audioUtils.ts')
  const { AudioPlayer } = mod
  const SR = 24000            // chunk PCM rate
  const CTX_SR = 48000        // device context rate (reproduces resampling 24k→48k)
  const offline = new OfflineAudioContext(1, CTX_SR * 2, CTX_SR)
  const player = new AudioPlayer(() => {}, { context: offline, destination: offline.destination })
  await player.prewarm()

  let gi = 0 // global sample index → continuous sine ACROSS chunks (like real TTS audio)
  function chunkB64(ms) {
    const n = Math.round((SR * ms) / 1000)
    const i16 = new Int16Array(n)
    for (let i = 0; i < n; i++, gi++) i16[i] = Math.round(16000 * Math.sin((2 * Math.PI * 220 * gi) / SR)) // 220Hz, ~0.5 amp
    let bin = ''
    const b = new Uint8Array(i16.buffer)
    for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i])
    return btoa(bin)
  }

  for (let i = 0; i < 6; i++) await player.play(chunkB64(120)) // offline clock=0 → contiguous from LEAD
  const rendered = await offline.startRendering()
  const d = rendered.getChannelData(0)
  const R = CTX_SR

  // First audible sample
  let start = 0
  while (start < d.length && Math.abs(d[start]) < 1e-4) start++
  // Max sample-to-sample jump in the first 30ms after start (a click = big jump)
  let maxDeltaStart = 0
  for (let i = start; i < Math.min(d.length - 1, start + R * 0.03); i++) {
    maxDeltaStart = Math.max(maxDeltaStart, Math.abs(d[i + 1] - d[i]))
  }
  // Max jump anywhere after the fade-in (catches per-chunk-boundary glitches/电音)
  let maxDeltaBody = 0, bodyAt = 0
  for (let i = start + R * 0.05; i < d.length - 1; i++) {
    const dd = Math.abs(d[i + 1] - d[i])
    if (dd > maxDeltaBody) { maxDeltaBody = dd; bodyAt = +((i - start) / R * 1000).toFixed(0) }
  }
  const peak = (a, b) => { let p = 0; for (let i = a; i < b; i++) p = Math.max(p, Math.abs(d[i])); return p }
  return {
    ctxSampleRate: R,
    startMs: +(start / R * 1000).toFixed(1),
    first8: Array.from(d.slice(start, start + 8)).map((x) => +x.toFixed(3)),
    maxDeltaStart30ms: +maxDeltaStart.toFixed(3),
    maxDeltaBody: +maxDeltaBody.toFixed(3), maxDeltaBodyAtMs: bodyAt,
    peakEarly_0_5ms: +peak(start, start + R * 0.005).toFixed(3),
    peakLate_15_20ms: +peak(start + R * 0.015, start + R * 0.020).toFixed(3),
  }
})
console.log('WAVEFORM:', JSON.stringify(result, null, 1))
await browser.close()
