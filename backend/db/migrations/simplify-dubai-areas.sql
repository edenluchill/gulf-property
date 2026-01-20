-- ============================================================================
-- 简化 dubai_areas 表 - 移除不需要的字段
-- ============================================================================

-- 1. 删除现有的默认/测试数据
DELETE FROM dubai_areas;

-- 2. 移除不需要的字段
ALTER TABLE dubai_areas 
DROP COLUMN IF EXISTS area_type,
DROP COLUMN IF EXISTS wealth_level,
DROP COLUMN IF EXISTS cultural_attribute;

-- 3. 确保必要字段存在
ALTER TABLE dubai_areas 
ADD COLUMN IF NOT EXISTS project_counts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS average_price NUMERIC(12, 2),
ADD COLUMN IF NOT EXISTS sales_volume NUMERIC(12, 2),
ADD COLUMN IF NOT EXISTS capital_appreciation NUMERIC(5, 2),
ADD COLUMN IF NOT EXISTS rental_yield NUMERIC(5, 2);

-- 4. 添加唯一约束（如果还没有）
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'dubai_areas_name_unique'
    ) THEN
        ALTER TABLE dubai_areas ADD CONSTRAINT dubai_areas_name_unique UNIQUE (name);
    END IF;
END $$;

-- 完成
SELECT 'Dubai areas table simplified successfully!' as status;
