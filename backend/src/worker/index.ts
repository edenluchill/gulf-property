/**
 * Pinzos PDF Processing Worker
 *
 * Runs as a separate service from the main API (image: pinzos-worker,
 * built via Dockerfile.worker, CMD node dist/worker/index.js).
 * Polls database for pending jobs and processes PDFs.
 *
 * Benefits:
 * - Main API stays responsive
 * - Worker can use full CPU/memory for PDF processing
 * - If worker crashes, API still works
 * - Can scale workers independently
 *
 * Ported from the legacy standalone worker/ package (2026-06) so the worker
 * runs against backend/src directly — single source of truth for langgraph.
 */

import 'dotenv/config';
import { JobPoller } from './job-poller';
import { processJob } from './job-processor';
import { startWorkerTelemetry } from '../telemetry/worker';
import { counter, histogram } from '../telemetry';

// Configuration
const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL || '3000', 10);
const MAX_CONCURRENT_JOBS = parseInt(process.env.WORKER_MAX_CONCURRENT || '1', 10);
const WORKER_ID = `worker-${process.pid}-${Date.now().toString(36)}`;

console.log(`
╔════════════════════════════════════════════════════════════════╗
║            Pinzos PDF Processing Worker                        ║
╠════════════════════════════════════════════════════════════════╣
║  Worker ID: ${WORKER_ID.padEnd(40)}║
║  Poll Interval: ${String(POLL_INTERVAL_MS + 'ms').padEnd(36)}║
║  Max Concurrent Jobs: ${String(MAX_CONCURRENT_JOBS).padEnd(30)}║
║  Node Memory: ${String(process.env.NODE_OPTIONS || 'default').padEnd(33)}║
╚════════════════════════════════════════════════════════════════╝
`);

// Graceful shutdown handling
let isShuttingDown = false;
const activeJobs = new Set<string>();

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n⚠️  Received ${signal}, shutting down gracefully...`);
  console.log(`   Active jobs: ${activeJobs.size}`);

  if (activeJobs.size > 0) {
    console.log(`   Waiting for active jobs to complete...`);
    const maxWait = 300000; // 5 minutes max wait
    const startWait = Date.now();
    while (activeJobs.size > 0 && Date.now() - startWait < maxWait) {
      await new Promise(r => setTimeout(r, 5000));
      console.log(`   Still waiting for ${activeJobs.size} job(s)...`);
    }
  }

  console.log(`✅ Worker shutdown complete`);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Main worker loop
async function main() {
  const poller = new JobPoller({
    pollIntervalMs: POLL_INTERVAL_MS,
    maxConcurrentJobs: MAX_CONCURRENT_JOBS,
    workerId: WORKER_ID,
  });

  // worker 是**独立进程** —— API 里那句 startTelemetry() 它跑不到,所以在这之前
  // 整条 PDF 管线内部零遥测。同一道生产门(本地 dev 连的是生产库,不许写)。
  if (process.env.NODE_ENV === 'production') startWorkerTelemetry();

  console.log(`🚀 Worker started, polling for jobs...`);

  poller.on('job', async (job) => {
    const jobId = job.job_id;

    if (isShuttingDown) {
      console.log(`⚠️  Skipping job ${jobId} - worker is shutting down`);
      return;
    }

    activeJobs.add(jobId);
    console.log(`\n📥 Processing job: ${jobId}`);

    // jobId **绝不能进 label**(基数会炸)—— 它只进日志和表。
    const t0 = Date.now();
    counter('pdf.job.started').inc();
    try {
      await processJob(job);
      counter('pdf.job', { result: 'completed' }).inc();
      histogram('pdf.job.total_ms').observe(Date.now() - t0);
      console.log(`✅ Job ${jobId} completed`);
    } catch (error) {
      counter('pdf.job', { result: 'failed' }).inc();
      histogram('pdf.job.total_ms').observe(Date.now() - t0);
      console.error(`❌ Job ${jobId} failed:`, error);
    } finally {
      activeJobs.delete(jobId);
      poller.notifyJobDone(jobId);  // 通知 poller 任务完成，释放槽位
    }
  });

  poller.on('error', (error) => {
    console.error('❌ Poller error:', error);
  });

  // Start polling
  await poller.start();
}

main().catch((error) => {
  console.error('💥 Worker fatal error:', error);
  process.exit(1);
});
