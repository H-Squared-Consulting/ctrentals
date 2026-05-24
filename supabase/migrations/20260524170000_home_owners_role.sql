-- ============================================================
-- home_owners.role — promote the table from "property owners
-- only" to "everyone associated with a property except guests".
--
-- Roles cover the people Hayley actually needs to reach: the
-- owner, the house manager, the domestic, the gardener, plus
-- a catch-all 'other'. Existing rows default to 'owner' so
-- nothing in the app breaks before a sweep through the data.
--
-- The table name stays `home_owners` to avoid a destabilising
-- rename; the UI exposes it as the "People" menu. A later
-- cleanup can rename the table once every reference is moved.
-- ============================================================

BEGIN;

ALTER TABLE home_owners
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'owner'
  CHECK (role IN ('owner', 'manager', 'domestic', 'gardener', 'other'));

-- Index so filtering by role is fast even at portfolio scale.
CREATE INDEX IF NOT EXISTS idx_home_owners_role ON home_owners (role);

COMMIT;
