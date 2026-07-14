import { runAudit } from '../quality';
import { PDF_RULES } from '../quality/pdf-rules';
/**
 * Job Processor
 *
 * Downloads PDFs from R2, processes them using the workflow executor,
 * and updates progress in the database.
 *
 * Ported from the legacy standalone worker/ package (2026-06) so the worker
 * runs against backend/src directly — single source of truth for langgraph.
 */

import { join } from 'path';
import { mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { PendingJob } from './job-poller';
import { executePdfWorkflow } from '../langgraph/workflow-executor';
import { taskManager } from '../services/task-manager';
import { downloadFromR2 } from '../services/r2-storage';
import { progressEmitter } from '../services/progress-emitter';

// Active abort controllers for cancellation support
const activeAbortControllers = new Map<string, AbortController>();

/**
 * Check if job has been cancelled in database
 */
async function checkJobCancelled(jobId: string): Promise<boolean> {
  try {
    const task = await taskManager.getTask(jobId);
    return task?.status === 'cancelled' || task?.status === 'paused';
  } catch {
    return false;
  }
}

/**
 * Start a cancellation monitor that periodically checks the database
 */
function startCancellationMonitor(jobId: string, abortController: AbortController): NodeJS.Timeout {
  return setInterval(async () => {
    const cancelled = await checkJobCancelled(jobId);
    if (cancelled) {
      console.log(`🚫 Job ${jobId} was cancelled/paused, aborting...`);
      abortController.abort('cancelled');
    }
  }, 2000); // Check every 2 seconds
}

/**
 * Cancel a running job
 */
export function cancelJob(jobId: string): boolean {
  const controller = activeAbortControllers.get(jobId);
  if (controller) {
    controller.abort('cancelled');
    return true;
  }
  return false;
}

/**
 * Process a single job
 */
export async function processJob(job: PendingJob): Promise<void> {
  const { job_id: jobId, pdf_names, pdf_urls } = job;
  const startTime = Date.now();

  // Create abort controller for this job
  const abortController = new AbortController();
  activeAbortControllers.set(jobId, abortController);

  // Start cancellation monitor
  const cancelMonitor = startCancellationMonitor(jobId, abortController);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔄 Processing Job: ${jobId}`);
  console.log(`   PDFs: ${pdf_names?.join(', ') || 'unnamed'}`);
  console.log(`   URLs: ${pdf_urls?.length || 0} files`);
  console.log(`${'='.repeat(60)}`);

  // Create temp directory for this job
  const tempDir = join(process.cwd(), 'temp', jobId);
  if (!existsSync(tempDir)) {
    await mkdir(tempDir, { recursive: true });
  }

  try {
    // Check if already cancelled before starting
    if (abortController.signal.aborted) {
      console.log(`⏹️  Job ${jobId} was cancelled before processing started`);
      return;
    }

    // Step 1: Download PDFs from R2 (worker-side fetch — phrase it as
    // "preparing" so admins don't think their browser is downloading)
    await updateProgress(jobId, 'Preparing files on processing server...', 1);

    const pdfBuffers: Buffer[] = [];
    const pdfNames: string[] = [];

    if (!pdf_urls || pdf_urls.length === 0) {
      throw new Error('No PDF URLs provided for job');
    }

    for (let i = 0; i < pdf_urls.length; i++) {
      // Check for cancellation between downloads
      if (abortController.signal.aborted) {
        console.log(`⏹️  Job ${jobId} cancelled during download`);
        return;
      }

      const url = pdf_urls[i];
      const name = pdf_names?.[i] || `document_${i + 1}.pdf`;

      await updateProgress(
        jobId,
        `Preparing ${name}...`,
        Math.round((i / pdf_urls.length) * 5) + 1
      );

      try {
        const buffer = await downloadFromR2(url);
        pdfBuffers.push(buffer);
        pdfNames.push(name);
        console.log(`   ✅ Downloaded: ${name} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
      } catch (error) {
        console.error(`   ❌ Failed to download ${name}:`, error);
        throw new Error(`Failed to download PDF: ${name}`);
      }
    }

    await updateProgress(jobId, `Files ready (${pdfBuffers.length}), starting analysis...`, 5);

    // Step 2: Process PDFs using workflow executor
    await updateProgress(jobId, 'Starting PDF analysis...', 6);

    const result = await executePdfWorkflow({
      pdfBuffers,
      pdfNames,
      jobId,
      outputBaseDir: join(process.cwd(), 'uploads', 'langgraph-output'),
      pagesPerChunk: 5,
      batchSize: 10,  // Concurrency for chunk processing
      abortSignal: abortController.signal,  // Pass abort signal to workflow
    });

    // Step 3: Save results
    if (result.success) {
      // Mark job as complete FIRST to prevent race conditions with async progress updates
      progressEmitter.complete(jobId);

      // Save full result data (matching backend inline mode format)
      await taskManager.completeTask(jobId, {
        success: result.success,
        totalPages: result.totalPages,
        totalChunks: result.totalChunks,
        processingTime: result.processingTime,
        summary: {
          unitsCount: result.buildingData?.units?.length || 0,
          paymentPlansCount: result.buildingData?.paymentPlans?.length || 0,
          amenitiesCount: result.buildingData?.amenities?.length || 0,
          projectImagesCount: result.buildingData?.images?.projectImages?.length || 0,
          floorPlanImagesCount: result.buildingData?.images?.floorPlanImages?.length || 0,
        },
        buildingData: result.buildingData,
        errors: result.errors,
        warnings: result.warnings,
      });
      console.log(`   [100%] Processing complete!`);

      /**
       * 抽取质检 —— **一个"成功"的 job 完全可能什么都没抽出来**。
       * 客户传了 200 页楼书,拿回一个空壳,而系统显示"处理完成"。
       *
       * 这里把「成功」拆成可优化的维度:户型抽到了吗、价格/面积填充率多少、
       * 有没有坐标(没坐标 = 项目上不了地图)、有没有图。
       * 分数落 quality_samples(带 jobId,**可回溯到原 PDF —— 源文件是永久归档的**),
       * 失败的规则进 quality.rule 指标 → **哪个字段最常缺,就是下一个该改的抽取 agent**。
       */
      void runAudit('pdf_extract', jobId, result.buildingData, PDF_RULES, {
        totalPages: result.totalPages,
        totalChunks: result.totalChunks,
        processingTimeMs: result.processingTime,
      }).catch((e) => console.error('[quality] pdf audit failed:', e));

      // ⭐ 永久归档源 PDF(2026-07-09):成功处理后把 pending-pdfs/ 的原始 PDF 复制到
      // pdf-archive/(永不自动清理),供以后 pipeline 改进时重跑验证/优化。非致命。
      try {
        const { archivePdfsForJob } = await import('../services/r2-cleanup');
        await archivePdfsForJob(jobId);
      } catch (e) {
        console.warn(`   ⚠️  PDF archive skipped for ${jobId}:`, (e as Error).message);
      }

      // NOTE: pending-pdfs/ 的原始 PDF 处理后暂留(审核页可下载对比),提交/删任务时
      // 清理(admin-tasks DELETE /:jobId 与 /:jobId/pdfs),scripts/cleanup-pending-pdfs.ts
      // 作为孤儿兜底。永久副本已在 pdf-archive/,清 pending 不影响重跑验证。

      console.log(`\n✅ Job ${jobId} completed successfully`);
      console.log(`   Processing time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
      console.log(`   Total pages: ${result.totalPages}`);
      console.log(`   Chunks processed: ${result.totalChunks}`);
    } else if (result.aborted) {
      console.log(`\n⏸️  Job ${jobId} was aborted`);
    } else {
      throw new Error(result.errors.join('; ') || 'Unknown processing error');
    }

  } catch (error) {
    // Don't mark as failed if it was cancelled
    if (abortController.signal.aborted) {
      console.log(`⏹️  Job ${jobId} was cancelled`);
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Job ${jobId} failed:`, errorMessage);

    await taskManager.failTask(jobId, [errorMessage]);
    throw error;

  } finally {
    // Stop cancellation monitor
    clearInterval(cancelMonitor);
    activeAbortControllers.delete(jobId);

    // Cleanup temp directory
    try {
      if (existsSync(tempDir)) {
        await rm(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      console.error(`   Warning: Failed to cleanup temp dir:`, cleanupError);
    }
  }
}

/**
 * Update progress in database
 */
async function updateProgress(
  jobId: string,
  message: string,
  progress: number
): Promise<void> {
  try {
    await taskManager.updateStatus(jobId, 'processing', {
      progress,
      currentStage: message,
    });
    console.log(`   [${progress}%] ${message}`);
  } catch (error) {
    console.error(`   Failed to update progress:`, error);
  }
}
