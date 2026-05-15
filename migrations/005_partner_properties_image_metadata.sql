-- ============================================================
-- 005: partner_properties.image_metadata
-- ============================================================
-- Per-image annotations (caption + show-in-brochure flag) keyed by URL.
-- Shape: { "<url>": { "caption": "...", "show_in_brochure": true } }
--
-- Non-breaking: gallery_images keeps the canonical URL list + ordering.
-- Readers that don't care about metadata can keep ignoring this column.
-- A missing entry means "no caption, show by default" — so existing
-- properties behave exactly as they did before this migration.
-- ============================================================

ALTER TABLE partner_properties
  ADD COLUMN IF NOT EXISTS image_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
