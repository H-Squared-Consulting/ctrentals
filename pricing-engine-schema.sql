-- Pricing Engine — Database Schema
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- PostgreSQL (Supabase)

-- ============================================================
-- TABLE: baselines
-- Locked annual baseline rates per property
-- ============================================================
CREATE TABLE IF NOT EXISTS baselines (
  id            uuid          NOT NULL DEFAULT gen_random_uuid(),
  property_id   uuid          NOT NULL,
  year          integer       NOT NULL,
  daily_rate    numeric(12,2) NOT NULL,
  monthly_rate  numeric(12,2) NOT NULL,
  locked        boolean       DEFAULT true,
  created_at    timestamptz   DEFAULT now(),
  updated_at    timestamptz   DEFAULT now(),

  CONSTRAINT baselines_pkey PRIMARY KEY (id),
  CONSTRAINT baselines_property_year_key UNIQUE (property_id, year),
  CONSTRAINT baselines_property_id_fkey
    FOREIGN KEY (property_id) REFERENCES partner_properties(id) ON DELETE CASCADE
);

-- ============================================================
-- TABLE: season_tags
-- Seasonal multipliers (business-wide or per-property)
-- ============================================================
CREATE TABLE IF NOT EXISTS season_tags (
  id            uuid          NOT NULL DEFAULT gen_random_uuid(),
  property_id   uuid,
  name          text          NOT NULL,
  start_date    date          NOT NULL,
  end_date      date          NOT NULL,
  multiplier    numeric(4,2)  NOT NULL DEFAULT 1.0,
  created_at    timestamptz   DEFAULT now(),

  CONSTRAINT season_tags_pkey PRIMARY KEY (id),
  CONSTRAINT season_tags_property_id_fkey
    FOREIGN KEY (property_id) REFERENCES partner_properties(id) ON DELETE CASCADE
);

-- ============================================================
-- TABLE: agents
-- Booking agents with default commission rates
-- ============================================================
CREATE TABLE IF NOT EXISTS agents (
  id                      uuid          NOT NULL DEFAULT gen_random_uuid(),
  name                    text          NOT NULL,
  default_commission_pct  numeric(5,2)  NOT NULL,
  created_at              timestamptz   DEFAULT now(),

  CONSTRAINT agents_pkey PRIMARY KEY (id)
);

-- ============================================================
-- TABLE: channel_profiles
-- Platform fee profiles per property
-- ============================================================
CREATE TABLE IF NOT EXISTS channel_profiles (
  id                uuid          NOT NULL DEFAULT gen_random_uuid(),
  property_id       uuid          NOT NULL,
  platform_name     text          NOT NULL,
  platform_fee_pct  numeric(5,2)  NOT NULL DEFAULT 0,
  platform_fixed_fee numeric(12,2) NOT NULL DEFAULT 0,
  notes             text,
  created_at        timestamptz   DEFAULT now(),

  CONSTRAINT channel_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT channel_profiles_property_id_fkey
    FOREIGN KEY (property_id) REFERENCES partner_properties(id) ON DELETE CASCADE
);

-- ============================================================
-- TABLE: pricing_proposals
-- Immutable pricing snapshots (separate from existing proposals table)
-- ============================================================
CREATE TABLE IF NOT EXISTS pricing_proposals (
  id                      uuid          NOT NULL DEFAULT gen_random_uuid(),
  property_id             uuid          NOT NULL,
  scenario_type           text          NOT NULL,
  agent_id                uuid,
  channel_profile_id      uuid,
  baseline_used           numeric(12,2) NOT NULL,
  baseline_mode           text          NOT NULL,
  season_tag              text,
  season_multiplier       numeric(4,2)  DEFAULT 1.0,
  calc_method             text          NOT NULL,
  commission_pct          numeric(5,2)  NOT NULL,
  reduced_baseline        numeric(12,2),
  reduced_commission_pct  numeric(5,2),
  owner_net               numeric(12,2) NOT NULL,
  company_take            numeric(12,2) NOT NULL,
  client_price_excl_vat   numeric(12,2) NOT NULL,
  vat_enabled             boolean       DEFAULT false,
  vat_rate_pct            numeric(5,2)  DEFAULT 15.00,
  vat_amount              numeric(12,2) DEFAULT 0,
  client_price_incl_vat   numeric(12,2) NOT NULL,
  status                  text          NOT NULL DEFAULT 'draft',
  expiry_date             date,
  notes                   text,
  created_at              timestamptz   DEFAULT now(),
  updated_at              timestamptz   DEFAULT now(),

  CONSTRAINT pricing_proposals_pkey PRIMARY KEY (id),
  CONSTRAINT pricing_proposals_property_id_fkey
    FOREIGN KEY (property_id) REFERENCES partner_properties(id),
  CONSTRAINT pricing_proposals_agent_id_fkey
    FOREIGN KEY (agent_id) REFERENCES agents(id),
  CONSTRAINT pricing_proposals_channel_profile_id_fkey
    FOREIGN KEY (channel_profile_id) REFERENCES channel_profiles(id),
  CONSTRAINT pricing_proposals_scenario_type_check
    CHECK (scenario_type IN ('direct', 'agent', 'platform')),
  CONSTRAINT pricing_proposals_baseline_mode_check
    CHECK (baseline_mode IN ('daily', 'monthly')),
  CONSTRAINT pricing_proposals_calc_method_check
    CHECK (calc_method IN ('margin', 'markup')),
  CONSTRAINT pricing_proposals_status_check
    CHECK (status IN ('draft', 'live', 'accepted', 'expired', 'archived'))
);

-- ============================================================
-- TABLE: vat_settings
-- Business-level VAT configuration (single row)
-- ============================================================
CREATE TABLE IF NOT EXISTS vat_settings (
  id            uuid          NOT NULL DEFAULT gen_random_uuid(),
  vat_enabled   boolean       DEFAULT false,
  vat_rate_pct  numeric(5,2)  DEFAULT 15.00,
  updated_at    timestamptz   DEFAULT now(),

  CONSTRAINT vat_settings_pkey PRIMARY KEY (id)
);

-- Insert default VAT settings row
INSERT INTO vat_settings (vat_enabled, vat_rate_pct)
VALUES (false, 15.00);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_baselines_property_id ON baselines (property_id);
CREATE INDEX IF NOT EXISTS idx_season_tags_property_id ON season_tags (property_id);
CREATE INDEX IF NOT EXISTS idx_season_tags_dates ON season_tags (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_channel_profiles_property_id ON channel_profiles (property_id);
CREATE INDEX IF NOT EXISTS idx_pricing_proposals_property_id ON pricing_proposals (property_id);
CREATE INDEX IF NOT EXISTS idx_pricing_proposals_status ON pricing_proposals (status);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE vat_settings ENABLE ROW LEVEL SECURITY;

-- baselines policies
CREATE POLICY baselines_admin_select ON baselines FOR SELECT TO authenticated USING (is_portal_user());
CREATE POLICY baselines_admin_insert ON baselines FOR INSERT TO authenticated WITH CHECK (is_portal_user());
CREATE POLICY baselines_admin_update ON baselines FOR UPDATE TO authenticated USING (is_portal_user());
CREATE POLICY baselines_admin_delete ON baselines FOR DELETE TO authenticated USING (is_portal_user());
CREATE POLICY baselines_service ON baselines FOR ALL TO service_role USING (true) WITH CHECK (true);

-- season_tags policies
CREATE POLICY season_tags_admin_select ON season_tags FOR SELECT TO authenticated USING (is_portal_user());
CREATE POLICY season_tags_admin_insert ON season_tags FOR INSERT TO authenticated WITH CHECK (is_portal_user());
CREATE POLICY season_tags_admin_update ON season_tags FOR UPDATE TO authenticated USING (is_portal_user());
CREATE POLICY season_tags_admin_delete ON season_tags FOR DELETE TO authenticated USING (is_portal_user());
CREATE POLICY season_tags_service ON season_tags FOR ALL TO service_role USING (true) WITH CHECK (true);

-- agents policies
CREATE POLICY agents_admin_select ON agents FOR SELECT TO authenticated USING (is_portal_user());
CREATE POLICY agents_admin_insert ON agents FOR INSERT TO authenticated WITH CHECK (is_portal_user());
CREATE POLICY agents_admin_update ON agents FOR UPDATE TO authenticated USING (is_portal_user());
CREATE POLICY agents_admin_delete ON agents FOR DELETE TO authenticated USING (is_portal_user());
CREATE POLICY agents_service ON agents FOR ALL TO service_role USING (true) WITH CHECK (true);

-- channel_profiles policies
CREATE POLICY channel_profiles_admin_select ON channel_profiles FOR SELECT TO authenticated USING (is_portal_user());
CREATE POLICY channel_profiles_admin_insert ON channel_profiles FOR INSERT TO authenticated WITH CHECK (is_portal_user());
CREATE POLICY channel_profiles_admin_update ON channel_profiles FOR UPDATE TO authenticated USING (is_portal_user());
CREATE POLICY channel_profiles_admin_delete ON channel_profiles FOR DELETE TO authenticated USING (is_portal_user());
CREATE POLICY channel_profiles_service ON channel_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);

-- pricing_proposals policies
CREATE POLICY pricing_proposals_admin_select ON pricing_proposals FOR SELECT TO authenticated USING (is_portal_user());
CREATE POLICY pricing_proposals_admin_insert ON pricing_proposals FOR INSERT TO authenticated WITH CHECK (is_portal_user());
CREATE POLICY pricing_proposals_admin_update ON pricing_proposals FOR UPDATE TO authenticated USING (is_portal_user());
CREATE POLICY pricing_proposals_admin_delete ON pricing_proposals FOR DELETE TO authenticated USING (is_portal_user());
CREATE POLICY pricing_proposals_service ON pricing_proposals FOR ALL TO service_role USING (true) WITH CHECK (true);

-- vat_settings policies
CREATE POLICY vat_settings_admin_select ON vat_settings FOR SELECT TO authenticated USING (is_portal_user());
CREATE POLICY vat_settings_admin_update ON vat_settings FOR UPDATE TO authenticated USING (is_portal_user());
CREATE POLICY vat_settings_service ON vat_settings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- PHASE 1 TRIGGERS + VIEW (see migrations/002-004 for rationale)
-- ============================================================

-- Baseline lock (migrations/002)
CREATE OR REPLACE FUNCTION enforce_baseline_lock_update() RETURNS trigger AS $$
BEGIN
  IF OLD.locked = true AND (
       NEW.daily_rate   IS DISTINCT FROM OLD.daily_rate
    OR NEW.monthly_rate IS DISTINCT FROM OLD.monthly_rate
    OR NEW.year         IS DISTINCT FROM OLD.year
  ) THEN
    RAISE EXCEPTION 'BASELINE_LOCKED: unlock the baseline before editing rates'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_baseline_lock_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.locked = true THEN
    RAISE EXCEPTION 'BASELINE_LOCKED: unlock the baseline before deleting it'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS baselines_enforce_lock_update ON baselines;
CREATE TRIGGER baselines_enforce_lock_update
  BEFORE UPDATE ON baselines
  FOR EACH ROW EXECUTE FUNCTION enforce_baseline_lock_update();

DROP TRIGGER IF EXISTS baselines_enforce_lock_delete ON baselines;
CREATE TRIGGER baselines_enforce_lock_delete
  BEFORE DELETE ON baselines
  FOR EACH ROW EXECUTE FUNCTION enforce_baseline_lock_delete();

-- Pricing proposal immutability + status transition guard (migrations/003)
CREATE OR REPLACE FUNCTION enforce_pricing_proposal_immutability() RETURNS trigger AS $$
DECLARE
  allowed_transitions text[] := ARRAY[
    'draft->live', 'draft->archived',
    'live->accepted', 'live->archived', 'live->expired',
    'accepted->archived', 'expired->archived'
  ];
  t text;
BEGIN
  IF  NEW.property_id            IS DISTINCT FROM OLD.property_id
   OR NEW.scenario_type          IS DISTINCT FROM OLD.scenario_type
   OR NEW.agent_id               IS DISTINCT FROM OLD.agent_id
   OR NEW.channel_profile_id     IS DISTINCT FROM OLD.channel_profile_id
   OR NEW.baseline_used          IS DISTINCT FROM OLD.baseline_used
   OR NEW.baseline_mode          IS DISTINCT FROM OLD.baseline_mode
   OR NEW.season_tag             IS DISTINCT FROM OLD.season_tag
   OR NEW.season_multiplier      IS DISTINCT FROM OLD.season_multiplier
   OR NEW.calc_method            IS DISTINCT FROM OLD.calc_method
   OR NEW.commission_pct         IS DISTINCT FROM OLD.commission_pct
   OR NEW.reduced_baseline       IS DISTINCT FROM OLD.reduced_baseline
   OR NEW.reduced_commission_pct IS DISTINCT FROM OLD.reduced_commission_pct
   OR NEW.owner_net              IS DISTINCT FROM OLD.owner_net
   OR NEW.company_take           IS DISTINCT FROM OLD.company_take
   OR NEW.client_price_excl_vat  IS DISTINCT FROM OLD.client_price_excl_vat
   OR NEW.vat_enabled            IS DISTINCT FROM OLD.vat_enabled
   OR NEW.vat_rate_pct           IS DISTINCT FROM OLD.vat_rate_pct
   OR NEW.vat_amount             IS DISTINCT FROM OLD.vat_amount
   OR NEW.client_price_incl_vat  IS DISTINCT FROM OLD.client_price_incl_vat
   OR NEW.created_at             IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'PROPOSAL_IMMUTABLE: only status, notes, expiry_date may change on a saved proposal'
      USING ERRCODE = 'P0002';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    t := OLD.status || '->' || NEW.status;
    IF NOT (t = ANY(allowed_transitions)) THEN
      RAISE EXCEPTION 'PROPOSAL_ILLEGAL_TRANSITION: transition % is not allowed', t
        USING ERRCODE = 'P0003';
    END IF;
  END IF;

  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pricing_proposals_immutability ON pricing_proposals;
CREATE TRIGGER pricing_proposals_immutability
  BEFORE UPDATE ON pricing_proposals
  FOR EACH ROW EXECUTE FUNCTION enforce_pricing_proposal_immutability();

-- Lazy-expiry view (migrations/004)
CREATE OR REPLACE VIEW pricing_proposals_with_computed_status AS
SELECT p.*,
       CASE
         WHEN p.status = 'live'
              AND p.expiry_date IS NOT NULL
              AND p.expiry_date < CURRENT_DATE
           THEN 'expired'
         ELSE p.status
       END AS computed_status
FROM pricing_proposals p;

GRANT SELECT ON pricing_proposals_with_computed_status
  TO authenticated, service_role;
