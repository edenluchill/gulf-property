-- OA (Owners Association) service charges from data.dubai dld_oa_service_charges-open-api.
-- One row per (community / property_group / project, usage, budget_year, service_category).
-- service_cost is AED per sqft for THAT category — sum categories per project/year for the total.
CREATE TABLE IF NOT EXISTS dld_service_charges (
  id                        BIGSERIAL PRIMARY KEY,
  master_community_id       BIGINT,
  master_community_name_en  TEXT,
  master_community_name_ar  TEXT,
  property_group_id         BIGINT,
  property_group_name_en    TEXT,
  property_group_name_ar    TEXT,
  project_id                BIGINT,
  project_name              TEXT,
  usage_id                  INT,
  usage_name_en             TEXT,
  usage_name_ar             TEXT,
  budget_year               INT,
  service_cost              NUMERIC,
  service_category_id       INT,
  service_category_name_en  TEXT,
  service_category_name_ar  TEXT,
  management_company_id     BIGINT,
  management_company_name_en TEXT,
  management_company_name_ar TEXT,
  load_timestamp            TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sc_project   ON dld_service_charges(project_id);
CREATE INDEX IF NOT EXISTS idx_sc_pgroup    ON dld_service_charges(property_group_id);
CREATE INDEX IF NOT EXISTS idx_sc_community  ON dld_service_charges(master_community_id);
CREATE INDEX IF NOT EXISTS idx_sc_comm_name ON dld_service_charges(master_community_name_en);
CREATE INDEX IF NOT EXISTS idx_sc_year      ON dld_service_charges(budget_year);
