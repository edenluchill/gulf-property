/**
 * PDF Chunking Strategy Module
 * 
 * Handles splitting of PDFs into manageable chunks:
 * - Split multiple PDFs into uniform chunks
 * - Tag chunks with source file information
 * - Tag chunks with PDF hash for caching
 * - Calculate total pages and chunks
 */

import { splitPdfIntoChunks, type PdfChunk } from '../../utils/pdf/chunker';
import type { PdfImageBatch } from '../utils/pdf-image-generator';

export interface PdfChunkWithSource extends PdfChunk {
  sourceFile: string;
  pdfHash: string;  // SHA256 hash for cache key
  imageBatch?: PdfImageBatch;  // ⭐ NEW: Pre-generated image URLs
}

export interface ChunkingConfig {
  pdfBuffers: Buffer[];
  pdfNames?: string[];
  pdfHashes: string[];
  imageBatches?: PdfImageBatch[];  // ⭐ NEW: Pre-generated images
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
 * @returns Array of chunks with source file information and PDF hash
 */
export async function splitAllPdfsIntoChunks(
  config: ChunkingConfig
): Promise<ChunkingResult> {
  const { pdfBuffers, pdfNames, pdfHashes, imageBatches, pagesPerChunk = 5 } = config;
  
  const allChunks: PdfChunkWithSource[] = [];

  console.log(`\n📦 Splitting ${pdfBuffers.length} PDF(s) into ${pagesPerChunk}-page chunks...\n`);

  for (let fileIdx = 0; fileIdx < pdfBuffers.length; fileIdx++) {
    const fileName = pdfNames?.[fileIdx] || `Document ${fileIdx + 1}`;
    const pdfHash = pdfHashes[fileIdx];
    const imageBatch = imageBatches?.[fileIdx];  // ⭐ Get pre-generated images
    const sizeMB = (pdfBuffers[fileIdx].length / 1024 / 1024).toFixed(2);

    console.log(`📄 Splitting file ${fileIdx + 1}/${pdfBuffers.length}: ${fileName} (${sizeMB} MB)`);
    console.log(`   Hash: ${pdfHash.substring(0, 12)}...`);
    if (imageBatch) {
      console.log(`   ✅ Using ${imageBatch.totalPages} pre-generated images`);
    }

    // Split this PDF into chunks
    const chunks = await splitPdfIntoChunks(pdfBuffers[fileIdx], pagesPerChunk);

    // Tag chunks with source file, PDF hash, and image batch
    chunks.forEach(chunk => {
      allChunks.push({
        ...chunk,
        sourceFile: fileName,
        pdfHash,
        imageBatch,  // ⭐ Attach pre-generated images
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
