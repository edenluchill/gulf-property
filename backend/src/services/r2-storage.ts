/**
 * Cloudflare R2 Storage Service
 * 
 * Handles image uploads to Cloudflare R2 (S3-compatible)
 * - PDF Cache: pdf-cache/{pdfHash}/images/* (permanent, reusable, deduplicated)
 * 
 * All images are stored in PDF cache using PDF hash as key.
 * This enables automatic deduplication - identical PDFs reuse the same images.
 */

import { 
  S3Client, 
  PutObjectCommand, 
  ListObjectsV2Command,
  HeadObjectCommand
} from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';
import { basename } from 'path';

// Initialize R2 client with increased timeouts
const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
  // ⚡ Increase timeouts to handle slow connections
  requestHandler: {
    connectionTimeout: 30000,  // 30 seconds (default: 1s)
    requestTimeout: 60000,     // 60 seconds (default: 2s)
  } as any,
});

const R2_BUCKET = process.env.R2_BUCKET_NAME || '';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || ''; // e.g., https://images.yourdomain.com

// ============================================================================
// PDF Cache Functions (NEW - for image reuse)
// ============================================================================

/**
 * Check if PDF cache exists in R2
 * Returns list of cached image URLs if exists
 * 
 * @param pdfHash - SHA256 hash of PDF
 * @returns Array of image URLs if cache exists, null if not found
 */
export async function checkPdfCache(pdfHash: string): Promise<string[] | null> {
  const prefix = `pdf-cache/${pdfHash}/images/`;
  
  try {
    const listCommand = new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: prefix,
    });
    
    const result = await r2Client.send(listCommand);
    
    if (!result.Contents || result.Contents.length === 0) {
      return null;
    }
    
    // Convert keys to public URLs
    const imageUrls = result.Contents
      .filter(obj => obj.Key)
      .map(obj => `${R2_PUBLIC_URL}/${obj.Key}`);
    
    console.log(`✅ PDF cache found: ${imageUrls.length} images for hash ${pdfHash.substring(0, 12)}...`);
    return imageUrls;
    
  } catch (error) {
    console.error(`Error checking PDF cache:`, error);
    return null;
  }
}

/**
 * Upload image to PDF cache (permanent, reusable storage)
 * ⭐ SMART: Checks if file exists first, skips upload if already cached
 * 
 * @param buffer - Image buffer
 * @param pdfHash - SHA256 hash of PDF
 * @param filename - Image filename
 * @returns Public URL to access the image
 */
export async function uploadToPdfCache(
  buffer: Buffer,
  pdfHash: string,
  filename: string
): Promise<string> {
  const key = `pdf-cache/${pdfHash}/images/${filename}`;
  const publicUrl = `${R2_PUBLIC_URL}/${key}`;
  
  try {
    // ⭐ Check if file already exists in cache
    try {
      await r2Client.send(new HeadObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      }));
      
      // File exists! Skip upload
      console.log(`♻️  Image already cached, reusing: ${filename}`);
      return publicUrl;
      
    } catch (headError: any) {
      // File doesn't exist (404), proceed with upload
      if (headError.name !== 'NotFound' && headError.$metadata?.httpStatusCode !== 404) {
        // Real error, not just "not found"
        throw headError;
      }
    }
    
    // File doesn't exist, upload it
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: getContentType(filename),
      Metadata: {
        uploadedAt: Date.now().toString(),
        pdfHash,
        cached: 'true',
      },
    });

    await r2Client.send(command);
    console.log(`✅ Image uploaded to PDF cache: ${publicUrl}`);
    
    return publicUrl;
  } catch (error) {
    console.error(`❌ Failed to upload to PDF cache:`, error);
    throw new Error(`Failed to upload image to PDF cache: ${error}`);
  }
}

/**
 * Upload image from file path to PDF cache (single size)
 */
export async function uploadFileToPdfCache(
  filePath: string,
  pdfHash: string
): Promise<string> {
  const buffer = readFileSync(filePath);
  const filename = basename(filePath);
  return uploadToPdfCache(buffer, pdfHash, filename);
}

/**
 * Upload image with multiple size variants to PDF cache
 * Generates and uploads: original, large, medium, thumbnail
 * 
 * @param filePath - Source image path
 * @param pdfHash - PDF hash for cache key
 * @returns Object with URLs for each size variant
 */
export async function uploadFileToPdfCacheWithVariants(
  filePath: string,
  pdfHash: string
): Promise<ImageUrls> {
  const { generateImageVariants } = require('../utils/pdf/image-processor');
  
  try {
    const filename = basename(filePath);
    const baseFilename = filename.replace(/\.[^/.]+$/, ''); // Remove extension
    
    // Generate all size variants
    const variants = await generateImageVariants(filePath);
    
    // Upload each variant
    const urls: Partial<ImageUrls> = {};
    
    for (const [variantName, buffer] of variants.entries()) {
      // ⭐ Original doesn't need postfix, others do
      const variantFilename = variantName === 'original' 
        ? `${baseFilename}.jpg`
        : `${baseFilename}_${variantName}.jpg`;
      
      // Check if already exists (cache hit)
      const key = `pdf-cache/${pdfHash}/images/${variantFilename}`;
      const publicUrl = `${R2_PUBLIC_URL}/${key}`;
      
      try {
        await r2Client.send(new HeadObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
        }));
        
        // File exists, skip upload
        console.log(`♻️  Image variant already cached: ${variantFilename}`);
        urls[variantName as keyof ImageUrls] = publicUrl;
        continue;
      } catch (headError: any) {
        if (headError.name !== 'NotFound' && headError.$metadata?.httpStatusCode !== 404) {
          throw headError;
        }
      }
      
      // Upload new variant
      await r2Client.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: 'image/jpeg',
        Metadata: {
          uploadedAt: Date.now().toString(),
          pdfHash,
          variant: variantName,
          cached: 'true',
        },
      }));
      
      urls[variantName as keyof ImageUrls] = publicUrl;
    }
    
    console.log(`✅ Uploaded ${variants.size} size variants to PDF cache`);
    
    return urls as ImageUrls;
  } catch (error) {
    console.error(`❌ Failed to upload image variants to PDF cache:`, error);
    throw error;
  }
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Image URL variants for responsive loading
 */
export interface ImageUrls {
  original: string;    // 1920×1080 - Full quality for detail pages
  large: string;       // 1280×720 - Desktop listings
  medium: string;      // 800×450 - Tablet/cards
  thumbnail: string;   // 400×225 - Mobile previews
}

/**
 * Check if R2 is properly configured
 */
export async function testR2Connection(): Promise<boolean> {
  try {
    // Try to list objects (limited to 1)
    const command = new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      MaxKeys: 1,
    });
    
    await r2Client.send(command);
    console.log('✅ R2 connection successful');
    return true;
  } catch (error) {
    console.error('❌ R2 connection failed:', error);
    return false;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Determine content type from filename
 */
function getContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  
  const contentTypes: Record<string, string> = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
  };
  
  return contentTypes[ext || 'jpg'] || 'image/jpeg';
}


/**
 * Check if URL is a PDF cache URL (all images should be pdf-cache now)
 */
export function isR2PdfCacheUrl(url: string): boolean {
  return url.includes('/pdf-cache/') && url.includes(R2_PUBLIC_URL);
}

/**
 * Check if URL is an R2 URL (valid image URL)
 */
export function isR2Url(url: string): boolean {
  return url.startsWith('https://') && url.includes(R2_PUBLIC_URL);
}
