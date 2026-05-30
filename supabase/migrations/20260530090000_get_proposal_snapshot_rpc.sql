-- Public-readable RPC for the proposal page's "?snapshot=" handler.
--
-- pricing_proposals has tighter RLS than proposals — anon clients can
-- read it transitively via PostgREST embed (proposals → pricing_proposals
-- via the FK) but a direct `pricing_proposals?id=eq.X` query is blocked.
-- The proposal page needs to render an arbitrary historical snapshot
-- (when the agent portal links over with ?snapshot=<id>), so it can't
-- use the embed — it needs to look up a snapshot that's NOT the one
-- currently FK-linked to the proposal.
--
-- The RPC runs as SECURITY DEFINER so it bypasses RLS, but enforces the
-- proposal_id ↔ ref_code match internally so a snapshot can only be
-- resolved via the proposal it actually belongs to. Anon callers can't
-- enumerate arbitrary snapshots.
CREATE OR REPLACE FUNCTION public.get_proposal_snapshot(
  p_ref_code text,
  p_snapshot_id uuid
)
RETURNS SETOF pricing_proposals
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT pp.*
    FROM pricing_proposals pp
    JOIN proposals p ON p.id = pp.proposal_id
   WHERE p.ref_code = p_ref_code
     AND pp.id = p_snapshot_id
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_proposal_snapshot(text, uuid) TO anon, authenticated;
