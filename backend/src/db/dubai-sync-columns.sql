-- data.dubai 增量同步需要的列/表(增量锚点 load_timestamp + 估价表)
-- 应用:cd backend && npx ts-node scripts/db-runner.ts src/db/dubai-sync-columns.sql
ALTER TABLE dld_transactions   ADD COLUMN IF NOT EXISTS load_timestamp TIMESTAMPTZ;
ALTER TABLE dld_rent_contracts ADD COLUMN IF NOT EXISTS load_timestamp TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS dld_valuations (
  procedure_id         VARCHAR(60) PRIMARY KEY,
  instance_date        DATE,
  property_type        VARCHAR(50),
  property_sub_type    VARCHAR(100),
  area_id              INTEGER,
  area_name            VARCHAR(150),
  actual_area          NUMERIC,
  actual_worth         NUMERIC,
  property_total_value NUMERIC,
  load_timestamp       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_dld_valuations_area ON dld_valuations(area_id);
CREATE INDEX IF NOT EXISTS idx_dld_valuations_date ON dld_valuations(instance_date);
