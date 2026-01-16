/**
 * PDF Workflow Executor
 * 
 * Main entry point for executing PDF processing workflow.
 * 
 * Strategy:
 * 1. Split all PDFs into uniform chunks (default: 5 pages per chunk)
 * 2. Process chunks in parallel batches (with rate limiting)
 * 3. Aggregate and merge results in real-time
 * 4. Return finalized building data
 * 
 * Perfect for processing single or multiple PDFs of any size!
 */

import { join } from 'path';
import { createOutputStructure } from '../utils/pdf/file-manager';
import { progressEmitter } from '../services/progress-emitter';
import { splitAllPdfsIntoChunks } from './strategies/chunking';
import { processChunksInBatches } from './processors/batch-processor';
import { 
  createEmptyAggregatedData, 
  finalizeAggregatedData 
} from './processors/data-aggregator';
import { ResultRecorder } from './processors/result-recorder';

export interface WorkflowConfig {
  pdfBuffers: Buffer[];
  pdfNames?: string[];
  outputBaseDir?: string;
  jobId: string;
  pagesPerChunk?: number;
  batchSize?: number;
  batchDelay?: number;
}

export interface WorkflowResult {
  success: boolean;
  buildingData: any;
  processingTime: number;
  errors: string[];
  warnings: string[];
  jobId: string;
  totalChunks: number;
  totalPages: number;
  analysisReportPath?: string;  // Path to detailed JSON analysis report
}

/**
 * Execute PDF processing workflow
 * 
 * @param config - Workflow configuration
 * @returns Processing result with building data
 */
export async function executePdfWorkflow(
  config: WorkflowConfig
): Promise<WorkflowResult> {
  const startTime = Date.now();
  const { 
    jobId, 
    pdfBuffers, 
    pdfNames, 
    pagesPerChunk = 5,
    batchSize = 10,
    batchDelay = 1000,
  } = config;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`PDF PROCESSING WORKFLOW - Job ID: ${jobId}`);
  console.log(`Files: ${pdfBuffers.length} | Pages per chunk: ${pagesPerChunk}`);
  console.log(`Batch size: ${batchSize} | Batch delay: ${batchDelay}ms`);
  console.log(`${'='.repeat(70)}\n`);

  try {
    // Setup output directory
    const outputBaseDir = config.outputBaseDir || join(process.cwd(), 'uploads', 'langgraph-output');
    const outputStructure = createOutputStructure(outputBaseDir, jobId);

    // Initialize result recorder for detailed analysis
    const resultRecorder = new ResultRecorder(
      jobId, 
      outputStructure.jobDir,
      pdfNames || pdfBuffers.map((_, i) => `Document ${i + 1}`)
    );
    
    resultRecorder.setMetadata({
      pagesPerChunk,
      batchSize,
      batchDelay,
    });

    // ============================================================
    // STEP 1: Split all PDFs into chunks
    // ============================================================
    progressEmitter.emit(jobId, {
      stage: 'ingestion',
      message: `📦 正在将所有文档切分成 ${pagesPerChunk} 页小块...`,
      progress: 5,
      timestamp: Date.now(),
    });

    const { chunks, totalChunks, totalPages } = await splitAllPdfsIntoChunks({
      pdfBuffers,
      pdfNames,
      pagesPerChunk,
    });

    progressEmitter.emit(jobId, {
      stage: 'ingestion',
      message: `✅ 已切分成 ${totalChunks} 个小块，开始批量处理...`,
      progress: 10,
      timestamp: Date.now(),
    });

    // ============================================================
    // STEP 2: Process chunks in batches and aggregate data
    // ============================================================
    const aggregatedData = createEmptyAggregatedData();

    const { allErrors, allWarnings, chunkAnalyses } = await processChunksInBatches(
      {
        chunks,
        outputDir: outputStructure.jobDir,
        jobId,
        batchSize,
        batchDelay,
      },
      aggregatedData
    );
    
    // Record all chunk analyses
    chunkAnalyses.forEach(chunk => resultRecorder.recordChunk(chunk));

    // ============================================================
    // STEP 3: Finalize and deduplicate aggregated data
    // ============================================================
    console.log(`\n📊 Processing complete. Finalizing data...`);

    progressEmitter.emit(jobId, {
      stage: 'reducing',
      message: '📊 正在合并去重数据...',
      progress: 90,
      timestamp: Date.now(),
    });

    const finalData = finalizeAggregatedData(aggregatedData);

    // Log summary
    console.log(`\n📊 Final Summary:`);
    console.log(`   Units: ${aggregatedData.units.length} → ${finalData.units.length} (deduplicated)`);
    console.log(`   Payment plans: ${finalData.paymentPlans.length}`);
    console.log(`   Amenities: ${finalData.amenities.length}`);
    console.log(`   Images: ${finalData.images.projectImages.length} project, ${finalData.images.floorPlanImages.length} floor plans`);

    // ============================================================
    // STEP 4: Save detailed analysis report
    // ============================================================
    const analysisReportPath = resultRecorder.saveFullReport(
      finalData,
      allErrors,
      allWarnings
    );

    // ============================================================
    // STEP 5: Return result
    // ============================================================
    const processingTime = Date.now() - startTime;

    console.log(`\n${'='.repeat(70)}`);
    console.log('✅ WORKFLOW COMPLETED');
    console.log(`Time: ${(processingTime / 1000).toFixed(2)}s | Chunks: ${totalChunks} | Pages: ${totalPages}`);
    console.log(`${'='.repeat(70)}\n`);

    return {
      success: allErrors.length === 0,
      buildingData: finalData,
      processingTime,
      errors: allErrors,
      warnings: allWarnings,
      jobId,
      totalChunks,
      totalPages,
      analysisReportPath,
    };

  } catch (error) {
    console.error('❌ WORKFLOW FAILED:', error);
    progressEmitter.error(jobId, String(error));

    return {
      success: false,
      buildingData: {},
      processingTime: Date.now() - startTime,
      errors: [String(error)],
      warnings: [],
      jobId,
      totalChunks: 0,
      totalPages: 0,
      analysisReportPath: undefined,
    };
  }
}
