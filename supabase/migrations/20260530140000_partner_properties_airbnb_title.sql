-- Cached Airbnb listing title for each property. Populated by the
-- fetch-airbnb-title edge function when the airbnb URL is saved on
-- the Property editor: the function scrapes the page's og:title meta
-- tag (Airbnb-rendered headline like "Spacious 4 Bed Retreat with
-- Stunning Views") and stamps it here. The global search "Copy
-- Airbnb links" modal uses this title in front of each URL so the
-- guest sees the listing headline instead of our internal property
-- name.
--
-- Null when:
--   - the property has no airbnb URL on file
--   - the fetch failed (network error, Airbnb markup change)
-- The copy modal falls back to property_name in those cases.
ALTER TABLE partner_properties
  ADD COLUMN IF NOT EXISTS airbnb_title TEXT;
