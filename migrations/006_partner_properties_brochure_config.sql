-- ============================================================
-- 006: partner_properties.brochure_config
-- ============================================================
-- Per-property brochure customisation: hidden sections + photo
-- ordering override. Edited via the in-app Brochure Editor.
--
-- Shape: {
--   "hidden_sections": ["stats", "beds", "about", "amenities", "share"],
--   "photo_order": ["<url>", "<url>", ...]    -- optional override; missing falls back to gallery_images order
-- }
--
-- Non-breaking: empty / NULL config means "use defaults" — every
-- existing brochure renders exactly as it did before this migration.
-- ============================================================

ALTER TABLE partner_properties
  ADD COLUMN IF NOT EXISTS brochure_config jsonb NOT NULL DEFAULT '{}'::jsonb;
