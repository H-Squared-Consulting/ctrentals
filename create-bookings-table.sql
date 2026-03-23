-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Creates the bookings table for the calendar system

CREATE TABLE IF NOT EXISTS bookings (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  partner_id           uuid        NOT NULL,
  property_id          uuid        NOT NULL,
  enquiry_id           uuid,

  guest_name           text        NOT NULL,
  guest_email          text,
  guest_phone          text,
  guest_nationality    text,
  guests_total         integer     NOT NULL DEFAULT 1,
  guests_adults        integer,
  guests_children      integer,

  check_in             date        NOT NULL,
  check_out            date        NOT NULL,

  platform             text,
  manager              text,

  total_amount         numeric,
  balance_due          numeric,
  currency             text        DEFAULT 'ZAR',

  house_contact        text,
  extras               text,
  notes                text,

  status               text        NOT NULL DEFAULT 'confirmed',

  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now(),
  created_by           uuid,
  updated_by           uuid,

  CONSTRAINT bookings_pkey PRIMARY KEY (id),
  CONSTRAINT bookings_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES partner_directories(id),
  CONSTRAINT bookings_property_id_fkey FOREIGN KEY (property_id) REFERENCES partner_properties(id),
  CONSTRAINT bookings_check_in_before_check_out CHECK (check_out > check_in)
);

CREATE INDEX IF NOT EXISTS idx_bookings_property_dates ON bookings (property_id, check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_bookings_partner_id ON bookings (partner_id);

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY bookings_admin_select ON bookings FOR SELECT TO authenticated USING (is_portal_user());
CREATE POLICY bookings_admin_insert ON bookings FOR INSERT TO authenticated WITH CHECK (is_portal_user());
CREATE POLICY bookings_admin_update ON bookings FOR UPDATE TO authenticated USING (is_portal_user());
CREATE POLICY bookings_admin_delete ON bookings FOR DELETE TO authenticated USING (is_portal_user());
CREATE POLICY bookings_service ON bookings FOR ALL TO service_role USING (true) WITH CHECK (true);
