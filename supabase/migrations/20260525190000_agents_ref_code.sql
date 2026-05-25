-- ============================================================
-- agents.ref_code — short A{xx} code where xx = agent initials.
--
-- Surfaces as the first column on the Agents page (locked) so the
-- ladies can refer to an agent by a stable shorthand even when two
-- agents share a first name. Collisions get a numeric suffix
-- (AHH, AHH2, AHH3).
--
-- Generated client-side at INSERT and never auto-recomputed on
-- UPDATE — once an agent has a code, downstream enquiry / proposal
-- ref codes lock to it.
--
-- Codes are globally unique on the agents table (the table is not
-- partner-scoped in this schema).
-- ============================================================

BEGIN;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS ref_code text;

DO $$
DECLARE
  row RECORD;
  base text;
  candidate text;
  suffix int;
BEGIN
  FOR row IN
    SELECT id, name
    FROM agents
    WHERE ref_code IS NULL
    ORDER BY created_at, id
  LOOP
    DECLARE
      cleaned text := regexp_replace(coalesce(row.name, ''), '^\s+|\s+$', '', 'g');
      tokens text[];
      letters text;
    BEGIN
      IF cleaned = '' THEN
        letters := 'XX';
      ELSE
        tokens := regexp_split_to_array(cleaned, '[\s\-]+');
        IF array_length(tokens, 1) >= 2 THEN
          letters := upper(left(tokens[1], 1) || left(tokens[2], 1));
        ELSIF length(tokens[1]) >= 2 THEN
          letters := upper(left(tokens[1], 2));
        ELSE
          letters := upper(tokens[1] || 'X');
        END IF;
      END IF;

      base := 'A' || letters;
      candidate := base;
      suffix := 2;

      WHILE EXISTS (
        SELECT 1 FROM agents WHERE ref_code = candidate
      ) LOOP
        candidate := base || suffix::text;
        suffix := suffix + 1;
      END LOOP;

      UPDATE agents SET ref_code = candidate WHERE id = row.id;
    END;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS agents_ref_code_idx
  ON agents (ref_code)
  WHERE ref_code IS NOT NULL;

COMMIT;
