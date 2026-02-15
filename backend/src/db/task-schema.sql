-- PDF Processing Tasks Table
-- Stores state for background PDF processing tasks with support for
-- pause/resume, progress tracking, and checkpoint-based recovery

CREATE TABLE IF NOT EXISTS pdf_processing_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id VARCHAR(100) UNIQUE NOT NULL,
    user_id VARCHAR(255) NOT NULL DEFAULT 'anonymous',  -- Changed from UUID to VARCHAR for flexibility
    user_email VARCHAR(255),

    -- 任务信息
    task_name VARCHAR(500),
    pdf_count INTEGER NOT NULL DEFAULT 1,
    pdf_names TEXT[] DEFAULT '{}',
    total_pages INTEGER,

    -- 状态: pending | uploading | processing | paused | completed | failed | cancelled
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    progress INTEGER NOT NULL DEFAULT 0,
    current_stage VARCHAR(100),

    -- 暂停/恢复支持
    paused_at TIMESTAMP WITH TIME ZONE,
    checkpoint_data JSONB,  -- 保存恢复所需状态

    -- 处理进度
    total_chunks INTEGER,
    processed_chunks INTEGER DEFAULT 0,

    -- 结果
    result_data JSONB,
    errors TEXT[] DEFAULT '{}',

    -- 时间
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_pdf_tasks_user_id ON pdf_processing_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_pdf_tasks_status ON pdf_processing_tasks(status);
CREATE INDEX IF NOT EXISTS idx_pdf_tasks_job_id ON pdf_processing_tasks(job_id);
CREATE INDEX IF NOT EXISTS idx_pdf_tasks_created_at ON pdf_processing_tasks(created_at DESC);

-- Index for finding active (in-progress or paused) tasks
CREATE INDEX IF NOT EXISTS idx_pdf_tasks_active ON pdf_processing_tasks(user_id, status)
    WHERE status IN ('pending', 'uploading', 'processing', 'paused');

-- Trigger for auto-updating updated_at
CREATE OR REPLACE FUNCTION update_pdf_task_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_pdf_processing_tasks_updated_at ON pdf_processing_tasks;
CREATE TRIGGER update_pdf_processing_tasks_updated_at
    BEFORE UPDATE ON pdf_processing_tasks
    FOR EACH ROW EXECUTE FUNCTION update_pdf_task_updated_at();
