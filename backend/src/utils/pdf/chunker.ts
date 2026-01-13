/**
 * PDF Chunking Utilities
 * 
 * Split large PDFs into smaller chunks for batch processing
 * Bypasses Gemini's ~20MB file size limit
 */

import { PDFDocument } from 'pdf-lib';

export interface PdfChunk {
  chunkIndex: number;
  totalChunks: number;
  buffer: Buffer;
  pageRange: { start: number; end: number };
  sizeMB: number;
}

/**
 * Split PDF into chunks by page count (simple and predictable)
 * 
 * @param pdfBuffer - Original PDF buffer
 * @param pagesPerChunk - Pages per chunk (default: 5 for optimal processing)
 * @returns Array of PDF chunks
 */
export async function splitPdfIntoChunks(
  pdfBuffer: Buffer,
  pagesPerChunk: number = 5
): Promise<PdfChunk[]> {
  try {
    console.log(`\n📄 Splitting PDF into ${pagesPerChunk}-page chunks...`);
    
    // Load the PDF
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const totalPages = pdfDoc.getPageCount();
    
    console.log(`   Total pages: ${totalPages}`);
    console.log(`   Pages per chunk: ${pagesPerChunk}`);
    console.log(`   Estimated chunks: ${Math.ceil(totalPages / pagesPerChunk)}`);

    const chunks: PdfChunk[] = [];

    // Split by fixed page count
    for (let startPage = 0; startPage < totalPages; startPage += pagesPerChunk) {
      const endPage = Math.min(startPage + pagesPerChunk, totalPages);
      
      // Create chunk PDF
      const chunkPdf = await PDFDocument.create();
      
      // Copy pages to chunk
      const pagesToCopy = [];
      for (let i = startPage; i < endPage; i++) {
        pagesToCopy.push(i);
      }
      
      const copiedPages = await chunkPdf.copyPages(pdfDoc, pagesToCopy);
      copiedPages.forEach(page => chunkPdf.addPage(page));

      // Serialize chunk
      const chunkBytes = await chunkPdf.save();
      const chunkBuffer = Buffer.from(chunkBytes);
      const chunkSizeMB = chunkBuffer.length / 1024 / 1024;

      chunks.push({
        chunkIndex: chunks.length,
        totalChunks: 0, // Will update later
        buffer: chunkBuffer,
        pageRange: { start: startPage + 1, end: endPage },
        sizeMB: chunkSizeMB,
      });

      console.log(`   ✓ Chunk ${chunks.length}: 页 ${startPage + 1}-${endPage} (${chunkSizeMB.toFixed(2)} MB, ${endPage - startPage} 页)`);
    }

    // Update totalChunks for all chunks
    chunks.forEach(chunk => {
      chunk.totalChunks = chunks.length;
    });

    console.log(`\n   📦 Split into ${chunks.length} chunks`);
    console.log(`   ✅ Ready for batch processing\n`);

    return chunks;

  } catch (error) {
    console.error('Error chunking PDF:', error);
    throw new Error(`Failed to split PDF: ${error}`);
  }
}

/**
 * Check if PDF needs chunking (always chunk if > 10 pages for better processing)
 */
export async function needsChunking(pdfBuffer: Buffer): Promise<boolean> {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const totalPages = pdfDoc.getPageCount();
    // Chunk if more than 10 pages
    return totalPages > 10;
  } catch {
    return false;
  }
}

/**
 * Get estimated chunk count
 */
export async function estimateChunkCount(
  pdfBuffer: Buffer,
  maxPages: number = 50
): Promise<number> {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const totalPages = pdfDoc.getPageCount();
    return Math.ceil(totalPages / maxPages);
  } catch (error) {
    console.error('Error estimating chunks:', error);
    return 1;
  }
}
