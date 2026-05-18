-- CRM v1: Guests + Home Owners tables, plus a property → owner link
-- and an is_active flag on agents.
--
-- Scope kept minimal: core record fields only. Derived stats (total
-- spend, last stay, payouts, etc.) live in views/joins we'll add once
-- bookings/invoices data is flowing.

-- ── Guests ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  uuid NOT NULL,
  name        text NOT NULL,
  email       text,
  phone       text,
  country     text,
  source      text,        -- how they first found us (direct / agent / website / referral / ...)
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guests_partner ON guests (partner_id);
CREATE INDEX IF NOT EXISTS idx_guests_email   ON guests (lower(email));
CREATE INDEX IF NOT EXISTS idx_guests_name    ON guests (lower(name));

ALTER TABLE guests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guests_select ON guests;
CREATE POLICY guests_select ON guests
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS guests_insert ON guests;
CREATE POLICY guests_insert ON guests
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS guests_update ON guests;
CREATE POLICY guests_update ON guests
  FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS guests_delete ON guests;
CREATE POLICY guests_delete ON guests
  FOR DELETE TO authenticated
  USING (true);

-- ── Home Owners ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS home_owners (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id             uuid NOT NULL,
  name                   text NOT NULL,
  email                  text,
  phone                  text,
  company                text,
  default_commission_pct numeric(5,2),   -- 0–100, optional
  payment_notes          text,           -- bank details / payout instructions
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_home_owners_partner ON home_owners (partner_id);
CREATE INDEX IF NOT EXISTS idx_home_owners_name    ON home_owners (lower(name));

ALTER TABLE home_owners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS home_owners_select ON home_owners;
CREATE POLICY home_owners_select ON home_owners
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS home_owners_insert ON home_owners;
CREATE POLICY home_owners_insert ON home_owners
  FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS home_owners_update ON home_owners;
CREATE POLICY home_owners_update ON home_owners
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS home_owners_delete ON home_owners;
CREATE POLICY home_owners_delete ON home_owners
  FOR DELETE TO authenticated USING (true);

-- ── partner_properties → owner link ─────────────────────────────────
ALTER TABLE partner_properties
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES home_owners(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_partner_properties_owner ON partner_properties (owner_id);

-- ── Agents: active flag + phone + notes (idempotent) ────────────────
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS notes text;

CREATE INDEX IF NOT EXISTS idx_agents_is_active ON agents (is_active);
