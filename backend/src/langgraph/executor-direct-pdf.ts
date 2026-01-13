/**
 * Direct PDF Workflow Executor
 * 
 * Executes PDF processing using Gemini's native PDF support
 * NO canvas/pdf-img-convert required!
 */

import { buildDirectPdfWorkflow } from './graph-direct-pdf';
import type { State } from './state';
import { generateJobId, createOutputStructure } from '../utils/pdf/file-manager';
import { join } from 'path';

export interface DirectPdfWorkflowConfig {
  pdfBuffer: Buffer;
  pdfPath?: string;
  outputBaseDir?: string;
}

export interface WorkflowResult {
  success: boolean;
  buildingData: any;
  marketContext?: any;
  analysisReport?: any;
  marketingContent?: any;
  processingTime: number;
  errors: string[];
  warnings: string[];
  jobId: string;
}

/**
 * Execute PDF workflow using direct processing (no image conversion)
 */
export async function executeDirectPdfWorkflow(
  config: DirectPdfWorkflowConfig
): Promise<WorkflowResult> {
  const startTime = Date.now();
  const jobId = generateJobId();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`DIRECT PDF WORKFLOW - Job ID: ${jobId}`);
  console.log(`Using Gemini native PDF processing (NO canvas needed!)`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    // Create output structure
    const outputBaseDir = config.outputBaseDir || join(process.cwd(), 'uploads', 'langgraph-output');
    const outputStructure = createOutputStructure(outputBaseDir, jobId);

    // Initialize state
    const initialState: Partial<State> = {
      pdfPath: config.pdfPath || `job_${jobId}.pdf`,
      pdfBuffer: config.pdfBuffer,
      outputDir: outputStructure.jobDir,
      totalPages: 0,
      pageImages: [],
      pageResults: [],
      buildingData: {},
      categorizedImages: {
        cover: [],
        renderings: [],
        floorPlans: [],
        amenities: [],
        maps: [],
      },
      retryCount: 0,
      errors: [],
      warnings: [],
      startTime,
      processingStage: 'ingestion',
    };

    // Build and execute workflow
    const app = buildDirectPdfWorkflow();

    console.log('Starting direct PDF processing...\n');

    const finalState = await app.invoke(initialState);

    const processingTime = Date.now() - startTime;

    console.log(`\n${'='.repeat(60)}`);
    console.log('✅ WORKFLOW COMPLETED');
    console.log(`Processing Time: ${(processingTime / 1000).toFixed(2)}s`);
    console.log(`${'='.repeat(60)}\n`);

    // Log summary
    console.log('📊 SUMMARY:');
    console.log(`  Units Extracted: ${finalState.buildingData?.units?.length || 0}`);
    console.log(`  Payment Plans: ${finalState.buildingData?.paymentPlans?.length || 0}`);
    console.log(`  Amenities: ${finalState.buildingData?.amenities?.length || 0}`);
    console.log(`  Errors: ${finalState.errors?.length || 0}`);
    console.log(`  Warnings: ${finalState.warnings?.length || 0}`);
    console.log();

    return {
      success: finalState.errors.length === 0,
      buildingData: finalState.buildingData,
      marketContext: finalState.marketContext,
      analysisReport: finalState.analysisReport,
      marketingContent: finalState.marketingContent,
      processingTime,
      errors: finalState.errors,
      warnings: finalState.warnings,
      jobId,
    };

  } catch (error) {
    console.error('❌ WORKFLOW FAILED:', error);

    const processingTime = Date.now() - startTime;

    return {
      success: false,
      buildingData: {},
      processingTime,
      errors: [String(error)],
      warnings: [],
      jobId,
    };
  }
}
