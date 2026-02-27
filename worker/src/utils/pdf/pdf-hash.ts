/**
 * PDF Hashing Utilities
 * 
 * Calculate unique hash for PDF files to enable:
 * - Image caching and reuse
 * - Avoiding duplicate processing
 * - Consistent storage paths
 */

import crypto from 'crypto';

/**
 * Calculate SHA256 hash of PDF buffer
 * Same PDF = Same hash (regardless of where it's downloaded)
 * 
 * @param pdfBuffer - PDF file as Buffer
 * @returns Hex string hash (64 characters)
 */
export function calculatePdfHash(pdfBuffer: Buffer): string {
  const hash = crypto.createHash('sha256');
  hash.update(pdfBuffer);
  return hash.digest('hex');
}

/**
 * Calculate hash for multiple PDFs and return mapping
 * 
 * @param pdfBuffers - Array of PDF buffers
 * @param pdfNames - Optional array of PDF names for logging
 * @returns Array of {hash, buffer, name}
 */
export function calculatePdfHashes(
  pdfBuffers: Buffer[],
  pdfNames?: string[]
): Array<{ hash: string; buffer: Buffer; name: string; index: number }> {
  return pdfBuffers.map((buffer, index) => {
    const hash = calculatePdfHash(buffer);
    const name = pdfNames?.[index] || `Document ${index + 1}`;
    
    console.log(`📄 PDF ${index + 1}: ${name}`);
    console.log(`   Hash: ${hash}`);
    console.log(`   Size: ${(buffer.length / 1024).toFixed(2)} KB`);
    
    return {
      hash,
      buffer,
      name,
      index,
    };
  });
}

/**
 * Create a short hash for display (first 12 characters)
 * e.g., "a1b2c3d4e5f6"
 */
export function shortHash(fullHash: string): string {
  return fullHash.substring(0, 12);
}
