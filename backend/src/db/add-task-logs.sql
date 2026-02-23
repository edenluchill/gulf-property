-- ============================================================================
-- ADD PROCESSING LOGS TO TASKS
-- Stores structured logs for debugging production PDF processing jobs
-- ============================================================================

-- Add processing_logs column to store structured log entries
-- Each entry: { timestamp, level, stage, message, data? }
ALTER TABLE pdf_processing_tasks
ADD COLUMN IF NOT EXISTS processing_logs JSONB DEFAULT '[]'::jsonb;

-- Add debug_snapshot column to store periodic state snapshots
-- Useful for debugging stuck jobs or analyzing processing flow
ALTER TABLE pdf_processing_tasks
ADD COLUMN IF NOT EXISTS debug_snapshot JSONB;

-- Add index for searching logs (GIN index for JSONB)
CREATE INDEX IF NOT EXISTS idx_pdf_tasks_logs_gin
ON pdf_processing_tasks USING GIN (processing_logs jsonb_path_ops);

-- Comments
COMMENT ON COLUMN pdf_processing_tasks.processing_logs IS 'Structured log entries: [{timestamp, level, stage, message, data?}, ...]';
COMMENT ON COLUMN pdf_processing_tasks.debug_snapshot IS 'Periodic state snapshot for debugging: {lastUpdate, currentState, metrics, ...}';
