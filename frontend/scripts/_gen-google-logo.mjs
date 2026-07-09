// Generate Google OAuth consent-screen logo: pin mark + "Pinzos" wordmark on white.
// Google rejected the bare pin ("does not uniquely identify your brand"), so the
// wordmark goes in the image. Outputs 120x120 (upload size) and 512x512.
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const OUT = process.env.OUT || '../docs/brand'
mkdirSync(OUT, { recursive: true })

const PIN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 42 42" width="100%" height="100%">
  <defs>
    <linearGradient id="pinzosPin" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2dd4bf"/><stop offset="55%" stop-color="#0d9488"/><stop offset="100%" stop-color="#0f766e"/>
    </linearGradient>
  </defs>
  <g transform="translate(5,0)">
    <path d="M16 1 C7.7 1 1 7.7 1 16 C1 26 16 41 16 41 C16 41 31 26 31 16 C31 7.7 24.3 1 16 1 Z" fill="url(#pinzosPin)"/>
    <rect x="8.4" y="15.5" width="3.4" height="6.7" rx="1.1" fill="#ffffff" fill-opacity="0.9"/>
    <rect x="13.9" y="12" width="3.4" height="10.2" rx="1.1" fill="#ffffff" fill-opacity="0.9"/>
    <rect x="19.4" y="8.4" width="3.4" height="13.8" rx="1.1" fill="#fbbf24"/>
  </g>
</svg>`

const html = (size) => `<!doctype html><html><head><style>
  * { margin: 0; padding: 0; }
  body { width: ${size}px; height: ${size}px; background: #ffffff; overflow: hidden; }
  .wrap { width: 120px; height: 120px; transform: scale(${size / 120}); transform-origin: top left;
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; }
  .pin { width: 58px; height: 58px; }
  .word { font: 700 26px Georgia, 'Times New Roman', serif; color: #0f172a; letter-spacing: 0.5px; }
</style></head><body>
  <div class="wrap"><div class="pin">${PIN}</div><div class="word">Pinzos</div></div>
</body></html>`

const browser = await chromium.launch()
for (const size of [120, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(html(size))
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/pinzos-logo-${size}.png` })
  console.log(`saved pinzos-logo-${size}.png`)
  await page.close()
}
await browser.close()
