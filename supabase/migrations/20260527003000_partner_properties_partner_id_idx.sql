-- ============================================================
-- partner_properties: index for the agent-portal "my properties"
-- listing.
--
-- The PostgREST query that drives the agent portal home grid is
--   SELECT * FROM partner_properties
--   WHERE  partner_id = $1
--   ORDER  BY bedrooms
-- and runs on every page load. Without a supporting index it was
-- the top app-level query in Supabase's pg_stat_statements
-- (1,205 calls / ~47s total / 35–46ms mean). Composite
-- (partner_id, bedrooms) so the filter is the leading key and the
-- sort comes from the index — no separate sort step.
-- ============================================================

CREATE INDEX IF NOT EXISTS partner_properties_partner_bedrooms_idx
  ON partner_properties (partner_id, bedrooms);
