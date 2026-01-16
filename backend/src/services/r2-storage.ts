/**
 * Cloudflare R2 Storage Service
 * 
 * Handles image uploads to Cloudflare R2 (S3-compatible)
 * - Temporary storage: temp/{jobId}/images/* (deleted after 24h)
 * - Permanent storage: projects/{projectId}/images/* (permanent)
 */

import { 
  S3Client, 
  PutObjectCommand, 
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand 
} from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';
import { basename } from 'path';

// Initialize R2 client
const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME || '';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || ''; // e.g., https://images.yourdomain.com

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
  const key = `temp/${jobId}/images/${filename}`;
  
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
 * Move image from temporary to permanent storage
 * Called when project is submitted
 * 
 * @param tempUrl - Temporary URL (e.g., https://cdn.../temp/job123/images/img.png)
 * @param projectId - Project ID for permanent storage
 * @returns New permanent URL
 */
export async function moveToR2Permanent(
  tempUrl: string,
  projectId: string
): Promise<string> {
  try {
    // Extract key from URL
    const tempKey = extractKeyFromUrl(tempUrl);
    
    if (!tempKey) {
      throw new Error(`Invalid temp URL: ${tempUrl}`);
    }

    // New permanent key
    const filename = basename(tempKey);
    const permanentKey = `projects/${projectId}/images/${filename}`;

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

    // Delete temp file (optional - can also rely on cleanup script)
    await r2Client.send(new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: tempKey,
    }));

    const permanentUrl = `${R2_PUBLIC_URL}/${permanentKey}`;
    console.log(`✅ Image moved to permanent: ${permanentUrl}`);
    
    return permanentUrl;
  } catch (error) {
    console.error(`❌ Failed to move image to permanent storage:`, error);
    throw new Error(`Failed to move image: ${error}`);
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
  const prefix = `temp/${jobId}/`;
  
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
  const prefix = 'temp/';
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
 * Check if URL is a temporary R2 URL
 */
export function isR2TempUrl(url: string): boolean {
  return url.includes('/temp/') && url.includes(R2_PUBLIC_URL);
}

/**
 * Check if URL is a permanent R2 URL
 */
export function isR2PermanentUrl(url: string): boolean {
  return url.includes('/projects/') && url.includes(R2_PUBLIC_URL);
}
