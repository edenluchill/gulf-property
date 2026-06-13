/**
 * 清除某个 PDF 的 R2 图片缓存（pdf-cache/{hash}/images/*）
 *
 * 用途：缓存里存了错误/错位的页面图片时强制重新生成。
 * R2 上传遇到已存在的 key 会跳过，所以脏缓存必须显式删除。
 *
 * 用法:
 *   cd backend
 *   npx ts-node --transpile-only scripts/purge-pdf-cache.ts "C:\path\to\file.pdf"
 *   npx ts-node --transpile-only scripts/purge-pdf-cache.ts --hash <fullPdfHash>
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { calculatePdfHash } from '../src/utils/pdf/pdf-hash';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME || '';

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: purge-pdf-cache.ts <pdfPath> | --hash <fullHash>');
    process.exit(1);
  }

  const pdfHash = arg === '--hash'
    ? process.argv[3]
    : calculatePdfHash(readFileSync(arg));

  if (!pdfHash) {
    console.error('No hash resolved');
    process.exit(1);
  }

  const prefix = `pdf-cache/${pdfHash}/images/`;
  console.log(`🧹 Purging R2 cache: ${prefix}`);

  let deleted = 0;
  let token: string | undefined;
  do {
    const list = await r2Client.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: prefix,
      ContinuationToken: token,
    }));
    const keys = (list.Contents || []).map(o => ({ Key: o.Key! }));
    if (keys.length > 0) {
      await r2Client.send(new DeleteObjectsCommand({
        Bucket: R2_BUCKET,
        Delete: { Objects: keys },
      }));
      deleted += keys.length;
      console.log(`   🗑️  Deleted ${deleted} objects so far...`);
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);

  console.log(`✅ Purged ${deleted} objects for hash ${pdfHash.substring(0, 12)}...`);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
