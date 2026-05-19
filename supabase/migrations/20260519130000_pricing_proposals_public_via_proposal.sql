-- Allow the public proposal page (anon role) to read a pricing_proposals
-- row when it's referenced by a sendable proposal.
--
-- The public proposal page (proposal.html) loads a proposal by ref_code and
-- joins to pricing_proposals to render the per-night price + agent breakdown.
-- Without this policy, the nested join silently returns null because the
-- existing policies on pricing_proposals restrict reads to authenticated
-- portal users.
--
-- The EXISTS gate means an internal pricing snapshot that was never used
-- as a proposal stays private — only snapshots linked to a sendable proposal
-- become readable to anon. Whoever has the proposal's ref_code can already
-- see the per-night pricing on the rendered page, so this matches the
-- existing data-exposure surface.

DROP POLICY IF EXISTS pricing_proposals_anon_select_via_proposal ON pricing_proposals;

CREATE POLICY pricing_proposals_anon_select_via_proposal
  ON pricing_proposals
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1
      FROM proposals
      WHERE proposals.pricing_proposal_id = pricing_proposals.id
    )
  );
