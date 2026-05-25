-- ============================================================
-- enquiries quick-entry — allow stay fields to be NULL so the
-- direct-enquiry form can save a phone-call lead with just a
-- guest name. Dates / beds / guests are filled in later from
-- the kanban edit modal when the team has them.
--
-- Mirrors the earlier proposals_dates_nullable.sql migration
-- (20260519140000) which did the same on the proposals table.
-- ============================================================

BEGIN;

ALTER TABLE enquiries
  ALTER COLUMN check_in        DROP NOT NULL,
  ALTER COLUMN check_out       DROP NOT NULL,
  ALTER COLUMN bedrooms_needed DROP NOT NULL,
  ALTER COLUMN guests_total    DROP NOT NULL;

COMMIT;
