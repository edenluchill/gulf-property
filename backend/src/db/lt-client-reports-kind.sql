-- lt_client_reports.kind — distinguishes the report type so the shared /cr/:code
-- page can branch its layout: 'proposal' (AI-matched investment proposal, the
-- original) vs 'compare' (agent hand-picks 2-4 projects → branded side-by-side
-- comparison). Additive, non-breaking; existing rows default to 'proposal'.

ALTER TABLE lt_client_reports ADD COLUMN IF NOT EXISTS kind text DEFAULT 'proposal';
