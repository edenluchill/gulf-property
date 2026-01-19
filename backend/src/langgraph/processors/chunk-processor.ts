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
import { PageMetadata } from '../types/page-metadata';
import type { PdfImageBatch } from '../utils/pdf-image-generator';
import { getAllVariantUrls } from '../utils/pdf-image-generator';

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
  const { chunk, chunkIndex, totalChunks, outputDir, jobId } = config;
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
    
    console.log(`   🔄 Analyzing ${pagesInChunk} pages in parallel...`);
    
    // ⭐ Create parallel promises for all pages in this chunk
    const pagePromises = Array.from({ length: pagesInChunk }, (_, localIdx) => {
      const absolutePageNum = chunk.pageRange.start + localIdx;
      
      // Get pre-generated image URLs from imageBatch
      const imageUrls = getAllVariantUrls(imageBatch, absolutePageNum);
      
      if (!imageUrls) {
        console.warn(`   ⚠️ No image found for page ${absolutePageNum}, skipping`);
        return null;
      }

      // AI analyzes using R2 URL (no local file needed!)
      return analyzePageWithAI(
        imageUrls.original,  // ⭐ R2 URL (not local path)
        absolutePageNum,
        chunk.sourceFile,
        chunkIndex,
        jobId,
        imageUrls  // ⭐ Pass all variant URLs
      );
    });
    
    // ⭐ Wait for all pages to complete in parallel
    const pageResults = await Promise.all(pagePromises);
    
    // Filter out null results (pages with missing images)
    const pageMetadataList = pageResults.filter(p => p !== null) as PageMetadata[];
    
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

