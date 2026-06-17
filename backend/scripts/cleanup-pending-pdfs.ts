/**
 * Cleanup pending-pdfs/ — deletes raw uploaded brochures the worker already
 * processed. The PDF is only needed during processing (a few minutes); anything
 * older is dead weight. Replaces the broken cleanup-r2-temp-files.ts (which
 * imported a non-existent cleanupOldR2TempFiles()).
 *
 * SAFE BY DEFAULT: dry-run (lists what it WOULD delete). Add --delete to remove.
 * Filters by the timestamp embedded in jobId (job_{ms}_{rand}); keeps anything
 * newer than --hours (default 24) so in-flight jobs are never touched.
 *
 * Usage:
 *   npx ts-node scripts/cleanup-pending-pdfs.ts                 # preview (24h)
 *   npx ts-node scripts/cleanup-pending-pdfs.ts --hours=1       # preview (1h)
 *   npx ts-node scripts/cleanup-pending-pdfs.ts --delete        # actually delete
 */

import dotenv from 'dotenv'
dotenv.config()

import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
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

const DO_DELETE = process.argv.includes('--delete')
const hoursArg = process.argv.find((a) => a.startsWith('--hours='))
const AGE_HOURS = hoursArg ? Number(hoursArg.split('=')[1]) : 24
const cutoff = Date.now() - AGE_HOURS * 3600 * 1000

function mb(bytes: number): string {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + ' GB'
  return (bytes / 1024 ** 2).toFixed(1) + ' MB'
}

/** jobId looks like job_{ms}_{rand}; return the ms timestamp or null. */
function jobTimestamp(jobId: string): number | null {
  const parts = jobId.split('_')
  const ms = Number(parts[1])
  return Number.isFinite(ms) && ms > 1e12 ? ms : null
}

async function main() {
  console.log(`\n🧹 pending-pdfs/ cleanup  (mode: ${DO_DELETE ? 'DELETE' : 'DRY-RUN'}, keep < ${AGE_HOURS}h)\n`)

  const toDelete: { Key: string }[] = []
  const keptJobs = new Set<string>()
  let delSize = 0
  let token: string | undefined

  do {
    const r = await client.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'pending-pdfs/', ContinuationToken: token, MaxKeys: 1000 })
    )
    for (const o of r.Contents || []) {
      const key = o.Key || ''
      const jobId = key.split('/')[1] || ''
      const ts = jobTimestamp(jobId)
      // Keep if we can't parse the timestamp (be conservative) or it's recent.
      if (ts === null || ts >= cutoff) {
        keptJobs.add(jobId)
        continue
      }
      toDelete.push({ Key: key })
      delSize += o.Size || 0
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined
  } while (token)

  const delJobs = new Set(toDelete.map((d) => d.Key.split('/')[1]))
  console.log(`Will delete: ${toDelete.length} file(s) across ${delJobs.size} job(s), ${mb(delSize)}`)
  console.log(`Keeping:     ${keptJobs.size} recent/unparseable job(s)\n`)

  if (toDelete.length === 0) {
    console.log('Nothing to clean up.')
    return
  }

  if (!DO_DELETE) {
    console.log('DRY-RUN — nothing deleted. Re-run with --delete to remove the above.')
    return
  }

  // Delete in batches of 1000
  let deleted = 0
  for (let i = 0; i < toDelete.length; i += 1000) {
    const batch = toDelete.slice(i, i + 1000)
    const res = await client.send(
      new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: batch, Quiet: true } })
    )
    deleted += batch.length - (res.Errors?.length || 0)
    if (res.Errors?.length) console.error(`  ${res.Errors.length} delete error(s) in batch`, res.Errors[0])
  }
  console.log(`✅ Deleted ${deleted} file(s), freed ~${mb(delSize)}.`)
}

main().catch((e) => {
  console.error('❌ Cleanup failed:', e?.message || e)
  process.exit(1)
})
