-- bookings.block_reason — categorical label for why a property is
-- blocked off (kind='block' rows). Free-text notes still live in
-- bookings.notes; this column lets us bucket blocks for analytics
-- later ("how many days lost to maintenance this year?") without
-- string-matching the notes field.
--
-- Optional column — guest bookings never set it, and historical
-- block rows that pre-date this migration stay null until edited.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS block_reason text
  CHECK (block_reason IS NULL OR block_reason IN (
    'owner_stay',
    'maintenance',
    'renovation',
    'cleaning',
    'other'
  ));
