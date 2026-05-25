-- ============================================================
-- enquiries.requested_property_ids — agent-portal multi-property
-- enquiry context.
--
-- When an agent submits the multi-property form on /q/:token they
-- pick 1..N properties they want quoted. We don't auto-create
-- proposals (the team wants to consciously triage in Arrived first)
-- — instead we store the picked ids here as a suggestion.
--
-- The deal modal renders these as a "Agent requested quotes for:"
-- section with a single CTA that opens the match modal pre-checked,
-- so the team can review + generate proposals (or drop the ones
-- that aren't a fit) in one go.
--
-- NULL = legacy / non-multi enquiry. Empty array would also work
-- but NULL is unambiguous "no context supplied".
-- ============================================================

BEGIN;

ALTER TABLE enquiries
  ADD COLUMN IF NOT EXISTS requested_property_ids uuid[];

COMMIT;
