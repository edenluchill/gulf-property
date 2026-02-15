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
  createEmptyAggregatedData
} from './processors/data-aggregator';
import { ResultRecorder } from './processors/result-recorder';
import { calculatePdfHashes, shortHash } from '../utils/pdf/pdf-hash';
import { checkPdfCache } from '../services/r2-storage';
import { generateAndUploadAllPdfImages, type PdfImageBatch } from './utils/pdf-image-generator';
import { PageRegistryManager } from './core/page-registry';
import { TaskAbortedError } from '../services/task-manager';
import { startJobLogging, stopJobLogging } from '../utils/job-logger';

export interface WorkflowConfig {
  pdfBuffers: Buffer[];
  pdfNames?: string[];
  outputBaseDir?: string;
  jobId: string;
  pagesPerChunk?: number;
  batchSize?: number;
  batchDelay?: number;
  abortSignal?: AbortSignal; // For pause/cancel support
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
  aborted?: boolean; // Whether processing was aborted (paused/cancelled)
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
    batchSize = 20,  // ⭐ Increased from 10 to 20 for better parallelism
    batchDelay = 500,  // ⭐ Reduced from 1000ms to 500ms (still safe for API rate limits)
    abortSignal,
  } = config;

  // Start job logging (dev only)
  startJobLogging(jobId);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`📋 PDF PROCESSING WORKFLOW STARTED`);
  console.log(`   Job ID: ${jobId}`);
  console.log(`   Files: ${pdfBuffers.length} | Pages per chunk: ${pagesPerChunk}`);
  console.log(`   Batch size: ${batchSize} | Batch delay: ${batchDelay}ms`);
  console.log(`   PDF sizes: ${pdfBuffers.map(b => `${(b.length / 1024).toFixed(2)} KB`).join(', ')}`);
  console.log(`${'='.repeat(70)}\n`);

  try {
    console.log(`⚙️ Workflow execution starting for job ${jobId}...`);
    
    // ============================================================
    // STEP 0: Calculate PDF hashes and check cache
    // ============================================================
    console.log(`\n🔐 Calculating PDF hashes for cache lookup...`);
    const pdfHashes = calculatePdfHashes(pdfBuffers, pdfNames);
    
    // Check if we have cached results for any PDFs
    progressEmitter.emit(jobId, {
      stage: 'ingestion',
      code: 'CHECKING_CACHE',
      message: 'Checking PDF cache...',
      progress: 2,
      timestamp: Date.now(),
    });
    
    // ⭐ 先获取每个PDF的页数，用于验证缓存完整性
    const { getPdfPageCount } = await import('../utils/pdf/converter');
    const pdfPageCounts = await Promise.all(
      pdfBuffers.map(async (buffer) => {
        try {
          return await getPdfPageCount(buffer);
        } catch {
          return 0;
        }
      })
    );

    const cacheResults = await Promise.all(
      pdfHashes.map(async ({ hash, name }, index) => {
        const cached = await checkPdfCache(hash);
        const expectedPages = pdfPageCounts[index];

        if (cached) {
          // ⭐ 验证缓存完整性：检查是否有所有页面的图片
          const uniquePages = new Set<number>();
          cached.forEach(url => {
            const match = url.match(/page[._](\d+)(?:[._](large|medium|thumbnail))?\.jpg/);
            if (match) {
              uniquePages.add(parseInt(match[1]));
            }
          });

          if (uniquePages.size >= expectedPages) {
            console.log(`   ✅ Cache HIT for "${name}" (${shortHash(hash)}) - ${uniquePages.size}/${expectedPages} pages`);
            return { hash, name, cached };
          } else {
            console.log(`   ⚠️  Cache INCOMPLETE for "${name}" (${shortHash(hash)}) - only ${uniquePages.size}/${expectedPages} pages, regenerating...`);
            return { hash, name, cached: null };  // 标记为需要重新生成
          }
        } else {
          console.log(`   ⚠️  Cache MISS for "${name}" (${shortHash(hash)})`);
        }
        return { hash, name, cached };
      })
    );

    const allCached = cacheResults.every(r => r.cached !== null);
    
    // Setup output directory
    const outputBaseDir = config.outputBaseDir || join(process.cwd(), 'uploads', 'langgraph-output');
    const outputStructure = createOutputStructure(outputBaseDir, jobId);
    
    // ============================================================
    // STEP 0: Generate and upload ALL PDF images upfront (or reconstruct from cache)
    // ============================================================
    let imageBatches: PdfImageBatch[] = [];
    
    if (!allCached) {
      console.log(`\n🖼️  Generating and uploading ALL PDF images upfront...`);
      progressEmitter.emit(jobId, {
        stage: 'ingestion',
        code: 'GENERATING_IMAGES',
        message: 'Generating all page images in batch...',
        progress: 3,
        timestamp: Date.now(),
      });

      const imageGenResult = await generateAndUploadAllPdfImages({
        pdfBuffers,
        pdfNames: pdfNames || pdfBuffers.map((_, i) => `Document ${i + 1}`),
        pdfHashes: pdfHashes.map(h => h.hash),
        tempDir: join(outputStructure.jobDir, 'temp_images'),
        uploadConcurrency: 10,  // 10 concurrent uploads
        // ⭐ Progress callback for fine-grained progress updates
        onProgress: (progress) => {
          // Calculate overall progress: 3% to 8% for image generation
          // Phase weight: generating = 30%, uploading = 70%
          const phaseWeight = progress.phase === 'generating' ? 0.3 : 0.7;
          const pdfProgress = (progress.currentPdf - 1) / progress.totalPdfs;
          const imageProgress = progress.totalImages > 0
            ? progress.currentImage / progress.totalImages
            : 0;

          // Overall: 3 + (pdf_progress * 5) + (image_progress * phase_weight * 5 / totalPdfs)
          const overallProgress = 3 + (pdfProgress * 5) + (imageProgress * phaseWeight * 5 / progress.totalPdfs);

          progressEmitter.emit(jobId, {
            stage: 'ingestion',
            code: 'GENERATING_IMAGES',
            message: progress.phase === 'generating'
              ? `Converting PDF ${progress.currentPdf}/${progress.totalPdfs}: ${progress.pdfName || 'document'}`
              : `Uploading images: ${progress.currentImage}/${progress.totalImages} (PDF ${progress.currentPdf}/${progress.totalPdfs})`,
            progress: Math.min(Math.round(overallProgress), 8),
            timestamp: Date.now(),
            data: {
              phase: progress.phase,
              currentImage: progress.currentImage,
              totalImages: progress.totalImages,
              currentPdf: progress.currentPdf,
              totalPdfs: progress.totalPdfs,
            },
          });
        },
      });

      imageBatches = imageGenResult.imageBatches;

      console.log(`\n✅ All images generated and uploaded!`);
      console.log(`   Total: ${imageGenResult.totalImages} images`);
      console.log(`   Time: ${(imageGenResult.uploadTime / 1000).toFixed(2)}s`);
      
      progressEmitter.emit(jobId, {
        stage: 'ingestion',
        code: 'IMAGES_UPLOADED',
        message: `${imageGenResult.totalImages} images uploaded to cloud storage`,
        progress: 8,
        timestamp: Date.now(),
        data: { totalImages: imageGenResult.totalImages },
      });
    } else {
      console.log(`\n🎉 All PDFs found in cache! Reconstructing image batches from cached URLs...`);
      
      // ⭐ Reconstruct imageBatches from cached URLs
      imageBatches = cacheResults.map((result) => {
        const cachedUrls = result.cached!;  // We know it's not null because allCached = true
        
        // Convert array of URLs to Map<pageNumber, ImageUrls>
        const imageUrls = new Map<number, any>();
        
        // Group URLs by page number and variant
        const urlsByPage = new Map<number, Partial<any>>();
        
        cachedUrls.forEach(url => {
          // Extract page number from URL pattern: pdf-cache/{hash}/images/page_{pageNum}_{variant}.jpg
          // or: pdf-cache/{hash}/images/page_{pageNum}.jpg (original)
          const match = url.match(/page[._](\d+)(?:[._](large|medium|thumbnail))?\.jpg/);
          if (match) {
            const pageNum = parseInt(match[1]);
            const variant = match[2] || 'original';
            
            if (!urlsByPage.has(pageNum)) {
              urlsByPage.set(pageNum, {});
            }
            
            urlsByPage.get(pageNum)![variant] = url;
          }
        });
        
        // Convert to final format
        urlsByPage.forEach((variants, pageNum) => {
          imageUrls.set(pageNum, {
            original: variants.original || '',
            large: variants.large || '',
            medium: variants.medium || '',
            thumbnail: variants.thumbnail || '',
          });
        });
        
        const batch: PdfImageBatch = {
          pdfHash: result.hash,
          pdfName: result.name,
          totalPages: imageUrls.size,
          imageUrls,
        };
        
        console.log(`   ✅ Reconstructed ${imageUrls.size} images for "${result.name}"`);
        return batch;
      });
      
      const totalCachedImages = imageBatches.reduce((sum, batch) => sum + batch.totalPages, 0);
      
      progressEmitter.emit(jobId, {
        stage: 'ingestion',
        code: 'USING_CACHE',
        message: `Using ${totalCachedImages} cached images (instant response)`,
        progress: 8,
        timestamp: Date.now(),
        data: { totalImages: totalCachedImages },
      });
    }

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
      code: 'SPLITTING_CHUNKS',
      message: `Splitting documents into ${pagesPerChunk}-page chunks...`,
      progress: 9,
      timestamp: Date.now(),
      data: { pagesPerChunk },
    });

    const { chunks, totalChunks, totalPages } = await splitAllPdfsIntoChunks({
      pdfBuffers,
      pdfNames,
      pdfHashes: pdfHashes.map(h => h.hash),
      imageBatches,  // ⭐ NEW: Pass pre-generated image URLs
      pagesPerChunk,
    });

    progressEmitter.emit(jobId, {
      stage: 'ingestion',
      code: 'CHUNKS_READY',
      message: `Split into ${totalChunks} chunks, starting AI analysis...`,
      progress: 10,
      timestamp: Date.now(),
      data: { totalChunks },
    });

    // ============================================================
    // STEP 2: Process chunks in batches and aggregate data
    // ============================================================
    console.log(`\n🔄 Starting batch processing of ${totalChunks} chunks...`);
    
    const aggregatedData = createEmptyAggregatedData();

    let allErrors: string[] = [];
    let allWarnings: string[] = [];
    let chunkAnalyses: any[] = [];
    let finalAggregatedData = aggregatedData;

    try {
      const batchResult = await processChunksInBatches(
        {
          chunks,
          outputDir: outputStructure.jobDir,
          jobId,
          batchSize,
          batchDelay,
          abortSignal,
        },
        aggregatedData
      );

      allErrors = batchResult.allErrors;
      allWarnings = batchResult.allWarnings;
      chunkAnalyses = batchResult.chunkAnalyses;
      finalAggregatedData = batchResult.aggregatedData;

      console.log(`✅ Batch processing completed successfully`);
    } catch (batchError) {
      // Handle abort (pause/cancel) gracefully
      if (batchError instanceof TaskAbortedError) {
        console.log(`⏸️  Workflow ${batchError.reason} for job ${jobId}`);
        return {
          success: false,
          buildingData: {},
          processingTime: Date.now() - startTime,
          errors: [],
          warnings: [],
          jobId,
          totalChunks,
          totalPages,
          aborted: true,
        };
      }

      console.error(`❌ Batch processing failed:`, batchError);
      // Re-throw to be caught by outer try-catch
      throw new Error(`Batch processing failed: ${batchError}`);
    }
    
    // Record all chunk analyses
    console.log(`📝 Recording ${chunkAnalyses.length} chunk analyses...`);
    chunkAnalyses.forEach(chunk => resultRecorder.recordChunk(chunk));

    // ============================================================
    // STEP 3: 最终数据已在PageRegistry中，直接使用
    // ============================================================
    console.log(`\n📊 Processing complete. Using smart assignment result...`);

    progressEmitter.emit(jobId, {
      stage: 'reducing',
      code: 'ASSIGNMENT_COMPLETE',
      message: 'Smart assignment complete',
      progress: 95,
      timestamp: Date.now(),
    });

    // ⭐ 使用智能分配系统的最终结果（已在batch-processor中转换）
    const finalData = finalAggregatedData;

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
    // Handle abort (pause/cancel) gracefully
    if (error instanceof TaskAbortedError) {
      console.log(`⏸️  Workflow ${error.reason} for job ${jobId}`);
      return {
        success: false,
        buildingData: {},
        processingTime: Date.now() - startTime,
        errors: [],
        warnings: [],
        jobId,
        totalChunks: 0,
        totalPages: 0,
        aborted: true,
      };
    }

    console.error('\n❌ WORKFLOW FAILED:', error);
    console.error('   Stack trace:', (error as Error).stack);

    const errorMessage = error instanceof Error ? error.message : String(error);

    // Try to emit error to client
    try {
      progressEmitter.error(jobId, errorMessage);
    } catch (emitError) {
      console.error('   Failed to emit error to client:', emitError);
    }

    return {
      success: false,
      buildingData: {},
      processingTime: Date.now() - startTime,
      errors: [errorMessage],
      warnings: [],
      jobId,
      totalChunks: 0,
      totalPages: 0,
      analysisReportPath: undefined,
    };
  } finally {
    // Stop job logging (dev only) - always run
    stopJobLogging(jobId);

    // Cleanup PageRegistry for this job (unless aborted for resume)
    if (!abortSignal?.aborted) {
      PageRegistryManager.delete(jobId);
    }
  }
}
