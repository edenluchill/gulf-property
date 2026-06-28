-- user_favorites — server-side persistence for the favorites feature.
--
-- Until now favorites lived ONLY in localStorage (frontend/src/lib/favorites.ts,
-- key 'pinzos-favorites'): lost on device switch, never synced, invisible to the
-- owner dashboard / lead engine. This table backs a logged-in user's favorites so
-- they survive devices and merge their pre-login (anonymous, localStorage) picks.
--
-- One row = one favorite item:
--   • project-level favorite → unit_type_id = ''   (the empty-string sentinel)
--   • unit-type favorite     → unit_type_id = '<id>'
-- The '' sentinel (not NULL) keeps the UNIQUE constraint dedupe-correct, since
-- NULLs are never equal in a UNIQUE index. Merge is idempotent via ON CONFLICT.

CREATE TABLE IF NOT EXISTS user_favorites (
  id           BIGSERIAL PRIMARY KEY,
  user_id      TEXT NOT NULL,                       -- supabase auth user.id
  project_id   UUID NOT NULL,
  unit_type_id TEXT NOT NULL DEFAULT '',            -- '' = project-level favorite
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id, unit_type_id)
);

CREATE INDEX IF NOT EXISTS idx_user_favorites_user ON user_favorites (user_id);
