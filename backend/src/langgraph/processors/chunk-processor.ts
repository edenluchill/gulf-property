/**
 * Chunk Processor Module
 * 
 * Handles processing of individual PDF chunks:
 * - AI analyzes pre-generated images
 * - Extract building data via workflow
 * - Return PageMetadata for smart assignment
 * 
 * OPTIMIZED: Images are pre-generated in workflow-executor
 * - No image generation here
 * - No R2 upload here
 * - AI only classifies and marks images
 */

import type { PdfChunk } from '../../utils/pdf/chunker';
import { analyzePageWithAI } from '../agents/page-analyzer.agent';
import { classifyPagesBatch, type BatchClassifyInput, type ClassificationResult } from '../agents/page-classifier.agent';
import { PageMetadata } from '../types/page-metadata';
import type { PdfImageBatch } from '../utils/pdf-image-generator';
import { getAllVariantUrls } from '../utils/pdf-image-generator';
import { TextLayerRegistry, clipForPrompt } from '../utils/text-layer';

export interface ChunkProcessingConfig {
  chunk: PdfChunk & { sourceFile: string; pdfHash: string; imageBatch?: PdfImageBatch };
  chunkIndex: number;
  totalChunks: number;
  outputDir: string;
  jobId?: string;
}

export interface ChunkProcessingResult {
  success: boolean;
  chunkIndex: number;
  data: any | null;
  errors: string[];
  warnings: string[];
  processingTime?: number;
  pageRange?: { start: number; end: number };
  pageResults?: any[];  // Detailed page-level results
  pageMetadataList?: PageMetadata[];  // NEW: AI analyzed page metadata
}

/**
 * Process a single PDF chunk with smart image assignment
 */
export async function processSingleChunk(
  config: ChunkProcessingConfig
): Promise<ChunkProcessingResult> {
  const { chunk, chunkIndex, totalChunks, outputDir: _outputDir, jobId } = config;
  const startTime = Date.now();

  console.log(`   🚀 Chunk ${chunkIndex + 1}/${totalChunks}: 页 ${chunk.pageRange.start}-${chunk.pageRange.end}`);

  try {
    // ⭐ OPTIMIZED: Use pre-generated images from imageBatch
    const imageBatch = chunk.imageBatch;
    if (!imageBatch) {
      throw new Error('❌ Image batch not found - images should be pre-generated');
    }

    console.log(`   ✅ Using ${imageBatch.totalPages} pre-generated images from R2`);
    
    // 1. AI分析每一页（使用R2 URLs）- ⭐ OPTIMIZED: Parallel processing
    const pagesInChunk = chunk.pageRange.end - chunk.pageRange.start + 1;

    console.log(`   🔄 Analyzing ${pagesInChunk} pages...`);

    // ⭐ Collect page inputs (image URLs + text-layer assist)
    const pageInputs = Array.from({ length: pagesInChunk }, (_, localIdx) => {
      const absolutePageNum = chunk.pageRange.start + localIdx;
      const imageUrls = getAllVariantUrls(imageBatch, absolutePageNum);
      if (!imageUrls) {
        console.warn(`   ⚠️ No image found for page ${absolutePageNum}, skipping`);
        return null;
      }
      const pageText = jobId
        ? clipForPrompt(TextLayerRegistry.getPageText(jobId, chunk.pdfHash, absolutePageNum))
        : undefined;
      return { absolutePageNum, imageUrls, pageText };
    }).filter((p): p is NonNullable<typeof p> => p !== null);

    // ⚡ Phase A: batch classification — ONE call for the whole chunk
    // (验证过 batch=4~6 关键页零损失；失败/缺页自动降级为逐页分类)
    let batchClassifications: Map<number, ClassificationResult> | null = null;
    try {
      const batchInputs: BatchClassifyInput[] = pageInputs.map(p => ({
        pageNumber: p.absolutePageNum,
        imageUrl: p.imageUrls.large,
        pageText: p.pageText,
      }));
      batchClassifications = await classifyPagesBatch(batchInputs);
      const missing = pageInputs.filter(p => !batchClassifications!.has(p.absolutePageNum));
      if (missing.length > 0) {
        console.warn(`   ⚠️ Batch classify missed ${missing.length} pages, they fall back to per-page`);
      }
    } catch (batchClassifyError) {
      console.warn(`   ⚠️ Batch classification failed, falling back to per-page: ${(batchClassifyError as Error).message}`);
    }

    // ⭐ Phase B: per-page detail extraction in parallel
    // (有批量分类结果的页跳过 Phase 1；没有的走原单页路径)
    const pagePromises = pageInputs.map(p =>
      analyzePageWithAI(
        p.imageUrls.large,
        p.absolutePageNum,
        chunk.sourceFile,
        chunkIndex,
        jobId,
        p.imageUrls,
        chunk.pdfHash,
        p.pageText,
        batchClassifications?.get(p.absolutePageNum)
      )
    );

    // ⭐ Wait for all pages to complete in parallel
    const pageResults = await Promise.all(pagePromises);

    // Filter out null results and flatten arrays (multi-unit pages return arrays)
    const pageMetadataList: PageMetadata[] = [];
    for (const result of pageResults) {
      if (result === null) continue;
      if (Array.isArray(result)) {
        // Multi-unit page: flatten the array
        pageMetadataList.push(...result);
        console.log(`   🔀 Multi-unit page expanded: ${result.length} units added`);
      } else {
        pageMetadataList.push(result);
      }
    }
    
    console.log(`   ✅ AI analyzed ${pageMetadataList.length} pages in parallel`)

    // 2. No longer using Enhanced Direct PDF workflow - all data comes from PageRegistry
    const chunkResult = {
      buildingData: {},
      errors: [],
      warnings: [],
      pageResults: [],
    };
    
    const processingTime = Date.now() - startTime;
    
    console.log(`   ✓ Chunk ${chunkIndex + 1} complete: ${pageMetadataList.length} pages analyzed (${(processingTime / 1000).toFixed(2)}s)`);

    return {
      success: true,
      chunkIndex,
      data: chunkResult.buildingData,
      errors: chunkResult.errors || [],
      warnings: chunkResult.warnings || [],
      processingTime,
      pageRange: chunk.pageRange,
      pageResults: chunkResult.pageResults || [],
      pageMetadataList,
    };
  } catch (error) {
    console.error(`   ✗ Chunk ${chunkIndex + 1} failed:`, error);
    
    return {
      success: false,
      chunkIndex,
      data: null,
      errors: [`Chunk ${chunkIndex + 1} failed: ${error}`],
      warnings: [],
      processingTime: Date.now() - startTime,
      pageRange: chunk.pageRange,
    };
  }
}

// ⭐ Removed: convertChunkToImages() - images are now pre-generated in workflow-executor

