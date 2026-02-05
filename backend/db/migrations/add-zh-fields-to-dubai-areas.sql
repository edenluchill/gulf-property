-- Replace per-language columns with a single JSONB translations column.
-- Structure: { "zh": { "name": "...", "description": "...", "aiSummary": "..." }, "fr": { ... } }
-- English stays in the existing `name` / `description` / `ai_summary` columns (default fallback).
-- Arabic stays in `name_ar` / `description_ar` (already deployed).

ALTER TABLE dubai_areas
ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}';
