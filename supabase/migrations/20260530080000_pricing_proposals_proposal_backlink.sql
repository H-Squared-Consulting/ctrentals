-- Adds a proposal_id back-reference on pricing_proposals so every
-- snapshot remembers which sendable proposal it served. Until now the
-- relationship was one-way: proposals.pricing_proposal_id → the LIVE
-- snapshot. Each "Edit pricing" save inserts a fresh snapshot and
-- re-points the proposal, leaving older snapshots orphaned with no way
-- to reach them from a proposal lookup.
--
-- With proposal_id in place, the agent portal can render every historical
-- pricing version attached to a proposal (audit trail + version toggle)
-- without changing the immutable-on-insert behaviour of the snapshot.
--
-- An AFTER-INSERT/UPDATE trigger on proposals keeps the back-link in
-- sync transparently, so the various insert paths (CreateProposalModal,
-- EnquiryPropertyMatchModal, PricingModal) don't need touch-ups.

-- 1. Column + FK
ALTER TABLE pricing_proposals
  ADD COLUMN IF NOT EXISTS proposal_id UUID REFERENCES proposals(id) ON DELETE SET NULL;

-- 2. Backfill from the existing forward FK. For each proposals row, set
--    the back-link on the snapshot it currently points to. Historical
--    snapshots that aren't currently linked (orphans from prior edits)
--    stay NULL — they can't be reliably attributed in retrospect, so
--    versioning starts from this point forward.
UPDATE pricing_proposals pp
   SET proposal_id = p.id
  FROM proposals p
 WHERE p.pricing_proposal_id = pp.id
   AND pp.proposal_id IS NULL;

-- 3. Lookup index — the agent portal fetches the full chain ordered by
--    recency, so the partial-key index covers the hot path.
CREATE INDEX IF NOT EXISTS idx_pricing_proposals_proposal_id
  ON pricing_proposals (proposal_id, created_at DESC)
  WHERE proposal_id IS NOT NULL;

-- 4. Trigger function: whenever a proposals row's pricing_proposal_id
--    is set or changed, stamp the back-reference on the targeted
--    pricing_proposals row. Skips when already set to the same value
--    (avoid spurious row writes / triggering cascading updates).
CREATE OR REPLACE FUNCTION sync_pricing_proposal_backlink()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.pricing_proposal_id IS NOT NULL THEN
    UPDATE pricing_proposals
       SET proposal_id = NEW.id
     WHERE id = NEW.pricing_proposal_id
       AND (proposal_id IS DISTINCT FROM NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Attach trigger to proposals.
DROP TRIGGER IF EXISTS trg_proposals_sync_pricing_backlink ON proposals;
CREATE TRIGGER trg_proposals_sync_pricing_backlink
  AFTER INSERT OR UPDATE OF pricing_proposal_id ON proposals
  FOR EACH ROW
  EXECUTE FUNCTION sync_pricing_proposal_backlink();
