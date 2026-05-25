-- ============================================================
-- enquiries.source_url — link to the conversation thread on the
-- platform where the enquiry originated (Airbnb / Booking /
-- VRBO / etc). Set alongside source='platform' from the New
-- Enquiry form's Platform toggle.
--
-- Nullable + free-form text. The UI renders it as a clickable
-- link on the deal card / modal so Hayley can jump back to the
-- conversation in one click.
-- ============================================================

BEGIN;

ALTER TABLE enquiries
  ADD COLUMN IF NOT EXISTS source_url text;

COMMIT;
