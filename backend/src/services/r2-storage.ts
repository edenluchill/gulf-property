/**
 * Cloudflare R2 Storage Service
 * 
 * Handles image uploads to Cloudflare R2 (S3-compatible)
 * - PDF Cache: pdf-cache/{pdfHash}/images/* (permanent, reusable)
 * - Temporary storage: temporary/{jobId}/images/* (deleted after 24h)
 * - Permanent storage: permanent/{projectId}/images/* (permanent)
 */

import { 
  S3Client, 
  PutObjectCommand, 
  CopyObjectCommand,
  DeleteObjectCommand,
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
// Temporary Storage Functions (Original)
// ============================================================================

/**
 * Upload image to R2 temporary storage
 * Used during PDF processing - images stored temporarily
 * 
 * @param buffer - Image buffer
 * @param jobId - Processing job ID
 * @param filename - Image filename
 * @returns Public URL to access the image
 */
export async function uploadToR2Temp(
  buffer: Buffer,
  jobId: string,
  filename: string
): Promise<string> {
  const key = `temporary/${jobId}/images/${filename}`;
  
  try {
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: getContentType(filename),
      // Add metadata for cleanup
      Metadata: {
        uploadedAt: Date.now().toString(),
        jobId,
        temporary: 'true',
      },
    });

    await r2Client.send(command);
    
    const publicUrl = `${R2_PUBLIC_URL}/${key}`;
    console.log(`✅ Image uploaded to R2 temp: ${publicUrl}`);
    
    return publicUrl;
  } catch (error) {
    console.error(`❌ Failed to upload to R2:`, error);
    throw new Error(`Failed to upload image to R2: ${error}`);
  }
}

/**
 * Upload image from local file path to R2 temporary storage
 */
export async function uploadFileToR2Temp(
  filePath: string,
  jobId: string
): Promise<string> {
  const buffer = readFileSync(filePath);
  const filename = basename(filePath);
  return uploadToR2Temp(buffer, jobId, filename);
}

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
 * Upload image with multiple size variants to R2 temporary storage
 * Generates and uploads: original, large, medium, thumbnail
 * 
 * @param filePath - Source image path
 * @param jobId - Processing job ID
 * @returns Object with URLs for each size variant
 */
export async function uploadFileToR2TempWithVariants(
  filePath: string,
  jobId: string
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
      const variantFilename = `${baseFilename}_${variantName}.jpg`;
      const url = await uploadToR2Temp(buffer, jobId, variantFilename);
      urls[variantName as keyof ImageUrls] = url;
    }
    
    console.log(`✅ Uploaded ${variants.size} size variants to R2`);
    
    return urls as ImageUrls;
  } catch (error) {
    console.error(`❌ Failed to upload image variants:`, error);
    throw error;
  }
}

/**
 * Move image from temporary to permanent storage
 * Called when project is submitted
 * 
 * ⭐ NEW: Smart handling for different storage types:
 * - temporary/ → Copy to permanent/ and delete source
 * - pdf-cache/ → Keep as-is (already permanent, shared across projects)
 * - permanent/ → Keep as-is (already permanent)
 * 
 * @param sourceUrl - Source URL (temporary, pdf-cache, or permanent)
 * @param projectId - Project ID for permanent storage
 * @returns Final permanent URL
 */
export async function moveToR2Permanent(
  sourceUrl: string,
  projectId: string
): Promise<string> {
  try {
    // ⭐ PDF cache URLs are already permanent, no need to move
    if (isR2PdfCacheUrl(sourceUrl)) {
      console.log(`♻️  Keeping PDF cache URL (shared across projects): ${sourceUrl.substring(0, 80)}...`);
      return sourceUrl;
    }
    
    // ⭐ Already permanent URLs, no need to move
    if (isR2PermanentUrl(sourceUrl)) {
      console.log(`✅ Already permanent URL, keeping: ${sourceUrl.substring(0, 80)}...`);
      return sourceUrl;
    }
    
    // ⭐ Only move temporary URLs
    if (!isR2TempUrl(sourceUrl)) {
      console.warn(`⚠️ Unknown URL type, keeping original: ${sourceUrl}`);
      return sourceUrl;
    }
    
    // Extract key from URL
    const tempKey = extractKeyFromUrl(sourceUrl);
    
    if (!tempKey) {
      console.warn(`⚠️ Invalid URL, keeping original: ${sourceUrl}`);
      return sourceUrl;
    }

    // New permanent key
    const filename = basename(tempKey);
    const permanentKey = `permanent/${projectId}/images/${filename}`;

    // Copy to permanent location
    await r2Client.send(new CopyObjectCommand({
      Bucket: R2_BUCKET,
      CopySource: `${R2_BUCKET}/${tempKey}`,
      Key: permanentKey,
      ContentType: getContentType(filename),
      Metadata: {
        uploadedAt: Date.now().toString(),
        projectId,
        permanent: 'true',
      },
      MetadataDirective: 'REPLACE', // Override metadata
    }));

    // Delete temp file (only for temporary/ URLs)
    try {
      await r2Client.send(new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: tempKey,
      }));
      console.log(`🗑️  Deleted temporary file: ${tempKey}`);
    } catch (deleteError) {
      // Ignore delete errors - cleanup script will handle it
      console.log(`⚠️ Could not delete temp file (will be cleaned by script): ${tempKey}`);
    }

    const permanentUrl = `${R2_PUBLIC_URL}/${permanentKey}`;
    console.log(`✅ Image moved from temporary to permanent: ${permanentUrl}`);
    
    return permanentUrl;
  } catch (error: any) {
    // If file doesn't exist (NoSuchKey), return original URL
    if (error.Code === 'NoSuchKey') {
      console.warn(`⚠️ Source file not found, keeping URL: ${sourceUrl}`);
      return sourceUrl;
    }
    
    console.error(`❌ Failed to move image to permanent storage:`, error);
    // Return original URL instead of throwing
    return sourceUrl;
  }
}

/**
 * Move multiple images from temp to permanent
 */
export async function moveMultipleToR2Permanent(
  tempUrls: string[],
  projectId: string
): Promise<string[]> {
  const permanentUrls: string[] = [];
  
  for (const tempUrl of tempUrls) {
    try {
      const permanentUrl = await moveToR2Permanent(tempUrl, projectId);
      permanentUrls.push(permanentUrl);
    } catch (error) {
      console.error(`Failed to move image: ${tempUrl}`, error);
      // Keep original URL if move fails
      permanentUrls.push(tempUrl);
    }
  }
  
  return permanentUrls;
}

/**
 * Delete all temporary images for a job
 */
export async function deleteR2TempJob(jobId: string): Promise<number> {
  const prefix = `temporary/${jobId}/`;
  
  try {
    // List all objects with this prefix
    const listCommand = new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: prefix,
    });
    
    const listResult = await r2Client.send(listCommand);
    
    if (!listResult.Contents || listResult.Contents.length === 0) {
      console.log(`No temp files found for job ${jobId}`);
      return 0;
    }

    // Delete each object
    let deleted = 0;
    for (const obj of listResult.Contents) {
      if (obj.Key) {
        await r2Client.send(new DeleteObjectCommand({
          Bucket: R2_BUCKET,
          Key: obj.Key,
        }));
        deleted++;
      }
    }

    console.log(`🗑️ Deleted ${deleted} temp files for job ${jobId}`);
    return deleted;
  } catch (error) {
    console.error(`Failed to delete temp files for job ${jobId}:`, error);
    return 0;
  }
}

/**
 * Cleanup old temporary files (older than 24 hours)
 * Should be run periodically (e.g., daily cron job)
 */
export async function cleanupOldR2TempFiles(): Promise<number> {
  const prefix = 'temporary/';
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  try {
    const listCommand = new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: prefix,
    });
    
    const listResult = await r2Client.send(listCommand);
    
    if (!listResult.Contents || listResult.Contents.length === 0) {
      console.log('No temp files found');
      return 0;
    }

    const now = Date.now();
    let deleted = 0;

    for (const obj of listResult.Contents) {
      if (!obj.Key || !obj.LastModified) continue;

      const age = now - obj.LastModified.getTime();
      
      if (age > maxAge) {
        await r2Client.send(new DeleteObjectCommand({
          Bucket: R2_BUCKET,
          Key: obj.Key,
        }));
        deleted++;
        console.log(`🗑️ Deleted old temp file: ${obj.Key}`);
      }
    }

    console.log(`✅ Cleanup complete: ${deleted} old temp files deleted`);
    return deleted;
  } catch (error) {
    console.error('Failed to cleanup old temp files:', error);
    return 0;
  }
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
 * Extract R2 key from public URL
 * e.g., "https://cdn.example.com/temp/job123/images/img.png" -> "temp/job123/images/img.png"
 */
function extractKeyFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    // Remove leading slash
    return urlObj.pathname.substring(1);
  } catch (error) {
    console.error('Failed to parse URL:', url);
    return null;
  }
}

/**
 * Check if URL is a temporary R2 URL (needs to be moved on submit)
 */
export function isR2TempUrl(url: string): boolean {
  return url.includes('/temporary/') && url.includes(R2_PUBLIC_URL);
}

/**
 * Check if URL is a PDF cache URL (permanent, can be shared across projects)
 */
export function isR2PdfCacheUrl(url: string): boolean {
  return url.includes('/pdf-cache/') && url.includes(R2_PUBLIC_URL);
}

/**
 * Check if URL is a permanent R2 URL
 */
export function isR2PermanentUrl(url: string): boolean {
  return url.includes('/permanent/') && url.includes(R2_PUBLIC_URL);
}

/**
 * Check if URL needs to be moved to permanent storage
 * PDF cache URLs are already permanent, so only temporary URLs need moving
 */
export function needsMoveToPermament(url: string): boolean {
  return isR2TempUrl(url) && !isR2PdfCacheUrl(url) && !isR2PermanentUrl(url);
}
