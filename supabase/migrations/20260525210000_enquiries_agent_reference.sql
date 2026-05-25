-- ============================================================
-- enquiries.agent_reference — the agent's own short label for an
-- enquiry submitted via /q/:token.
--
-- The kanban-side `subject` column holds the auto-generated AHH/N
-- code (the team's tracking handle). Agents don't see those codes,
-- so they need their OWN free-text label to recognise their enquiry
-- on the "My Enquiries" tab — e.g. "Sarah & Mark, Easter" or
-- "Family of 6 for Whitsun".
--
-- Required at the agent-portal submission step (form-level enforcement
-- so legacy rows can stay NULL). The team sees it surfaced inline on
-- the deal modal alongside the AHH/N code.
-- ============================================================

BEGIN;

ALTER TABLE enquiries
  ADD COLUMN IF NOT EXISTS agent_reference text;

COMMIT;
