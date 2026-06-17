/**
 * Delete raw uploaded PDFs for a job once processing succeeds.
 *
 * The brochure is only needed during processing; keeping it wastes R2 space
 * (pending-pdfs/ had grown to 6GB+ of processed leftovers before this). Failed
 * jobs are intentionally NOT cleaned here, so the PDF stays available for
 * debugging or retry.
 */
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME || '';

/** Delete every object under pending-pdfs/{jobId}/. Returns count deleted. */
export async function deletePdfsForJob(jobId: string): Promise<number> {
  const prefix = `pending-pdfs/${jobId}/`;
  const list = await r2Client.send(
    new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix })
  );
  const objects = (list.Contents || [])
    .filter((o) => o.Key)
    .map((o) => ({ Key: o.Key as string }));
  if (objects.length === 0) return 0;
  await r2Client.send(
    new DeleteObjectsCommand({
      Bucket: R2_BUCKET,
      Delete: { Objects: objects, Quiet: true },
    })
  );
  console.log(`🧹 Deleted ${objects.length} processed PDF(s) for job ${jobId}`);
  return objects.length;
}
