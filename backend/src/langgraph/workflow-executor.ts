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
import { TaskAbortedError, taskManager } from '../services/task-manager';
import { startJobLogging, stopJobLogging } from '../utils/job-logger';
import { geocodeAddress } from '../services/geocoding';
import { extractPdfTextPages, TextLayerRegistry, type PdfTextLayer } from './utils/text-layer';
import { extractTextInsights, applyTextInsights, type TextInsights } from './agents/text-insights-extractor.agent';
import { computeSubmitReadiness } from './utils/submit-readiness';
import { resolveCanonicalArea } from './utils/canonical-area';

// Memory monitoring to prevent OOM crashes
const MEMORY_THRESHOLD_MB = 3500; // Warn when heap exceeds this
const MEMORY_CRITICAL_MB = 4500;  // Abort job when heap exceeds this

function checkMemory(jobId: string, stage: string): { ok: boolean; heapUsedMB: number } {
  const usage = process.memoryUsage();
  const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
  const rssMB = Math.round(usage.rss / 1024 / 1024);

  if (heapUsedMB > MEMORY_THRESHOLD_MB) {
    console.warn(`⚠️  [${jobId}] High memory at ${stage}: ${heapUsedMB}MB heap, ${rssMB}MB RSS`);
  }

  if (heapUsedMB > MEMORY_CRITICAL_MB) {
    console.error(`🚨 [${jobId}] CRITICAL memory at ${stage}: ${heapUsedMB}MB - triggering GC and aborting`);
    // Try to free memory
    if (global.gc) {
      global.gc();
    }
    return { ok: false, heapUsedMB };
  }

  return { ok: true, heapUsedMB };
}

// Custom error for memory issues
class MemoryExceededError extends Error {
  constructor(heapUsedMB: number, stage: string) {
    super(`Memory limit exceeded: ${heapUsedMB}MB at ${stage}. Job aborted to prevent server crash.`);
    this.name = 'MemoryExceededError';
  }
}

// Helper function to log to database (non-blocking)
async function logToDB(
  jobId: string,
  level: 'debug' | 'info' | 'warn' | 'error',
  stage: string,
  message: string,
  data?: any
): Promise<void> {
  // Fire and forget - don't await to avoid blocking the workflow
  taskManager.appendLog(jobId, level, stage, message, data).catch(() => {});
}

export interface WorkflowConfig {
  pdfBuffers: Buffer[];
  pdfNames?: string[];
  outputBaseDir?: string;
  jobId: string;
  pagesPerChunk?: number;
  batchSize?: number;  // Max concurrent chunks (p-limit pool size)
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
    batchSize = 20,  // ⭐ Max concurrent chunks (p-limit sliding window)
    abortSignal,
  } = config;

  // Start job logging (dev only)
  startJobLogging(jobId);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`📋 PDF PROCESSING WORKFLOW STARTED`);
  console.log(`   Job ID: ${jobId}`);
  console.log(`   Files: ${pdfBuffers.length} | Pages per chunk: ${pagesPerChunk}`);
  console.log(`   Concurrency: ${batchSize} (p-limit sliding window)`);
  console.log(`   PDF sizes: ${pdfBuffers.map(b => `${(b.length / 1024).toFixed(2)} KB`).join(', ')}`);
  console.log(`${'='.repeat(70)}\n`);

  // Log workflow start to database
  logToDB(jobId, 'info', 'workflow', 'PDF processing workflow started', {
    fileCount: pdfBuffers.length,
    pagesPerChunk,
    batchSize,
    pdfSizes: pdfBuffers.map(b => b.length),
    pdfNames: pdfNames || [],
  });

  try {
    // Initial memory check
    const initialMem = checkMemory(jobId, 'workflow-start');
    console.log(`⚙️ Workflow execution starting for job ${jobId}... (${initialMem.heapUsedMB}MB heap)`);

    if (!initialMem.ok) {
      throw new MemoryExceededError(initialMem.heapUsedMB, 'workflow-start');
    }
    
    // ============================================================
    // STEP 0: Calculate PDF hashes and check cache
    // ============================================================
    console.log(`\n🔐 Calculating PDF hashes for cache lookup...`);
    const pdfHashes = calculatePdfHashes(pdfBuffers, pdfNames);

    // ============================================================
    // STEP 0.5: Extract PDF text layer (must run BEFORE chunking —
    // pdfBuffers are cleared after splitAllPdfsIntoChunks)
    // ============================================================
    console.log(`\n📜 Extracting PDF text layer...`);
    const textLayerStart = Date.now();
    const textLayers: PdfTextLayer[] = [];
    for (let i = 0; i < pdfBuffers.length; i++) {
      const pages = await extractPdfTextPages(pdfBuffers[i]);
      textLayers.push({
        pdfHash: pdfHashes[i].hash,
        pdfName: pdfHashes[i].name,
        pages,
      });
    }
    TextLayerRegistry.set(jobId, textLayers);
    const fullText = TextLayerRegistry.getFullText(jobId);
    console.log(`   ✓ Text layer extracted: ${fullText.length} chars across ${textLayers.reduce((s, l) => s + l.pages.length, 0)} pages (${Date.now() - textLayerStart}ms)`);

    // 🔄 Project-level text pass runs in PARALLEL with image gen + chunk
    // processing; awaited just before final assembly.
    const textInsightsPromise: Promise<TextInsights | null> = extractTextInsights(fullText)
      .catch(err => {
        console.warn(`   ⚠️  Text insights pass failed: ${err?.message}`);
        return null;
      });

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
            const match = url.match(/page[._](\d+)(?:[._](original|large|medium|thumbnail))?\.jpg/);
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
      // Memory check before heavy image generation
      const preImageMem = checkMemory(jobId, 'pre-image-generation');
      if (!preImageMem.ok) {
        throw new MemoryExceededError(preImageMem.heapUsedMB, 'pre-image-generation');
      }

      console.log(`\n🖼️  Generating and uploading ALL PDF images upfront... (${preImageMem.heapUsedMB}MB heap)`);
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

      logToDB(jobId, 'info', 'image-generation', 'All images generated and uploaded', {
        totalImages: imageGenResult.totalImages,
        uploadTimeMs: imageGenResult.uploadTime,
      });
      
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
          // 4 variants; old caches may lack 'original' (falls back to large below)
          const match = url.match(/page[._](\d+)[._](original|large|medium|thumbnail)\.jpg/);
          if (match) {
            const pageNum = parseInt(match[1]);
            const variant = match[2];

            if (!urlsByPage.has(pageNum)) {
              urlsByPage.set(pageNum, {});
            }

            urlsByPage.get(pageNum)![variant] = url;
          }
        });

        // Convert to final format with all variants
        urlsByPage.forEach((variants, pageNum) => {
          imageUrls.set(pageNum, {
            original: variants.original || variants.large || '',  // Fallback to large if original missing
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

    // 🧹 Memory optimization: buffers are cleared incrementally in chunking.ts
    // This is a safety net to ensure GC can reclaim memory before batch processing
    pdfBuffers.length = 0;
    console.log(`🧹 Memory optimized: ${totalChunks} chunks ready (buffers cleared during chunking)`);

    // Update task with total pages and chunks
    try {
      await taskManager.updateTaskCounts(jobId, totalPages, totalChunks);
    } catch (e) { /* ignore */ }

    progressEmitter.emit(jobId, {
      stage: 'ingestion',
      code: 'CHUNKS_READY',
      message: `Split into ${totalChunks} chunks (${totalPages} pages), starting AI analysis...`,
      progress: 10,
      timestamp: Date.now(),
      data: { totalChunks, totalPages },
    });

    // ============================================================
    // STEP 2: Process chunks in batches and aggregate data
    // ============================================================
    // Memory check before batch processing
    const preBatchMem = checkMemory(jobId, 'pre-batch-processing');
    if (!preBatchMem.ok) {
      throw new MemoryExceededError(preBatchMem.heapUsedMB, 'pre-batch-processing');
    }
    console.log(`\n🔄 Starting batch processing of ${totalChunks} chunks... (${preBatchMem.heapUsedMB}MB heap)`);

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

      // Handle memory exceeded gracefully
      if (batchError instanceof MemoryExceededError) {
        console.error(`🚨 Workflow aborted due to memory limit: ${batchError.message}`);
        logToDB(jobId, 'error', 'memory', batchError.message);
        return {
          success: false,
          buildingData: {},
          processingTime: Date.now() - startTime,
          errors: [batchError.message],
          warnings: ['Job was aborted to prevent server crash. Try with smaller PDFs or fewer files.'],
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

    // ============================================================
    // STEP 3.2: Merge text-layer insights (dates, developer guard,
    // payment milestones, inventory/parking, service charge, landmarks)
    // ============================================================
    try {
      const textInsights = await textInsightsPromise;
      applyTextInsights(finalData, textInsights, fullText, allWarnings);
    } catch (insightsError) {
      console.warn(`   ⚠️  Failed to apply text insights:`, insightsError);
    }

    // ============================================================
    // STEP 3.5: Auto-geocode address to get coordinates
    // ============================================================
    if (finalData.address && !finalData.latitude && !finalData.longitude) {
      console.log(`\n🌍 Auto-geocoding project address...`);
      progressEmitter.emit(jobId, {
        stage: 'reducing',
        code: 'GEOCODING',
        message: 'Getting project coordinates from address...',
        progress: 96,
        timestamp: Date.now(),
      });

      const coords = await geocodeAddress(finalData.address, finalData.name);
      if (coords) {
        finalData.latitude = coords.lat;
        finalData.longitude = coords.lng;
        console.log(`   ✓ Coordinates set: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`);
      } else {
        console.log(`   ⚠️  Could not geocode address, coordinates not set`);
      }
    }

    // ============================================================
    // STEP 3.6: Canonicalize area — map extracted (marketing) area names to
    // the dubai_areas entry by coordinate containment ("City Walk" → "CityWalk").
    // Deterministic spatial lookup, no AI guessing.
    // ============================================================
    try {
      const canonical = await resolveCanonicalArea(
        finalData.latitude,
        finalData.longitude,
        finalData.area
      );
      if (canonical !== finalData.area) {
        console.log(`   📍 [AREA] Canonicalized: "${finalData.area || '(empty)'}" → "${canonical || '(none — outside all areas)'}"`);
      }
      // area 只存地图系统的标准区域名；坐标不在任何区域内 → 留空（合法状态）
      finalData.area = canonical || '';
    } catch (areaError) {
      console.warn(`   ⚠️  Area canonicalization failed:`, areaError);
    }

    // ============================================================
    // STEP 3.7: Submit readiness (structured — rides inside buildingData
    // so it reaches the frontend in both inline and worker modes)
    // ============================================================
    const submitReadiness = computeSubmitReadiness(finalData);
    (finalData as any).submitReadiness = submitReadiness;
    if (!submitReadiness.submittable && submitReadiness.message) {
      allWarnings.push(submitReadiness.message);
    }
    console.log(`\n🚦 Submit readiness: ${submitReadiness.submittable ? '✅ YES' : `❌ NO — ${submitReadiness.message}`}`);

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

    // Log completion to database
    logToDB(jobId, 'info', 'workflow', 'Workflow completed successfully', {
      processingTimeMs: processingTime,
      totalChunks,
      totalPages,
      errorCount: allErrors.length,
      warningCount: allWarnings.length,
      summary: {
        units: finalData.units?.length || 0,
        paymentPlans: finalData.paymentPlans?.length || 0,
        amenities: finalData.amenities?.length || 0,
        projectImages: finalData.images?.projectImages?.length || 0,
        floorPlanImages: finalData.images?.floorPlanImages?.length || 0,
      },
    });

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

    // Handle memory exceeded gracefully
    if (error instanceof MemoryExceededError) {
      console.error(`🚨 Workflow aborted due to memory limit: ${error.message}`);
      logToDB(jobId, 'error', 'memory', error.message);
      progressEmitter.error(jobId, error.message);
      return {
        success: false,
        buildingData: {},
        processingTime: Date.now() - startTime,
        errors: [error.message],
        warnings: ['Job was aborted to prevent server crash. Try with smaller PDFs or fewer files.'],
        jobId,
        totalChunks: 0,
        totalPages: 0,
        aborted: true,
      };
    }

    console.error('\n❌ WORKFLOW FAILED:', error);
    console.error('   Stack trace:', (error as Error).stack);

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    // Log error to database
    logToDB(jobId, 'error', 'workflow', `Workflow failed: ${errorMessage}`, {
      error: errorMessage,
      stack: errorStack,
      processingTimeMs: Date.now() - startTime,
    });

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
      TextLayerRegistry.delete(jobId);
    }
  }
}
