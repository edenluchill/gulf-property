-- ============================================================================
-- DUBAI POI ENRICHMENT
-- Photos / descriptions / opening hours / official ratings for POIs.
-- Filled by scripts/enrich-pois.ts from FREE sources:
--   - Wikipedia (geosearch + pageimages): photo + extract  [CC BY-SA, credit shown]
--   - Gemini: concise bilingual description (no invented ratings)
--   - KHDA (Phase 2): official school inspection rating
-- Kept in a separate table so we can re-run enrichment without touching the
-- OSM-sourced dubai_pois rows.
-- ============================================================================

CREATE TABLE IF NOT EXISTS dubai_poi_enrichment (
    poi_id         UUID PRIMARY KEY REFERENCES dubai_pois(id) ON DELETE CASCADE,

    -- Description (neutral, 1-3 sentences)
    description     TEXT,            -- English
    description_zh  TEXT,            -- 简体中文 (target buyers)

    -- Photo (Wikipedia/Commons — CC licensed, must show credit)
    photo_url       TEXT,
    photo_credit    TEXT,            -- e.g. 'Wikipedia' + article URL

    -- Misc
    opening_hours   TEXT,

    -- KHDA official school rating (Phase 2; schools/universities only)
    khda_rating     VARCHAR(20),     -- Outstanding | Very Good | Good | Acceptable | Weak
    khda_year       INT,
    khda_url        TEXT,

    -- Provenance
    source          VARCHAR(30),     -- 'wikipedia' | 'gemini' | 'wikipedia+gemini'
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE dubai_poi_enrichment IS 'Free-source enrichment (photo/description/KHDA) for dubai_pois';
