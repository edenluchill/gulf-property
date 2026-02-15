/**
 * PDF to Image Conversion Utilities
 *
 * Priority order:
 * 1. Poppler (pdftoppm) - Best memory efficiency for large JPEG2000 PDFs
 * 2. MuPDF with PDF splitting - Split large PDFs into chunks first to avoid memory issues
 * 3. pdf2pic - Requires GraphicsMagick/ImageMagick
 *
 * Converts PDF pages to high-resolution images for AI processing
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';
import { PDFDocument } from 'pdf-lib';
import { pdfToImagesMupdf, getPdfPageCountMupdf, pdfPageToImageMupdf } from './converter-mupdf';
import { pdfToImagesPoppler, isPopplerAvailable, getPdfPageCountPoppler } from './converter-poppler';

// Constants for memory-efficient processing
const CHUNK_SIZE_PAGES = 10;  // Split PDF into 10-page chunks
const LARGE_PDF_THRESHOLD_MB = 50;  // PDFs larger than 50MB use chunked processing

// Cache Poppler availability check
let popplerAvailable: boolean | null = null;

async function checkPopplerAvailable(): Promise<boolean> {
  if (popplerAvailable === null) {
    popplerAvailable = await isPopplerAvailable();
    if (popplerAvailable) {
      console.log('✓ Poppler (pdftoppm) detected - using for PDF conversion');
    } else {
      console.log('⚠ Poppler not found, will use MuPDF/pdf2pic fallback');
      console.log('  Install Poppler for better memory handling: choco install poppler');
    }
  }
  return popplerAvailable;
}

// Fallback to pdf2pic if other methods fail
// @ts-ignore - pdf2pic has no type declarations
let fromBuffer: any;
try {
  fromBuffer = require('pdf2pic').fromBuffer;
} catch (e) {
  console.log('pdf2pic not available');
}

/**
 * Split a large PDF into smaller chunks using pdf-lib
 * This is memory efficient because pdf-lib streams pages
 *
 * @param pdfBuffer - Original PDF buffer
 * @param outputDir - Directory to save chunk PDFs
 * @param pagesPerChunk - Number of pages per chunk (default: 10)
 * @returns Array of { chunkPath, startPage, endPage }
 */
async function splitPdfIntoChunks(
  pdfBuffer: Buffer,
  outputDir: string,
  pagesPerChunk: number = CHUNK_SIZE_PAGES
): Promise<Array<{ chunkPath: string; startPage: number; endPage: number }>> {
  const chunks: Array<{ chunkPath: string; startPage: number; endPage: number }> = [];

  try {
    // Load source PDF
    const srcDoc = await PDFDocument.load(pdfBuffer, {
      ignoreEncryption: true,
      updateMetadata: false
    });
    const totalPages = srcDoc.getPageCount();

    console.log(`   📄 Splitting ${totalPages} pages into ${Math.ceil(totalPages / pagesPerChunk)} chunks (${pagesPerChunk} pages each)...`);

    // Create chunks
    for (let startPage = 0; startPage < totalPages; startPage += pagesPerChunk) {
      const endPage = Math.min(startPage + pagesPerChunk, totalPages);
      const chunkNum = Math.floor(startPage / pagesPerChunk) + 1;

      // Create new PDF for this chunk
      const chunkDoc = await PDFDocument.create();

      // Copy pages from source to chunk
      const pageIndices = [];
      for (let i = startPage; i < endPage; i++) {
        pageIndices.push(i);
      }

      const copiedPages = await chunkDoc.copyPages(srcDoc, pageIndices);
      copiedPages.forEach(page => chunkDoc.addPage(page));

      // Save chunk to file
      const chunkPath = join(outputDir, `chunk_${chunkNum}.pdf`);
      const chunkBytes = await chunkDoc.save();
      writeFileSync(chunkPath, chunkBytes);

      chunks.push({
        chunkPath,
        startPage: startPage + 1,  // 1-indexed
        endPage
      });

      console.log(`   ✓ Chunk ${chunkNum}: pages ${startPage + 1}-${endPage} (${(chunkBytes.length / 1024 / 1024).toFixed(1)}MB)`);
    }

    return chunks;

  } catch (error: any) {
    console.error('Error splitting PDF:', error.message);
    throw error;
  }
}

/**
 * Convert PDF to images using chunked processing for memory efficiency
 *
 * Strategy:
 * 1. Split large PDF into small chunks (10 pages each)
 * 2. Process each chunk separately, releasing memory between chunks
 * 3. Combine all image paths at the end
 */
async function pdfToImagesChunked(
  pdfBuffer: Buffer,
  outputDir: string,
  prefix: string = 'page'
): Promise<string[]> {
  const tempChunkDir = join(outputDir, '_pdf_chunks');
  mkdirSync(tempChunkDir, { recursive: true });

  const allImagePaths: string[] = [];

  try {
    // Split PDF into chunks
    const chunks = await splitPdfIntoChunks(pdfBuffer, tempChunkDir, CHUNK_SIZE_PAGES);

    console.log(`   🔄 Processing ${chunks.length} PDF chunks...`);

    // Process each chunk separately
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkNum = i + 1;

      console.log(`   📦 Processing chunk ${chunkNum}/${chunks.length} (pages ${chunk.startPage}-${chunk.endPage})...`);

      try {
        // Read chunk PDF
        const chunkBuffer = readFileSync(chunk.chunkPath);

        // Convert chunk to images
        const chunkImagePaths = await convertSingleChunk(
          chunkBuffer,
          outputDir,
          prefix,
          chunk.startPage
        );

        allImagePaths.push(...chunkImagePaths);

        // Clean up chunk PDF immediately to free disk space
        unlinkSync(chunk.chunkPath);

        // Force garbage collection hint (won't work without --expose-gc flag, but doesn't hurt)
        if (global.gc) {
          global.gc();
        }

        console.log(`   ✅ Chunk ${chunkNum} complete: ${chunkImagePaths.length} images`);

      } catch (chunkError: any) {
        console.error(`   ❌ Error processing chunk ${chunkNum}: ${chunkError.message}`);
        // Continue with next chunk - don't fail entire process
      }
    }

    // Clean up temp directory
    rmSync(tempChunkDir, { recursive: true, force: true });

    console.log(`   ✅ Chunked processing complete: ${allImagePaths.length} total images`);
    return allImagePaths;

  } catch (error: any) {
    // Clean up on error
    rmSync(tempChunkDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Convert a single PDF chunk to images
 */
async function convertSingleChunk(
  chunkBuffer: Buffer,
  outputDir: string,
  prefix: string,
  startPageNumber: number
): Promise<string[]> {
  const chunkTempDir = join(outputDir, `_chunk_${startPageNumber}_temp`);
  mkdirSync(chunkTempDir, { recursive: true });

  try {
    // Try MuPDF for the chunk (smaller chunks should work fine)
    const chunkImages = await pdfToImagesMupdf(chunkBuffer, chunkTempDir, {
      dpi: 96,
      format: 'jpeg',
      quality: 80,
      prefix: 'p',
    });

    // Rename images to have correct page numbers
    const finalPaths: string[] = [];
    for (let i = 0; i < chunkImages.length; i++) {
      const originalPath = chunkImages[i];
      const actualPageNum = startPageNumber + i;
      const newFilename = `${prefix}.${actualPageNum}.jpeg`;
      const newPath = join(outputDir, newFilename);

      // Move file to final location with correct name
      const imageData = readFileSync(originalPath);
      writeFileSync(newPath, imageData);
      unlinkSync(originalPath);

      finalPaths.push(newPath);
    }

    // Clean up chunk temp directory
    rmSync(chunkTempDir, { recursive: true, force: true });

    return finalPaths;

  } catch (error: any) {
    rmSync(chunkTempDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Convert PDF to high-resolution images
 *
 * Strategy:
 * 1. Poppler (pdftoppm) - Best for large JPEG2000 PDFs, excellent memory management
 * 2. For large PDFs (>50MB): Split into chunks first, then process with MuPDF
 * 3. For small PDFs: Direct MuPDF processing
 * 4. pdf2pic - Last resort, requires GraphicsMagick
 *
 * @param pdfBuffer - PDF file as Buffer
 * @param outputDir - Directory to save images
 * @param filenamePrefix - Optional unique prefix for filenames (default: 'page')
 * @returns Array of image file paths
 */
export async function pdfToImages(
  pdfBuffer: Buffer,
  outputDir: string,
  filenamePrefix?: string
): Promise<string[]> {
  const prefix = filenamePrefix || 'page';
  const pdfSizeMB = pdfBuffer.length / 1024 / 1024;

  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  console.log(`📄 PDF size: ${pdfSizeMB.toFixed(1)}MB`);

  // ============ Try Poppler first (best for large JPEG2000) ============
  if (await checkPopplerAvailable()) {
    try {
      console.log(`Converting PDF to images using Poppler...`);

      const imagePaths = await pdfToImagesPoppler(pdfBuffer, outputDir, {
        dpi: 96,
        format: 'jpeg',
        quality: 80,
        prefix,
      });

      if (imagePaths.length > 0) {
        console.log(`✅ Poppler conversion successful: ${imagePaths.length} pages`);
        return imagePaths;
      }

      console.warn('Poppler returned 0 pages, trying chunked MuPDF...');
    } catch (popplerError: any) {
      console.warn(`Poppler conversion failed: ${popplerError.message}`);
      console.log('Trying chunked MuPDF fallback...');
    }
  }

  // ============ For large PDFs, use chunked processing ============
  if (pdfSizeMB >= LARGE_PDF_THRESHOLD_MB) {
    console.log(`📦 Large PDF detected (${pdfSizeMB.toFixed(1)}MB > ${LARGE_PDF_THRESHOLD_MB}MB threshold)`);
    console.log(`   Using memory-efficient chunked processing...`);

    try {
      const imagePaths = await pdfToImagesChunked(pdfBuffer, outputDir, prefix);

      if (imagePaths.length > 0) {
        console.log(`✅ Chunked MuPDF conversion successful: ${imagePaths.length} pages`);
        return imagePaths;
      }

      console.warn('Chunked processing returned 0 pages, trying direct MuPDF...');
    } catch (chunkedError: any) {
      console.warn(`Chunked processing failed: ${chunkedError.message}`);
      console.log('Trying direct MuPDF as fallback...');
    }
  }

  // ============ Try direct MuPDF for smaller PDFs ============
  try {
    console.log(`Converting PDF to images using MuPDF (direct)...`);

    const imagePaths = await pdfToImagesMupdf(pdfBuffer, outputDir, {
      dpi: 96,         // Lower DPI to reduce memory usage
      format: 'jpeg',
      quality: 80,
      prefix,
    });

    if (imagePaths.length > 0) {
      console.log(`✅ MuPDF conversion successful: ${imagePaths.length} pages`);
      return imagePaths;
    }

    console.warn('MuPDF returned 0 pages, trying pdf2pic...');
  } catch (mupdfError: any) {
    console.warn(`MuPDF conversion failed: ${mupdfError.message}`);

    // If direct MuPDF failed and we haven't tried chunked yet, try it now
    if (pdfSizeMB < LARGE_PDF_THRESHOLD_MB) {
      console.log('Trying chunked processing as fallback...');
      try {
        const imagePaths = await pdfToImagesChunked(pdfBuffer, outputDir, prefix);
        if (imagePaths.length > 0) {
          console.log(`✅ Chunked MuPDF fallback successful: ${imagePaths.length} pages`);
          return imagePaths;
        }
      } catch (chunkedError: any) {
        console.warn(`Chunked fallback also failed: ${chunkedError.message}`);
      }
    }

    console.log('Trying pdf2pic fallback...');
  }

  // ============ Fallback to pdf2pic (requires GraphicsMagick) ============
  if (!fromBuffer) {
    throw new Error('PDF conversion failed: All converters failed (Poppler, MuPDF chunked, MuPDF direct, pdf2pic not available)');
  }

  try {
    console.log(`Converting PDF using pdf2pic (GraphicsMagick)...`);

    const options = {
      density: 150,
      saveFilename: prefix,
      savePath: outputDir,
      format: "png",
      width: 1920,
      height: 1080
    };

    const convert = fromBuffer(pdfBuffer, options);
    const imagePaths: string[] = [];
    let pageNum = 1;

    while (true) {
      try {
        const result = await convert(pageNum, { responseType: "image" });
        if (!result || !result.path) break;

        imagePaths.push(result.path);
        if (pageNum % 10 === 0) {
          console.log(`   ✓ Converted ${pageNum} pages...`);
        }
        pageNum++;
      } catch (e: any) {
        if (pageNum === 1) {
          console.error(`pdf2pic failed on first page: ${e.message}`);
          console.error('Please install GraphicsMagick: choco install graphicsmagick');
        }
        break;
      }
    }

    console.log(`Converted ${imagePaths.length} pages`);
    return imagePaths;

  } catch (error: any) {
    console.error('Error converting PDF to images:', error);
    throw new Error(`PDF conversion failed: ${error.message}`);
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
    return await pdfPageToImageMupdf(pdfBuffer, pageNumber, outputPath, {
      dpi: 150,
      format: 'jpeg',
      quality: 85,
    });
  } catch (error) {
    console.error(`Error converting page ${pageNumber}:`, error);
    throw error;
  }
}

/**
 * Get PDF page count (fast, no rendering needed)
 */
export async function getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
  // Try Poppler first (pdfinfo)
  if (await checkPopplerAvailable()) {
    try {
      return await getPdfPageCountPoppler(pdfBuffer);
    } catch (e) {
      // Fall through to MuPDF
    }
  }

  // Fallback to MuPDF
  return getPdfPageCountMupdf(pdfBuffer);
}
