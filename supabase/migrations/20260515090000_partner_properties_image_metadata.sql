ALTER TABLE partner_properties
  ADD COLUMN IF NOT EXISTS image_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
