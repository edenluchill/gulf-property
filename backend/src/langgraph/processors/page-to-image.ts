/**
 * Page to Image Converter Module
 * 
 * Converts PDF pages to images for storage and display
 * 
 * Strategy: Convert entire pages to images (simplified approach)
 * Uses existing pdf-img-convert utility (no additional canvas setup needed!)
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { PageImageAnalysis, ImageInfo } from './image-analyzer';

// Use pdf2pic for PDF to image conversion
import { fromBuffer } from 'pdf2pic';

export interface PageToImageConfig {
  pdfBuffer: Buffer;
  pageNumbers: number[];  // Which pages to convert (1-indexed)
  outputDir: string;
  width?: number;         // Image width (default: 1240, ~150 DPI)
  height?: number;        // Image height (default: 1754, ~150 DPI)
}

export interface PageImageResult {
  pageNumber: number;
  imagePath: string;
  success: boolean;
  error?: string;
}

/**
 * Convert multiple PDF pages to images
 */
export async function convertPagesToImages(
  config: PageToImageConfig
): Promise<PageImageResult[]> {
  const { pdfBuffer, pageNumbers, outputDir, width = 1240, height = 1754 } = config;
  const results: PageImageResult[] = [];

  // Ensure output directory exists
  const imagesDir = join(outputDir, 'images');
  if (!existsSync(imagesDir)) {
    mkdirSync(imagesDir, { recursive: true });
  }

  console.log(`\n📸 Converting ${pageNumbers.length} pages to images (${width}x${height})...`);

  try {
    // Configure pdf2pic
    const options = {
      density: 150,
      saveFilename: 'page',
      savePath: imagesDir,
      format: 'png',
      width,
      height
    };

    const convert = fromBuffer(pdfBuffer, options);

    // Convert each requested page
    for (const pageNumber of pageNumbers) {
      try {
        const result = await convert(pageNumber, { responseType: 'image' });
        
        if (result && result.path) {
          console.log(`   ✓ Saved: page_${pageNumber}.png`);
          results.push({
            pageNumber,
            imagePath: result.path,
            success: true,
          });
        } else {
          console.warn(`   ⚠️ Page ${pageNumber} returned no result`);
          results.push({
            pageNumber,
            imagePath: '',
            success: false,
            error: 'No result from conversion',
          });
        }
      } catch (error) {
        console.error(`   ✗ Failed page ${pageNumber}:`, error);
        results.push({
          pageNumber,
          imagePath: '',
          success: false,
          error: String(error),
        });
      }
    }

    console.log(`\n✅ Converted ${results.filter(r => r.success).length}/${pageNumbers.length} pages\n`);

  } catch (error) {
    console.error('❌ Failed to convert PDF:', error);
    pageNumbers.forEach(pageNumber => {
      results.push({
        pageNumber,
        imagePath: '',
        success: false,
        error: String(error),
      });
    });
  }

  return results;
}

/**
 * Convert pages based on image analysis results
 * Only converts pages that have important images
 */
export async function convertImportantPages(
  pdfBuffer: Buffer,
  pageAnalyses: PageImageAnalysis[],
  outputDir: string
): Promise<Map<number, string>> {
  // Filter pages that should be saved
  const importantPages = pageAnalyses
    .filter(analysis => analysis.hasImages)
    .map(analysis => analysis.pageNumber);

  if (importantPages.length === 0) {
    console.log('⚠️  No important pages found to convert to images');
    return new Map();
  }

  console.log(`\n📸 Found ${importantPages.length} pages with important images`);

  // Convert pages
  const results = await convertPagesToImages({
    pdfBuffer,
    pageNumbers: importantPages,
    outputDir,
    width: 1240,   // ~150 DPI
    height: 1754,  // ~150 DPI
  });

  // Build map of page number → image path
  const imageMap = new Map<number, string>();
  results.forEach(result => {
    if (result.success) {
      imageMap.set(result.pageNumber, result.imagePath);
    }
  });

  return imageMap;
}

/**
 * Update image info with actual saved paths
 */
export function updateImagePaths(
  images: ImageInfo[],
  pageImageMap: Map<number, string>
): ImageInfo[] {
  return images.map(img => {
    const savedPath = pageImageMap.get(img.pageNumber);
    if (savedPath) {
      return {
        ...img,
        imagePath: savedPath,
      };
    }
    return img;
  });
}
