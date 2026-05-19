-- Multi-agent support on pricing_proposals.
--
-- Adds an `agents` JSONB column storing the per-proposal agent split:
--   [{ "id": <uuid>, "pct": <number> }, ...]
--
-- Each entry's `pct` is the effective commission used in *this* proposal —
-- by default it mirrors the agent's `default_commission_pct` from Settings,
-- but Override mode lets the user adjust it without writing back to Settings.
--
-- The legacy `agent_id` column stays on the table for back-compat with
-- existing rows and pre-multi-agent reads; new writes use the array. Reads
-- should prefer `agents` and fall back to `agent_id` when the array is empty.

ALTER TABLE pricing_proposals
  ADD COLUMN IF NOT EXISTS agents JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: for any existing agent-scenario row that has a single agent_id
-- and no array yet, seed the array with that single agent. We can't perfectly
-- reconstruct the agent's split from commission_pct (which is total margin,
-- CTR + agent combined), so the pct is stored as 0 and the proposal's
-- existing commission_pct stays the source of truth for total margin. The
-- agent's identity is what we needed to preserve.
UPDATE pricing_proposals
SET agents = jsonb_build_array(jsonb_build_object('id', agent_id::text, 'pct', 0))
WHERE agent_id IS NOT NULL AND agents = '[]'::jsonb;
