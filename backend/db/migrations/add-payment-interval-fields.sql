-- ============================================================================
-- Add Payment Interval Fields to project_payment_plans
-- ============================================================================
-- This migration adds fields to track payment intervals between milestones,
-- helping customers understand when payments are due.

-- Add interval_months field (months from previous milestone)
ALTER TABLE project_payment_plans 
ADD COLUMN IF NOT EXISTS interval_months INTEGER;

-- Add interval_description field (text description of interval)
ALTER TABLE project_payment_plans 
ADD COLUMN IF NOT EXISTS interval_description TEXT;

-- Add comments
COMMENT ON COLUMN project_payment_plans.interval_months IS 'Number of months from the previous milestone (0 for first milestone)';
COMMENT ON COLUMN project_payment_plans.interval_description IS 'Text description of the interval (e.g., "3 months after booking", "On handover")';

-- ============================================================================
-- Example data after migration:
-- ============================================================================
-- | milestone_name          | percentage | milestone_date | interval_months | interval_description      |
-- |------------------------|------------|----------------|-----------------|---------------------------|
-- | On Booking             | 20         | 2025-01-01     | 0               | At booking                |
-- | 3 Months After Booking | 10         | 2025-04-01     | 3               | 3 months after booking    |
-- | On Handover            | 70         | 2028-06-01     | 38              | On handover               |
-- ============================================================================

-- Verify the migration
\d project_payment_plans;
