/**
 * 一次性回填:把现有 pending-pdfs/ 里所有 PDF 按内容 hash 归档到 pdf-archive/{sha256}.pdf。
 * 幂等(已存在跳过),同内容只存一份。归档上线前的存量 PDF 供以后回归验证。
 *   TS_NODE_TRANSPILE_ONLY=1 npx ts-node scripts/backfill-pdf-archive.ts
 */
import 'dotenv/config';
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';

const r2 = new S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID || '', secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '' } });
const BUCKET = process.env.R2_BUCKET_NAME || '';

async function buf(body: any): Promise<Buffer> { const c: Buffer[] = []; for await (const x of body) c.push(Buffer.from(x)); return Buffer.concat(c); }

async function main() {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const r = await r2.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'pending-pdfs/', ContinuationToken: token }));
    for (const o of r.Contents || []) if (o.Key && /\.pdf$/i.test(o.Key) && !o.Key.endsWith('/_.pdf')) keys.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  console.log(`pending-pdfs 里的 PDF: ${keys.length}`);

  let archived = 0, skipped = 0;
  const seen = new Set<string>();
  for (const key of keys) {
    const bytes = await buf((await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))).Body);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (seen.has(hash)) { skipped++; continue; }
    seen.add(hash);
    const dest = `pdf-archive/${hash}.pdf`;
    let exists = false;
    try { await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: dest })); exists = true; } catch { /* */ }
    if (exists) { skipped++; continue; }
    const name = key.split('/').pop() || 'x.pdf';
    await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: dest, Body: bytes, ContentType: 'application/pdf', Metadata: { originalName: encodeURIComponent(name), firstJob: (key.match(/pending-pdfs\/([^/]+)\//) || [])[1] || '' } }));
    archived++;
    console.log(`  📦 ${hash.slice(0, 12)}  ${name}`);
  }
  console.log(`\n✅ 归档 ${archived} 个唯一 PDF,跳过 ${skipped}(重复/已存在)。总唯一: ${seen.size}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
