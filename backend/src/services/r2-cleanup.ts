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
  CopyObjectCommand,
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

/**
 * 永久归档:把 pending-pdfs/{jobId}/* 复制到 pdf-archive/{jobId}/*(永不自动清理)。
 * 处理成功后调用 → 源 PDF 永久保留,供 pipeline 改进后重跑验证/优化。
 * 幂等(已归档的 Copy 覆盖同 key,无副作用);不删 pending(pending 照常清理)。
 * 返回归档的 R2 key 列表。失败不抛(非致命,只记 warn)。
 */
export async function archivePdfsForJob(jobId: string): Promise<string[]> {
  const prefix = `pending-pdfs/${jobId}/`;
  try {
    const list = await r2Client.send(
      new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix })
    );
    const keys = (list.Contents || []).map((o) => o.Key).filter(Boolean) as string[];
    const archived: string[] = [];
    for (const key of keys) {
      const dest = `pdf-archive/${jobId}/${key.slice(prefix.length)}`;
      await r2Client.send(
        new CopyObjectCommand({
          Bucket: R2_BUCKET,
          CopySource: `${R2_BUCKET}/${encodeURIComponent(key)}`,
          Key: dest,
        })
      );
      archived.push(dest);
    }
    if (archived.length > 0) console.log(`📦 Archived ${archived.length} source PDF(s) for job ${jobId} → pdf-archive/`);
    return archived;
  } catch (e) {
    console.warn(`⚠️  archivePdfsForJob(${jobId}) failed (non-fatal):`, (e as Error).message);
    return [];
  }
}

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
