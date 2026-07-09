/**
 * 重跑归档 PDF —— pipeline 改进后回归验证/优化用。
 *
 * 列出所有已归档的 job:
 *   npx ts-node scripts/rerun-archived-pdf.ts --list
 * 重跑某个 job 的归档 PDF(下载 pdf-archive/{jobId}/* → 跑 pipeline → 打印户型摘要):
 *   TS_NODE_TRANSPILE_ONLY=1 npx ts-node scripts/rerun-archived-pdf.ts <jobId>
 *
 * 归档由 worker 成功处理时写入 pdf-archive/{jobId}/(见 r2-cleanup.archivePdfsForJob)。
 */
import 'dotenv/config';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { join } from 'path';
import { executePdfWorkflow } from '../src/langgraph/workflow-executor';

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});
const BUCKET = process.env.R2_BUCKET_NAME || '';

async function streamToBuffer(body: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of body) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

async function listArchived(): Promise<void> {
  const jobs = new Map<string, string[]>();
  let token: string | undefined;
  do {
    const r = await r2.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'pdf-archive/', ContinuationToken: token }));
    for (const o of r.Contents || []) {
      const m = (o.Key || '').match(/^pdf-archive\/([^/]+)\/(.+)$/);
      if (m) { if (!jobs.has(m[1])) jobs.set(m[1], []); jobs.get(m[1])!.push(m[2]); }
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  console.log(`归档 job 数: ${jobs.size}`);
  for (const [job, files] of jobs) console.log(`  ${job}  (${files.length} PDF)  ${files.join(', ')}`);
}

async function rerun(jobId: string): Promise<void> {
  const list = await r2.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `pdf-archive/${jobId}/` }));
  const keys = (list.Contents || []).map((o) => o.Key!).filter(Boolean);
  if (keys.length === 0) { console.error(`❌ 没有归档: pdf-archive/${jobId}/`); process.exit(1); }
  console.log(`⬇️  下载 ${keys.length} 个归档 PDF...`);
  const pdfBuffers: Buffer[] = [];
  const pdfNames: string[] = [];
  for (const key of keys) {
    const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    pdfBuffers.push(await streamToBuffer(obj.Body));
    pdfNames.push(key.split('/').pop() || 'archived.pdf');
  }
  const newJobId = `rerun_${jobId}`;
  const result = await executePdfWorkflow({
    pdfBuffers, pdfNames,
    outputBaseDir: join(process.cwd(), 'uploads', 'langgraph-output'),
    jobId: newJobId, pagesPerChunk: 5, batchSize: 10,
  });
  const units: any[] = result.buildingData?.units || [];
  console.log(`\n📊 重跑结果: 户型数=${units.length}, 项目图=${result.buildingData?.images?.projectImages?.length ?? 0}`);
  for (const u of units) {
    console.log(`  • ${(u.typeName || u.name || '?').padEnd(40)} | ${String(u.category || '?').padEnd(8)} | ${u.area ?? '?'}sqft | 平面图:${u.floorPlanImages?.length ?? 0}`);
  }
}

async function main() {
  const arg = process.argv[2];
  if (!arg || arg === '--list') { await listArchived(); return; }
  await rerun(arg);
  process.exit(0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
