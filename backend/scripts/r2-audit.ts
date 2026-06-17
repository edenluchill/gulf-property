/**
 * R2 storage audit (READ-ONLY) — reports what's taking up space and likely junk.
 *
 * - Aggregates object count + size per top-level prefix
 * - Breaks down pending-pdfs/ by jobId (these are raw uploads that should be
 *   deleted after the worker finishes — prime junk candidates)
 * - Lists incomplete multipart uploads (orphans from aborted/abandoned uploads;
 *   invisible in the R2 web UI but still billed)
 *
 * Deletes NOTHING. Run: cd backend && npx ts-node scripts/r2-audit.ts
 */

import dotenv from 'dotenv'
dotenv.config()

import {
  S3Client,
  ListObjectsV2Command,
  ListMultipartUploadsCommand,
} from '@aws-sdk/client-s3'

const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
})
const BUCKET = process.env.R2_BUCKET_NAME || ''

function mb(bytes: number): string {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + ' GB'
  return (bytes / 1024 ** 2).toFixed(1) + ' MB'
}

interface Agg { count: number; size: number }

async function main() {
  console.log(`\n📊 Auditing R2 bucket: ${BUCKET}\n`)

  const byPrefix: Record<string, Agg> = {}
  const pendingByJob: Record<string, Agg> = {}
  let totalCount = 0
  let totalSize = 0
  let token: string | undefined

  do {
    const r = await client.send(
      new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token, MaxKeys: 1000 })
    )
    for (const o of r.Contents || []) {
      const key = o.Key || ''
      const size = o.Size || 0
      totalCount++
      totalSize += size
      const top = key.split('/')[0] || '(root)'
      ;(byPrefix[top] ||= { count: 0, size: 0 })
      byPrefix[top].count++
      byPrefix[top].size += size
      if (top === 'pending-pdfs') {
        const job = key.split('/')[1] || '(none)'
        ;(pendingByJob[job] ||= { count: 0, size: 0 })
        pendingByJob[job].count++
        pendingByJob[job].size += size
      }
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined
  } while (token)

  console.log(`Total: ${totalCount} objects, ${mb(totalSize)}\n`)
  console.log('By top-level prefix (largest first):')
  Object.entries(byPrefix)
    .sort((a, b) => b[1].size - a[1].size)
    .forEach(([p, a]) => console.log(`  ${p.padEnd(16)} ${String(a.count).padStart(7)} objs   ${mb(a.size).padStart(10)}`))

  // pending-pdfs detail — these are raw uploads that should be cleaned post-process
  const jobs = Object.entries(pendingByJob).sort((a, b) => b[1].size - a[1].size)
  if (jobs.length) {
    const pendTotal = jobs.reduce((s, [, a]) => s + a.size, 0)
    console.log(`\n🗑️  pending-pdfs/: ${jobs.length} job folder(s), ${mb(pendTotal)} (likely JUNK — raw uploads kept after processing)`)
    jobs.slice(0, 15).forEach(([job, a]) => console.log(`     ${job.padEnd(36)} ${a.count} file(s)  ${mb(a.size)}`))
    if (jobs.length > 15) console.log(`     ...and ${jobs.length - 15} more job folders`)
  } else {
    console.log('\n✅ pending-pdfs/ is empty — no leftover raw uploads.')
  }

  // incomplete multipart uploads (orphans, invisible in UI, still billed)
  let mpuCount = 0
  let oldest: Date | undefined
  let mtoken: string | undefined
  let mkeytoken: string | undefined
  do {
    const r: any = await client.send(
      new ListMultipartUploadsCommand({
        Bucket: BUCKET,
        KeyMarker: mkeytoken,
        UploadIdMarker: mtoken,
      })
    )
    for (const u of r.Uploads || []) {
      mpuCount++
      const init = u.Initiated ? new Date(u.Initiated) : undefined
      if (init && (!oldest || init < oldest)) oldest = init
    }
    if (r.IsTruncated) {
      mkeytoken = r.NextKeyMarker
      mtoken = r.NextUploadIdMarker
    } else {
      mkeytoken = undefined
      mtoken = undefined
    }
  } while (mkeytoken || mtoken)

  if (mpuCount > 0) {
    console.log(`\n⚠️  Incomplete multipart uploads: ${mpuCount} (orphans — invisible in R2 UI, still billed)`)
    if (oldest) console.log(`     oldest started: ${oldest.toISOString()}`)
    console.log(`     → safe to abort any older than ~1 day (no completed upload uses them).`)
  } else {
    console.log('\n✅ No incomplete multipart uploads.')
  }

  console.log('\nDone (read-only — nothing deleted).')
}

main().catch((e) => {
  console.error('❌ Audit failed:', e?.message || e)
  process.exit(1)
})
