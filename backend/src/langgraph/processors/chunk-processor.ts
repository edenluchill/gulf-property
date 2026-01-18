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
import { uploadFileToR2Temp } from '../../services/r2-storage';

export interface ChunkProcessingConfig {
  chunk: PdfChunk & { sourceFile: string };
  chunkIndex: number;
  totalChunks: number;
  outputDir: string;
  jobId?: string; // For R2 temp storage
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
    
    // ⚡ PERFORMANCE: Batch upload all images to R2 after analysis
    // ⚡ R2-ONLY: Upload must succeed, no fallback to local serving
    if (!jobId) {
      throw new Error('❌ JobId is required for R2 upload');
    }
    
    console.log(`   📤 Batch uploading ${pageImages.length} images to R2...`);
    const uploadStartTime = Date.now();
    
    // ⚡ Upload images with staggered timing to avoid overwhelming R2
    const uploadResults = await Promise.allSettled(
      pageImages.map(async (imgPath, idx) => {
        // ⚡ Stagger uploads: each image waits idx * 100ms before starting
        // This spreads out the load and reduces connection timeouts
        await new Promise(resolve => setTimeout(resolve, idx * 100));
        
        let retries = 3;
        let lastError: any;
        
        // Retry logic for R2 upload
        while (retries > 0) {
          try {
            const r2Url = await uploadFileToR2Temp(imgPath, jobId);
            
            // ⚡ Update imagePath in pageMetadataList
            if (pageMetadataList[idx]?.images) {
              pageMetadataList[idx].images.forEach(img => {
                img.imagePath = r2Url;
              });
            }
            
            return { success: true, path: imgPath, url: r2Url };
          } catch (err) {
            lastError = err;
            retries--;
            
            if (retries > 0) {
              console.warn(`   ⚠️ Upload failed for image ${idx + 1}, retrying... (${retries} attempts left)`);
              await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
            }
          }
        }
        
        // All retries failed
        console.error(`   ❌ Failed to upload image ${idx + 1} after 3 attempts:`, lastError);
        return { success: false, path: imgPath, error: lastError };
      })
    );
    
    const successCount = uploadResults.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failedCount = pageImages.length - successCount;
    const uploadTime = Date.now() - uploadStartTime;
    
    console.log(`   📊 Upload results: ${successCount}/${pageImages.length} succeeded in ${uploadTime}ms`);
    
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
 * 关键修复：
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
  
  // 转换PDF chunk为图片
  const localImagePaths = await pdfToImages(
    chunk.buffer,
    tempDir,
    `chunk${chunkIndex}`
  );
  
  // ⭐ 返回本地路径（AI分析需要）
  // R2上传稍后在PageImage中处理
  return localImagePaths;
}

