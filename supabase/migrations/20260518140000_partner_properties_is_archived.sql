-- Distinguish "inactive" (temporarily hidden, can come back) from
-- "archived" (permanently retired). Before this, is_published carried
-- both meanings and the UI couldn't tell them apart.
--
-- New semantics:
--   is_published = true,  is_archived = false  → Active
--   is_published = false, is_archived = false  → Inactive (parked)
--   is_archived  = true                        → Archived (retired)
--
-- The Archive action sets is_archived = true and also forces
-- is_published = false so an archived property is never publicly
-- visible by accident.

ALTER TABLE partner_properties
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_partner_properties_is_archived
  ON partner_properties (is_archived);
