-- ============================================================
-- 007: Gallery sections jsonb column
-- ============================================================
-- Replaces the flat gallery_images / image_metadata / hero_image_url
-- trio with a single structured jsonb column that groups photos into
-- sections (Living Area, Master Bedroom, Pool, etc.).
--
-- Shape:
--   gallery_sections: [
--     { id, name, sort_order,
--       photos: [ { id, url, caption, is_hero, is_visible, sort_order } ] }
--   ]
--
-- The old flat columns stay in place — the admin app keeps writing them
-- in sync so brochure.html, proposal.html, and the public website don't
-- need a coordinated cut-over. The backfill that converts existing rows
-- into a single "Unsorted" section runs as a one-off via
-- scripts/_backfill-gallery-sections.mjs (JS rather than SQL because
-- looping over the URL array is easier in JS than in pg).
-- ============================================================

ALTER TABLE partner_properties
  ADD COLUMN IF NOT EXISTS gallery_sections jsonb NOT NULL DEFAULT '[]'::jsonb;
