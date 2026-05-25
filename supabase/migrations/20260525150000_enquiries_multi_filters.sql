-- ============================================================
-- enquiries.bedrooms_options + enquiries.guests_options — multi-
-- value filters captured at enquiry time. Replaces the single
-- bedrooms_needed / guests_total numbers when the user wants to
-- search broader (e.g. "4 OR 5 OR 6 bed properties").
--
-- The legacy single-value columns stay populated (set to the MIN
-- of the options array) so older readers + Pipeline cards keep
-- working. Property match filter prefers the array when present,
-- falls back to the single number otherwise.
-- ============================================================

BEGIN;

ALTER TABLE enquiries
  ADD COLUMN IF NOT EXISTS bedrooms_options integer[],
  ADD COLUMN IF NOT EXISTS guests_options   integer[];

COMMIT;
