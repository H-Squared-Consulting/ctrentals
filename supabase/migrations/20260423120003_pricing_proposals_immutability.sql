-- ============================================================
-- Migration 003 — Pricing proposals: immutability + status transition guard
-- ============================================================
-- Purpose:
--   RLS UPDATE was wide open. This migration enforces:
--     (a) Only `status`, `notes`, `expiry_date`, `updated_at` can change.
--         All other columns are immutable after insert.
--     (b) Status changes must follow the approved transition graph.
--
-- Allowed transitions (D3):
--   draft    -> live
--   draft    -> archived
--   live     -> accepted
--   live     -> archived
--   live     -> expired
--   accepted -> archived
--   expired  -> archived
--   (any other transition is rejected)
--
-- Postgres RLS cannot restrict UPDATE to specific columns, so column-level
-- enforcement is done by this trigger; RLS still gates row visibility.
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_pricing_proposal_immutability() RETURNS trigger AS $$
DECLARE
  allowed_transitions text[] := ARRAY[
    'draft->live',
    'draft->archived',
    'live->accepted',
    'live->archived',
    'live->expired',
    'accepted->archived',
    'expired->archived'
  ];
  t text;
BEGIN
  -- Immutable fields: anything not status/notes/expiry_date/updated_at.
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

  -- Status transition guard.
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

-- Replace the RLS UPDATE policy in place. Column-level restriction is
-- enforced by the trigger above; this policy continues to gate by user.
DROP POLICY IF EXISTS pricing_proposals_admin_update ON pricing_proposals;
CREATE POLICY pricing_proposals_admin_update ON pricing_proposals
  FOR UPDATE TO authenticated
  USING (is_portal_user())
  WITH CHECK (is_portal_user());
