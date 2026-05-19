-- Link a sendable proposal back to the internal pricing snapshot it was
-- generated from. The pricing_proposal stays the source of truth for the
-- breakdown (owner net, CTR take, agent take, platform fee, guest price);
-- the proposal row layers guest-facing data (ref_code, guest details,
-- viewable URL, send status) on top.
--
-- Nullable + ON DELETE SET NULL so a deleted pricing snapshot doesn't
-- cascade-wipe a sent proposal — the proposal's frozen snapshot lives
-- on the proposal row's own audit history if we ever denormalise later.

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS pricing_proposal_id uuid
  REFERENCES pricing_proposals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_proposals_pricing_proposal_id
  ON proposals (pricing_proposal_id);
