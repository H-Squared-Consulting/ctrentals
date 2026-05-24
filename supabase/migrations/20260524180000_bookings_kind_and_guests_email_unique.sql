-- ============================================================
-- bookings.kind + guests email partial unique index
-- ============================================================
-- Two small additive items from issue #40.
--
-- 1. `bookings.kind` — distinguishes a real booking from a manual
--    Block placed by the team to hold dates off the calendar. Replaces
--    the localStorage workaround in BookingCalendarPage so blocks
--    sync across users.
--
-- 2. Partial UNIQUE index on guests(partner_id, lower(email)) — closes
--    the race window where two operators add the same guest before the
--    UI dedupe check fires. NULL emails are allowed (imported owners
--    that only have a phone), hence the partial WHERE clause.
-- ============================================================

BEGIN;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'booking'
  CHECK (kind IN ('booking','block'));

CREATE UNIQUE INDEX IF NOT EXISTS guests_partner_email_unique
  ON guests (partner_id, lower(email))
  WHERE email IS NOT NULL;

COMMIT;
