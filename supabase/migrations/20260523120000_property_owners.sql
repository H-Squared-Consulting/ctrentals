-- ============================================================
-- Property owners — many-to-many between partner_properties and
-- home_owners. Replaces the single-owner FK with a join table so
-- joint ownership (spouses, trusts with multiple trustees, co-
-- investors) can be represented honestly.
--
-- partner_properties.owner_id stays in place for now so any code
-- still reading it keeps working. A follow-up migration drops it
-- once every reader has been migrated to property_owners.
--
-- Wrapped in a single transaction so either everything lands or
-- nothing does.
-- ============================================================

BEGIN;

-- 1. Join table.
CREATE TABLE IF NOT EXISTS property_owners (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid NOT NULL REFERENCES partner_properties(id) ON DELETE CASCADE,
  owner_id        uuid NOT NULL REFERENCES home_owners(id)       ON DELETE RESTRICT,
  -- Ownership share. Nullable for properties where the split isn't
  -- known or doesn't apply. Validates 0-100 but we don't enforce
  -- that the sum across rows equals 100 — sometimes it doesn't
  -- (e.g. a third party retains a residual interest).
  ownership_pct   numeric(5,2) CHECK (ownership_pct IS NULL OR (ownership_pct >= 0 AND ownership_pct <= 100)),
  -- The contact / main party for this property. The UI promotes the
  -- primary owner's name/email when listing properties; a partial
  -- unique index below enforces at most one primary per property.
  is_primary      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, owner_id)
);

CREATE INDEX IF NOT EXISTS idx_property_owners_property ON property_owners (property_id);
CREATE INDEX IF NOT EXISTS idx_property_owners_owner    ON property_owners (owner_id);

-- At most one primary per property. Partial index so non-primary
-- rows don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS property_owners_one_primary
  ON property_owners (property_id)
  WHERE is_primary = true;

-- 2. Backfill from the existing single owner_id FK.
--    Every property with an owner becomes one is_primary=true row.
INSERT INTO property_owners (property_id, owner_id, is_primary)
SELECT id, owner_id, true
FROM partner_properties
WHERE owner_id IS NOT NULL
ON CONFLICT (property_id, owner_id) DO NOTHING;

-- 3. RLS — mirror the rest of the partner-scoped tables.
ALTER TABLE property_owners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS property_owners_select ON property_owners;
CREATE POLICY property_owners_select ON property_owners
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS property_owners_insert ON property_owners;
CREATE POLICY property_owners_insert ON property_owners
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS property_owners_update ON property_owners;
CREATE POLICY property_owners_update ON property_owners
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS property_owners_delete ON property_owners;
CREATE POLICY property_owners_delete ON property_owners
  FOR DELETE TO authenticated USING (true);

COMMIT;
