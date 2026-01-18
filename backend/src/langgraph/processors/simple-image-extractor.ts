/**
 * Simple Image Extractor
 * 
 * Simplified image extraction that doesn't depend on pageResults
 * Strategy: If a chunk extracted units, convert ALL pages in that chunk to images
 * 
 * UPDATED: Now uploads images to Cloudflare R2 instead of local storage
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { PdfChunk } from '../../utils/pdf/chunker';

// Use unified PDF converter (supports pdf2pic)
import { pdfToImages } from '../../utils/pdf/converter';
import { uploadFileToR2Temp } from '../../services/r2-storage';

export interface SimpleImageExtractionResult {
  success: boolean;
  extractedImages: Array<{
    pageNumber: number;
    imagePath: string; // Now R2 URL instead of local path
    category: 'floor_plan' | 'project' | 'other';
  }>;
  floorPlanImages: string[]; // R2 URLs
  projectImages: string[]; // R2 URLs
}

/**
 * Simple image extraction from chunk
 * If chunk has units → extract floor plan images
 * If chunk has no units but is from Project Briefing → extract project images
 * 
 * @param outputDir - Local temp directory for conversion (will be cleaned up)
 * @param jobId - Job ID for R2 temporary storage path
 * @param chunkIndex - Chunk index for unique filename generation
 */
export async function extractImagesFromChunkSimple(
  chunk: PdfChunk & { sourceFile: string },
  chunkData: any,
  outputDir: string,
  jobId?: string,
  chunkIndex?: number
): Promise<SimpleImageExtractionResult> {
  
  console.log(`\n🔍 IMAGE EXTRACTION DEBUG:`);
  console.log(`   Source: ${chunk.sourceFile}`);
  console.log(`   Pages: ${chunk.pageRange.start}-${chunk.pageRange.end}`);
  console.log(`   Units in chunk: ${chunkData?.units?.length || 0}`);
  console.log(`   PDF converter: pdf2pic (GraphicsMagick)`);
  
  const hasUnits = chunkData?.units && chunkData.units.length > 0;
  const isProjectBriefing = chunk.sourceFile.toLowerCase().includes('briefing') || 
                            chunk.sourceFile.toLowerCase().includes('brochure');
  
  console.log(`   hasUnits: ${hasUnits}`);
  console.log(`   isProjectBriefing: ${isProjectBriefing}`);
  
  // Skip if no useful content
  if (!hasUnits && !isProjectBriefing) {
    console.log(`   ⏭️ Skipping (no units and not project briefing)`);
    return {
      success: true,
      extractedImages: [],
      floorPlanImages: [],
      projectImages: [],
    };
  }

  console.log(`   ✅ Proceeding with image extraction...`);

  try {
    console.log(`\n🖼️  Extracting images from chunk (pages ${chunk.pageRange.start}-${chunk.pageRange.end})...`);
    
    // Create images directory
    const imagesDir = join(outputDir, 'images');
    if (!existsSync(imagesDir)) {
      mkdirSync(imagesDir, { recursive: true });
    }

    // Generate unique filename prefix to avoid race conditions in parallel processing
    // Format: job_{jobId}_chunk_{chunkIndex}_pages_{start}-{end}_{random}
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const filenamePrefix = [
      jobId ? `job_${jobId}` : `ts_${Date.now()}`,
      chunkIndex !== undefined ? `chunk_${chunkIndex}` : null,
      `pages_${chunk.pageRange.start}-${chunk.pageRange.end}`,
      randomSuffix
    ].filter(Boolean).join('_');

    console.log(`   📝 Using filename prefix: ${filenamePrefix}`);

    // Convert ALL pages in this chunk to images using unified converter
    const imagePaths = await pdfToImages(chunk.buffer, imagesDir, filenamePrefix);

    console.log(`   ✓ Converted ${imagePaths.length} pages to images`);

    const extractedImages: SimpleImageExtractionResult['extractedImages'] = [];
    const floorPlanImages: string[] = [];
    const projectImages: string[] = [];

    // Process each converted image and upload to R2
    for (let i = 0; i < imagePaths.length; i++) {
      const pageNumber = chunk.pageRange.start + i;
      const localImagePath = imagePaths[i];
      
      // Categorize image
      const category = hasUnits ? 'floor_plan' : 'project';
      
      // Upload to R2 temp storage if jobId provided
      let finalImagePath = localImagePath;
      if (jobId) {
        try {
          const r2Url = await uploadFileToR2Temp(localImagePath, jobId);
          finalImagePath = r2Url;
          console.log(`   ✓ Page ${pageNumber} uploaded to R2: ${r2Url}`);
        } catch (error) {
          console.error(`   ✗ Failed to upload to R2, using local path:`, error);
          // Fallback to local path if R2 upload fails
        }
      }
      
      extractedImages.push({
        pageNumber,
        imagePath: finalImagePath,
        category,
      });
      
      if (category === 'floor_plan') {
        floorPlanImages.push(finalImagePath);
      } else {
        projectImages.push(finalImagePath);
      }
      
      console.log(`   ✓ Page ${pageNumber}: ${category}`);
    }

    console.log(`\n📊 Extracted ${extractedImages.length} images (${floorPlanImages.length} floor plans, ${projectImages.length} project)`);

    return {
      success: true,
      extractedImages,
      floorPlanImages,
      projectImages,
    };

  } catch (error) {
    console.error(`   ✗ Image extraction failed:`, error);
    return {
      success: false,
      extractedImages: [],
      floorPlanImages: [],
      projectImages: [],
    };
  }
}
