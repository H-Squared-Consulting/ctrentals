-- ============================================================
-- Migration 999 — SMOKE TEST for Phase 1 triggers + view
-- ============================================================
-- NOT A MIGRATION. Do not apply in production.
-- Wrapped in BEGIN / ROLLBACK — leaves no data behind.
-- Run against the dev database AFTER 001-004 have been applied.
-- Each assertion raises NOTICE on pass, EXCEPTION on fail.
-- ============================================================
BEGIN;

DO $$
DECLARE
  v_partner_id  uuid;
  v_property_id uuid;
  v_baseline_id uuid;
  v_proposal_id uuid;
  v_computed    text;
  v_row_count   int;
BEGIN
  -- Fixtures
  INSERT INTO partner_directories (slug, company_name, country)
    VALUES ('smoke-test-partner-' || substr(gen_random_uuid()::text,1,8), 'Smoke Test', 'ZA')
    RETURNING id INTO v_partner_id;

  INSERT INTO partner_properties (partner_id, slug, property_name)
    VALUES (v_partner_id, 'smoke-test-prop-' || substr(gen_random_uuid()::text,1,8), 'Smoke Test Property')
    RETURNING id INTO v_property_id;

  -- -------- Baseline lock (migration 002) --------
  INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
    VALUES (v_property_id, 2026, 1000, 25000, true)
    RETURNING id INTO v_baseline_id;

  BEGIN
    UPDATE baselines SET daily_rate = 1500 WHERE id = v_baseline_id;
    RAISE EXCEPTION 'FAIL: locked baseline UPDATE should have been blocked';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    RAISE NOTICE 'PASS: locked baseline UPDATE blocked';
  END;

  BEGIN
    DELETE FROM baselines WHERE id = v_baseline_id;
    RAISE EXCEPTION 'FAIL: locked baseline DELETE should have been blocked';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    RAISE NOTICE 'PASS: locked baseline DELETE blocked';
  END;

  UPDATE baselines SET locked = false WHERE id = v_baseline_id;
  UPDATE baselines SET daily_rate = 1500 WHERE id = v_baseline_id;
  RAISE NOTICE 'PASS: unlock-then-edit succeeds';

  -- -------- Proposal immutability + transitions (migration 003) --------
  INSERT INTO pricing_proposals (
    property_id, scenario_type, baseline_used, baseline_mode,
    calc_method, commission_pct, owner_net, company_take,
    client_price_excl_vat, client_price_incl_vat, status
  ) VALUES (
    v_property_id, 'direct', 1000, 'daily',
    'margin', 15, 1000, 176.47, 1176.47, 1176.47, 'draft'
  ) RETURNING id INTO v_proposal_id;

  BEGIN
    UPDATE pricing_proposals SET owner_net = 9999 WHERE id = v_proposal_id;
    RAISE EXCEPTION 'FAIL: owner_net mutation should have been blocked';
  EXCEPTION WHEN sqlstate 'P0002' THEN
    RAISE NOTICE 'PASS: immutable field mutation blocked';
  END;

  UPDATE pricing_proposals SET status = 'live' WHERE id = v_proposal_id;
  RAISE NOTICE 'PASS: draft->live accepted';

  BEGIN
    UPDATE pricing_proposals SET status = 'draft' WHERE id = v_proposal_id;
    RAISE EXCEPTION 'FAIL: live->draft should have been blocked';
  EXCEPTION WHEN sqlstate 'P0003' THEN
    RAISE NOTICE 'PASS: illegal transition live->draft blocked';
  END;

  UPDATE pricing_proposals SET status = 'accepted' WHERE id = v_proposal_id;
  UPDATE pricing_proposals SET status = 'archived' WHERE id = v_proposal_id;
  RAISE NOTICE 'PASS: live->accepted->archived accepted';

  -- notes / expiry_date are permitted
  UPDATE pricing_proposals SET notes = 'smoke', expiry_date = CURRENT_DATE + 10
    WHERE id = v_proposal_id;
  RAISE NOTICE 'PASS: notes and expiry_date mutation allowed';

  -- -------- Computed status view (migration 004) --------
  INSERT INTO pricing_proposals (
    property_id, scenario_type, baseline_used, baseline_mode,
    calc_method, commission_pct, owner_net, company_take,
    client_price_excl_vat, client_price_incl_vat, status, expiry_date
  ) VALUES (
    v_property_id, 'direct', 1000, 'daily',
    'margin', 15, 1000, 176.47, 1176.47, 1176.47, 'live', CURRENT_DATE - 1
  ) RETURNING id INTO v_proposal_id;

  SELECT computed_status INTO v_computed
    FROM pricing_proposals_with_computed_status WHERE id = v_proposal_id;
  IF v_computed <> 'expired' THEN
    RAISE EXCEPTION 'FAIL: computed_status expected expired, got %', v_computed;
  END IF;
  RAISE NOTICE 'PASS: computed_status flips live+past-expiry to expired';

  -- Verify stored status untouched
  SELECT count(*) INTO v_row_count FROM pricing_proposals
    WHERE id = v_proposal_id AND status = 'live';
  IF v_row_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: stored status should remain live';
  END IF;
  RAISE NOTICE 'PASS: stored status preserved';

  RAISE NOTICE 'ALL SMOKE TESTS PASSED';
END $$;

ROLLBACK;
