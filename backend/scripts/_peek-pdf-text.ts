/**
 * 直接把归档 PDF 的文本层打出来 + 搜价格 —— 用来一锤定音回答:
 * 「这份楼书里到底有没有价格?」
 *
 * 用法:npx ts-node -T scripts/_peek-pdf-text.ts <hash前缀> [关键词]
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env') })

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { downloadFromR2 } from '../src/services/r2-storage'
import { extractPdfTextPages } from '../src/langgraph/utils/text-layer'

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
})

const prefix = process.argv[2]
const kw = process.argv[3] || 'price'

async function run() {
  const r = await s3.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET_NAME, Prefix: 'pdf-archive/' }))
  const hit = (r.Contents || []).find((o) => (o.Key || '').includes(prefix))
  if (!hit) { console.error('没找到'); process.exit(1) }

  const buf = await downloadFromR2(hit.Key!)
  const pages = await extractPdfTextPages(buf)
  const text = pages.join('\n')

  console.log(`\n${hit.Key}  ·  ${pages.length} 页  ·  文本层 ${text.length} 字符\n`)

  // 价格模式
  const money = text.match(/\b\d{1,2},\d{3},\d{3}\b/g) || []
  const aed = text.match(/AED[\s:]*[\d,]{6,}/gi) || []
  const priceWord = text.match(/.{0,40}(price|starting from|from AED).{0,40}/gi) || []

  console.log(`💰 「1,643,000」式金额: ${money.length} 个  ${money.slice(0, 6).join(' · ')}`)
  console.log(`💰 「AED 数字」:        ${aed.length} 个  ${aed.slice(0, 4).join(' · ')}`)
  console.log(`💬 出现 price/from 的上下文(前 5 条):`)
  for (const p of priceWord.slice(0, 5)) console.log(`   … ${p.replace(/\s+/g, ' ').trim()} …`)

  if (kw && kw !== 'price') {
    const re = new RegExp(`.{0,50}${kw}.{0,50}`, 'gi')
    const m = text.match(re) || []
    console.log(`\n🔎 「${kw}」: ${m.length} 处`)
    for (const x of m.slice(0, 5)) console.log(`   … ${x.replace(/\s+/g, ' ').trim()} …`)
  }

  const verdict = money.length + aed.length
  console.log(`\n${verdict === 0
    ? '⚪ 这份 PDF 里**没有任何价格** —— 抽取器抽不出来是正常的(输入就没有)'
    : `🔴 这份 PDF 里**有 ${verdict} 处价格** —— 抽取器漏了!`}\n`)
}

run().catch((e) => { console.error('💥', e); process.exit(1) })
