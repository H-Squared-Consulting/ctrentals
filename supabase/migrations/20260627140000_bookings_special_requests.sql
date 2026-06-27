-- Dedicated special-requests field on bookings.
--
-- The owner emails carry a "Special requests" line ({{special_requests}}), but
-- there was no real source for it: the engine read booking.extras as a JSON
-- object that never exists (the form stores extras as plain text), so the
-- variable was always blank. This adds a proper text column, editable in the
-- booking modal now and auto-populated by the Stage 2 guest form later. When
-- it's empty the email omits the whole line (see renderTemplate).

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS special_requests text;

COMMENT ON COLUMN bookings.special_requests IS
  'Guest special requests, surfaced in owner emails as {{special_requests}}. Manually editable; auto-populated by the Stage 2 guest form. Blank → the email omits the Special requests line.';
