/**
 * Workflow Executor
 * 
 * Main entry point for executing the PDF processing workflow
 */

import { buildWorkflow, buildSimplifiedWorkflow } from './graph';
import type { State } from './state';
import { generateJobId, createOutputStructure } from '../utils/pdf/file-manager';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface WorkflowConfig {
  pdfPath?: string;
  pdfBuffer?: Buffer;
  outputBaseDir?: string;
  simplified?: boolean; // Use simplified workflow (faster, no retries)
}

export interface WorkflowResult {
  success: boolean;
  buildingData: any;
  marketContext?: any;
  analysisReport?: any;
  marketingContent?: any;
  categorizedImages: any;
  processingTime: number;
  errors: string[];
  warnings: string[];
  jobId: string;
  outputDir: string;
}

/**
 * Execute the PDF processing workflow
 * 
 * @param config - Workflow configuration
 * @returns Processing result
 */
export async function executePdfWorkflow(
  config: WorkflowConfig
): Promise<WorkflowResult> {
  const startTime = Date.now();
  const jobId = generateJobId();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`PDF PROCESSING WORKFLOW - Job ID: ${jobId}`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    // Validate input
    if (!config.pdfPath && !config.pdfBuffer) {
      throw new Error('Either pdfPath or pdfBuffer must be provided');
    }

    // Load PDF buffer if path provided
    const pdfBuffer = config.pdfBuffer || readFileSync(config.pdfPath!);

    // Create output directory structure
    const outputBaseDir = config.outputBaseDir || join(process.cwd(), 'output');
    const outputStructure = createOutputStructure(outputBaseDir, jobId);

    // Initialize state
    const initialState: Partial<State> = {
      pdfPath: config.pdfPath || `job_${jobId}.pdf`,
      pdfBuffer,
      outputDir: outputStructure.pagesDir,
      totalPages: 0,
      pageImages: [],
      pageResults: [],
      buildingData: {},
      marketContext: undefined,
      analysisReport: undefined,
      marketingContent: undefined,
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

    // Build and compile workflow
    const app = config.simplified 
      ? buildSimplifiedWorkflow()
      : buildWorkflow();

    console.log(`Using ${config.simplified ? 'SIMPLIFIED' : 'FULL'} workflow\n`);

    // Execute workflow
    console.log('Starting workflow execution...\n');
    const finalState = await app.invoke(initialState);

    const processingTime = Date.now() - startTime;

    console.log(`\n${'='.repeat(60)}`);
    console.log('WORKFLOW COMPLETED');
    console.log(`Processing Time: ${(processingTime / 1000).toFixed(2)}s`);
    console.log(`${'='.repeat(60)}\n`);

    // Log summary
    console.log('📊 SUMMARY:');
    console.log(`  Pages Processed: ${finalState.totalPages}`);
    console.log(`  Units Extracted: ${finalState.buildingData?.units?.length || 0}`);
    console.log(`  Payment Plans: ${finalState.buildingData?.paymentPlans?.length || 0}`);
    console.log(`  Errors: ${finalState.errors?.length || 0}`);
    console.log(`  Warnings: ${finalState.warnings?.length || 0}`);
    console.log();

    // Return result
    return {
      success: finalState.errors.length === 0,
      buildingData: finalState.buildingData,
      marketContext: finalState.marketContext,
      analysisReport: finalState.analysisReport,
      marketingContent: finalState.marketingContent,
      categorizedImages: finalState.categorizedImages,
      processingTime,
      errors: finalState.errors,
      warnings: finalState.warnings,
      jobId,
      outputDir: outputStructure.jobDir,
    };
  } catch (error) {
    console.error('❌ WORKFLOW FAILED:', error);

    const processingTime = Date.now() - startTime;

    return {
      success: false,
      buildingData: {},
      categorizedImages: {
        cover: [],
        renderings: [],
        floorPlans: [],
        amenities: [],
        maps: [],
      },
      processingTime,
      errors: [String(error)],
      warnings: [],
      jobId,
      outputDir: '',
    };
  }
}

/**
 * Quick test function for development
 */
export async function testWorkflow(pdfPath: string) {
  console.log(`\n🧪 TESTING WORKFLOW WITH: ${pdfPath}\n`);

  const result = await executePdfWorkflow({
    pdfPath,
    simplified: false, // Use full workflow with quality checks
  });

  console.log('\n📋 FINAL RESULT:');
  console.log(JSON.stringify(result, null, 2));

  return result;
}
