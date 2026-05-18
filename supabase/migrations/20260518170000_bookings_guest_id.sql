-- Link bookings to the Guest CRM record so a guest's "stays" can be
-- derived without duplicating guest fields across tables.
--
-- guest_name / guest_email remain on bookings as a denormalised label so
-- existing rows (pre-CRM) keep rendering, and so a booking can be
-- captured against a one-off walk-in before a Guest record exists. When
-- guest_id is set, the Guest CRM record is the source of truth.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS guest_id uuid REFERENCES guests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_guest_id ON bookings (guest_id);
