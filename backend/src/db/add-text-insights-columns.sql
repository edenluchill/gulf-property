-- Text-layer insights columns (2026-06-12)
-- New data recovered from the PDF text layer by the text-insights pass:
-- service charge, landmark distances (project level); parking allocation (unit level).
-- All nullable / additive — safe on production.

ALTER TABLE residential_projects
  ADD COLUMN IF NOT EXISTS service_charge_per_sqft NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS landmark_distances JSONB;

COMMENT ON COLUMN residential_projects.service_charge_per_sqft IS 'Service charge in AED per sqft per year (from brochure text layer)';
COMMENT ON COLUMN residential_projects.landmark_distances IS 'Array of {name, distanceKm} landmark distances (from brochure text layer)';

ALTER TABLE project_unit_types
  ADD COLUMN IF NOT EXISTS parking_spaces NUMERIC(3,1);

COMMENT ON COLUMN project_unit_types.parking_spaces IS 'Parking allocation per unit (e.g. 1, 2, 3 — from brochure inventory table)';
