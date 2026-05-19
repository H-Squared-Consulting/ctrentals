-- Allow proposals.status to carry terminal 'booked' / 'cancelled' values.
--
-- Enquiry-rooted deals close via the enquiry's own status, but standalone
-- proposals (FAB-created, no enquiry) have no enquiry to flip — so the
-- proposal itself needs to carry the outcome. The Pipeline UI exposes
-- Mark Booked / Cancel actions that write to this column for standalone
-- deals.
--
-- Defensive: drop the existing check constraint if it exists, then add
-- a new one covering the original lifecycle + the two new outcomes.

ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_status_check;

ALTER TABLE proposals ADD CONSTRAINT proposals_status_check
  CHECK (status IN (
    'draft', 'sent', 'viewed', 'interested',
    'expired', 'archived',
    'booked', 'cancelled'
  ));
