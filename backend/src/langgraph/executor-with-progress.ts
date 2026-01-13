/**
 * Workflow Executor with Progress Tracking
 * 
 * Enhanced executor that emits real-time progress updates
 */

import { buildWorkflow, buildSimplifiedWorkflow } from './graph';
import type { State } from './state';
import { generateJobId, createOutputStructure } from '../utils/pdf/file-manager';
import { readFileSync } from 'fs';
import { join } from 'path';
import { progressEmitter } from '../services/progress-emitter';

export interface WorkflowConfigWithProgress {
  pdfPath?: string;
  pdfBuffer?: Buffer;
  outputBaseDir?: string;
  simplified?: boolean;
  jobId?: string; // Optional custom job ID
  enableProgress?: boolean; // Enable SSE progress updates
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
 * Execute PDF workflow with progress tracking
 */
export async function executePdfWorkflowWithProgress(
  config: WorkflowConfigWithProgress
): Promise<WorkflowResult> {
  const startTime = Date.now();
  const jobId = config.jobId || generateJobId();
  const enableProgress = config.enableProgress !== false;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`PDF PROCESSING WORKFLOW - Job ID: ${jobId}`);
  console.log(`${'='.repeat(60)}\n`);

  // Emit starting event
  if (enableProgress) {
    progressEmitter.emit(jobId, {
      stage: 'starting',
      message: 'Initializing PDF processing...',
      progress: 5,
      timestamp: Date.now(),
    });
  }

  try {
    // Validate input
    if (!config.pdfPath && !config.pdfBuffer) {
      throw new Error('Either pdfPath or pdfBuffer must be provided');
    }

    // Load PDF buffer if path provided
    const pdfBuffer = config.pdfBuffer || readFileSync(config.pdfPath!);

    // Create output directory structure
    const outputBaseDir = config.outputBaseDir || join(process.cwd(), 'uploads', 'langgraph-output');
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

    // Build workflow
    const app = config.simplified 
      ? buildSimplifiedWorkflow()
      : buildWorkflow();

    console.log(`Using ${config.simplified ? 'SIMPLIFIED' : 'FULL'} workflow\n`);

    // Emit ingestion start
    if (enableProgress) {
      progressEmitter.emit(jobId, {
        stage: 'ingestion',
        message: 'Converting PDF to images...',
        progress: 10,
        timestamp: Date.now(),
      });
    }

    // Execute workflow with progress tracking
    console.log('Starting workflow execution...\n');
    
    // Note: Since we can't easily hook into LangGraph's execution,
    // we'll simulate progress based on typical timing
    const progressInterval = enableProgress ? setInterval(() => {
      // Estimate progress (this is a simulation)
      const elapsed = Date.now() - startTime;
      const estimatedProgress = Math.min(90, 10 + (elapsed / 1000) * 2);
      
      progressEmitter.emit(jobId, {
        stage: 'mapping',
        message: 'Processing pages in parallel...',
        progress: estimatedProgress,
        timestamp: Date.now(),
      });
    }, 2000) : null;

    const finalState = await app.invoke(initialState);

    if (progressInterval) {
      clearInterval(progressInterval);
    }

    const processingTime = Date.now() - startTime;

    // Emit completion progress
    if (enableProgress) {
      progressEmitter.emit(jobId, {
        stage: 'complete',
        message: 'Processing complete!',
        progress: 100,
        data: {
          unitsExtracted: finalState.buildingData?.units?.length || 0,
          pagesProcessed: finalState.totalPages,
          processingTime,
        },
        timestamp: Date.now(),
      });
    }

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
    const result = {
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

    // Send final data via SSE
    if (enableProgress) {
      progressEmitter.complete(jobId, result);
    }

    return result;
  } catch (error) {
    console.error('❌ WORKFLOW FAILED:', error);

    if (enableProgress) {
      progressEmitter.error(jobId, String(error));
    }

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
