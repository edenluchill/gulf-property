-- Area is a manually-curated map layer; projects whose coordinates fall
-- outside every dubai_areas polygon legitimately have NO area (2026-06-12).
ALTER TABLE residential_projects ALTER COLUMN area DROP NOT NULL;
