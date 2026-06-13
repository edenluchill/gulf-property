/**
 * 本地直跑 PDF pipeline（绕过上传/worker队列，直接调 executePdfWorkflow）
 *
 * 用法:
 *   cd backend
 *   npx ts-node scripts/run-pdf-local.ts "C:\path\to\a.pdf" ["C:\path\to\b.pdf" ...]
 *
 * 输出: uploads/langgraph-output/job_local_xxx 目录 + 控制台户型图片归属摘要
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { basename, join } from 'path';
import { executePdfWorkflow } from '../src/langgraph/workflow-executor';

async function main() {
  const pdfPaths = process.argv.slice(2);
  if (pdfPaths.length === 0) {
    console.error('Usage: npx ts-node scripts/run-pdf-local.ts <pdf> [<pdf> ...]');
    process.exit(1);
  }

  const pdfBuffers = pdfPaths.map(p => readFileSync(p));
  const pdfNames = pdfPaths.map(p => basename(p));
  const jobId = `local_test_${Date.now()}`;

  console.log(`\n🚀 Local pipeline run: ${jobId}`);
  pdfNames.forEach((n, i) => console.log(`   📄 ${n} (${(pdfBuffers[i].length / 1024 / 1024).toFixed(1)} MB)`));

  const t0 = Date.now();
  const result = await executePdfWorkflow({
    pdfBuffers,
    pdfNames,
    outputBaseDir: join(process.cwd(), 'uploads', 'langgraph-output'),
    jobId,
    pagesPerChunk: 5,
    batchSize: 10,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const bd: any = result.buildingData || {};
  const units: any[] = bd.units || [];

  console.log('\n' + '='.repeat(70));
  console.log(`📊 RESULT (${elapsed}s, success=${result.success})`);
  console.log('='.repeat(70));
  console.log(`项目: ${bd.name} | 开发商: ${bd.developer} | 区域: ${bd.area}`);
  console.log(`总页数: ${result.totalPages} | 户型数: ${units.length}`);
  console.log(`项目图: ${bd.images?.projectImages?.length ?? 0} | 付款计划: ${bd.paymentPlans?.length ?? 0}`);

  console.log('\n户型明细:');
  for (const u of units) {
    console.log(
      `  • ${u.typeName || u.name}`.padEnd(50) +
      ` | ${String(u.category || '?').padEnd(8)}` +
      ` | ${String(u.bedrooms ?? '?')}BR ${String(u.area ?? '?')}sqft` +
      ` | 价格:${u.price ? (u.price / 1e6).toFixed(2) + 'M' : '无'}` +
      ` | 平面图:${u.floorPlanImages?.length ?? 0}` +
      ` | 外观:${u.renderingImages?.length ?? 0}` +
      ` | 室内:${u.interiorImages?.length ?? 0}`
    );
  }

  if (result.errors?.length) {
    console.log('\n❌ Errors:');
    result.errors.slice(0, 10).forEach((e: any) => console.log(`  - ${e}`));
  }
  if (result.warnings?.length) {
    console.log(`\n⚠️  Warnings: ${result.warnings.length} (前5条)`);
    result.warnings.slice(0, 5).forEach((w: any) => console.log(`  - ${w}`));
  }

  console.log(`\n📁 详细输出: uploads/langgraph-output/job_${jobId}/`);
  process.exit(result.success ? 0 : 1);
}

main().catch(err => {
  console.error('💥 Pipeline crashed:', err);
  process.exit(1);
});
