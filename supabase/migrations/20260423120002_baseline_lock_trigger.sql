-- ============================================================
-- Migration 002 — Enforce baseline lock at the database level
-- ============================================================
-- Purpose:
--   The `locked` flag on baselines was decorative. This migration makes
--   it real by adding BEFORE UPDATE and BEFORE DELETE triggers.
--
-- Semantics (D2, D5):
--   * Trigger inspects OLD.locked. To change rates on a locked row, the
--     user must first save an unlock (locked=true -> locked=false), then
--     save the rate change. Two steps by design.
--   * While OLD.locked = true, any change to daily_rate, monthly_rate,
--     or year is rejected with BASELINE_LOCKED.
--   * While OLD.locked = true, DELETE is rejected with BASELINE_LOCKED.
--   * Toggling the lock itself (locked -> !locked with no rate change)
--     is always allowed.
-- ============================================================

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
