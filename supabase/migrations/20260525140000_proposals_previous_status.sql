-- ============================================================
-- proposals.previous_status — snapshot of a proposal's status
-- immediately before an accept-cascade flipped it. Lets the
-- "Move back to Responded" action restore each proposal to its
-- exact pre-booking state instead of guessing (the old code
-- defaulted superseded siblings back to 'sent' even when they
-- were still 'drafting' pre-cascade).
--
-- Populated by closeEnquiryOnProposalAccept (cascading siblings)
-- and by markProposalOutcome (the accepted proposal itself).
-- Cleared on reopen so a future accept gets a fresh snapshot.
-- ============================================================

BEGIN;

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS previous_status text;

COMMIT;
