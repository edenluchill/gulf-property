/**
 * Test the full PDF processing pipeline against a local brochure PDF.
 *
 * Usage:
 *   cd backend && npx ts-node scripts/test-pdf-processing.ts "C:\path\to\brochure.pdf"
 *
 * Output goes to backend/uploads/langgraph-output/job_xxx/ — check the
 * "SUBMIT READINESS" section in the analysis summary for the verdict.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    console.error('Usage: npx ts-node scripts/test-pdf-processing.ts <path-to-pdf>');
    process.exit(1);
  }

  const { executePdfWorkflow } = await import('../src/langgraph/workflow-executor');

  const pdfBuffer = fs.readFileSync(pdfPath);
  const pdfName = path.basename(pdfPath);
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  console.log(`\n🧪 Testing PDF processing: ${pdfName} (${(pdfBuffer.length / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`   Job ID: ${jobId}\n`);

  const result = await executePdfWorkflow({
    pdfBuffers: [pdfBuffer],
    pdfNames: [pdfName],
    jobId,
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Success: ${result.success} | Time: ${result.processingTime.toFixed(1)}s`);
  console.log(`Units: ${result.buildingData?.units?.length ?? 0} | Errors: ${result.errors.length} | Warnings: ${result.warnings.length}`);
  if (result.errors.length > 0) {
    console.log('\nERRORS:');
    result.errors.forEach(e => console.log(`  - ${e}`));
  }

  const summaryPath = path.join(__dirname, '..', 'uploads', 'langgraph-output', jobId, `analysis-summary-${jobId}.txt`);
  if (fs.existsSync(summaryPath)) {
    const summary = fs.readFileSync(summaryPath, 'utf-8');
    const idx = summary.indexOf('🚦 SUBMIT READINESS');
    const end = summary.indexOf('📦 CHUNK-BY-CHUNK');
    if (idx >= 0) {
      console.log(`\n${summary.slice(idx, end > idx ? end : undefined)}`);
    }
    console.log(`Full summary: ${summaryPath}`);
  }

  process.exit(result.success ? 0 : 1);
}

main().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
