-- ============================================================
-- Migration 004 — View: pricing_proposals_with_computed_status
-- ============================================================
-- Purpose:
--   Proposals expire lazily, without a cron job. A 'live' proposal whose
--   expiry_date has passed is treated as 'expired' at read time via this
--   view. The stored status is not modified automatically — the user can
--   always manually transition live -> expired to make it permanent.
--
-- Contract:
--   * All columns from pricing_proposals are passed through unchanged.
--   * Extra column `computed_status`:
--       if status = 'live' AND expiry_date IS NOT NULL
--                        AND expiry_date < CURRENT_DATE
--         then 'expired'
--       else status
--
-- Permissions:
--   The view inherits RLS from pricing_proposals. We GRANT SELECT
--   explicitly so the Supabase REST layer can reach it.
-- ============================================================

CREATE OR REPLACE VIEW pricing_proposals_with_computed_status AS
SELECT
  p.*,
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
