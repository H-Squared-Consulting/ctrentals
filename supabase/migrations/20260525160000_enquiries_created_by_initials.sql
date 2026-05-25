-- ============================================================
-- enquiries.created_by_initials — short 2-letter tag for the
-- team member who captured the enquiry. Stamped on insert from
-- the email of the authenticated user via the userInitials
-- lookup table on the client (Nicki / Hayley / Jordon / Gary).
--
-- Surfaces as a small NT / HH / JH / GH pill on the bottom-right
-- of every deal card and feeds the "show only mine" filter on
-- the kanban toolbar.
-- ============================================================

BEGIN;

ALTER TABLE enquiries
  ADD COLUMN IF NOT EXISTS created_by_initials text;

COMMIT;
