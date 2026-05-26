-- ============================================================
-- proposals.published_to_agent_at + published_to_agent_expires —
-- agent-portal-visible flag for proposals on agent enquiries.
--
-- When the team clicks "Publish to portal" on a proposal row:
--   - published_to_agent_at  := now()
--   - published_to_agent_expires := enquiry.check_in  (date)
--   - status := 'sent' (handled in app code, not here)
--
-- The agent-portal-read edge function surfaces proposals where
-- published_to_agent_at IS NOT NULL AND published_to_agent_expires
-- >= today, so anything past the stay date silently drops off the
-- agent's My Enquiries tab.
--
-- Both nullable; legacy rows (and direct proposals) stay NULL.
-- ============================================================

BEGIN;

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS published_to_agent_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_to_agent_expires date;

COMMIT;
