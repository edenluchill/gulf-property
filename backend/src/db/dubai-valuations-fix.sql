-- Fix dld_valuations primary key (2026-06-18). The original used procedure_id as
-- PK, but procedure_id is a CONSTANT type code in this dataset — the real unique
-- key is (procedure_year, procedure_number). Table is empty, no dependents, so a
-- clean drop+recreate is safe.
DROP TABLE IF EXISTS dld_valuations;

CREATE TABLE dld_valuations (
  procedure_year       INTEGER NOT NULL,
  procedure_number     INTEGER NOT NULL,
  procedure_id         VARCHAR(60),
  instance_date        DATE,
  property_type        VARCHAR(50),
  property_sub_type    VARCHAR(100),
  area_id              INTEGER,
  area_name            VARCHAR(150),
  actual_area          NUMERIC,
  actual_worth         NUMERIC,
  property_total_value NUMERIC,
  load_timestamp       TIMESTAMPTZ,
  PRIMARY KEY (procedure_year, procedure_number)
);
CREATE INDEX IF NOT EXISTS idx_dld_valuations_area ON dld_valuations(area_id);
CREATE INDEX IF NOT EXISTS idx_dld_valuations_date ON dld_valuations(instance_date);
