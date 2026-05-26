-- Guidebook v1 schema follow-ups (PR #1 per GUIDEBOOK_DESIGN_GUIDE §8.1).
--
-- Adds:
--   guidebook_house_manuals.visibility      — forward-compat for v2 privacy gate
--   guidebook_house_manuals.image_url       — photo-first card variant (§4.3)
--   guidebook_house_manuals.emergency_tag   — feeds Emergency page synthesis (§4.6)
--
--   guidebooks.host_phone                   — Emergency page + host contact chip
--   guidebooks.armed_response_company/phone — Emergency page armed-response card
--   guidebooks.nearest_hospital_*           — Emergency page hospital card
--   guidebooks.checkout_time                — Departure section header
--   guidebooks.checkout_checklist           — Departure checkable checklist (JSONB)
--
-- Per §10.2: no guidebook-level `visibility` (privacy gate deferred to v2).
-- Per §10.8: no `backup_host_*` columns (deferred to v2).

-- ── House manuals ────────────────────────────────────────────────────
alter table guidebook_house_manuals
  add column if not exists visibility text not null default 'public'
    check (visibility in ('public','guest_only')),
  add column if not exists image_url text,
  add column if not exists emergency_tag text;

-- emergency_tag is open text by design — values like 'gas-shut-off',
-- 'water-shut-off', 'electrical-shut-off' are conventions used by the
-- Emergency page synthesis. No CHECK constraint so new tag types can
-- be added without a migration.

-- ── Guidebooks ───────────────────────────────────────────────────────
alter table guidebooks
  add column if not exists host_phone text,
  add column if not exists armed_response_company text,
  add column if not exists armed_response_phone text,
  add column if not exists nearest_hospital_name text,
  add column if not exists nearest_hospital_phone text,
  add column if not exists nearest_hospital_address text,
  add column if not exists nearest_hospital_lat numeric,
  add column if not exists nearest_hospital_lng numeric,
  add column if not exists checkout_time time,
  add column if not exists checkout_checklist jsonb not null default '[]'::jsonb;

-- checkout_checklist is an ordered array of items:
--   [
--     { "id": "lock-doors",  "label": "Lock all doors and windows", "icon": "key" },
--     { "id": "dishwasher",  "label": "Start the dishwasher on Eco", "icon": "home" },
--     ...
--   ]
-- Persisted as JSONB so the admin editor can edit shape without DDL.
