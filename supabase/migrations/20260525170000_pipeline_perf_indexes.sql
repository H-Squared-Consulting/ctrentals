-- ============================================================
-- Pipeline hot-path indexes.
--
-- PipelinePage.fetchDeals() runs a nested PostgREST embed:
--   enquiries (partner_id = X, deal_status OR created_at floor)
--     ↳ proposals (joined on enquiry_id)
--          ↳ partner_properties (joined on id)
--          ↳ pricing_proposals  (joined on pricing_proposal_id)
--
-- Without the supporting indexes, PostgREST falls back to seq-scans
-- per parent row, which is what made admin.southernescapes.co.za
-- /operations/enquiries slow to a crawl as the data grew. These
-- indexes make the embed O(log n) per join.
--
-- All CREATE INDEX IF NOT EXISTS so the migration is idempotent
-- across local Supabase, staging and prod where some of these may
-- already exist from earlier ad-hoc tuning.
-- ============================================================

BEGIN;

-- enquiries: partner-scoped reads ordered by created_at, filtered by
-- the active-or-recent predicate. Composite (partner_id, created_at)
-- so the date sort comes from the index and the partner filter is the
-- leading key.
CREATE INDEX IF NOT EXISTS enquiries_partner_created_idx
  ON enquiries (partner_id, created_at DESC);

-- enquiries.deal_status drives the active-vs-archived filter in the
-- main fetch. Partial indexes keep it small + only relevant rows.
CREATE INDEX IF NOT EXISTS enquiries_partner_open_idx
  ON enquiries (partner_id, created_at DESC)
  WHERE deal_status IS NULL OR deal_status NOT IN ('won', 'lost');

-- proposals embed lookup: PostgREST joins proposals on enquiry_id
-- when expanding enquiries. Also serves the standalone fetch which
-- filters on partner_id + enquiry_id IS NULL.
CREATE INDEX IF NOT EXISTS proposals_enquiry_id_idx
  ON proposals (enquiry_id);

CREATE INDEX IF NOT EXISTS proposals_partner_created_idx
  ON proposals (partner_id, created_at DESC);

-- pricing_proposals are looked up by id (proposals.pricing_proposal_id
-- → pricing_proposals.id). The PK already covers this, but adding the
-- reverse lookup helps the embed phase when the planner picks it. No-
-- op if the planner already does the right thing.
CREATE INDEX IF NOT EXISTS pricing_proposals_id_idx
  ON pricing_proposals (id);

COMMIT;
