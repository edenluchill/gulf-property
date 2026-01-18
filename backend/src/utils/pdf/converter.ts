/**
 * PDF to Image Conversion Utilities
 * 
 * Uses pdf2pic (GraphicsMagick/ImageMagick based, actively maintained)
 * Converts PDF pages to high-resolution images for AI processing
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
// @ts-ignore - pdf2pic has no type declarations
import { fromBuffer } from 'pdf2pic';

/**
 * Convert PDF to high-resolution images (300 DPI)
 * 
 * @param pdfBuffer - PDF file as Buffer
 * @param outputDir - Directory to save images
 * @param filenamePrefix - Optional unique prefix for filenames (default: auto-generated)
 * @returns Array of image file paths
 */
export async function pdfToImages(
  pdfBuffer: Buffer,
  outputDir: string,
  filenamePrefix?: string
): Promise<string[]> {
  try {
    // Ensure output directory exists
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // Generate unique prefix if not provided
    // Use timestamp + random string to avoid race conditions in parallel processing
    const prefix = filenamePrefix || `page_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    console.log(`Converting PDF to images at 300 DPI (prefix: ${prefix})...`);

    // ⚡ PERFORMANCE: Reduced from 300 DPI to 150 DPI for 50% faster conversion
    // Still high quality for AI analysis, but much faster
    const options = {
      density: 150,  // Was: 300
      saveFilename: prefix,
      savePath: outputDir,
      format: "png",
      width: 1240,   // Was: 2480 (half size)
      height: 1754   // Was: 3508 (half size)
    };

    const convert = fromBuffer(pdfBuffer, options);
    
    // Convert all pages
    const imagePaths: string[] = [];
    let pageNum = 1;
    
    // pdf2pic returns null when no more pages
    while (true) {
      try {
        const result = await convert(pageNum, { responseType: "image" });
        if (!result || !result.path) break;
        
        imagePaths.push(result.path);
        console.log(`Saved page ${pageNum} to ${result.path}`);
        pageNum++;
      } catch (e) {
        // No more pages
        break;
      }
    }

    console.log(`Converted ${imagePaths.length} pages`);
    return imagePaths;
  } catch (error) {
    console.error('Error converting PDF to images:', error);
    throw new Error(`PDF conversion failed: ${error}`);
  }
}

/**
 * Convert a single PDF page to image
 * 
 * @param pdfBuffer - PDF file as Buffer
 * @param pageNumber - Page number (1-indexed)
 * @param outputPath - Output file path
 */
export async function pdfPageToImage(
  pdfBuffer: Buffer,
  pageNumber: number,
  outputPath: string
): Promise<string> {
  try {
    const outputDir = join(outputPath, '..');
    const options = {
      density: 300,
      saveFilename: `page_${pageNumber}`,
      savePath: outputDir,
      format: "png",
      width: 2480,
      height: 3508
    };

    const convert = fromBuffer(pdfBuffer, options);
    const result = await convert(pageNumber, { responseType: "image" });
    
    if (!result || !result.path) {
      throw new Error(`Page ${pageNumber} not found`);
    }

    console.log(`Saved page ${pageNumber} to ${result.path}`);
    return result.path;
  } catch (error) {
    console.error(`Error converting page ${pageNumber}:`, error);
    throw error;
  }
}

/**
 * Get PDF page count
 * Note: pdf2pic doesn't have a built-in page count method
 * This is a workaround that tries to convert pages until it fails
 */
export async function getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
  try {
    const tmpDir = join(process.cwd(), 'uploads', 'tmp-count');
    if (!existsSync(tmpDir)) {
      mkdirSync(tmpDir, { recursive: true });
    }

    const options = {
      density: 72, // Low quality for speed
      saveFilename: "count",
      savePath: tmpDir,
      format: "png"
    };

    const convert = fromBuffer(pdfBuffer, options);
    let count = 0;
    
    // Try converting pages until we fail
    for (let i = 1; i <= 1000; i++) { // Max 1000 pages
      try {
        const result = await convert(i, { responseType: "image" });
        if (!result || !result.path) break;
        count = i;
      } catch (e) {
        break;
      }
    }

    return count;
  } catch (error) {
    console.error('Error getting PDF page count:', error);
    throw error;
  }
}
