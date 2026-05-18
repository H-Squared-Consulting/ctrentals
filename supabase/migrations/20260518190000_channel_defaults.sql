-- Global per-partner channel defaults (Airbnb fee %, Booking.com fee %, etc).
-- Until now, the per-property channel_profiles table was the only place to
-- record platform fees, which forced repeated data entry every time a new
-- property was added. The defaults table is the source of truth; the
-- per-property table remains for overrides where a specific listing has
-- non-standard terms.

CREATE TABLE IF NOT EXISTS channel_defaults (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id    uuid NOT NULL,
  platform_name text NOT NULL,
  fee_pct       numeric(5,2) NOT NULL DEFAULT 0,    -- 0–100
  fixed_fee     numeric(12,2) NOT NULL DEFAULT 0,   -- per-booking flat fee
  notes         text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, platform_name)
);

CREATE INDEX IF NOT EXISTS idx_channel_defaults_partner ON channel_defaults (partner_id);

ALTER TABLE channel_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS channel_defaults_select ON channel_defaults;
CREATE POLICY channel_defaults_select ON channel_defaults
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS channel_defaults_insert ON channel_defaults;
CREATE POLICY channel_defaults_insert ON channel_defaults
  FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS channel_defaults_update ON channel_defaults;
CREATE POLICY channel_defaults_update ON channel_defaults
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS channel_defaults_delete ON channel_defaults;
CREATE POLICY channel_defaults_delete ON channel_defaults
  FOR DELETE TO authenticated USING (true);
