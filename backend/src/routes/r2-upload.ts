import { counter, histogram } from '../telemetry';
/**
 * R2 Direct Upload Routes — browser uploads PDF parts straight to R2 (presigned
 * multipart), bypassing the German API server entirely. This fixes the chronic
 * "Network error during upload" seen from Dubai on large brochures.
 *
 * Flow:
 *   1. POST /start    → server creates jobId + one multipart upload per file
 *   2. POST /sign     → server presigns the part-number URLs the browser PUTs to
 *   3. POST /complete → server finalizes each upload and creates the worker task
 *   4. POST /abort    → best-effort cleanup if the browser gives up
 *
 * The worker is untouched — /complete creates the exact same task (pdfUrls =
 * pending-pdfs keys) that the legacy /langgraph-progress/start worker path did.
 */

import { Router, Request, Response } from 'express';
import { generateJobId } from '../utils/pdf/file-manager';
import { taskManager } from '../services/task-manager';
import {
  pendingPdfKey,
  createMultipartUpload,
  signUploadPart,
  completeMultipartUpload,
  abortMultipartUpload,
} from '../services/r2-multipart';
import { resolveAgentId } from '../lib/agent-identity';
import { spend } from '../luna-tour/credits';
import { requireAuth } from '../middleware/auth';
import { requireUploader } from '../middleware/requireUploader';

const router = Router();

const MAX_FILES = 10;

/** Keep R2 keys safe; preserve a readable tail of the original name. */
function safeName(name: string): string {
  return String(name || 'document.pdf')
    .replace(/[^\w.\- ]+/g, '_')
    .slice(-200);
}

/**
 * POST /api/r2-upload/start
 * body: { files: [{ filename, size }] }
 * → { success, jobId, uploads: [{ filename, key, uploadId }] }
 */
router.post('/start', requireAuth, requireUploader, async (req: Request, res: Response): Promise<void> => {
  try {
    const files = req.body?.files;
    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ success: false, error: 'No files provided' });
      return;
    }
    if (files.length > MAX_FILES) {
      res.status(400).json({ success: false, error: `Too many files (max ${MAX_FILES})` });
      return;
    }

    const jobId = generateJobId();
    const uploads: Array<{ filename: string; key: string; uploadId: string }> = [];

    for (const f of files) {
      const filename = safeName(f?.filename);
      const key = pendingPdfKey(jobId, filename);
      const uploadId = await createMultipartUpload(key);
      uploads.push({ filename, key, uploadId });
    }

    console.log(`📤 Direct R2 upload started: job ${jobId}, ${uploads.length} file(s)`);
    res.json({ success: true, jobId, uploads });
  } catch (e: any) {
    console.error('r2-upload/start failed:', e);
    res.status(500).json({ success: false, error: e.message || 'Failed to start upload' });
  }
});

/**
 * POST /api/r2-upload/sign
 * body: { key, uploadId, partNumbers: number[] }
 * → { success, urls: { [partNumber]: presignedUrl } }
 */
router.post('/sign', requireAuth, requireUploader, async (req: Request, res: Response): Promise<void> => {
  try {
    const { key, uploadId, partNumbers } = req.body || {};
    if (!key || !uploadId || !Array.isArray(partNumbers) || partNumbers.length === 0) {
      res.status(400).json({ success: false, error: 'key, uploadId, partNumbers required' });
      return;
    }
    // Only ever sign keys inside the pending-pdfs prefix.
    if (!String(key).startsWith('pending-pdfs/')) {
      res.status(400).json({ success: false, error: 'Invalid key' });
      return;
    }

    const urls: Record<number, string> = {};
    for (const pn of partNumbers) {
      const n = Number(pn);
      if (!Number.isInteger(n) || n < 1 || n > 10000) {
        res.status(400).json({ success: false, error: `Invalid part number: ${pn}` });
        return;
      }
      urls[n] = await signUploadPart(key, uploadId, n);
    }

    res.json({ success: true, urls });
  } catch (e: any) {
    console.error('r2-upload/sign failed:', e);
    res.status(500).json({ success: false, error: e.message || 'Failed to sign parts' });
  }
});

/**
 * POST /api/r2-upload/complete
 * body: {
 *   jobId, userId?, userEmail?, totalSizeBytes?,
 *   files: [{ filename, key, uploadId, parts: [{ PartNumber, ETag }] }]
 * }
 * → { success, jobId }
 */
router.post('/complete', requireAuth, requireUploader, async (req: Request, res: Response): Promise<void> => {
  try {
    const { jobId, files, totalSizeBytes } = req.body || {};
    const userId =
      (req.headers['x-user-id'] as string) || req.body?.userId || 'anonymous';
    const userEmail = (req.headers['x-user-email'] as string) || req.body?.userEmail;

    if (!jobId || !Array.isArray(files) || files.length === 0) {
      res.status(400).json({ success: false, error: 'jobId and files required' });
      return;
    }

    // 权限已由 requireUploader 强制(admin/owner/白名单)。此处只为记账解析经纪身份;
    // 白名单里的人可能没订阅,拿不到 agentId 也照常放行,不再卡积分。
    const agentId = await resolveAgentId(req).catch(() => null);

    const pdfUrls: string[] = [];
    const pdfNames: string[] = [];

    for (const f of files) {
      // Guard: the key must belong to this job's prefix.
      if (!String(f?.key).startsWith(`pending-pdfs/${jobId}/`)) {
        res.status(400).json({ success: false, error: 'Invalid key for job' });
        return;
      }
      if (!f?.uploadId || !Array.isArray(f?.parts) || f.parts.length === 0) {
        res.status(400).json({ success: false, error: 'Each file needs uploadId and parts' });
        return;
      }
      await completeMultipartUpload(f.key, f.uploadId, f.parts);
      pdfUrls.push(f.key);
      pdfNames.push(safeName(f.filename));
    }

    await taskManager.createTask({
      jobId,
      userId,
      userEmail,
      taskName:
        pdfNames.length === 1
          ? pdfNames[0]
          : `${pdfNames.length} PDFs: ${pdfNames.join(', ').substring(0, 100)}`,
      pdfCount: pdfNames.length,
      pdfNames,
      pdfUrls, // worker downloads from these
      totalSizeBytes: Number(totalSizeBytes) || undefined,
      metadata: { uploadedAt: Date.now(), workerMode: true, directUpload: true },
    });

    // 记账(best-effort,绝不阻断已放行的上传)。白名单里没订阅的经纪 agentId 为空 → 跳过。
    if (agentId) {
      await spend(agentId, 'brochures', { type: 'brochure', id: String(jobId), label: pdfNames[0] })
        .catch((e) => {
          counter('credits.spend.failed', { feature: 'brochures' }).inc();
          console.error('[r2-upload] 🔴 楼书扣费失败(白送了一次):', e);
        });
    }

    // 上传是客户旅程的起点(500MB 楼书,失败最伤人)。之前这条线零遥测。
    counter('pdf.upload.completed').inc();
    counter('pdf.upload.files').inc(pdfNames.length);
    histogram('pdf.upload.bytes').observe(Number(totalSizeBytes) || 0);
    console.log(`📋 Task created from direct upload: ${jobId} (${pdfNames.length} file(s))`);
    res.json({
      success: true,
      jobId,
      message: 'Upload complete. Worker will process. Connect to /api/langgraph-progress/stream/:jobId',
    });
  } catch (e: any) {
    // 客户已经把几百 MB 传完了,却在最后一步挂掉 —— 这是最伤的失败。
    counter('pdf.upload.failed').inc();
    console.error('r2-upload/complete failed:', e);
    res.status(500).json({ success: false, error: e.message || 'Failed to complete upload' });
  }
});

/**
 * POST /api/r2-upload/abort
 * body: { uploads: [{ key, uploadId }] } — best-effort cleanup; always 200s.
 */
router.post('/abort', async (req: Request, res: Response): Promise<void> => {
  try {
    const uploads = req.body?.uploads;
    if (Array.isArray(uploads)) {
      for (const u of uploads) {
        if (u?.key && u?.uploadId) {
          try {
            await abortMultipartUpload(u.key, u.uploadId);
          } catch {
            /* ignore individual abort failures */
          }
        }
      }
    }
    res.json({ success: true });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

export default router;
