/**
 * PDF Chunking Strategy Module
 * 
 * Handles splitting of PDFs into manageable chunks:
 * - Split multiple PDFs into uniform chunks
 * - Tag chunks with source file information
 * - Calculate total pages and chunks
 */

import { splitPdfIntoChunks, type PdfChunk } from '../../utils/pdf/chunker';

export interface PdfChunkWithSource extends PdfChunk {
  sourceFile: string;
}

export interface ChunkingConfig {
  pdfBuffers: Buffer[];
  pdfNames?: string[];
  pagesPerChunk?: number;
}

export interface ChunkingResult {
  chunks: PdfChunkWithSource[];
  totalChunks: number;
  totalPages: number;
}

/**
 * Split all PDFs into uniform chunks
 * 
 * @param config - Chunking configuration
 * @returns Array of chunks with source file information
 */
export async function splitAllPdfsIntoChunks(
  config: ChunkingConfig
): Promise<ChunkingResult> {
  const { pdfBuffers, pdfNames, pagesPerChunk = 5 } = config;
  
  const allChunks: PdfChunkWithSource[] = [];

  console.log(`\n📦 Splitting ${pdfBuffers.length} PDF(s) into ${pagesPerChunk}-page chunks...\n`);

  for (let fileIdx = 0; fileIdx < pdfBuffers.length; fileIdx++) {
    const fileName = pdfNames?.[fileIdx] || `Document ${fileIdx + 1}`;
    const sizeMB = (pdfBuffers[fileIdx].length / 1024 / 1024).toFixed(2);

    console.log(`📄 Splitting file ${fileIdx + 1}/${pdfBuffers.length}: ${fileName} (${sizeMB} MB)`);

    // Split this PDF into chunks
    const chunks = await splitPdfIntoChunks(pdfBuffers[fileIdx], pagesPerChunk);

    // Tag chunks with source file
    chunks.forEach(chunk => {
      allChunks.push({
        ...chunk,
        sourceFile: fileName,
      });
    });

    console.log(`   ✓ Split into ${chunks.length} chunks`);
  }

  const totalChunks = allChunks.length;
  const totalPages = allChunks[allChunks.length - 1]?.pageRange.end || 0;

  console.log(`\n📊 Chunking Summary:`);
  console.log(`   Total chunks: ${totalChunks}`);
  console.log(`   Total pages: ${totalPages}\n`);

  return {
    chunks: allChunks,
    totalChunks,
    totalPages,
  };
}
