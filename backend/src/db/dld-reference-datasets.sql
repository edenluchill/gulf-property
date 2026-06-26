-- ===========================================================================
-- Reference datasets from data.dubai (slow-moving → synced WEEKLY, not daily).
-- Pulled by scripts/dubai-weekly.ts via the DATASET registry (full replace).
-- Fields confirmed on PROD 2026-06-26 (cli.ts discover). See
-- docs/reports/2026-06-22-dubai-api-prod-datasets.md.
-- ===========================================================================

-- ── Projects: off-plan pipeline — progress %, escrow, developer, status ─────
CREATE TABLE IF NOT EXISTS dld_projects (
  project_id            bigint PRIMARY KEY,
  project_number        text,
  project_name          text,
  developer_id          bigint,
  developer_name        text,
  master_developer_id   bigint,
  master_developer_name text,
  project_start_date    date,
  project_end_date      date,
  project_type_ar       text,
  escrow_agent_id       bigint,
  escrow_agent_name     text,
  project_status        text,   -- ACTIVE / FINISHED / ... (English)
  project_status_ar     text,
  percent_completed     numeric,
  completion_date       date,
  cancellation_date     date,
  area_id               bigint,
  area_name_en          text,
  master_project_en     text,
  no_of_lands           integer,
  no_of_buildings       integer,
  no_of_villas          integer,
  no_of_units           integer,
  load_timestamp        timestamptz
);
CREATE INDEX IF NOT EXISTS idx_dld_projects_name      ON dld_projects (upper(project_name));
CREATE INDEX IF NOT EXISTS idx_dld_projects_area      ON dld_projects (area_id);
CREATE INDEX IF NOT EXISTS idx_dld_projects_developer ON dld_projects (developer_id);
CREATE INDEX IF NOT EXISTS idx_dld_projects_status    ON dld_projects (project_status);

-- ── OA service charges: AED/sqft per project × budget_year × category ───────
-- Net yield = gross yield − (SUM(service_cost) per project for the latest year).
CREATE TABLE IF NOT EXISTS dld_oa_service_charges (
  id                       bigserial PRIMARY KEY,
  master_community_id      bigint,
  master_community_name_en text,
  property_group_id        bigint,
  property_group_name_en   text,
  project_id               bigint,
  project_name             text,
  usage_id                 integer,
  usage_name_en            text,
  budget_year              integer,
  service_cost             numeric,   -- AED / sqft for this category
  service_category_id      integer,
  service_category_name_en text,
  management_company_id    bigint,
  management_company_name_en text,
  load_timestamp           timestamptz
);
CREATE INDEX IF NOT EXISTS idx_dld_oa_project ON dld_oa_service_charges (project_id, budget_year);
CREATE INDEX IF NOT EXISTS idx_dld_oa_pgroup  ON dld_oa_service_charges (upper(property_group_name_en));
CREATE INDEX IF NOT EXISTS idx_dld_oa_comm    ON dld_oa_service_charges (upper(master_community_name_en));

-- NOTE: deriving a clean "service charge AED/sqft per project" for net-yield needs
-- category-aware logic — `service_cost` mixes per-sqft rates with lump-sum funds
-- (e.g. "Reserved Fund"), so a naive SUM is wrong (some projects → thousands).
-- Raw rows are kept here; the net-yield integration is a separate follow-up.
