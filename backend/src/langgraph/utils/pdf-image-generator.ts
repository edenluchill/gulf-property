/**
 * PDF Image Generator Module
 * 
 * Handles batch generation and upload of ALL PDF images upfront:
 * - Convert every page to images (with variants)
 * - Upload to R2 PDF cache in parallel batches
 * - Return predictable image URLs for AI analysis
 * 
 * Benefits:
 * - Decoupled from chunk processing
 * - 100% cache hit rate on re-upload
 * - Predictable image URLs (page_1.jpg, page_2.jpg, etc.)
 * - AI only needs to classify/mark images, not decide generation
 */

import { pdfToImages } from '../../utils/pdf/converter';
import { uploadFileToPdfCacheWithVariants, type ImageUrls } from '../../services/r2-storage';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';

export interface PdfImageBatch {
  pdfHash: string;
  pdfName: string;
  totalPages: number;
  imageUrls: Map<number, ImageUrls>;  // pageNumber → URLs for all variants
}

export interface BatchGenerationConfig {
  pdfBuffers: Buffer[];
  pdfNames: string[];
  pdfHashes: string[];
  tempDir: string;
  uploadConcurrency?: number;  // Max concurrent R2 uploads
}

export interface BatchGenerationResult {
  imageBatches: PdfImageBatch[];
  totalImages: number;
  uploadTime: number;
  cacheHits: number;
}

/**
 * Generate and upload ALL images for all PDFs upfront
 * 
 * Strategy:
 * 1. Convert each PDF to images (all pages)
 * 2. Upload images in parallel batches to R2
 * 3. Return organized URLs for AI to reference
 * 
 * @returns Map of page numbers to image URLs for each PDF
 */
export async function generateAndUploadAllPdfImages(
  config: BatchGenerationConfig
): Promise<BatchGenerationResult> {
  const { 
    pdfBuffers, 
    pdfNames, 
    pdfHashes, 
    tempDir,
    uploadConcurrency = 10  // Default: 10 concurrent uploads
  } = config;

  const startTime = Date.now();
  let totalImages = 0;
  let cacheHits = 0;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`🖼️  BATCH IMAGE GENERATION & UPLOAD`);
  console.log(`   PDFs: ${pdfBuffers.length} | Upload concurrency: ${uploadConcurrency}`);
  console.log(`${'='.repeat(70)}\n`);

  const imageBatches: PdfImageBatch[] = [];

  // Process each PDF
  for (let pdfIdx = 0; pdfIdx < pdfBuffers.length; pdfIdx++) {
    const pdfBuffer = pdfBuffers[pdfIdx];
    const pdfName = pdfNames[pdfIdx];
    const pdfHash = pdfHashes[pdfIdx];

    console.log(`\n📄 Processing PDF ${pdfIdx + 1}/${pdfBuffers.length}: ${pdfName}`);
    console.log(`   Hash: ${pdfHash.substring(0, 12)}...`);

    // 1. Convert entire PDF to images
    const pdfTempDir = join(tempDir, `pdf_${pdfIdx}_images`);
    mkdirSync(pdfTempDir, { recursive: true });

    console.log(`   📸 Converting all pages to images...`);
    const imageStartTime = Date.now();
    
    const localImagePaths = await pdfToImages(
      pdfBuffer,
      pdfTempDir,
      'page'  // Prefix: page.1.png, page.2.png, etc.
    );

    const imageTime = Date.now() - imageStartTime;
    console.log(`   ✓ Generated ${localImagePaths.length} images in ${(imageTime / 1000).toFixed(2)}s`);

    totalImages += localImagePaths.length;

    // 2. Upload images to R2 in parallel batches
    console.log(`   📤 Uploading ${localImagePaths.length} images to R2 (${uploadConcurrency} concurrent)...`);
    const uploadStartTime = Date.now();

    const imageUrls = new Map<number, ImageUrls>();

    // Upload in batches to respect rate limits
    for (let i = 0; i < localImagePaths.length; i += uploadConcurrency) {
      const batch = localImagePaths.slice(i, Math.min(i + uploadConcurrency, localImagePaths.length));

      const batchResults = await Promise.allSettled(
        batch.map(async (imgPath, batchIdx) => {
          const pageNumber = i + batchIdx + 1;  // ⭐ 1-indexed page numbers
          
          // Small delay to avoid overwhelming R2
          await new Promise(resolve => setTimeout(resolve, batchIdx * 100));

          // Upload with retry logic
          let retries = 3;
          let lastError: any;

          while (retries > 0) {
            try {
              const urls = await uploadFileToPdfCacheWithVariants(imgPath, pdfHash);
              
              // Check if this was a cache hit (uploadFileToPdfCacheWithVariants logs this)
              // We can't detect it directly, but R2 will be fast if cached
              
              return { pageNumber, urls, success: true };
            } catch (err) {
              lastError = err;
              retries--;

              if (retries > 0) {
                console.warn(`   ⚠️ Upload failed for page ${pageNumber}, retrying... (${retries} left)`);
                await new Promise(resolve => setTimeout(resolve, 1500));
              }
            }
          }

          console.error(`   ❌ Failed to upload page ${pageNumber} after 3 attempts:`, lastError);
          return { pageNumber, urls: null, success: false, error: lastError };
        })
      );

      // Process results
      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value.success && result.value.urls) {
          imageUrls.set(result.value.pageNumber, result.value.urls);
        } else {
          console.error(`   ❌ Failed to upload image:`, result);
        }
      }

      // Progress update
      const uploadedSoFar = Math.min(i + uploadConcurrency, localImagePaths.length);
      console.log(`   📊 Progress: ${uploadedSoFar}/${localImagePaths.length} images uploaded`);
    }

    const uploadTime = Date.now() - uploadStartTime;
    console.log(`   ✅ Uploaded ${imageUrls.size}/${localImagePaths.length} images in ${(uploadTime / 1000).toFixed(2)}s`);

    // Clean up temp directory
    rmSync(pdfTempDir, { recursive: true, force: true });

    // Store result
    imageBatches.push({
      pdfHash,
      pdfName,
      totalPages: localImagePaths.length,
      imageUrls,
    });
  }

  const totalTime = Date.now() - startTime;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`✅ BATCH IMAGE GENERATION COMPLETE`);
  console.log(`   Total images: ${totalImages} | Time: ${(totalTime / 1000).toFixed(2)}s`);
  console.log(`   Cache hits: ${cacheHits} | Uploads: ${totalImages - cacheHits}`);
  console.log(`${'='.repeat(70)}\n`);

  return {
    imageBatches,
    totalImages,
    uploadTime: totalTime,
    cacheHits,
  };
}

/**
 * Get image URL for a specific page in a PDF
 * 
 * @param imageBatch - PDF image batch
 * @param pageNumber - Page number (1-indexed)
 * @param variant - Image size variant (default: 'original')
 * @returns Image URL or null if not found
 */
export function getImageUrl(
  imageBatch: PdfImageBatch,
  pageNumber: number,
  variant: keyof ImageUrls = 'original'
): string | null {
  const urls = imageBatch.imageUrls.get(pageNumber);
  return urls?.[variant] || null;
}

/**
 * Get all image URLs for a page (all variants)
 */
export function getAllVariantUrls(
  imageBatch: PdfImageBatch,
  pageNumber: number
): ImageUrls | null {
  return imageBatch.imageUrls.get(pageNumber) || null;
}
