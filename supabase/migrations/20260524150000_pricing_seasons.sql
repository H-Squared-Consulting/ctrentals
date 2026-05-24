-- ============================================================
-- Pricing seasons — 4-tier seasonal model with auto-suggest +
-- per-cell overrides + per-property Fixed mode (3rd-party rates).
--
-- Model:
--   1. `seasons` is the global 4-tier definition per partner. Keys
--      are fixed (peak / high / shoulder / winter); dates and the
--      multiplier are editable on /settings/seasons. Each season
--      can have multiple date ranges (Shoulder = Mar-Apr + Oct-Dec).
--      Multipliers are relative to Peak (Peak = 1.000).
--
--   2. `partner_properties.pricing_mode` flags how a property's
--      rates are computed:
--        'system' — Peak rate × season multiplier; optional per-cell
--                   override in `property_season_overrides`.
--        'fixed'  — 3rd-party agency sets guest rate; owner has a
--                   pre-agreed rate. Platform earn = (guest − owner)
--                   ÷ 2 split with the agent. Per-season values live
--                   in `property_fixed_rates`.
--
--   3. Existing `baselines.daily_rate` stays in place AS the property's
--      Peak rate. No row migration needed for backfill; the new model
--      reads `baselines.daily_rate` as the anchor and derives every
--      other season from it.
--
-- Wrapped in a single transaction so either everything lands or
-- nothing does.
-- ============================================================

BEGIN;

-- 1. Global seasons table — 4 fixed tiers per partner.
CREATE TABLE IF NOT EXISTS seasons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id   uuid NOT NULL,
  key          text NOT NULL CHECK (key IN ('peak','high','shoulder','winter')),
  name         text NOT NULL,
  multiplier   numeric(5,3) NOT NULL DEFAULT 1.000 CHECK (multiplier > 0),
  -- Array of {start, end} pairs, each side in MM-DD format. Allows a
  -- season to cover non-contiguous date ranges (e.g. Shoulder bookends
  -- Winter). Wrap-around (e.g. Peak: 12-15 → 01-15) is handled in the
  -- season-lookup helper, not in SQL.
  date_ranges  jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, key)
);

CREATE INDEX IF NOT EXISTS idx_seasons_partner ON seasons (partner_id);

-- 2. Per-property pricing mode. 'system' default keeps every existing
--    property on the old straight baseline path; flip to 'fixed' for
--    the handful of outliers with 3rd-party-set guest rates.
ALTER TABLE partner_properties
  ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'system'
  CHECK (pricing_mode IN ('system','fixed'));

-- 3. Per-cell overrides for System-mode properties. One row per
--    (property, year, season) that deviates from `peak × multiplier`.
--    Absence of a row = use the auto-suggested value.
CREATE TABLE IF NOT EXISTS property_season_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES partner_properties(id) ON DELETE CASCADE,
  year           int  NOT NULL,
  season_id      uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  override_rate  numeric NOT NULL CHECK (override_rate >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, year, season_id)
);

CREATE INDEX IF NOT EXISTS idx_property_season_overrides_lookup
  ON property_season_overrides (property_id, year, season_id);

-- 4. Per-season guest/owner rates for Fixed-mode properties.
--    Guest rate set by 3rd party; owner rate pre-agreed.
--    Platform earn per night = (guest − owner) ÷ 2 (the other half goes
--    to the agent). Either side may be NULL while in setup.
CREATE TABLE IF NOT EXISTS property_fixed_rates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  uuid NOT NULL REFERENCES partner_properties(id) ON DELETE CASCADE,
  year         int  NOT NULL,
  season_id    uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  guest_rate   numeric CHECK (guest_rate IS NULL OR guest_rate >= 0),
  owner_rate   numeric CHECK (owner_rate IS NULL OR owner_rate >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, year, season_id)
);

CREATE INDEX IF NOT EXISTS idx_property_fixed_rates_lookup
  ON property_fixed_rates (property_id, year, season_id);

-- 5. Seed the 4 seasons for the CT Rentals partner. Multipliers are
--    reverse-engineered from Hayley's confirmed nightly numbers
--    (Peak R120k → ×1.000; High R100k → ×0.833; Shoulder R90k → ×0.750;
--    Winter R75k → ×0.625). Date ranges follow the Cape Town short-let
--    cycle. All four are editable on /settings/seasons.
INSERT INTO seasons (partner_id, key, name, multiplier, date_ranges, sort_order)
VALUES
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'peak',     'Peak',     1.000,
    '[{"start":"12-15","end":"01-15"}]'::jsonb, 1),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'high',     'High',     0.830,
    '[{"start":"01-16","end":"03-15"}]'::jsonb, 2),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'shoulder', 'Shoulder', 0.750,
    '[{"start":"03-16","end":"04-30"},{"start":"10-01","end":"12-14"}]'::jsonb, 3),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'winter',   'Winter',   0.625,
    '[{"start":"05-01","end":"09-30"}]'::jsonb, 4)
ON CONFLICT (partner_id, key) DO NOTHING;

-- 6. RLS — mirror the rest of the partner-scoped tables.
ALTER TABLE seasons                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_season_overrides  ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_fixed_rates       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seasons_select ON seasons;
CREATE POLICY seasons_select ON seasons FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS seasons_insert ON seasons;
CREATE POLICY seasons_insert ON seasons FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS seasons_update ON seasons;
CREATE POLICY seasons_update ON seasons FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS seasons_delete ON seasons;
CREATE POLICY seasons_delete ON seasons FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS property_season_overrides_select ON property_season_overrides;
CREATE POLICY property_season_overrides_select ON property_season_overrides FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS property_season_overrides_insert ON property_season_overrides;
CREATE POLICY property_season_overrides_insert ON property_season_overrides FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS property_season_overrides_update ON property_season_overrides;
CREATE POLICY property_season_overrides_update ON property_season_overrides FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS property_season_overrides_delete ON property_season_overrides;
CREATE POLICY property_season_overrides_delete ON property_season_overrides FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS property_fixed_rates_select ON property_fixed_rates;
CREATE POLICY property_fixed_rates_select ON property_fixed_rates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS property_fixed_rates_insert ON property_fixed_rates;
CREATE POLICY property_fixed_rates_insert ON property_fixed_rates FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS property_fixed_rates_update ON property_fixed_rates;
CREATE POLICY property_fixed_rates_update ON property_fixed_rates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS property_fixed_rates_delete ON property_fixed_rates;
CREATE POLICY property_fixed_rates_delete ON property_fixed_rates FOR DELETE TO authenticated USING (true);

-- 7. Table-level GRANTs. RLS gates row visibility but PostgreSQL still
--    requires the role to hold the table-level privilege before any
--    policy is even consulted. Without these the admin portal hits
--    "permission denied" on every write (the lesson from #30).
GRANT SELECT, INSERT, UPDATE, DELETE ON seasons                   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON property_season_overrides TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON property_fixed_rates      TO authenticated;

COMMIT;
