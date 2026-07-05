-- Add 'selling' (已开盘在售中) to the residential_projects status options.
-- Requested 2026-07-05: review page now offers 即将开盘 / 已开盘在售中 / 建设中 / 已建成 / 已售罄.

ALTER TABLE residential_projects
DROP CONSTRAINT IF EXISTS residential_projects_status_check;

ALTER TABLE residential_projects
ADD CONSTRAINT residential_projects_status_check
CHECK (status IN ('upcoming', 'selling', 'under-construction', 'completed', 'handed-over', 'sold-out'));
