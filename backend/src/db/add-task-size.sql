-- Add total_size_bytes column to pdf_processing_tasks table
-- This stores the total file size of all uploaded PDFs in bytes

ALTER TABLE pdf_processing_tasks
ADD COLUMN IF NOT EXISTS total_size_bytes BIGINT;

-- Add comment for documentation
COMMENT ON COLUMN pdf_processing_tasks.total_size_bytes IS 'Total size of all uploaded PDF files in bytes';
