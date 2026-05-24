-- ============================================================
-- Agent self-service portal — backlog #7.
--
-- Adds the data layer for a public agent portal at /q/:token where
-- each booking agent gets a curated list of properties they can
-- sell, and submits enquiries directly into the Pipeline tagged
-- with their agent ID.
--
-- Scope:
--   1. Token columns on agents (one URL per agent, rotatable by
--      Hayley from the Agents page).
--   2. agent_properties join table — which houses each agent can
--      see in their portal. Curated by the team; owner-private
--      homes simply never get added.
--   3. enquiries.agent_id + enquiries.property_id +
--      enquiries.source — so portal-submitted enquiries land in
--      Pipeline tagged with their origin.
--
-- Wrapped in a single transaction so either everything lands or
-- nothing does. Idempotent (IF NOT EXISTS) so re-running is safe.
-- ============================================================

BEGIN;

-- ── 1. Portal token columns on agents ──────────────────────────────
-- Token is a 128-bit (32 hex char) random string minted server-side
-- by an edge function. Issued / revoked timestamps give Hayley an
-- audit trail; last-used is bumped by the public portal on each
-- successful token lookup so dormant agents can be spotted.

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS url_token            text,
  ADD COLUMN IF NOT EXISTS url_token_issued_at  timestamptz,
  ADD COLUMN IF NOT EXISTS url_token_revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS url_token_last_used_at timestamptz;

-- Partial unique index. Many agents may have NULL tokens (portal
-- not enabled); only the active tokens need to be unique.
CREATE UNIQUE INDEX IF NOT EXISTS agents_url_token_unique
  ON agents (url_token)
  WHERE url_token IS NOT NULL;


-- ── 2. Curated agent → properties join table ───────────────────────
-- One row per (agent, property) pair the agent is allowed to sell.
-- Empty list (no rows for an agent) = agent sees no properties.

CREATE TABLE IF NOT EXISTS agent_properties (
  agent_id    uuid NOT NULL REFERENCES agents(id)             ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES partner_properties(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_properties_agent    ON agent_properties (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_properties_property ON agent_properties (property_id);

ALTER TABLE agent_properties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_properties_select ON agent_properties;
CREATE POLICY agent_properties_select ON agent_properties
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS agent_properties_insert ON agent_properties;
CREATE POLICY agent_properties_insert ON agent_properties
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS agent_properties_delete ON agent_properties;
CREATE POLICY agent_properties_delete ON agent_properties
  FOR DELETE TO authenticated USING (true);

-- No UPDATE policy: rows are atomic membership facts, edits happen
-- by deleting and re-inserting.

GRANT SELECT, INSERT, DELETE ON agent_properties TO authenticated;
GRANT SELECT, INSERT, DELETE ON agent_properties TO service_role;


-- ── 3. Enquiry origin tracking ─────────────────────────────────────
-- agent_id lets the Pipeline filter by who brought the enquiry in.
-- property_id lets us pre-fill the proposal with the specific house
-- the agent was looking at when they clicked + Enquire (the existing
-- /enquiry/new flow leaves this NULL and picks the property later).
-- source is a soft enum so Hayley can slice Pipeline by lead source.

ALTER TABLE enquiries
  ADD COLUMN IF NOT EXISTS agent_id    uuid REFERENCES agents(id)             ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES partner_properties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source      text;

CREATE INDEX IF NOT EXISTS idx_enquiries_agent_id    ON enquiries (agent_id);
CREATE INDEX IF NOT EXISTS idx_enquiries_property_id ON enquiries (property_id);
CREATE INDEX IF NOT EXISTS idx_enquiries_source      ON enquiries (source);


COMMIT;
