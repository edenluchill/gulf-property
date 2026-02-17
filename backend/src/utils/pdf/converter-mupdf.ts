/**
 * PDF to Image Conversion using MuPDF
 *
 * MuPDF is a lightweight PDF/XPS/EPUB viewer and toolkit.
 * Fully supports JPEG2000, complex fonts, and all PDF features.
 * No external dependencies required.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// Lazy load mupdf (ESM module with top-level await)
// Use Function constructor to prevent TypeScript from transforming import() to require()
let mupdfModule: any = null;

async function getMupdf() {
  if (!mupdfModule) {
    // This trick prevents TS from converting import() to require()
    const dynamicImport = new Function('specifier', 'return import(specifier)');
    mupdfModule = await dynamicImport('mupdf');
  }
  return mupdfModule;
}

/**
 * Convert PDF buffer to high-resolution images using MuPDF
 *
 * @param pdfBuffer - PDF file as Buffer
 * @param outputDir - Directory to save images
 * @param options - Conversion options
 * @returns Array of image file paths
 */
export async function pdfToImagesMupdf(
  pdfBuffer: Buffer,
  outputDir: string,
  options: {
    dpi?: number;         // DPI for rendering (default: 150)
    format?: 'png' | 'jpeg';
    quality?: number;     // JPEG quality (1-100)
    prefix?: string;      // Filename prefix
  } = {}
): Promise<string[]> {
  const {
    dpi = 96,          // ⭐ Lower default DPI to reduce memory (was 150)
    format = 'jpeg',
    quality = 80,
    prefix = 'page'
  } = options;

  try {
    // Ensure output directory exists
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    console.log(`Converting PDF to images using MuPDF (dpi: ${dpi}, format: ${format})...`);
    const startTime = Date.now();

    // Load mupdf dynamically
    const mupdf = await getMupdf();

    // ⭐ 分批处理以避免内存累积（每批20页）
    const BATCH_SIZE = 20;
    const imagePaths: string[] = [];
    const scale = dpi / 72;

    // First, get total page count
    let doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
    const numPages = doc.countPages();
    console.log(`   PDF loaded: ${numPages} pages`);

    // Process in batches to prevent memory exhaustion
    for (let batchStart = 0; batchStart < numPages; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, numPages);

      // ⭐ 每批重新打开文档以释放内存
      if (batchStart > 0) {
        // Force garbage collection hint
        if (global.gc) {
          global.gc();
        }
        doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
      }

      // Process pages in this batch
      for (let pageNum = batchStart; pageNum < batchEnd; pageNum++) {
        const filename = `${prefix}.${pageNum + 1}.${format}`;
        const outputPath = join(outputDir, filename);

        // ⭐ 尝试多种DPI级别（从低到高的尝试顺序）
        const dpiLevels = [scale, scale * 0.66, scale * 0.5, scale * 0.33];  // 100%, 66%, 50%, 33%

        for (const currentScale of dpiLevels) {
          try {
            const page = doc.loadPage(pageNum);

            // Render page to pixmap
            const pixmap = page.toPixmap(
              mupdf.Matrix.scale(currentScale, currentScale),
              mupdf.ColorSpace.DeviceRGB,
              false,  // no alpha
              true    // annots
            );

            let imageData: Uint8Array;
            if (format === 'jpeg') {
              imageData = pixmap.asJPEG(quality);
            } else {
              imageData = pixmap.asPNG();
            }

            writeFileSync(outputPath, imageData);
            imagePaths.push(outputPath);

            if (currentScale !== scale) {
              console.log(`   ⚠️ Page ${pageNum + 1} converted at reduced quality (${Math.round(currentScale / scale * 100)}%)`);
            }
            break;  // 成功，跳出重试循环

          } catch (pageError: any) {
            if (currentScale === dpiLevels[dpiLevels.length - 1]) {
              // 最后一次尝试也失败
              console.error(`   ❌ Failed to convert page ${pageNum + 1}: ${pageError.message}`);
            }
            // 继续尝试更低的DPI
          }
        }
      }

      // Progress logging after each batch
      console.log(`   ✓ Converted ${Math.min(batchEnd, numPages)}/${numPages} pages`);
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
export async function getPdfPageCountMupdf(pdfBuffer: Buffer): Promise<number> {
  try {
    const mupdf = await getMupdf();
    const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
    return doc.countPages();
  } catch (error: any) {
    console.error('Error getting PDF page count:', error);
    throw error;
  }
}

/**
 * Convert a single PDF page to image
 */
export async function pdfPageToImageMupdf(
  pdfBuffer: Buffer,
  pageNumber: number,  // 1-indexed
  outputPath: string,
  options: {
    dpi?: number;
    format?: 'png' | 'jpeg';
    quality?: number;
  } = {}
): Promise<string> {
  const {
    dpi = 150,
    format = 'jpeg',
    quality = 85,
  } = options;

  try {
    const mupdf = await getMupdf();
    const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
    const numPages = doc.countPages();

    if (pageNumber < 1 || pageNumber > numPages) {
      throw new Error(`Page ${pageNumber} out of range (1-${numPages})`);
    }

    // MuPDF uses 0-indexed pages
    const page = doc.loadPage(pageNumber - 1);
    const scale = dpi / 72;

    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceRGB,
      false,
      true
    );

    // Ensure directory exists
    const dir = join(outputPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    let imageData: Uint8Array;
    if (format === 'jpeg') {
      imageData = pixmap.asJPEG(quality);
    } else {
      imageData = pixmap.asPNG();
    }

    writeFileSync(outputPath, imageData);

    return outputPath;
  } catch (error: any) {
    console.error(`Error converting page ${pageNumber}:`, error);
    throw error;
  }
}
