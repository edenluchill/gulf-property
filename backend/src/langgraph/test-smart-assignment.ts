/**
 * 测试智能图片分配系统
 * 
 * 使用方法：
 * npx ts-node src/langgraph/test-smart-assignment.ts
 */

import { readFileSync } from 'fs';
import { executePdfWorkflow } from './workflow-executor';

async function testSmartAssignment() {
  console.log('🧪 Testing Smart Image Assignment System\n');
  
  // TODO: 替换为实际的测试PDF路径
  const testPdfPath = process.argv[2];
  
  if (!testPdfPath) {
    console.error('❌ Please provide PDF path: npx ts-node src/langgraph/test-smart-assignment.ts path/to/test.pdf');
    process.exit(1);
  }
  
  const pdfBuffer = readFileSync(testPdfPath);
  const testJobId = `test_${Date.now()}`;
  
  console.log(`📄 PDF: ${testPdfPath}`);
  console.log(`🆔 Job ID: ${testJobId}\n`);
  
  const result = await executePdfWorkflow({
    pdfBuffers: [pdfBuffer],
    pdfNames: [testPdfPath],
    jobId: testJobId,
    pagesPerChunk: 5,
    batchSize: 10,
  });
  
  console.log('\n' + '='.repeat(70));
  console.log('📊 Test Results:');
  console.log('='.repeat(70));
  console.log(`Success: ${result.success}`);
  console.log(`Total Chunks: ${result.totalChunks}`);
  console.log(`Total Pages: ${result.totalPages}`);
  console.log(`Processing Time: ${(result.processingTime / 1000).toFixed(2)}s`);
  console.log(`Units Found: ${result.buildingData?.units?.length || 0}`);
  console.log('='.repeat(70) + '\n');
  
  if (result.buildingData?.units) {
    console.log('🏠 Units:');
    result.buildingData.units.forEach((unit: any, idx: number) => {
      console.log(`\n${idx + 1}. ${unit.name || unit.typeName}`);
      console.log(`   - Floor Plans: ${unit.floorPlanImages?.length || 0}`);
      console.log(`   - Renderings: ${unit.renderingImages?.length || 0}`);
      console.log(`   - Interiors: ${unit.interiorImages?.length || 0}`);
      if (unit.pdfSources) {
        console.log(`   - Sources: ${unit.pdfSources.join(', ')}`);
      }
    });
  }
}

testSmartAssignment().catch(console.error);
