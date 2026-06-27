-- Stage 2 — self-serve guest / agent detail forms.
--
-- Instead of emailing a table of fields for someone to fill in, we attach a
-- token link (/f/:token). The recipient opens it, fills a public form, and the
-- data tracks back into the booking — surfaced read-only in the booking modal.
-- Mirrors the agent-portal token + edge-function pattern.
--
-- CRITICAL: these forms NEVER write the bookings core columns (check_in/out,
-- property_id, guest_name, guests_total) — those drive the calendar and the
-- conflict detector. Everything submitted lands in booking_details as DECLARED
-- values; staff reconcile anything calendar/identity-affecting by hand.

-- ===========================================================================
-- booking_form_tokens — one active, revocable link per (booking, form_type)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS booking_form_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  form_type     text NOT NULL CHECK (form_type IN ('guest','agent')),
  token         text,                  -- null = revoked (mirrors agents.url_token)
  issued_at     timestamptz,
  revoked_at    timestamptz,
  last_used_at  timestamptz,           -- bumped fire-and-forget by booking-form-read
  submitted_at  timestamptz,           -- stamped by booking-form-submit
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per (booking, form_type); regenerate overwrites it.
CREATE UNIQUE INDEX IF NOT EXISTS booking_form_tokens_booking_type_unique
  ON booking_form_tokens (booking_id, form_type);
-- Active tokens globally unique (partial — many rows can be revoked/null).
CREATE UNIQUE INDEX IF NOT EXISTS booking_form_tokens_token_unique
  ON booking_form_tokens (token) WHERE token IS NOT NULL;

ALTER TABLE booking_form_tokens ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON booking_form_tokens TO authenticated, service_role;

DROP POLICY IF EXISTS bft_admin ON booking_form_tokens;
CREATE POLICY bft_admin   ON booking_form_tokens FOR ALL TO authenticated USING (is_portal_user()) WITH CHECK (is_portal_user());
DROP POLICY IF EXISTS bft_service ON booking_form_tokens;
CREATE POLICY bft_service ON booking_form_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ===========================================================================
-- booking_details — 1:1 side table; guest_* and agent_* are disjoint so the
-- two forms never clobber each other when both links are used on one booking.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS booking_details (
  booking_id uuid PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,

  -- ── from the GUEST form ─────────────────────────────
  guest_flight_details        text,
  guest_check_in_time         text,    -- 'HH:MM' (lenient text; blank allowed)
  guest_check_out_time        text,
  guest_weekend_housekeeping  boolean,
  guest_staff_requirements    text,
  guest_baby_cot              boolean,
  guest_baby_high_chair       boolean,
  guest_submitted_at          timestamptz,

  -- ── from the AGENT form ─────────────────────────────
  agent_guest_name            text,
  agent_guests_count          integer,
  agent_check_in              date,     -- declared by the agent; admin reconciles
  agent_check_out             date,
  agent_house                 text,     -- free-text house name the agent typed
  agent_contact_number        text,
  agent_flight_details        text,
  agent_check_in_time         text,
  agent_check_out_time        text,
  agent_staff_requirements    text,
  agent_rates                 text,
  agent_payment_terms         text,
  agent_other_requests        text,
  agent_indemnity_signed      boolean,
  agent_breakages_deposit     numeric,
  agent_submitted_at          timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE booking_details ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON booking_details TO authenticated, service_role;

DROP POLICY IF EXISTS bd_admin ON booking_details;
CREATE POLICY bd_admin   ON booking_details FOR ALL TO authenticated USING (is_portal_user()) WITH CHECK (is_portal_user());
DROP POLICY IF EXISTS bd_service ON booking_details;
CREATE POLICY bd_service ON booking_details FOR ALL TO service_role USING (true) WITH CHECK (true);
