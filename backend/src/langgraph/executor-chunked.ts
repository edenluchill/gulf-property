/**
 * Chunked PDF Workflow Executor
 * 
 * Handles large PDFs by splitting them into chunks and processing in batches
 * State is accumulated in Manager Agent across all chunks
 * 
 * Perfect for files > 20MB!
 */

import { buildEnhancedWorkflow } from './graph-enhanced';
import type { State } from './state';
import { generateJobId, createOutputStructure } from '../utils/pdf/file-manager';
import { splitPdfIntoChunks, needsChunking, type PdfChunk } from '../utils/pdf/chunker';
import { join } from 'path';
import { progressEmitter } from '../services/progress-emitter';

export interface ChunkedWorkflowConfig {
  pdfBuffer: Buffer;
  pdfPath?: string;
  outputBaseDir?: string;
  jobId?: string;
  enableProgress?: boolean;
  maxChunkSizeMB?: number;
  maxPagesPerChunk?: number;
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
  chunksProcessed: number;
  totalPages: number;
}

/**
 * Execute PDF workflow with automatic chunking for large files
 */
export async function executeChunkedWorkflow(
  config: ChunkedWorkflowConfig
): Promise<WorkflowResult> {
  const startTime = Date.now();
  const jobId = config.jobId || generateJobId();
  const enableProgress = config.enableProgress !== false;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`CHUNKED PDF WORKFLOW - Job ID: ${jobId}`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    const outputBaseDir = config.outputBaseDir || join(process.cwd(), 'uploads', 'langgraph-output');
    const outputStructure = createOutputStructure(outputBaseDir, jobId);

    // Check if chunking is needed (> 10 pages)
    const needsChunk = await needsChunking(config.pdfBuffer);

    let chunks: PdfChunk[];
    
    if (needsChunk) {
      console.log('📦 Multi-page PDF detected - splitting for optimal processing...');
      
      if (enableProgress) {
        progressEmitter.emit(jobId, {
          stage: 'ingestion',
          message: '📦 正在按页面分批处理...',
          progress: 10,
          timestamp: Date.now(),
        });
      }

      // Split into 5-page chunks for optimal Gemini processing
      chunks = await splitPdfIntoChunks(
        config.pdfBuffer,
        config.maxPagesPerChunk || 5  // 每批 5 页
      );

      console.log(`   ✅ Split into ${chunks.length} batches (${config.maxPagesPerChunk || 5} pages each)`);
    } else {
      console.log('✓ Small PDF (≤10 pages) - processing directly');
      chunks = [{
        chunkIndex: 0,
        totalChunks: 1,
        buffer: config.pdfBuffer,
        pageRange: { start: 1, end: 10 },
        sizeMB: config.pdfBuffer.length / 1024 / 1024,
      }];
    }

    // Initialize accumulated state (Manager Agent state)
    const accumulatedData = {
      name: '',
      developer: '',
      address: '',
      area: '',
      completionDate: '',
      launchDate: '',
      description: '',
      amenities: [] as string[],
      units: [] as any[],
      paymentPlans: [] as any[],
    };

    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    // Process each chunk and accumulate results
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkProgress = 20 + (i / chunks.length) * 50; // 20-70%

      console.log(`\n--- Processing chunk ${i + 1}/${chunks.length} (Pages ${chunk.pageRange.start}-${chunk.pageRange.end}) ---`);

      if (enableProgress) {
        progressEmitter.emit(jobId, {
          stage: 'mapping',
          message: `🔍 正在分析第 ${i + 1}/${chunks.length} 批 (页 ${chunk.pageRange.start}-${chunk.pageRange.end})...`,
          progress: chunkProgress,
          data: {
            buildingData: accumulatedData, // Send current accumulated data
          },
          timestamp: Date.now(),
        });
      }

      // Process this chunk
      const initialState: Partial<State> = {
        pdfPath: config.pdfPath || `chunk_${i + 1}.pdf`,
        pdfBuffer: chunk.buffer,
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
        startTime: Date.now(),
        processingStage: 'ingestion',
      };

      const app = buildEnhancedWorkflow();
      const chunkResult = await app.invoke(initialState);

      // Accumulate data (Manager Agent logic)
      if (chunkResult.buildingData) {
        // Merge basic info (prefer non-empty values)
        accumulatedData.name = chunkResult.buildingData.name || accumulatedData.name;
        accumulatedData.developer = chunkResult.buildingData.developer || accumulatedData.developer;
        accumulatedData.address = chunkResult.buildingData.address || accumulatedData.address;
        accumulatedData.area = chunkResult.buildingData.area || accumulatedData.area;
        accumulatedData.completionDate = chunkResult.buildingData.completionDate || accumulatedData.completionDate;
        accumulatedData.launchDate = chunkResult.buildingData.launchDate || accumulatedData.launchDate;
        accumulatedData.description = chunkResult.buildingData.description || accumulatedData.description;

        // Accumulate units (append all, will dedupe later)
        if (chunkResult.buildingData.units) {
          accumulatedData.units.push(...chunkResult.buildingData.units);
        }

        // Accumulate payment plans
        if (chunkResult.buildingData.paymentPlans) {
          accumulatedData.paymentPlans.push(...chunkResult.buildingData.paymentPlans);
        }

        // Accumulate amenities (dedupe)
        if (chunkResult.buildingData.amenities) {
          const newAmenities = chunkResult.buildingData.amenities.filter(
            (a: string) => !accumulatedData.amenities.includes(a)
          );
          accumulatedData.amenities.push(...newAmenities);
        }
      }

      if (chunkResult.errors) {
        allErrors.push(...chunkResult.errors);
      }
      if (chunkResult.warnings) {
        allWarnings.push(...chunkResult.warnings);
      }

      console.log(`   ✓ Chunk ${i + 1} processed`);
      console.log(`   📊 Accumulated: ${accumulatedData.units.length} units, ${accumulatedData.paymentPlans.length} payment plans`);
    }

    // Deduplicate units
    const uniqueUnits = deduplicateUnits(accumulatedData.units);
    accumulatedData.units = uniqueUnits;

    console.log(`\n📊 After deduplication: ${uniqueUnits.length} unique units`);

    // Post-processing: Market research and content generation
    if (enableProgress) {
      progressEmitter.emit(jobId, {
        stage: 'reducing',
        message: '📊 正在汇总所有数据...',
        progress: 75,
        data: {
          buildingData: accumulatedData,
        },
        timestamp: Date.now(),
      });
    }

    // Note: Market research and copywriting would go here
    // For now, skip to save time

    const processingTime = Date.now() - startTime;

    console.log(`\n${'='.repeat(60)}`);
    console.log('✅ CHUNKED WORKFLOW COMPLETED');
    console.log(`Processing Time: ${(processingTime / 1000).toFixed(2)}s`);
    console.log(`Chunks Processed: ${chunks.length}`);
    console.log(`${'='.repeat(60)}\n`);

    console.log('📊 FINAL SUMMARY:');
    console.log(`  Total Units: ${accumulatedData.units.length}`);
    console.log(`  Payment Plans: ${accumulatedData.paymentPlans.length}`);
    console.log(`  Amenities: ${accumulatedData.amenities.length}`);
    console.log(`  Errors: ${allErrors.length}`);

    return {
      success: allErrors.length === 0,
      buildingData: accumulatedData,
      processingTime,
      errors: allErrors,
      warnings: allWarnings,
      jobId,
      chunksProcessed: chunks.length,
      totalPages: chunks[chunks.length - 1]?.pageRange.end || 0,
    };

  } catch (error) {
    console.error('❌ CHUNKED WORKFLOW FAILED:', error);

    return {
      success: false,
      buildingData: {},
      processingTime: Date.now() - startTime,
      errors: [String(error)],
      warnings: [],
      jobId,
      chunksProcessed: 0,
      totalPages: 0,
    };
  }
}

/**
 * Deduplicate units by category + typeName
 */
function deduplicateUnits(units: any[]): any[] {
  const seen = new Map<string, any>();

  for (const unit of units) {
    const key = `${unit.category || unit.bedrooms}_${unit.typeName || unit.name || 'default'}`;
    
    if (!seen.has(key)) {
      seen.set(key, unit);
    } else {
      // Merge data (prefer non-null values)
      const existing = seen.get(key);
      
      // Merge unit numbers if both have them
      if (unit.unitNumbers && existing.unitNumbers) {
        const mergedNumbers = [...new Set([...existing.unitNumbers, ...unit.unitNumbers])];
        existing.unitNumbers = mergedNumbers;
      } else if (unit.unitNumbers) {
        existing.unitNumbers = unit.unitNumbers;
      }

      // Add unit counts
      if (unit.unitCount) {
        existing.unitCount = (existing.unitCount || 0) + unit.unitCount;
      }

      // Merge other fields (prefer non-null)
      Object.entries(unit).forEach(([key, value]) => {
        if (value != null && !existing[key]) {
          existing[key] = value;
        }
      });

      seen.set(key, existing);
    }
  }

  return Array.from(seen.values());
}
