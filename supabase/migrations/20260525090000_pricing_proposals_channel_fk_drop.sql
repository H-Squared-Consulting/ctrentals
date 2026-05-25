-- ============================================================
-- pricing_proposals.channel_profile_id — drop the FK to the
-- legacy per-property channel_profiles table.
--
-- The pricing dashboard now sources its channel dropdown from
-- channel_defaults (partner-scoped templates) rather than from
-- channel_profiles (per-property overrides). The values stored
-- in channel_profile_id are therefore channel_defaults.id UUIDs,
-- which the legacy FK rejects with a 23503 — surfacing in the
-- UI as "Failed to create proposal: insert or update on table
-- pricing_proposals violates foreign key constraint
-- pricing_proposals_channel_profile_id_fkey".
--
-- Dropping the constraint leaves the column as a generic
-- "channel reference id" so existing snapshots keep their value
-- and new ones land cleanly. A future cleanup can rename the
-- column to channel_defaults_id once every reader has been
-- updated and an FK to channel_defaults can be added safely.
-- ============================================================

BEGIN;

ALTER TABLE pricing_proposals
  DROP CONSTRAINT IF EXISTS pricing_proposals_channel_profile_id_fkey;

COMMIT;
