-- ============================================================
-- partner_properties.listing_urls — multi-platform listing map
-- ============================================================
-- Replaces the single `booking_url` text column with a flexible
-- JSONB map keyed by platform. The UI exposes five labelled
-- inputs (Airbnb, Booking.com, VRBO, Direct, Other); future
-- platforms can be added without further migrations.
--
-- `booking_url` is intentionally LEFT IN PLACE as a read
-- fallback during the transition. A later cleanup PR will drop
-- it once every consumer has been migrated.
--
-- Shape of the JSONB:
--   {
--     "airbnb":      "https://airbnb.com/h/...",
--     "booking_com": "https://booking.com/hotel/...",
--     "vrbo":        "https://vrbo.com/...",
--     "direct":      "https://southernescapes.co.za/...",
--     "other":       "https://..."
--   }
-- Keys are optional; missing key = no link for that platform.
-- ============================================================

ALTER TABLE partner_properties
ADD COLUMN IF NOT EXISTS listing_urls jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Backfill: copy any existing booking_url into the new map under
-- "booking_com". Idempotent — re-runnable safely.
UPDATE partner_properties
SET listing_urls = jsonb_build_object('booking_com', booking_url)
WHERE booking_url IS NOT NULL
  AND booking_url <> ''
  AND (listing_urls = '{}'::jsonb OR listing_urls IS NULL);
