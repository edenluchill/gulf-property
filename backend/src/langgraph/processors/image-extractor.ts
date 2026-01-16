/**
 * Image Extractor Module
 * 
 * Coordinates image analysis and extraction workflow:
 * 1. Analyze pages to identify image types
 * 2. Convert important pages to images
 * 3. Organize and categorize images
 * 4. Link images to units/facilities
 */

import type { PdfChunk } from '../../utils/pdf/chunker';
import { 
  classifyImageCategory, 
  linkImagesToUnits, 
  shouldSavePageAsImage,
  type PageImageAnalysis,
  type ImageInfo,
  ImageCategory,
} from './image-analyzer';
import { convertImportantPages, updateImagePaths } from './page-to-image';

export interface ImageExtractionResult {
  totalImages: number;
  imagesByCategory: Record<ImageCategory, ImageInfo[]>;
  allImages: ImageInfo[];
  pageAnalyses: PageImageAnalysis[];
}

/**
 * Extract and analyze images from chunk result
 */
export function analyzeChunkImages(
  chunkIndex: number,
  pageRange: { start: number; end: number },
  chunkData: any,
  pageResults?: any[]
): PageImageAnalysis[] {
  const analyses: PageImageAnalysis[] = [];

  // Analyze each page in the chunk
  const numPages = pageRange.end - pageRange.start + 1;
  
  for (let i = 0; i < numPages; i++) {
    const pageNumber = pageRange.start + i;
    const pageResult = pageResults?.[i];
    
    // Get page classification (from existing classifier)
    const pageClassification = pageResult?.classification || 'Unknown';
    
    // Determine if this page has images worth extracting
    const hasFloorPlan = pageClassification.toLowerCase().includes('floorplan');
    const hasRendering = pageClassification.toLowerCase().includes('rendering');
    const hasCover = pageClassification.toLowerCase().includes('cover');
    const hasAmenities = pageClassification.toLowerCase().includes('amenities');
    
    const hasImages = hasFloorPlan || hasRendering || hasCover || hasAmenities;
    
    if (hasImages) {
      // Create image info for this page
      const category = classifyImageCategory(pageClassification, pageResult);
      
      // Create placeholder image info (will be updated with actual path later)
      const imageInfo: ImageInfo = {
        pageNumber,
        imagePath: '',  // Will be filled in after conversion
        category,
        confidence: 0.8,  // Default confidence
      };
      
      // Link to units if available
      const extractedUnits = pageResult?.extractedData?.units || chunkData?.units || [];
      const linkedImages = linkImagesToUnits([imageInfo], extractedUnits);
      
      analyses.push({
        pageNumber,
        hasImages: true,
        images: linkedImages,
        pageClassification,
      });
      
      console.log(`   📸 Page ${pageNumber}: ${pageClassification} → ${category}${linkedImages[0].linkedUnitType ? ` (${linkedImages[0].linkedUnitType})` : ''}`);
    } else {
      analyses.push({
        pageNumber,
        hasImages: false,
        images: [],
        pageClassification,
      });
    }
  }

  return analyses;
}

/**
 * Extract images from a chunk
 */
export async function extractImagesFromChunk(
  chunk: PdfChunk,
  chunkData: any,
  pageResults: any[],
  outputDir: string
): Promise<ImageExtractionResult> {
  console.log(`\n🖼️  Extracting images from chunk (pages ${chunk.pageRange.start}-${chunk.pageRange.end})...`);

  // Step 1: Analyze pages to identify images
  const pageAnalyses = analyzeChunkImages(
    0,  // chunkIndex not needed here
    chunk.pageRange,
    chunkData,
    pageResults
  );

  // Step 2: Convert important pages to images
  const pageImageMap = await convertImportantPages(
    chunk.buffer,
    pageAnalyses,
    outputDir
  );

  // Step 3: Update image paths with actual saved locations
  const allImages: ImageInfo[] = [];
  pageAnalyses.forEach(analysis => {
    if (analysis.hasImages) {
      const updatedImages = updateImagePaths(analysis.images, pageImageMap);
      allImages.push(...updatedImages);
      analysis.images = updatedImages;
    }
  });

  // Step 4: Categorize images
  const imagesByCategory: Record<ImageCategory, ImageInfo[]> = {
    [ImageCategory.FLOOR_PLAN]: [],
    [ImageCategory.UNIT_RENDERING]: [],
    [ImageCategory.PROJECT_EXTERIOR]: [],
    [ImageCategory.PROJECT_ENVIRONMENT]: [],
    [ImageCategory.FACILITY]: [],
    [ImageCategory.LOCATION_MAP]: [],
    [ImageCategory.AMENITY]: [],
    [ImageCategory.COVER]: [],
    [ImageCategory.OTHER]: [],
  };

  allImages.forEach(img => {
    imagesByCategory[img.category].push(img);
  });

  console.log(`\n📊 Image extraction summary:`);
  console.log(`   Total images: ${allImages.length}`);
  Object.entries(imagesByCategory).forEach(([category, images]) => {
    if (images.length > 0) {
      console.log(`   ${category}: ${images.length}`);
    }
  });

  return {
    totalImages: allImages.length,
    imagesByCategory,
    allImages,
    pageAnalyses,
  };
}
