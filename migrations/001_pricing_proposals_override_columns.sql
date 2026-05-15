-- ============================================================
-- Migration 001 — Pricing proposals: override columns
-- ============================================================
-- Purpose:
--   Persist reduced-baseline and reduced-commission overrides on the
--   pricing_proposals row, alongside the ORIGINAL baseline_used and
--   commission_pct. This lets a saved proposal reproduce its own numbers
--   and show the owner concession story ("reduced from R1,200 → R1,000").
--
-- Backfill:
--   Existing rows keep NULL in both override columns. From now on,
--   baseline_used / commission_pct always hold the originals and the
--   two new columns hold the overrides (or NULL if no override was used).
-- ============================================================

ALTER TABLE pricing_proposals
  ADD COLUMN IF NOT EXISTS reduced_baseline       numeric(12,2),
  ADD COLUMN IF NOT EXISTS reduced_commission_pct numeric(5,2);

COMMENT ON COLUMN pricing_proposals.reduced_baseline IS
  'Override baseline (owner concession). NULL means baseline_used applied unchanged.';
COMMENT ON COLUMN pricing_proposals.reduced_commission_pct IS
  'Override commission %. NULL means commission_pct applied unchanged.';
