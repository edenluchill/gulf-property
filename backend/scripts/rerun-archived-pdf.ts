/**
 * 重跑归档 PDF —— pipeline 改进后回归验证/优化用。
 * 归档按内容 hash 存 pdf-archive/{sha256}.pdf(唯一,同内容只一份)。
 *
 *   npx ts-node scripts/rerun-archived-pdf.ts --list          # 列出所有归档 PDF(hash + 原名)
 *   TS_NODE_TRANSPILE_ONLY=1 npx ts-node scripts/rerun-archived-pdf.ts <hash> [<hash2> ...]  # 一起重跑
 */
import 'dotenv/config';
import { S3Client, ListObjectsV2Command, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { join } from 'path';
import { executePdfWorkflow } from '../src/langgraph/workflow-executor';

const r2 = new S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID || '', secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '' } });
const BUCKET = process.env.R2_BUCKET_NAME || '';

async function streamToBuffer(body: any): Promise<Buffer> {
  const chunks: Buffer[] = []; for await (const c of body) chunks.push(Buffer.from(c)); return Buffer.concat(chunks);
}

async function listArchived(): Promise<void> {
  let token: string | undefined; let n = 0;
  do {
    const r = await r2.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'pdf-archive/', ContinuationToken: token }));
    for (const o of r.Contents || []) {
      const hash = (o.Key || '').replace('pdf-archive/', '').replace('.pdf', '');
      let name = '';
      try { const h = await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: o.Key! })); name = decodeURIComponent(h.Metadata?.originalname || ''); } catch { /* */ }
      console.log(`  ${hash.slice(0, 16)}  ${((o.Size || 0) / 1e6).toFixed(1)}MB  ${name}`);
      n++;
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  console.log(`归档 PDF 总数(唯一): ${n}`);
}

async function rerun(hashes: string[]): Promise<void> {
  const pdfBuffers: Buffer[] = []; const pdfNames: string[] = [];
  for (const hash of hashes) {
    const key = `pdf-archive/${hash}.pdf`;
    const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    pdfBuffers.push(await streamToBuffer(obj.Body));
    pdfNames.push(decodeURIComponent(obj.Metadata?.originalname || `${hash.slice(0, 8)}.pdf`));
  }
  console.log(`⬇️  ${pdfBuffers.length} PDF 重跑...`);
  const result = await executePdfWorkflow({ pdfBuffers, pdfNames, outputBaseDir: join(process.cwd(), 'uploads', 'langgraph-output'), jobId: `rerun_${Date.now().toString(36)}`, pagesPerChunk: 5, batchSize: 10 });
  const units: any[] = result.buildingData?.units || [];
  console.log(`\n📊 户型数=${units.length}, 项目图=${result.buildingData?.images?.projectImages?.length ?? 0}`);
  for (const u of units) console.log(`  • ${(u.typeName || u.name || '?').padEnd(40)} | ${String(u.category || '?').padEnd(8)} | ${u.area ?? '?'}sqft | 平面图:${u.floorPlanImages?.length ?? 0}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--list') { await listArchived(); return; }
  await rerun(args); process.exit(0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
