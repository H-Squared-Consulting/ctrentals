-- Closed-column metadata for the enquiries pipeline.
--
-- close_reason: free-text "why" captured when the team manually moves
--   an enquiry into the Closed column (vs auto-closed via expiry).
--   Surfaces on the closed card so the reason is obvious without
--   opening the deal modal. NULL pre-feature + on auto-closed rows.
--
-- archived_at / archive_reason: lets the team prune the Closed column
--   without losing the record. Archived enquiries drop out of the
--   kanban entirely but stay in the DB for reporting / audit. Archive
--   is bulk-select on the Closed column with a required reason so the
--   "why was this archived?" question is always answerable later.
ALTER TABLE enquiries
  ADD COLUMN IF NOT EXISTS close_reason TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

-- Partial index for the kanban's "exclude archived" filter — most rows
-- stay active so the partial index keeps the b-tree small.
CREATE INDEX IF NOT EXISTS idx_enquiries_archived_at
  ON enquiries (archived_at)
  WHERE archived_at IS NOT NULL;
