/**
 * Browser direct-to-R2 multipart upload.
 *
 * Why: uploading a 100MB+ brochure as a single request to the German API server
 * constantly drops from far regions (e.g. Dubai) — one network hiccup fails the
 * whole transfer. Here the browser PUTs small parts straight to the nearest
 * Cloudflare R2 edge and retries individual failed parts, so a hiccup costs one
 * 8MB part, not the whole file.
 *
 * The backend only issues presigned URLs (small JSON calls) and registers the
 * job; the heavy bytes never touch our server. Pairs with backend
 * routes/r2-upload.ts. Requires the R2 bucket CORS to ExposeHeaders: ETag.
 */

import { API_BASE_URL } from './config'

const PART_SIZE = 8 * 1024 * 1024 // 8MB per part
const PART_CONCURRENCY = 4 // parts uploaded in parallel per file
const MAX_PART_RETRIES = 4 // per-part retry attempts (exponential backoff)
const PART_TIMEOUT_MS = 120_000 // 2 min per 8MB part

interface StartResponse {
  success: boolean
  jobId: string
  uploads: { filename: string; key: string; uploadId: string }[]
  error?: string
}

interface CompletedFile {
  filename: string
  key: string
  uploadId: string
  parts: { PartNumber: number; ETag: string }[]
}

export interface UploadOptions {
  headers?: Record<string, string>
  onProgress?: (percent: number) => void // 0–100
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function postJson(path: string, body: any, headers?: Record<string, string>): Promise<any> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `${path} failed (${res.status})`)
  }
  return json
}

/** PUT one part to its presigned URL, retrying the whole part on failure. */
async function putPartWithRetry(url: string, blob: Blob): Promise<string> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_PART_RETRIES; attempt++) {
    try {
      return await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', url)
        xhr.timeout = PART_TIMEOUT_MS
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const etag = xhr.getResponseHeader('ETag')
            if (!etag) {
              reject(new Error('No ETag returned — R2 CORS must ExposeHeaders: ETag'))
            } else {
              resolve(etag)
            }
          } else {
            reject(new Error(`Part upload failed: HTTP ${xhr.status}`))
          }
        }
        xhr.onerror = () => reject(new Error('Network error during part upload'))
        xhr.ontimeout = () => reject(new Error('Part upload timed out'))
        xhr.send(blob)
      })
    } catch (e) {
      lastErr = e
      if (attempt < MAX_PART_RETRIES) {
        await sleep(Math.min(1000 * 2 ** attempt, 8000))
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Part upload failed')
}

/**
 * Upload files directly to R2 via presigned multipart, then register the job.
 * Returns the jobId to connect the SSE progress stream to (unchanged downstream).
 */
export async function uploadFilesToR2(
  files: File[],
  opts: UploadOptions = {}
): Promise<{ jobId: string }> {
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0) || 1
  let uploadedBytes = 0
  const bump = (delta: number) => {
    uploadedBytes += delta
    opts.onProgress?.(Math.min(99, Math.round((uploadedBytes / totalBytes) * 100)))
  }

  // 1. Create job + one multipart upload per file
  const start: StartResponse = await postJson(
    '/api/r2-upload/start',
    { files: files.map(f => ({ filename: f.name, size: f.size })) },
    opts.headers
  )
  const { jobId, uploads } = start

  try {
    const completedFiles: CompletedFile[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const up = uploads[i]
      const partCount = Math.max(1, Math.ceil(file.size / PART_SIZE))
      const partNumbers = Array.from({ length: partCount }, (_, k) => k + 1)

      // Presign every part for this file in one call
      const signed = await postJson(
        '/api/r2-upload/sign',
        { key: up.key, uploadId: up.uploadId, partNumbers },
        opts.headers
      )
      const urls: Record<number, string> = signed.urls

      // Upload parts with bounded concurrency
      const parts: { PartNumber: number; ETag: string }[] = new Array(partCount)
      let nextIdx = 0
      const worker = async () => {
        while (nextIdx < partCount) {
          const idx = nextIdx++
          const partNumber = idx + 1
          const startByte = idx * PART_SIZE
          const blob = file.slice(startByte, Math.min(startByte + PART_SIZE, file.size))
          const etag = await putPartWithRetry(urls[partNumber], blob)
          parts[idx] = { PartNumber: partNumber, ETag: etag }
          bump(blob.size)
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(PART_CONCURRENCY, partCount) }, () => worker())
      )

      completedFiles.push({
        filename: up.filename,
        key: up.key,
        uploadId: up.uploadId,
        parts,
      })
    }

    // 3. Finalize all uploads and create the worker task
    await postJson(
      '/api/r2-upload/complete',
      { jobId, files: completedFiles, totalSizeBytes: totalBytes },
      opts.headers
    )

    opts.onProgress?.(100)
    return { jobId }
  } catch (err) {
    // Best-effort cleanup of unfinished multipart uploads
    try {
      await postJson(
        '/api/r2-upload/abort',
        { uploads: uploads.map(u => ({ key: u.key, uploadId: u.uploadId })) },
        opts.headers
      )
    } catch {
      /* ignore abort errors */
    }
    throw err
  }
}
