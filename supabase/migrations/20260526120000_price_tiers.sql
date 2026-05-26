-- Price tiers for the global search + cross-platform pricing filter.
--
-- The team filters properties by "what tier the guest can afford"
-- (Very low / Low / Medium / High / Very high). Tier thresholds
-- live here, one row per (partner_id, channel) since direct, agent
-- and platform deals each produce different "guest pays" rates
-- against the same baseline. UI computes sensible defaults from
-- the current inventory's peak-season guest-pays distribution
-- (quintiles) the first time the page is opened, and writes them
-- here so the admin sees + can override.

CREATE TABLE IF NOT EXISTS price_tiers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id    uuid NOT NULL,
  channel       text NOT NULL CHECK (channel IN ('direct','agent','platform')),
  -- Four upper-bound thresholds defining the five tiers:
  --   Very low ≤ threshold_1 < Low ≤ threshold_2 < Medium ≤ threshold_3
  --   < High ≤ threshold_4 < Very high
  -- Values are per-night ZAR amounts on the GUEST PAYS rate at peak
  -- season for the given channel (the always-most-expensive figure
  -- so a "Medium" pick truly is "everything the guest can afford
  -- including peak season").
  threshold_1   numeric(12,2) NOT NULL,
  threshold_2   numeric(12,2) NOT NULL,
  threshold_3   numeric(12,2) NOT NULL,
  threshold_4   numeric(12,2) NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, channel),
  CHECK (threshold_1 < threshold_2 AND threshold_2 < threshold_3 AND threshold_3 < threshold_4)
);

CREATE INDEX IF NOT EXISTS idx_price_tiers_partner ON price_tiers (partner_id);

ALTER TABLE price_tiers ENABLE ROW LEVEL SECURITY;

-- Explicit grants so the authenticated role can reach the table
-- in the first place (RLS still gates the actual rows). `supabase
-- db push` does this automatically; we include it for runs that
-- happen via the SQL editor / psql where the auto-grant doesn't
-- fire.
GRANT SELECT, INSERT, UPDATE, DELETE ON price_tiers TO authenticated;

DROP POLICY IF EXISTS price_tiers_select ON price_tiers;
CREATE POLICY price_tiers_select ON price_tiers
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS price_tiers_insert ON price_tiers;
CREATE POLICY price_tiers_insert ON price_tiers
  FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS price_tiers_update ON price_tiers;
CREATE POLICY price_tiers_update ON price_tiers
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS price_tiers_delete ON price_tiers;
CREATE POLICY price_tiers_delete ON price_tiers
  FOR DELETE TO authenticated USING (true);
