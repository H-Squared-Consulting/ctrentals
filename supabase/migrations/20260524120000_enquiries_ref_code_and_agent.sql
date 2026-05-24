-- ============================================================
-- Enquiries — unique ref_code + agent-on-behalf support
-- ============================================================
-- Adds:
--   * ref_code text UNIQUE NOT NULL — stable human-readable id
--       (ENQ-YYYYMMDD-XXXX, X = first 4 chars of the uuid uppercased)
--   * is_agent boolean — true when the enquiry came from an agent on
--       behalf of an undisclosed guest. client_* still holds the
--       recipient (the agent in that case), and the new guest_* columns
--       hold the underlying guest's details once disclosed.
--   * agent_id uuid FK → agents(id), set when is_agent=true.
--   * guest_name/guest_email/guest_phone — the actual underlying guest.
--       For agent enquiries these stay null until disclosed; for direct
--       enquiries the application mirrors client_* on insert so a single
--       column ("guest_*") is the canonical answer to "who's staying?".
--
-- Why no rename of client_*: every existing read path uses client_*. A
-- rename would mean a wide-ranging churn for cosmetic gain. The role-by-
-- type convention is documented in the model and kept stable.
-- ============================================================

BEGIN;

ALTER TABLE enquiries
  ADD COLUMN IF NOT EXISTS ref_code    text,
  ADD COLUMN IF NOT EXISTS is_agent    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agent_id    uuid REFERENCES agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS guest_name  text,
  ADD COLUMN IF NOT EXISTS guest_email text,
  ADD COLUMN IF NOT EXISTS guest_phone text;

-- Backfill ref_code for existing rows so the NOT NULL + UNIQUE we add
-- below don't fail. Pattern: ENQ-YYYYMMDD-NAM-XX where NAM is the first
-- three letters of the recipient name (alphabet only, padded with X if
-- shorter; 'GST' fallback when no name) and XX is the first two hex
-- chars of the row's uuid — disambiguates same-day same-name collisions.
UPDATE enquiries
   SET ref_code = 'ENQ-'
                  || to_char(created_at, 'YYYYMMDD')
                  || '-'
                  || rpad(upper(substr(regexp_replace(coalesce(client_name, 'GST'), '[^A-Za-z]', '', 'g'), 1, 3)), 3, 'X')
                  || '-'
                  || upper(substr(id::text, 1, 2))
 WHERE ref_code IS NULL;

ALTER TABLE enquiries ALTER COLUMN ref_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS enquiries_ref_code_idx ON enquiries(ref_code);
CREATE INDEX IF NOT EXISTS enquiries_agent_id_idx ON enquiries(agent_id);

-- For direct (non-agent) existing enquiries, mirror client_* into guest_*
-- so the new "guest_* is the actual guest" convention reads honestly for
-- historical data. Agent-flagged rows don't exist yet (is_agent default
-- false on the new column), so no row gets stranded.
UPDATE enquiries
   SET guest_name  = COALESCE(guest_name,  client_name),
       guest_email = COALESCE(guest_email, client_email),
       guest_phone = COALESCE(guest_phone, client_phone)
 WHERE is_agent = false;

COMMIT;
