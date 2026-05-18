ALTER TABLE partner_properties
  ADD COLUMN IF NOT EXISTS gallery_sections jsonb NOT NULL DEFAULT '[]'::jsonb;
