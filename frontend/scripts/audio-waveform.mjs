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
  const SR = 24000
  const offline = new OfflineAudioContext(1, SR * 2, SR)
  const player = new AudioPlayer(() => {}, { context: offline, destination: offline.destination })
  await player.prewarm()

  function chunkB64(ms) {
    const n = Math.round((SR * ms) / 1000)
    const i16 = new Int16Array(n)
    for (let i = 0; i < n; i++) i16[i] = Math.round(16000 * Math.sin((2 * Math.PI * 220 * i) / SR)) // 220Hz, ~0.5 amp
    let bin = ''
    const b = new Uint8Array(i16.buffer)
    for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i])
    return btoa(bin)
  }

  for (let i = 0; i < 6; i++) await player.play(chunkB64(120)) // offline clock=0 → contiguous from LEAD
  const rendered = await offline.startRendering()
  const d = rendered.getChannelData(0)

  // First audible sample
  let start = 0
  while (start < d.length && Math.abs(d[start]) < 1e-4) start++
  // Max sample-to-sample jump in the first 30ms after start (a click = big jump)
  let maxDelta = 0
  for (let i = start; i < Math.min(d.length - 1, start + SR * 0.03); i++) {
    maxDelta = Math.max(maxDelta, Math.abs(d[i + 1] - d[i]))
  }
  // Envelope: peak abs in first 5ms vs 15-20ms (fade-in → early << late)
  const peak = (a, b) => { let p = 0; for (let i = a; i < b; i++) p = Math.max(p, Math.abs(d[i])); return p }
  const peakEarly = peak(start, start + SR * 0.005)
  const peakLate = peak(start + SR * 0.015, start + SR * 0.020)
  return {
    startMs: +(start / SR * 1000).toFixed(1),
    first8: Array.from(d.slice(start, start + 8)).map((x) => +x.toFixed(3)),
    maxDeltaFirst30ms: +maxDelta.toFixed(3),
    peakEarly_0_5ms: +peakEarly.toFixed(3),
    peakLate_15_20ms: +peakLate.toFixed(3),
  }
})
console.log('WAVEFORM:', JSON.stringify(result, null, 1))
await browser.close()
