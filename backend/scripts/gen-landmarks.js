/**
 * Generate stylized 3D Dubai landmark icons on a pure green background,
 * then chroma-key to transparent PNG (512x512, ~90% canvas height).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = 'gemini-3-pro-image-preview';
const OUT_DIR = 'C:/Users/lzp65/Desktop/projects/gulf-property/frontend/public/landmarks';

const STYLE = [
  'Cute isometric 3D-render miniature style, like an Apple Maps 3D landmark icon.',
  'Soft studio lighting, slight warm color tint, clean smooth edges, subtle plastic/clay material feel.',
  'One single building, centered, fully visible from top to bottom with generous margin on all sides.',
  'CRITICAL: the background must be a completely SOLID, FLAT, pure chroma-key green color #00FF00 covering every background pixel.',
  'No ground plane, no shadow on the ground, no floor plate, no reflections on the background.',
  'No text, no letters, no watermark, no logo.',
].join(' ');

const LANDMARKS = [
  {
    file: 'burj-khalifa.png',
    desc: 'The Burj Khalifa skyscraper in Dubai: an extremely tall, slender, tapering silver-blue glass tower with its distinctive stepped Y-shaped setbacks spiraling upward to a needle spire.',
  },
  {
    file: 'mall-of-the-emirates.png',
    desc: 'Mall of the Emirates in Dubai: a low wide modern shopping mall building with a glass dome entrance, and its iconic giant enclosed indoor ski-slope tube (Ski Dubai) rising diagonally out of the building, supported on angled pillars.',
  },
  {
    file: 'burj-al-arab.png',
    desc: 'The Burj Al Arab hotel in Dubai: the famous sail-shaped luxury hotel tower, white curved sail facade with blue-tinted glass front, helipad disc near the top, standing alone.',
  },
  {
    file: 'dubai-international-airport.png',
    desc: 'Dubai International Airport: a sleek modern airport terminal building with a long curved barrel-vault glass roof, together with a slim air-traffic control tower with a flared top standing beside it.',
  },
  {
    file: 'global-village.png',
    desc: 'The Global Village Dubai main entrance gate: an ornate colorful festival gateway with arched portals, small decorative domes and towers, festive multicultural architecture in warm gold, red and teal colors.',
  },
  {
    file: 'dubai-frame.png',
    desc: 'The Dubai Frame: a giant rectangular golden picture-frame structure, two tall vertical golden towers connected by a horizontal golden bridge at the top, with shiny geometric gold cladding, large empty opening in the middle of the frame.',
  },
  {
    file: 'museum-of-the-future.png',
    desc: 'The Museum of the Future in Dubai: a smooth silver torus / oval ring shaped building with a hollow center, its stainless-steel facade decorated with elegant flowing Arabic calligraphy engravings as abstract decorative window patterns (not readable text), sitting on a small green mound base.',
  },
  {
    file: 'zayed-international-airport.png',
    desc: 'Zayed International Airport in Abu Dhabi: a futuristic modern airport terminal with a flowing, undulating wavy roof shaped like overlapping sand dunes, white and sand-colored, with a glass curtain-wall facade beneath the dune-like roof shells.',
  },
];

async function generateGreenImage(desc, attempt) {
  const prompt = `Create a 3D icon illustration. Subject: ${desc} Style: ${STYLE}` +
    (attempt > 0 ? ' Remember: background must be 100% flat pure green #00FF00, nothing else in the scene.' : '');
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { responseModalities: ['IMAGE'] },
  });
  const parts = res.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img) throw new Error('no image part in response');
  return Buffer.from(img.inlineData.data, 'base64');
}

async function chromaKeyTo512(buf) {
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  // Chroma key: alpha based on green dominance d = g - max(r,b)
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const d = g - Math.max(r, b);
    let a;
    if (d >= 90) a = 0;
    else if (d <= 25) a = 255;
    else a = Math.round(255 * (1 - (d - 25) / 65));
    data[o + 3] = Math.min(data[o + 3], a);
    // despill: remove green cast on kept pixels
    if (a > 0 && d > 0) data[o + 1] = Math.max(r, b);
    if (data[o + 3] > 8) {
      const x = i % width, y = (i / width) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('image fully keyed out');

  const cropped = sharp(data, { raw: { width, height, channels } }).extract({
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  });

  // Fit: ~90% of canvas height (460px), cap width at 500px
  return cropped
    .resize({ width: 500, height: 460, fit: 'inside' })
    .png()
    .toBuffer()
    .then((b) =>
      sharp({
        create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([{ input: b, gravity: 'center' }])
        .png()
        .toBuffer()
    );
}

async function verifyTransparency(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => data[(y * info.width + x) * info.channels + 3];
  const corners = [px(5, 5), px(506, 5), px(5, 506), px(506, 506)];
  return { pass: px(5, 5) === 0, corners };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const results = [];
  for (const lm of LANDMARKS) {
    const outPath = path.join(OUT_DIR, lm.file);
    let ok = false, err = null;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        console.log(`[gen] ${lm.file} (attempt ${attempt + 1})`);
        const raw = await generateGreenImage(lm.desc, attempt);
        const png = await chromaKeyTo512(raw);
        fs.writeFileSync(outPath, png);
        const v = await verifyTransparency(outPath);
        console.log(`  -> corners alpha: ${v.corners.join(',')} pass=${v.pass}`);
        if (v.pass) { ok = true; results.push({ file: lm.file, pass: true }); }
        else err = 'corner not transparent';
      } catch (e) {
        err = String(e.message || e);
        console.log(`  !! ${err.slice(0, 160)}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    if (!ok) results.push({ file: lm.file, pass: false, err });
  }
  console.log('\n=== SUMMARY ===');
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.file}${r.err ? '  (' + r.err + ')' : ''}`);
})();
