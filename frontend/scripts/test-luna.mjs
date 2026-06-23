/** Smoke test: load app, activate Luna (fake mic), capture state + console errors. */
import { chromium, devices } from 'playwright'
const url = process.env.SHOT_URL || 'http://localhost:5174/'
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})
const ctx = await browser.newContext({ ...devices['iPhone SE'], permissions: ['microphone'] })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 160)))
await page.addInitScript(() => { localStorage.setItem('pinzos-lang', 'zh-CN'); localStorage.setItem('map-base', 'satellite') })
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(11000)
// The Luna pill is at the right edge; click it to activate.
const pill = page.locator('button:has-text("LUNA"), [class*="rounded-l-2xl"]').first()
await pill.click({ timeout: 8000 }).catch((e) => console.log('pill click failed:', String(e).slice(0, 100)))
await page.waitForTimeout(6000) // connecting → listening
await page.screenshot({ path: 'luna_listening.png' })
console.log('console errors:', errors.length ? JSON.stringify(errors.slice(0, 8), null, 1) : 'none')
console.log('saved luna_listening.png')
await browser.close()
