ALTER TABLE partner_properties
  ADD COLUMN IF NOT EXISTS brochure_config jsonb NOT NULL DEFAULT '{}'::jsonb;
