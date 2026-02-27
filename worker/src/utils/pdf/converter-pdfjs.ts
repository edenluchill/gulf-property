/**
 * PDF to Image Conversion using PDF.js (Pure JavaScript)
 *
 * No external dependencies (GraphicsMagick, Ghostscript, etc.)
 * Uses Mozilla's PDF.js for parsing and canvas for rendering
 */

import { createCanvas, Canvas } from 'canvas';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// PDF.js setup for Node.js
// @ts-ignore - pdfjs-dist types are complex
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Properly disable worker for Node.js
// Setting to empty string doesn't work - we need to use isEvalSupported: false
// and the worker will be disabled automatically in Node.js environment

/**
 * Convert PDF buffer to high-resolution images
 *
 * @param pdfBuffer - PDF file as Buffer
 * @param outputDir - Directory to save images
 * @param options - Conversion options
 * @returns Array of image file paths
 */
export async function pdfToImagesPdfjs(
  pdfBuffer: Buffer,
  outputDir: string,
  options: {
    scale?: number;      // Scale factor (default: 2.0 for ~150 DPI)
    format?: 'png' | 'jpeg';
    quality?: number;    // JPEG quality (0-1)
    prefix?: string;     // Filename prefix
  } = {}
): Promise<string[]> {
  const {
    scale = 2.0,         // 2x scale ≈ 144-150 DPI (good balance of quality/speed)
    format = 'jpeg',
    quality = 0.85,
    prefix = 'page'
  } = options;

  try {
    // Ensure output directory exists
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    console.log(`Converting PDF to images using PDF.js (scale: ${scale}x, format: ${format})...`);
    const startTime = Date.now();

    // Load PDF document with Node.js-specific options
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
      disableFontFace: true,  // Required for Node.js
      isEvalSupported: false,  // Disable eval for security
      // @ts-ignore - disableWorker exists but not in types
      disableWorker: true,  // Disable web worker for Node.js
    });

    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;

    console.log(`   PDF loaded: ${numPages} pages`);

    const imagePaths: string[] = [];

    // Convert each page
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      try {
        const page = await pdfDoc.getPage(pageNum);

        // Get page dimensions
        const viewport = page.getViewport({ scale });

        // Create canvas
        const canvas = createCanvas(viewport.width, viewport.height) as Canvas;
        const context = canvas.getContext('2d');

        // Render page to canvas
        // @ts-ignore - pdfjs-dist types are complex in Node.js environment
        await page.render({ canvasContext: context, viewport }).promise;

        // Save as image
        const filename = `${prefix}.${pageNum}.${format}`;
        const outputPath = join(outputDir, filename);

        let buffer: Buffer;
        if (format === 'jpeg') {
          buffer = canvas.toBuffer('image/jpeg', { quality });
        } else {
          buffer = canvas.toBuffer('image/png');
        }

        writeFileSync(outputPath, buffer);
        imagePaths.push(outputPath);

        // Progress logging (every 10 pages or last page)
        if (pageNum % 10 === 0 || pageNum === numPages) {
          console.log(`   ✓ Converted ${pageNum}/${numPages} pages`);
        }

        // Clean up page resources
        page.cleanup();

      } catch (pageError: any) {
        console.error(`   ❌ Failed to convert page ${pageNum}: ${pageError.message}`);
        // Continue with next page
      }
    }

    const totalTime = Date.now() - startTime;
    console.log(`   ✅ Converted ${imagePaths.length}/${numPages} pages in ${(totalTime / 1000).toFixed(2)}s`);

    return imagePaths;

  } catch (error: any) {
    console.error('Error converting PDF to images:', error);
    throw new Error(`PDF conversion failed: ${error.message}`);
  }
}

/**
 * Get PDF page count without full conversion
 */
export async function getPdfPageCountPdfjs(pdfBuffer: Buffer): Promise<number> {
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      isEvalSupported: false,
      // @ts-ignore - disableWorker exists but not in types
      disableWorker: true,
    });

    const pdfDoc = await loadingTask.promise;
    return pdfDoc.numPages;
  } catch (error: any) {
    console.error('Error getting PDF page count:', error);
    throw error;
  }
}

/**
 * Convert a single PDF page to image
 */
export async function pdfPageToImagePdfjs(
  pdfBuffer: Buffer,
  pageNumber: number,
  outputPath: string,
  options: {
    scale?: number;
    format?: 'png' | 'jpeg';
    quality?: number;
  } = {}
): Promise<string> {
  const {
    scale = 2.0,
    format = 'jpeg',
    quality = 0.85,
  } = options;

  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
      disableFontFace: true,
      isEvalSupported: false,
      // @ts-ignore - disableWorker exists but not in types
      disableWorker: true,
    });

    const pdfDoc = await loadingTask.promise;

    if (pageNumber < 1 || pageNumber > pdfDoc.numPages) {
      throw new Error(`Page ${pageNumber} out of range (1-${pdfDoc.numPages})`);
    }

    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    const canvas = createCanvas(viewport.width, viewport.height) as Canvas;
    const context = canvas.getContext('2d');

    // @ts-ignore - pdfjs-dist types are complex in Node.js environment
    await page.render({ canvasContext: context, viewport }).promise;

    // Ensure directory exists
    const dir = join(outputPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    let buffer: Buffer;
    if (format === 'jpeg') {
      buffer = canvas.toBuffer('image/jpeg', { quality });
    } else {
      buffer = canvas.toBuffer('image/png');
    }

    writeFileSync(outputPath, buffer);
    page.cleanup();

    return outputPath;
  } catch (error: any) {
    console.error(`Error converting page ${pageNumber}:`, error);
    throw error;
  }
}
