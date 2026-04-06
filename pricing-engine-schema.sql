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
