/**
 * R2 Multipart Upload (presigned) — enables browser direct-to-R2 chunked uploads.
 *
 * Why: large brochures (100MB+) uploaded from far regions (e.g. Dubai → Germany)
 * over a single HTTP request constantly drop ("Network error during upload").
 * Direct-to-R2 multipart lets the browser upload small parts to the NEAREST
 * Cloudflare edge and retry individual failed parts, instead of re-sending the
 * whole file on every hiccup.
 *
 * The worker pipeline is UNCHANGED: it still downloads PDFs from the same
 * `pending-pdfs/{jobId}/{filename}` keys that the legacy backend-relay path used.
 */

import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME || '';

/** Same key layout the worker already downloads from. */
export function pendingPdfKey(jobId: string, filename: string): string {
  return `pending-pdfs/${jobId}/${filename}`;
}

/** Start a multipart upload, returns the UploadId used to sign/complete parts. */
export async function createMultipartUpload(key: string): Promise<string> {
  const out = await r2Client.send(
    new CreateMultipartUploadCommand({
      Bucket: R2_BUCKET,
      Key: key,
      ContentType: 'application/pdf',
    })
  );
  if (!out.UploadId) throw new Error('R2 did not return an UploadId');
  return out.UploadId;
}

/**
 * Generate a presigned URL the browser can PUT a single part to.
 * The browser must read the returned ETag header for each part (R2 CORS must
 * ExposeHeaders: ETag) and hand it back at complete time.
 */
export async function signUploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
  expiresIn = 6 * 3600 // 6h — generous for slow/unstable far-region links (Dubai)
): Promise<string> {
  const cmd = new UploadPartCommand({
    Bucket: R2_BUCKET,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });
  return getSignedUrl(r2Client, cmd, { expiresIn });
}

export interface CompletedPart {
  PartNumber: number;
  ETag: string;
}

/** Finalize a multipart upload. Parts are sorted by PartNumber as R2 requires. */
export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: CompletedPart[]
): Promise<void> {
  const sorted = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);
  await r2Client.send(
    new CompleteMultipartUploadCommand({
      Bucket: R2_BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: sorted },
    })
  );
}

/** Best-effort cleanup of an unfinished multipart upload. */
export async function abortMultipartUpload(key: string, uploadId: string): Promise<void> {
  await r2Client.send(
    new AbortMultipartUploadCommand({
      Bucket: R2_BUCKET,
      Key: key,
      UploadId: uploadId,
    })
  );
}
