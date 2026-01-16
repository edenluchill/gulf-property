/**
 * Batch Processor Module
 * 
 * Handles batch processing of chunks with:
 * - Parallel processing within batches
 * - Rate limiting between batches
 * - Progress tracking and updates
 * - Data aggregation during processing
 */

import type { PdfChunk } from '../../utils/pdf/chunker';
import { progressEmitter } from '../../services/progress-emitter';
import { processSingleChunk } from './chunk-processor';
import { 
  mergeChunkData, 
  getDeduplicatedUnits,
  type AggregatedBuildingData 
} from './data-aggregator';
import { extractPageAnalysis, type ChunkAnalysisResult } from './result-recorder';
import { updateBuildingDataWithImageUrls } from '../utils/image-url-helper';

export interface BatchProcessingConfig {
  chunks: Array<PdfChunk & { sourceFile: string }>;
  outputDir: string;
  jobId: string;
  batchSize?: number;
  batchDelay?: number; // ms
}

export interface BatchProcessingResult {
  aggregatedData: AggregatedBuildingData;
  allErrors: string[];
  allWarnings: string[];
  chunkAnalyses: ChunkAnalysisResult[];  // Detailed chunk analysis results
}

/**
 * Process all chunks in parallel batches with rate limiting
 */
export async function processChunksInBatches(
  config: BatchProcessingConfig,
  aggregatedData: AggregatedBuildingData
): Promise<BatchProcessingResult> {
  const { 
    chunks, 
    outputDir, 
    jobId, 
    batchSize = 10, 
    batchDelay = 1000 
  } = config;

  const totalChunks = chunks.length;
  const allErrors: string[] = [];
  const allWarnings: string[] = [];
  const chunkAnalyses: ChunkAnalysisResult[] = [];

  // Split chunks into batches
  const batches: typeof chunks[] = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    batches.push(chunks.slice(i, i + batchSize));
  }

  console.log(`\n🚀 Processing in ${batches.length} parallel batches (${batchSize} chunks per batch)\n`);
  console.log(`⏱️  Rate limit protection: ${batchDelay / 1000}s delay between batches\n`);

  // Process each batch
  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];

    console.log(`\n=== BATCH ${batchIdx + 1}/${batches.length} - Processing ${batch.length} chunks in PARALLEL ===\n`);

    // Process all chunks in this batch CONCURRENTLY
    const batchPromises = batch.map(async (chunk, batchLocalIdx) => {
      const globalIdx = batchIdx * batchSize + batchLocalIdx;

      // Process single chunk
      const result = await processSingleChunk({
        chunk,
        chunkIndex: globalIdx,
        totalChunks,
        outputDir,
        jobId, // Pass jobId for R2 temp storage
      });

      // Merge data immediately if successful
      if (result.success && result.data) {
        mergeChunkData(aggregatedData, result.data);

        // Record detailed chunk analysis
        const pages = extractPageAnalysis(
          globalIdx,
          chunk.sourceFile,
          chunk.pageRange,
          result.data
        );

        chunkAnalyses.push({
          chunkIndex: globalIdx,
          sourceFile: chunk.sourceFile,
          pageRange: chunk.pageRange,
          totalUnits: result.data.units?.length || 0,
          totalPaymentPlans: result.data.paymentPlans?.length || 0,
          pages,
          images: {
            projectImages: result.data.images?.projectImages || [],
            floorPlanImages: result.data.images?.floorPlanImages || [],
          },
          processingTime: result.processingTime || 0,
          errors: result.errors,
        });

        // Send progress update to frontend
        emitChunkProgressUpdate({
          jobId,
          chunkIndex: globalIdx,
          totalChunks,
          chunk,
          aggregatedData,
        });
      }

      return result;
    });

    // Wait for all chunks in this batch to complete
    const batchResults = await Promise.all(batchPromises);

    console.log(`\n✅ Batch ${batchIdx + 1} complete!\n`);

    // Collect errors and warnings
    batchResults.forEach((result) => {
      allErrors.push(...result.errors);
      allWarnings.push(...result.warnings);
    });

    // Delay between batches to respect rate limits
    if (batchIdx < batches.length - 1) {
      console.log(`\n⏸️  Waiting ${batchDelay / 1000}s before next batch (rate limit protection)...`);
      await new Promise(resolve => setTimeout(resolve, batchDelay));
    }
  }

  return {
    aggregatedData,
    allErrors,
    allWarnings,
    chunkAnalyses,
  };
}

/**
 * Emit progress update for a completed chunk
 */
function emitChunkProgressUpdate(params: {
  jobId: string;
  chunkIndex: number;
  totalChunks: number;
  chunk: PdfChunk & { sourceFile: string };
  aggregatedData: AggregatedBuildingData;
}): void {
  const { jobId, chunkIndex, totalChunks, chunk, aggregatedData } = params;

  // Calculate progress (10% reserved for initial chunking, 75% for processing, 15% for finalization)
  const chunkProgress = 10 + ((chunkIndex + 1) / totalChunks) * 75;

  // Get deduplicated and sorted units
  const sortedUnits = getDeduplicatedUnits(aggregatedData);

  // Build data and convert image paths to URLs
  const buildingData = updateBuildingDataWithImageUrls({
    name: aggregatedData.name,
    developer: aggregatedData.developer,
    address: aggregatedData.address,
    area: aggregatedData.area,
    completionDate: aggregatedData.completionDate,
    launchDate: aggregatedData.launchDate,
    description: aggregatedData.description,
    amenities: aggregatedData.amenities,
    paymentPlans: aggregatedData.paymentPlans,
    units: sortedUnits,
    images: aggregatedData.images,
  }, jobId);

  progressEmitter.emit(jobId, {
    stage: 'mapping',
    message: `✓ 块 ${chunkIndex + 1}/${totalChunks} (页 ${chunk.pageRange.start}-${chunk.pageRange.end}) - ${sortedUnits.length} 户型`,
    progress: chunkProgress,
    data: {
      buildingData,
    },
    timestamp: Date.now(),
  });
}
