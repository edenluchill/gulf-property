/**
 * 一次性修复:用修复后的 pipeline 重跑 Binghatti Wraith 两个归档 PDF,
 * 把干净的 buildingData 写回现有审核 task(串图修复,见
 * docs/reports/2026-07-09-floorplan-crossmix-binghatti-wraith.md)。
 *
 *   TS_NODE_TRANSPILE_ONLY=1 npx ts-node scripts/repair-wraith-task.ts
 */
import { config } from 'dotenv';
import { resolve, join } from 'path';
config({ path: resolve(__dirname, '../.env') });
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { executePdfWorkflow } from '../src/langgraph/workflow-executor';

const JOB_ID = 'job_1783627788287_afboj';
const HASHES = [
  'dffb4ae5f835b1783c398ad645a361fe70a0b575155a58b7676d75127b9c3b5b', // floor-plans.pdf
  '47c01b6a58ee64054b73256e7ef0f930adddee4683a270347741e410f508381e', // brochure.pdf
];

const r2 = new S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID || '', secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '' } });
const BUCKET = process.env.R2_BUCKET_NAME || '';
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function streamToBuffer(body: any): Promise<Buffer> {
  const chunks: Buffer[] = []; for await (const c of body) chunks.push(Buffer.from(c)); return Buffer.concat(chunks);
}

async function main() {
  const pdfBuffers: Buffer[] = []; const pdfNames: string[] = [];
  for (const hash of HASHES) {
    const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: `pdf-archive/${hash}.pdf` }));
    pdfBuffers.push(await streamToBuffer(obj.Body));
    pdfNames.push(decodeURIComponent(obj.Metadata?.originalname || `${hash.slice(0, 8)}.pdf`));
  }
  console.log(`⬇️  重跑 ${pdfNames.join(', ')} ...`);
  const result = await executePdfWorkflow({ pdfBuffers, pdfNames, outputBaseDir: join(process.cwd(), 'uploads', 'langgraph-output'), jobId: `repair_${JOB_ID}`, pagesPerChunk: 5, batchSize: 10 });

  const bd = result.buildingData;
  const units: any[] = bd?.units || [];
  console.log(`\n📊 干净结果: 户型=${units.length}, 项目图=${bd?.images?.projectImages?.length ?? 0}, 配套=${bd?.amenities?.length ?? 0}`);
  if (units.length < 25) { console.error('⚠️  户型数异常偏少,中止写库以防误伤'); process.exit(1); }

  // 只替换 buildingData(shape 与现有一致),保留 task 其余字段
  const res = await pool.query(
    `UPDATE pdf_processing_tasks
       SET result_data = jsonb_set(result_data, '{buildingData}', $1::jsonb, true),
           updated_at = NOW()
     WHERE job_id = $2`,
    [JSON.stringify(bd), JOB_ID]
  );
  console.log(`✅ 已写回 task ${JOB_ID} (rows=${res.rowCount})`);
  await pool.end();
  process.exit(0);
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
