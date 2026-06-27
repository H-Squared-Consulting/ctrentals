-- Distinguish genuinely in-app-confirmed bookings from bulk-imported ones.
--
-- The management-phase "confirmation" emails (owner confirmation, guest
-- welcome, agent details request) are anchored to "on confirmation". The
-- engine previously used bookings.created_at as that date, so every
-- bulk-imported booking showed an overdue confirmation on its import date
-- (e.g. ~41 bookings imported on one day all "due" that day). This column
-- records when a booking was actually confirmed inside the app (proposal
-- accept / manual create / mark-booked). It stays NULL for imported
-- bookings, and the engine skips confirm-anchored steps when it's NULL.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

COMMENT ON COLUMN bookings.confirmed_at IS
  'When the booking was genuinely confirmed in-app (proposal accept / manual create / mark-booked). NULL for bulk-imported bookings, which therefore get no confirmation/welcome management emails.';
