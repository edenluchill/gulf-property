-- ============================================================================
-- Migration: Add description column to project_unit_types table
-- Date: 2026-01-19
-- Purpose: Add AI-generated marketing description for each unit type
-- ============================================================================

-- Add description column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'project_unit_types' 
        AND column_name = 'description'
    ) THEN
        ALTER TABLE project_unit_types 
        ADD COLUMN description TEXT;
        
        COMMENT ON COLUMN project_unit_types.description IS 'AI-generated marketing description highlighting layout advantages, dimensions, design features, and target audience';
        
        RAISE NOTICE 'Added description column to project_unit_types table';
    ELSE
        RAISE NOTICE 'Description column already exists in project_unit_types table';
    END IF;
END $$;
