-- Migration: Add pdf_urls column for worker architecture
-- This stores R2 keys for uploaded PDFs so workers can download them

-- Add pdf_urls column to store R2 keys for each PDF
ALTER TABLE pdf_processing_tasks
ADD COLUMN IF NOT EXISTS pdf_urls TEXT[] DEFAULT '{}';

-- Add metadata column for additional job info
ALTER TABLE pdf_processing_tasks
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Add worker_id column to track which worker is processing the job
ALTER TABLE pdf_processing_tasks
ADD COLUMN IF NOT EXISTS worker_id VARCHAR(100);

-- Add index for pending jobs (worker polling optimization)
CREATE INDEX IF NOT EXISTS idx_pdf_tasks_pending
ON pdf_processing_tasks(created_at ASC)
WHERE status = 'pending';

-- Add index for worker status queries
CREATE INDEX IF NOT EXISTS idx_pdf_tasks_worker
ON pdf_processing_tasks(worker_id, status)
WHERE worker_id IS NOT NULL;

COMMENT ON COLUMN pdf_processing_tasks.pdf_urls IS 'R2 keys for uploaded PDFs (e.g., pending-pdfs/job123/document.pdf)';
COMMENT ON COLUMN pdf_processing_tasks.metadata IS 'Additional job metadata (file sizes, upload timestamps, etc.)';
COMMENT ON COLUMN pdf_processing_tasks.worker_id IS 'ID of worker processing this job (for debugging)';
