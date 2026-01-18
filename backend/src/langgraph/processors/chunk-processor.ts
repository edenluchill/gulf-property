/**
 * Chunk Processor Module
 * 
 * Handles processing of individual PDF chunks:
 * - Initialize chunk state
 * - Execute workflow for chunk
 * - Extract and return chunk results
 * 
 * NEW: Integrated with smart image assignment system
 * - AI analyzes each page → PageMetadata
 * - Pages inserted into PageRegistry
 * - Real-time image assignment
 */

import { buildEnhancedWorkflow } from '../graph-enhanced';
import type { State } from '../state';
import type { PdfChunk } from '../../utils/pdf/chunker';
import { analyzePageWithAI } from '../agents/page-analyzer.agent';
import { PageMetadata } from '../types/page-metadata';
import { pdfToImages } from '../../utils/pdf/converter';
import { join } from 'path';
import { renameSync } from 'fs';
import { uploadFileToPdfCacheWithVariants } from '../../services/r2-storage';

export interface ChunkProcessingConfig {
  chunk: PdfChunk & { sourceFile: string; pdfHash: string };
  chunkIndex: number;
  totalChunks: number;
  outputDir: string;
  jobId?: string; // For progress tracking
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
    // 1. 转换chunk为图片
    const pageImages = await convertChunkToImages(chunk, outputDir, jobId, chunkIndex);
    
    // 2. AI分析每一页
    const pageMetadataList = await Promise.all(
      pageImages.map(async (pageImgPath, localIdx) => {
        const absolutePageNum = chunk.pageRange.start + localIdx;
        return await analyzePageWithAI(
          pageImgPath,           // 本地路径（AI分析用）
          absolutePageNum,
          chunk.sourceFile,
          chunkIndex,
          jobId
        );
      })
    );
    
    console.log(`   ✓ AI analyzed ${pageMetadataList.length} pages`);
    
    // ⚡ PERFORMANCE: Batch upload all images to R2 PDF cache after analysis
    // ⭐ NEW: Use PDF hash for cache key, enabling image reuse across uploads
    const pdfHash = chunk.pdfHash;
    if (!pdfHash) {
      throw new Error('❌ PDF hash is required for R2 upload');
    }
    
    console.log(`   📤 Batch uploading ${pageImages.length} images to R2 cache (${pdfHash.substring(0, 12)}...)...`);
    const uploadStartTime = Date.now();
    
    // ⚡ Upload images with controlled concurrency to avoid R2 rate limits
    // Upload in smaller batches (3 at a time) instead of all at once
    const uploadResults: any[] = [];
    const UPLOAD_CONCURRENCY = 3; // ⚡ Max 3 concurrent uploads per chunk
    
    for (let i = 0; i < pageImages.length; i += UPLOAD_CONCURRENCY) {
      const batch = pageImages.slice(i, i + UPLOAD_CONCURRENCY);
      
      const batchResults = await Promise.allSettled(
        batch.map(async (imgPath, batchIdx) => {
          const idx = i + batchIdx;
          
          // ⚡ Small delay between uploads in the same batch
          await new Promise(resolve => setTimeout(resolve, batchIdx * 200));
          
          let retries = 3;
          let lastError: any;
          
          // Retry logic for R2 upload to PDF cache (with variants)
          while (retries > 0) {
            try {
              const imageUrls = await uploadFileToPdfCacheWithVariants(imgPath, pdfHash);
              
              // ⚡ Update imagePath and imageUrls in pageMetadataList
              if (pageMetadataList[idx]?.images) {
                pageMetadataList[idx].images.forEach(img => {
                  img.imagePath = imageUrls.original;  // 向后兼容
                  img.imageUrls = imageUrls;           // ⭐ 多尺寸URLs
                });
              }
              
              return { success: true, path: imgPath, url: imageUrls.original };
            } catch (err) {
              lastError = err;
              retries--;
              
              if (retries > 0) {
                console.warn(`   ⚠️ Upload failed for image ${idx + 1}, retrying... (${retries} attempts left)`);
                await new Promise(resolve => setTimeout(resolve, 1500)); // ⚡ Increased retry delay
              }
            }
          }
          
          // All retries failed
          console.error(`   ❌ Failed to upload image ${idx + 1} after 3 attempts:`, lastError);
          return { success: false, path: imgPath, error: lastError };
        })
      );
      
      uploadResults.push(...batchResults);
      
      // ⚡ Delay between batches to avoid overwhelming R2
      if (i + UPLOAD_CONCURRENCY < pageImages.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    
    const successCount = uploadResults.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failedCount = pageImages.length - successCount;
    const uploadTime = Date.now() - uploadStartTime;
    
    // ⭐ Track how many were actually uploaded vs reused from cache
    const uploadedCount = uploadResults.filter(r => 
      r.status === 'fulfilled' && 
      r.value.success && 
      !String(r.value.url).includes('already cached')
    ).length;
    const cachedCount = successCount - uploadedCount;
    
    if (cachedCount > 0) {
      console.log(`   📊 Upload results: ${successCount}/${pageImages.length} succeeded in ${uploadTime}ms`);
      console.log(`   ♻️  Cache reuse: ${cachedCount} images already existed, skipped upload`);
      console.log(`   ⬆️  New uploads: ${uploadedCount} images uploaded`);
    } else {
      console.log(`   📊 Upload results: ${successCount}/${pageImages.length} succeeded in ${uploadTime}ms`);
    }
    
    // ⚠️ If any uploads failed, log detailed error but continue processing
    if (failedCount > 0) {
      console.error(`   ⚠️ WARNING: ${failedCount} images failed to upload to R2`);
      console.error(`   These images will not be accessible in the frontend.`);
      console.error(`   Please check R2 configuration and network connectivity.`);
      
      // Log failed uploads
      uploadResults.forEach((result, idx) => {
        if (result.status === 'fulfilled' && !result.value.success) {
          console.error(`     - Image ${idx + 1}: ${result.value.path}`);
        }
      });
    }

    // ⚡ PERFORMANCE FIX: Only run full workflow on first and last chunk
    // Other chunks only do page-level analysis
    let chunkResult: any;
    
    if (chunkIndex === 0 || chunkIndex === totalChunks - 1) {
      console.log(`   🔄 Running full workflow for chunk ${chunkIndex + 1} (first/last chunk)`);
      
      // 3. 执行完整workflow（提取项目基本信息、单元信息等）
      const initialState: Partial<State> = {
        pdfPath: `${chunk.sourceFile}_chunk${chunkIndex + 1}`,
        pdfBuffer: chunk.buffer,
        outputDir: outputDir,
        buildingData: {},
        totalPages: 0,
        pageImages: pageImages,  // ⚡ Pass converted images to avoid re-conversion
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
        startTime,
        processingStage: 'ingestion',
      };

      const app = buildEnhancedWorkflow();
      chunkResult = await app.invoke(initialState);
    } else {
      console.log(`   ⚡ Skipping full workflow for chunk ${chunkIndex + 1} (only doing page analysis)`);
      
      // Skip expensive workflow for middle chunks
      chunkResult = {
        buildingData: {},
        errors: [],
        warnings: [],
        pageResults: [],
      };
    }
    
    const processingTime = Date.now() - startTime;
    const unitsCount = chunkResult.buildingData?.units?.length || 0;
    
    console.log(`   ✓ Chunk ${chunkIndex + 1} complete: ${unitsCount} units, ${pageMetadataList.length} pages analyzed (${(processingTime / 1000).toFixed(2)}s)`);

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

/**
 * 转换chunk为图片（辅助函数）
 * 
 * ⭐ KEY FIX: Use absolute page numbers for filename prefix
 * This ensures:
 * - Same PDF always generates same filenames (cache-friendly)
 * - Clear page identification (page_1.png = page 1 of PDF)
 * - Independent of chunk size changes
 * 
 * 关键修复：
 * - 使用PDF绝对页码作为文件名前缀
 * - 返回本地路径供AI分析（readFileSync需要）
 * - R2上传在PageImage中处理
 */
async function convertChunkToImages(
  chunk: PdfChunk & { sourceFile: string },
  outputDir: string,
  _jobId: string | undefined,  // Unused for now, kept for future use
  chunkIndex: number
): Promise<string[]> {
  const tempDir = join(outputDir, `chunk_${chunkIndex}_temp`);
  
  // ⭐ Use absolute page number as prefix (not chunk index!)
  // Example: Chunk 0 (pages 1-5) → page_1, page_2, page_3, page_4, page_5
  // Example: Chunk 1 (pages 6-10) → page_6, page_7, page_8, page_9, page_10
  const firstPageInChunk = chunk.pageRange.start;
  const filenamePrefix = `page_${firstPageInChunk}`;
  
  // 转换PDF chunk为图片
  const localImagePaths = await pdfToImages(
    chunk.buffer,
    tempDir,
    filenamePrefix
  );
  
  // ⚠️ IMPORTANT: pdfToImages generates sequential numbers starting from .1
  // So we need to rename files to use absolute page numbers
  // page_1.1.png → page_1.png, page_1.2.png → page_2.png, etc.
  const renamedPaths: string[] = [];
  for (let i = 0; i < localImagePaths.length; i++) {
    const oldPath = localImagePaths[i];
    const absolutePageNum = firstPageInChunk + i;
    const newPath = join(tempDir, `page_${absolutePageNum}.png`);
    
    // Rename file to use absolute page number
    renameSync(oldPath, newPath);
    renamedPaths.push(newPath);
  }
  
  // ⭐ 返回本地路径（AI分析需要）
  // R2上传稍后在PageImage中处理
  return renamedPaths;
}

