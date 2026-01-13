/**
 * PDF to Image Conversion Utilities
 * 
 * Converts PDF pages to high-resolution images for AI processing
 * 
 * Note: Requires pdf-img-convert which depends on canvas (native module).
 * If canvas is not available (Windows build issues), functions will throw descriptive errors.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Lazy load pdf-img-convert to handle missing canvas gracefully
let pdfImgConvert: any = null;
let canvasError: Error | null = null;

try {
  pdfImgConvert = require('pdf-img-convert');
} catch (error) {
  canvasError = error as Error;
  console.warn('⚠️ pdf-img-convert not available (canvas module missing)');
  console.warn('   LangGraph PDF processing will not work until canvas is installed');
  console.warn('   See LANGGRAPH_STATUS.md for installation instructions');
}

function checkPdfConverter() {
  if (!pdfImgConvert) {
    throw new Error(
      'PDF converter not available. The canvas native module failed to build.\n' +
      'This is a known issue on Windows. Solutions:\n' +
      '1. Install Visual Studio Build Tools and rebuild canvas\n' +
      '2. Use WSL (Windows Subsystem for Linux)\n' +
      '3. Use Docker for development\n' +
      'See: https://github.com/Automattic/node-canvas#compiling'
    );
  }
}

/**
 * Convert PDF to high-resolution images (300 DPI)
 * 
 * @param pdfBuffer - PDF file as Buffer
 * @param outputDir - Directory to save images
 * @returns Array of image file paths
 */
export async function pdfToImages(
  pdfBuffer: Buffer,
  outputDir: string
): Promise<string[]> {
  checkPdfConverter();
  
  try {
    // Ensure output directory exists
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    console.log('Converting PDF to images at 300 DPI...');

    // Convert PDF to PNG images at 300 DPI for high quality
    const images = await pdfImgConvert(pdfBuffer, {
      outputType: 'png',
      width: 2480, // ~300 DPI for A4 width (8.27 inches)
      height: 3508, // ~300 DPI for A4 height (11.69 inches)
    }) as Uint8Array[];

    console.log(`Converted ${images.length} pages`);

    // Save images to disk
    const imagePaths: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const imagePath = join(outputDir, `page_${i + 1}.png`);
      writeFileSync(imagePath, images[i]);
      imagePaths.push(imagePath);
      console.log(`Saved page ${i + 1} to ${imagePath}`);
    }

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
  checkPdfConverter();
  
  try {
    const images = await pdfImgConvert(pdfBuffer, {
      outputType: 'png',
      width: 2480,
      height: 3508,
      pagesToConvert: [pageNumber],
    }) as Uint8Array[];

    if (images.length === 0) {
      throw new Error(`Page ${pageNumber} not found`);
    }

    writeFileSync(outputPath, images[0]);
    console.log(`Saved page ${pageNumber} to ${outputPath}`);

    return outputPath;
  } catch (error) {
    console.error(`Error converting page ${pageNumber}:`, error);
    throw error;
  }
}

/**
 * Get PDF page count
 */
export async function getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
  checkPdfConverter();
  
  try {
    // Convert with minimal quality to just get count
    const images = await pdfImgConvert(pdfBuffer, {
      outputType: 'png',
      width: 100, // Small size just to count pages
    }) as Uint8Array[];

    return images.length;
  } catch (error) {
    console.error('Error getting PDF page count:', error);
    throw error;
  }
}
