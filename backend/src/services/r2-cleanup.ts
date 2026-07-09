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
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { createHash } from 'crypto';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME || '';

async function streamToBuffer(body: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of body) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

/**
 * 永久归档(按内容 hash 去重):把 pending-pdfs/{jobId}/* 归档到
 * **pdf-archive/{sha256}.pdf**(永不自动清理)。同一 PDF 被多个 job 重复上传时
 * 只存一份(内容 hash 相同 → 同一 key)。处理成功后调用,供 pipeline 改进后重跑验证。
 * 幂等(已存在则跳过);不删 pending(pending 照常清理)。失败不抛(非致命)。
 * 返回 [{ hash, key, name }]。
 */
export async function archivePdfsForJob(
  jobId: string
): Promise<{ hash: string; key: string; name: string }[]> {
  const prefix = `pending-pdfs/${jobId}/`;
  const archived: { hash: string; key: string; name: string }[] = [];
  try {
    const list = await r2Client.send(
      new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix })
    );
    const keys = (list.Contents || []).map((o) => o.Key).filter(Boolean) as string[];
    for (const key of keys) {
      const name = key.slice(prefix.length);
      if (!name || !/\.pdf$/i.test(name)) continue; // 只归档 PDF(跳过占位 _.pdf 等非 PDF)
      const bytes = await streamToBuffer(
        (await r2Client.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }))).Body
      );
      const hash = createHash('sha256').update(bytes).digest('hex');
      const dest = `pdf-archive/${hash}.pdf`;
      // 已存在(同内容)→ 跳过,保证唯一
      let exists = false;
      try { await r2Client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: dest })); exists = true; } catch { /* not found */ }
      if (!exists) {
        await r2Client.send(new PutObjectCommand({
          Bucket: R2_BUCKET, Key: dest, Body: bytes, ContentType: 'application/pdf',
          Metadata: { originalName: encodeURIComponent(name), firstJob: jobId },
        }));
      }
      archived.push({ hash, key: dest, name });
    }
    if (archived.length > 0) {
      console.log(`📦 Archived ${archived.length} source PDF(s) for job ${jobId} → pdf-archive/{hash}.pdf (content-deduped)`);
    }
    return archived;
  } catch (e) {
    console.warn(`⚠️  archivePdfsForJob(${jobId}) failed (non-fatal):`, (e as Error).message);
    return archived;
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
