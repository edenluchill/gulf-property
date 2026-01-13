/**
 * Unified Chunked PDF Workflow Executor
 * 
 * Simple strategy:
 * 1. Split ALL PDFs into 5-page chunks
 * 2. Process all chunks in batches
 * 3. Manager accumulates and merges results
 * 
 * Perfect for any size/number of files!
 */

import { buildEnhancedWorkflow } from './graph-enhanced';
import type { State } from './state';
import { createOutputStructure } from '../utils/pdf/file-manager';
import { splitPdfIntoChunks, type PdfChunk } from '../utils/pdf/chunker';
import { deduplicateUnits, deduplicatePaymentPlans, sortUnits } from '../utils/deduplication';
import { join } from 'path';
import { progressEmitter } from '../services/progress-emitter';

export interface UnifiedChunkedConfig {
  pdfBuffers: Buffer[];
  pdfNames?: string[];
  outputBaseDir?: string;
  jobId: string;
  pagesPerChunk?: number;
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
}

/**
 * Execute unified chunked workflow
 * All PDFs → uniform 5-page chunks → batch process → merge
 */
export async function executeUnifiedChunkedWorkflow(
  config: UnifiedChunkedConfig
): Promise<WorkflowResult> {
  const startTime = Date.now();
  const { jobId, pdfBuffers, pdfNames, pagesPerChunk = 5 } = config;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`UNIFIED CHUNKED WORKFLOW - Job ID: ${jobId}`);
  console.log(`Files: ${pdfBuffers.length} | Pages per chunk: ${pagesPerChunk}`);
  console.log(`${'='.repeat(70)}\n`);

  try {
    const outputBaseDir = config.outputBaseDir || join(process.cwd(), 'uploads', 'langgraph-output');
    const outputStructure = createOutputStructure(outputBaseDir, jobId);

    // Step 1: Split ALL PDFs into uniform chunks
    progressEmitter.emit(jobId, {
      stage: 'ingestion',
      message: `📦 正在将所有文档切分成 ${pagesPerChunk} 页小块...`,
      progress: 5,
      timestamp: Date.now(),
    });

    const allChunks: Array<PdfChunk & { sourceFile: string }> = [];

    for (let fileIdx = 0; fileIdx < pdfBuffers.length; fileIdx++) {
      const fileName = pdfNames?.[fileIdx] || `Document ${fileIdx + 1}`;
      const sizeMB = (pdfBuffers[fileIdx].length / 1024 / 1024).toFixed(2);
      
      console.log(`\n📄 Splitting file ${fileIdx + 1}/${pdfBuffers.length}: ${fileName} (${sizeMB} MB)`);

      const chunks = await splitPdfIntoChunks(pdfBuffers[fileIdx], pagesPerChunk);
      
      // Tag chunks with source file
      chunks.forEach(chunk => {
        allChunks.push({
          ...chunk,
          sourceFile: fileName,
        });
      });

      console.log(`   ✓ Split into ${chunks.length} chunks`);
    }

    const totalChunks = allChunks.length;
    const totalPages = allChunks[allChunks.length - 1]?.pageRange.end || 0;

    console.log(`\n📦 Total chunks to process: ${totalChunks}`);
    console.log(`📄 Total pages: ${totalPages}\n`);

    progressEmitter.emit(jobId, {
      stage: 'ingestion',
      message: `✅ 已切分成 ${totalChunks} 个小块，开始批量处理...`,
      progress: 10,
      timestamp: Date.now(),
    });

    // Step 2: Initialize Manager state
    const managerState = {
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

    // Step 3: Process chunks in parallel batches
    // Lower concurrency to respect Gemini free tier (10 RPM)
    const BATCH_SIZE = 10; // Process 3 chunks at a time (safe for free API)
    const BATCH_DELAY = 1000; // 3 second delay between batches
    const batches: typeof allChunks[] = [];
    
    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
      batches.push(allChunks.slice(i, i + BATCH_SIZE));
    }

    console.log(`\n🚀 Processing in ${batches.length} parallel batches (${BATCH_SIZE} chunks per batch)\n`);
    console.log(`⏱️  Rate limit protection: ${BATCH_DELAY / 1000}s delay between batches\n`);

    let processedCount = 0;

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];

      console.log(`\n=== BATCH ${batchIdx + 1}/${batches.length} - Processing ${batch.length} chunks in PARALLEL ===\n`);

      // Process all chunks in this batch CONCURRENTLY
      const batchPromises = batch.map(async (chunk, batchLocalIdx) => {
        const globalIdx = batchIdx * BATCH_SIZE + batchLocalIdx;
        
        console.log(`   🚀 Starting chunk ${globalIdx + 1}/${totalChunks}: 页 ${chunk.pageRange.start}-${chunk.pageRange.end}`);

        const initialState: Partial<State> = {
          pdfPath: `${chunk.sourceFile}_chunk${globalIdx + 1}`,
          pdfBuffer: chunk.buffer,
          outputDir: outputStructure.jobDir,
          buildingData: {},
          totalPages: 0,
          pageImages: [],
          pageResults: [],
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

        try {
          const app = buildEnhancedWorkflow();
          const chunkResult = await app.invoke(initialState);

          console.log(`   ✓ Chunk ${globalIdx + 1} complete: ${chunkResult.buildingData?.units?.length || 0} units`);

          // ✨ Immediately update frontend when THIS chunk completes!
          if (chunkResult.buildingData) {
            const bd = chunkResult.buildingData;
            
            // ✅ 只在第一次设置基本信息（保持稳定，不要每次覆盖）
            if (!managerState.name && bd.name) {
              managerState.name = bd.name;
            }
            if (!managerState.developer && bd.developer) {
              managerState.developer = bd.developer;
            }
            if (!managerState.address && bd.address) {
              managerState.address = bd.address;
            }
            if (!managerState.area && bd.area) {
              managerState.area = bd.area;
            }
            if (!managerState.completionDate && bd.completionDate) {
              managerState.completionDate = bd.completionDate;
            }
            if (!managerState.launchDate && bd.launchDate) {
              managerState.launchDate = bd.launchDate;
            }
            // Description: 选择最长的（最详细的）
            if (bd.description && (!managerState.description || bd.description.length > managerState.description.length)) {
              managerState.description = bd.description;
            }

            if (bd.units && bd.units.length > 0) {
              managerState.units.push(...bd.units);
            }
            if (bd.paymentPlans && bd.paymentPlans.length > 0) {
              managerState.paymentPlans.push(...bd.paymentPlans);
            }
            if (bd.amenities) {
              bd.amenities.forEach((a: string) => {
                if (!managerState.amenities.includes(a)) {
                  managerState.amenities.push(a);
                }
              });
            }

            // Send progress update immediately for THIS chunk
            const chunkProgress = 10 + ((globalIdx + 1) / totalChunks) * 75;
            
            // ✅ 去重并排序后再发送
            const deduped = deduplicateUnits(managerState.units);
            const sorted = sortUnits(deduped);
            
            progressEmitter.emit(jobId, {
              stage: 'mapping',
              message: `✓ 块 ${globalIdx + 1}/${totalChunks} (页 ${chunk.pageRange.start}-${chunk.pageRange.end}) - ${sorted.length} 户型`,
              progress: chunkProgress,
              data: {
                buildingData: {
                  ...managerState,
                  units: sorted, // 发送去重并排序的数据
                },
              },
              timestamp: Date.now(),
            });
          }

          return {
            success: true,
            data: chunkResult.buildingData,
            errors: chunkResult.errors || [],
            warnings: chunkResult.warnings || [],
          };
        } catch (chunkError) {
          console.error(`   ✗ Chunk ${globalIdx + 1} failed:`, chunkError);
          return {
            success: false,
            data: null,
            errors: [`Chunk ${globalIdx + 1} failed: ${chunkError}`],
            warnings: [],
          };
        }
      });

      // Wait for all chunks in this batch to complete (PARALLEL!)
      const batchResults = await Promise.all(batchPromises);

      console.log(`\n✅ Batch ${batchIdx + 1} complete!\n`);

      // Just collect errors/warnings (data already accumulated in individual promises)
      batchResults.forEach((result) => {
        allErrors.push(...result.errors);
        allWarnings.push(...result.warnings);
      });

      processedCount += batch.length;

      // Delay between batches to respect rate limits
      if (batchIdx < batches.length - 1) {
        console.log(`\n⏸️  Waiting ${BATCH_DELAY / 1000}s before next batch (rate limit protection)...`);
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
      }
    }

    // Step 4: Final deduplication and cleanup
    console.log(`\n📊 Processing complete. Deduplicating data...`);

    progressEmitter.emit(jobId, {
      stage: 'reducing',
      message: '📊 正在合并去重数据...',
      progress: 90,
      timestamp: Date.now(),
    });

    const finalUnits = deduplicateUnits(managerState.units);
    const sortedUnits = sortUnits(finalUnits);
    const finalPaymentPlans = deduplicatePaymentPlans(managerState.paymentPlans);

    console.log(`   ✓ Deduplicated: ${managerState.units.length} → ${finalUnits.length} unique units`);
    console.log(`   ✓ Sorted by category`);
    console.log(`   ✓ Payment plans: ${finalPaymentPlans.length}`);
    console.log(`   ✓ Amenities: ${managerState.amenities.length}`);

    const finalData = {
      ...managerState,
      units: sortedUnits,
      paymentPlans: finalPaymentPlans,
      minPrice: finalUnits.filter(u => u.price).length > 0 
        ? Math.min(...finalUnits.filter(u => u.price).map(u => u.price)) 
        : undefined,
      maxPrice: finalUnits.filter(u => u.price).length > 0
        ? Math.max(...finalUnits.filter(u => u.price).map(u => u.price))
        : undefined,
      minArea: finalUnits.filter(u => u.area).length > 0
        ? Math.min(...finalUnits.filter(u => u.area).map(u => u.area))
        : undefined,
      maxArea: finalUnits.filter(u => u.area).length > 0
        ? Math.max(...finalUnits.filter(u => u.area).map(u => u.area))
        : undefined,
    };

    const processingTime = Date.now() - startTime;

    console.log(`\n${'='.repeat(70)}`);
    console.log('✅ UNIFIED WORKFLOW COMPLETED');
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
    };

  } catch (error) {
    console.error('❌ UNIFIED WORKFLOW FAILED:', error);
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
    };
  }
}

// Deduplication functions moved to utils/deduplication.ts
// Using advanced key generation and smart merging
