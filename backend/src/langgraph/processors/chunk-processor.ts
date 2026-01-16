/**
 * Chunk Processor Module
 * 
 * Handles processing of individual PDF chunks:
 * - Initialize chunk state
 * - Execute workflow for chunk
 * - Extract and return chunk results
 */

import { buildEnhancedWorkflow } from '../graph-enhanced';
import type { State } from '../state';
import type { PdfChunk } from '../../utils/pdf/chunker';
import { extractImagesFromChunkSimple } from './simple-image-extractor';

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
}

/**
 * Process a single PDF chunk through the enhanced workflow
 */
export async function processSingleChunk(
  config: ChunkProcessingConfig
): Promise<ChunkProcessingResult> {
  const { chunk, chunkIndex, totalChunks, outputDir, jobId } = config;
  const startTime = Date.now();

  console.log(`   🚀 Starting chunk ${chunkIndex + 1}/${totalChunks}: 页 ${chunk.pageRange.start}-${chunk.pageRange.end}`);

  // Initialize state for this chunk
  const initialState: Partial<State> = {
    pdfPath: `${chunk.sourceFile}_chunk${chunkIndex + 1}`,
    pdfBuffer: chunk.buffer,
    outputDir: outputDir,
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
    startTime,
    processingStage: 'ingestion',
  };

  try {
    // Build and execute workflow for this chunk
    const app = buildEnhancedWorkflow();
    const chunkResult = await app.invoke(initialState);

    const unitsCount = chunkResult.buildingData?.units?.length || 0;
    
    // Extract images from this chunk (simplified version)
    let imageResult;
    try {
      imageResult = await extractImagesFromChunkSimple(
        chunk,
        chunkResult.buildingData,
        outputDir,
        jobId // Pass jobId for R2 upload
      );
      
      // Merge image data into building data
      if (imageResult && imageResult.success && imageResult.extractedImages.length > 0) {
        // Use type assertion to add images property
        (chunkResult.buildingData as any).images = {
          ...(chunkResult.buildingData as any).images,
          projectImages: imageResult.projectImages || [],
          floorPlanImages: imageResult.floorPlanImages || [],
          allImages: imageResult.extractedImages || [],
        };
        
        console.log(`   ✓ Extracted ${imageResult.extractedImages.length} images from chunk ${chunkIndex + 1}`);
      }
    } catch (imageError) {
      console.warn(`   ⚠️ Image extraction failed for chunk ${chunkIndex + 1}:`, imageError);
      // Continue without images - don't fail the whole chunk
    }
    
    const processingTime = Date.now() - startTime;
    
    console.log(`   ✓ Chunk ${chunkIndex + 1} complete: ${unitsCount} units (${(processingTime / 1000).toFixed(2)}s)`);

    return {
      success: true,
      chunkIndex,
      data: chunkResult.buildingData,
      errors: chunkResult.errors || [],
      warnings: chunkResult.warnings || [],
      processingTime,
      pageRange: chunk.pageRange,
      pageResults: chunkResult.pageResults || [],  // Include detailed page results
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
