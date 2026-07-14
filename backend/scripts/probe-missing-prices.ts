/**
 * 「户型抽出来了但没有价格」—— 到底是**抽取器漏了**,还是**PDF 里本来就没有**?
 *
 * 质量遥测发现:19 个 job 抽出了 12/13/31/47 个户型,**价格 0 个**。
 * 而客户在 Luna 对话里问「starting price」,问了两遍(她答不上来)。
 *
 * 但下结论前必须看源 PDF —— 很多迪拜楼书**本来就不印价格**(价格是单独一张
 * price list,经纪按需给)。如果是那样,这不是 bug,是**输入缺失**,
 * 修法完全不同(该提醒经纪补传,而不是改抽取器)。
 *
 * 源 PDF 是**永久归档**的(pdf-archive/{sha256}.pdf),所以现在还能查。
 *
 * 用法:npx ts-node -T scripts/probe-missing-prices.ts [jobId ...]
 *      不给 jobId 就自动挑「有户型但零价格」的 job。
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env') })

import pool from '../src/db/pool'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { extractPdfTextPages } from '../src/langgraph/utils/text-layer'
// 复用项目已有的 R2 client(自己拼 endpoint 会 SSL 握手失败 —— 踩过了)
import { downloadFromR2 } from '../src/services/r2-storage'

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
})
const BUCKET = process.env.R2_BUCKET_NAME || ''

/** 价格的样子:AED/د.إ + 6-8 位数,或「Starting from 1,643,000」这类。 */
const PRICE_HINTS = [
  /AED\s*[\d,]{7,}/i,
  /\bstarting\s+(from|price)\b/i,
  /\bprice\s*(list|from)\b/i,
  /\b[\d,]{9,}\s*(AED|درهم)/i,
  /\b\d{1,2},\d{3},\d{3}\b/,        // 1,643,000
]

async function fetchArchived(hash: string): Promise<Buffer | null> {
  try {
    return await downloadFromR2(`pdf-archive/${hash}.pdf`)
  } catch {
    return null
  }
}

/** 归档是按内容 hash 存的,原名在 metadata 里 —— 先列出来建索引。 */
async function archiveIndex(): Promise<{ hash: string; name: string }[]> {
  const out: { hash: string; name: string }[] = []
  let token: string | undefined
  do {
    const r = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: 'pdf-archive/', ContinuationToken: token,
    }))
    for (const o of r.Contents || []) {
      const hash = (o.Key || '').replace('pdf-archive/', '').replace('.pdf', '')
      if (hash) out.push({ hash, name: '' })
    }
    token = r.NextContinuationToken
  } while (token)
  return out
}

async function run() {
  const argJobs = process.argv.slice(2)
  const { rows: jobs } = await pool.query<{ job_id: string; task_name: string; pdf_names: string[] }>(
    argJobs.length
      ? `SELECT job_id, task_name, pdf_names FROM pdf_processing_tasks WHERE job_id = ANY($1)`
      : `SELECT job_id, task_name, pdf_names FROM pdf_processing_tasks
          WHERE status='completed'
            AND jsonb_array_length(COALESCE(result_data->'buildingData'->'units','[]'::jsonb)) > 0
            AND (SELECT COUNT(*) FROM jsonb_array_elements(result_data->'buildingData'->'units') u
                  WHERE (u->>'price') IS NOT NULL) = 0
          ORDER BY created_at DESC LIMIT 6`,
    argJobs.length ? [argJobs] : []
  )

  console.log(`\n检查 ${jobs.length} 个「有户型但零价格」的 job —— 源 PDF 里到底有没有价格?\n`)

  const index = await archiveIndex()
  console.log(`(归档里有 ${index.length} 份 PDF)\n`)

  for (const j of jobs) {
    console.log(`── ${j.job_id}`)
    console.log(`   ${j.task_name.slice(0, 80)}`)

    // 归档按 hash 存,但 job 里存的是 pending key。用 job 的 pdf 名去猜不可靠 ——
    // 直接扫归档:对每份 PDF 抽文本,看有没有价格。数量不大(几十份),够用。
    let found = false
    let scanned = 0
    for (const a of index) {
      const buf = await fetchArchived(a.hash)
      if (!buf) continue
      scanned++
      let text = ''
      try {
        const pages = await extractPdfTextPages(buf)
        text = pages.join('\n')
      } catch { continue }
      const hits = PRICE_HINTS.filter((re) => re.test(text))
      if (hits.length >= 2) {
        // 只报和这个 job 相关的(名字对得上)—— 否则会把别的项目的价格算进来
        const nameHit = (j.pdf_names || []).some((n) =>
          text.toLowerCase().includes(String(n).split('.')[0].toLowerCase().slice(0, 12)))
        if (nameHit) {
          found = true
          const sample = (text.match(PRICE_HINTS[4]) || text.match(PRICE_HINTS[0]) || [''])[0]
          console.log(`   🔴 源 PDF 里**有价格**(例:${sample})—— 抽取器漏了!`)
          break
        }
      }
      if (scanned > 40) break   // 别把整个归档都扫完
    }
    if (!found) {
      console.log(`   ⚪ 源 PDF 里**找不到价格** —— 多半是经纪没传 price list(输入缺失,不是抽取 bug)`)
    }
  }

  console.log(`\n判读:`)
  console.log(`  🔴 = 抽取器的问题 → 改 pricing-extractor / page-classifier`)
  console.log(`  ⚪ = 输入缺失 → **该提醒经纪补传价格表**,而不是改代码`)
  console.log(`     (客户正在问价格而 Luna 答不出来 —— 这个洞必须堵,但堵在上传环节)\n`)

  await pool.end()
}

run().catch(async (e) => { console.error('💥', e); await pool.end(); process.exit(1) })
