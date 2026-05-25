-- ============================================================
-- enquiries.subject — required 1-line summary written by Hayley
-- at capture time. Solves the "5 enquiries from the same agent
-- look identical on the kanban" problem by making the subject
-- the headline on every deal card. Existing rows get a NULL
-- subject and fall back to the old property/dates headline
-- derivation in the UI.
--
-- text NULL is intentional — we don't require it at the DB
-- layer so the backfill can leave old rows alone. The form
-- enforces required at capture for new rows.
-- ============================================================

BEGIN;

ALTER TABLE enquiries
  ADD COLUMN IF NOT EXISTS subject text;

COMMIT;
