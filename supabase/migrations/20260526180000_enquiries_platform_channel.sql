-- enquiries.platform_channel — which platform a 'platform' enquiry came
-- from (Airbnb vs VRBO). Sits alongside source='platform': the source
-- column stays the broad bucket the pipeline filters on, and this new
-- column drives the per-channel ref-code stream (A### vs V###) and the
-- channel-specific affordances on the deal card.
--
-- Optional column. NULL for non-platform enquiries (direct/agent) and
-- for any historical platform rows that pre-date the per-channel split
-- (those used the legacy ENQ-YYYYMMDD-... format and stay unmigrated).

ALTER TABLE enquiries
  ADD COLUMN IF NOT EXISTS platform_channel text
  CHECK (platform_channel IS NULL OR platform_channel IN ('airbnb', 'vrbo'));
