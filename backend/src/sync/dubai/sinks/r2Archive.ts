/**
 * Lossless raw archive → R2 object storage (separate from the query DB).
 * Every fetched page is stored verbatim at dubai-sync/<dataset>/<runId>/page-N.json
 * so any future re-processing/extension can replay the original API payload.
 * Best-effort: archive failures are logged, never abort the sync.
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

let client: S3Client | null = null
function getClient(): S3Client {
  if (client) return client
  client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    },
  })
  return client
}

export function isArchiveConfigured(): boolean {
  return !!(process.env.R2_ENDPOINT && process.env.R2_BUCKET_NAME && process.env.R2_ACCESS_KEY_ID)
}

export async function archivePage(
  datasetKey: string,
  runId: string,
  page: number,
  results: any[]
): Promise<void> {
  if (!isArchiveConfigured()) return
  const key = `dubai-sync/${datasetKey}/${runId}/page-${String(page).padStart(5, '0')}.json`
  await getClient().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: JSON.stringify(results),
      ContentType: 'application/json',
    })
  )
}
