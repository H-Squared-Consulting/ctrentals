-- ============================================================
-- Workflow rebuild: phase 1 (schema + data conversion)
-- ============================================================
--
-- Implements the agreed end-to-end workflow data model:
--
--   * Enquiries get a new deal_status field (8 values) which drives
--     the kanban columns. The old enquiries.status field is KEPT for
--     now so legacy code reading it keeps working; a future migration
--     can drop it once nothing references it.
--
--   * Proposals get five new status values (drafting, ready, sent,
--     accepted, declined) replacing the previous eight. A decline_reason
--     column captures why a proposal was declined (client-declined,
--     expired, withdrawn, sibling-accepted).
--
--   * Bookings get four cleaner statuses (confirmed, in_stay, completed,
--     cancelled) replacing the previous five.
--
--   * Guests get a status field (lead, customer) so the CRM page can
--     distinguish leads from customers.
--
--   * Both enquiries and proposals get a guest_id link so every record
--     ties back to a single CRM row, with existing rows backfilled by
--     email match (or new guest rows created where no match exists).
--
-- All data conversions run BEFORE the new CHECK constraints are
-- applied, so existing records never violate the new rules.
--
-- Wrapped in a single transaction so either everything lands or
-- nothing does.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. ENQUIRIES: add deal_status, link to guests
-- ============================================================

-- 1a. Add the new deal_status column (8 allowed values).
ALTER TABLE enquiries
  ADD COLUMN IF NOT EXISTS deal_status text NOT NULL DEFAULT 'new';

-- 1b. Backfill deal_status from old enquiries.status + linked proposals.
-- Mapping logic:
--   enquiry.status = 'booked'    → deal_status = 'won'
--   enquiry.status = 'cancelled' → deal_status = 'lost'
--   enquiry.status = 'new':
--     any linked proposal is 'interested'                 → 'interested'
--     any linked proposal is 'sent' or 'viewed'           → 'sent'
--     any linked proposal is 'draft'                      → 'drafting'
--     otherwise                                           → 'new'
UPDATE enquiries e
SET deal_status = CASE
  WHEN e.status = 'booked'    THEN 'won'
  WHEN e.status = 'cancelled' THEN 'lost'
  WHEN EXISTS (
    SELECT 1 FROM proposals p WHERE p.enquiry_id = e.id AND p.status = 'interested'
  ) THEN 'interested'
  WHEN EXISTS (
    SELECT 1 FROM proposals p WHERE p.enquiry_id = e.id AND p.status IN ('sent','viewed')
  ) THEN 'sent'
  WHEN EXISTS (
    SELECT 1 FROM proposals p WHERE p.enquiry_id = e.id AND p.status = 'draft'
  ) THEN 'drafting'
  ELSE 'new'
END;

-- 1c. Lock deal_status to the 8 allowed values.
ALTER TABLE enquiries DROP CONSTRAINT IF EXISTS enquiries_deal_status_check;
ALTER TABLE enquiries
  ADD CONSTRAINT enquiries_deal_status_check
  CHECK (deal_status IN (
    'new','drafting','ready','sent','stalled','interested','won','lost'
  ));

-- 1d. Link enquiries to guests.
ALTER TABLE enquiries
  ADD COLUMN IF NOT EXISTS guest_id uuid REFERENCES guests(id);

CREATE INDEX IF NOT EXISTS enquiries_guest_id_idx ON enquiries(guest_id);

-- ============================================================
-- 2. GUESTS: add lead/customer status
-- ============================================================

ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'lead';

ALTER TABLE guests DROP CONSTRAINT IF EXISTS guests_status_check;
ALTER TABLE guests
  ADD CONSTRAINT guests_status_check
  CHECK (status IN ('lead','customer'));

-- ============================================================
-- 3. PROPOSALS: link to guests, decline_reason, new statuses
-- ============================================================

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS guest_id uuid REFERENCES guests(id),
  ADD COLUMN IF NOT EXISTS decline_reason text;

CREATE INDEX IF NOT EXISTS proposals_guest_id_idx ON proposals(guest_id);

-- 3a. Capture decline reasons FIRST (before we rewrite status values).
-- Mapping logic:
--   'expired'   → decline_reason 'expired'
--   'archived'  → decline_reason 'withdrawn'
--   'cancelled' → decline_reason 'client-declined'
UPDATE proposals
SET decline_reason = CASE
  WHEN status = 'expired'   THEN 'expired'
  WHEN status = 'archived'  THEN 'withdrawn'
  WHEN status = 'cancelled' THEN 'client-declined'
  ELSE NULL
END
WHERE status IN ('expired','archived','cancelled');

-- 3b. Convert proposal status values to the new five.
-- Drop the old CHECK constraint first so the new values don't get
-- rejected on a clean database. The new constraint is re-added in 3c.
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_status_check;

-- Mapping logic:
--   'draft'      → 'drafting'
--   'sent'       → 'sent'
--   'viewed'     → 'sent'        (viewed is a timestamp now, not a status)
--   'interested' → 'sent'        (deal-level concept, proposal stays Sent)
--   'expired'    → 'declined'
--   'archived'   → 'declined'
--   'booked'     → 'accepted'
--   'cancelled'  → 'declined'
UPDATE proposals
SET status = CASE
  WHEN status = 'draft'       THEN 'drafting'
  WHEN status = 'viewed'      THEN 'sent'
  WHEN status = 'interested'  THEN 'sent'
  WHEN status = 'expired'     THEN 'declined'
  WHEN status = 'archived'    THEN 'declined'
  WHEN status = 'booked'      THEN 'accepted'
  WHEN status = 'cancelled'   THEN 'declined'
  ELSE status
END;

-- 3c. Swap the CHECK constraint to the new five values.
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_status_check;
ALTER TABLE proposals
  ADD CONSTRAINT proposals_status_check
  CHECK (status IN ('drafting','ready','sent','accepted','declined'));

-- ============================================================
-- 4. BOOKINGS: rename statuses to match agreed model
-- ============================================================
-- Drop the old CHECK constraint first so the new values don't get
-- rejected on a clean database. The new constraint is re-added below.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;

-- Mapping logic:
--   'tentative'   → 'confirmed' (no separate tentative state in the new model)
--   'confirmed'   → 'confirmed'
--   'checked_in'  → 'in_stay'
--   'checked_out' → 'completed'
--   'cancelled'   → 'cancelled'
UPDATE bookings
SET status = CASE
  WHEN status = 'tentative'    THEN 'confirmed'
  WHEN status = 'checked_in'   THEN 'in_stay'
  WHEN status = 'checked_out'  THEN 'completed'
  ELSE status
END;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('confirmed','in_stay','completed','cancelled'));

-- ============================================================
-- 5. CRM backfill: create guest rows for unmatched emails,
--    then link enquiries and proposals to them.
-- ============================================================

-- 5a. Create guest rows for any enquiry email that has no matching guest yet.
-- Matched on (partner_id, lower(email)) so a person who exists under one
-- partner doesn't accidentally get linked to enquiries under another.
INSERT INTO guests (partner_id, name, email, phone, country, status)
SELECT DISTINCT ON (e.partner_id, LOWER(e.client_email))
  e.partner_id,
  e.client_name,
  e.client_email,
  e.client_phone,
  e.nationality,
  'lead'
FROM enquiries e
LEFT JOIN guests g
  ON g.partner_id = e.partner_id
  AND LOWER(g.email) = LOWER(e.client_email)
WHERE e.client_email IS NOT NULL
  AND e.client_email <> ''
  AND g.id IS NULL
ORDER BY e.partner_id, LOWER(e.client_email), e.created_at;

-- 5b. Create guest rows for any proposal email that still has no matching guest.
INSERT INTO guests (partner_id, name, email, phone, country, status)
SELECT DISTINCT ON (p.partner_id, LOWER(p.guest_email))
  p.partner_id,
  p.guest_name,
  p.guest_email,
  p.guest_phone,
  p.guest_nationality,
  'lead'
FROM proposals p
LEFT JOIN guests g
  ON g.partner_id = p.partner_id
  AND LOWER(g.email) = LOWER(p.guest_email)
WHERE p.guest_email IS NOT NULL
  AND p.guest_email <> ''
  AND g.id IS NULL
ORDER BY p.partner_id, LOWER(p.guest_email), p.created_at;

-- 5c. Link enquiries to their guest by email match.
UPDATE enquiries e
SET guest_id = g.id
FROM guests g
WHERE g.partner_id = e.partner_id
  AND LOWER(g.email) = LOWER(e.client_email)
  AND e.client_email IS NOT NULL
  AND e.client_email <> ''
  AND e.guest_id IS NULL;

-- 5d. Link proposals to their guest by email match.
UPDATE proposals p
SET guest_id = g.id
FROM guests g
WHERE g.partner_id = p.partner_id
  AND LOWER(g.email) = LOWER(p.guest_email)
  AND p.guest_email IS NOT NULL
  AND p.guest_email <> ''
  AND p.guest_id IS NULL;

-- 5e. Flip Lead → Customer for any guest with at least one non-cancelled booking.
-- (Cancelled bookings don't promote a guest to Customer.)
UPDATE guests g
SET status = 'customer'
WHERE EXISTS (
  SELECT 1 FROM bookings b
  WHERE b.guest_id = g.id
    AND b.status IN ('confirmed','in_stay','completed')
);

COMMIT;
