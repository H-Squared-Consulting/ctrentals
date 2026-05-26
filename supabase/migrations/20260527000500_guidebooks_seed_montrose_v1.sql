-- Guidebook v1 seed follow-ups (PR #1 per GUIDEBOOK_DESIGN_GUIDE §8.1).
--
-- 1. Normalise existing manual-card categories onto the canonical
--    8-category enum from §2.2: Safety, Connectivity, Appliances,
--    Access, House Rules, Outdoors, Local Context, Emergencies.
-- 2. Swap real credentials in the Montrose seed for placeholders
--    (per §10.2 — guest URL is effectively public in v1).
-- 3. Seed the new emergency-related columns for Montrose Terrace
--    so PR #4 (Emergency page) has real data to render against.
--
-- Idempotent — all updates are safe to re-run.

-- ── 1. Canonical category mapping ────────────────────────────────────
update guidebook_house_manuals set category = 'Local Context' where slug = 'standard-load-shedding';
update guidebook_house_manuals set category = 'Local Context' where slug = 'standard-grocery-shopping';
update guidebook_house_manuals set category = 'Appliances'    where slug = 'standard-laundry-notice';
update guidebook_house_manuals set category = 'Emergencies'   where slug = 'standard-emergencies-constantia';
update guidebook_house_manuals set category = 'Local Context' where slug = 'standard-transportation';
update guidebook_house_manuals set category = 'House Rules'   where slug = 'standard-suntan';
update guidebook_house_manuals set category = 'Access'        where slug = 'mt-keys-access';
update guidebook_house_manuals set category = 'Outdoors'      where slug = 'mt-pool-outdoors';
update guidebook_house_manuals set category = 'House Rules'   where slug = 'mt-house-rules';

-- ── 2 & 3. Montrose guidebook fields ─────────────────────────────────
update guidebooks
  set
    -- §10.2: placeholder credentials — guest URL is effectively public in v1.
    wifi_password = 'PLACEHOLDER-CHANGE-ME',

    -- New emergency / host contact fields. Hospital phone is publicly
    -- listed so the real number is fine to seed; host phone and armed-
    -- response phone are placeholders until the host supplies them via
    -- the admin editor (PR #2).
    host_phone               = 'PLACEHOLDER-CHANGE-ME',
    armed_response_company   = 'ADT Security',
    armed_response_phone     = 'PLACEHOLDER-CHANGE-ME',
    nearest_hospital_name    = 'Constantiaberg Mediclinic',
    nearest_hospital_phone   = '+27 21 799 2911',
    nearest_hospital_address = 'Burnham Rd, Plumstead, Cape Town',
    nearest_hospital_lat     = -34.0153,
    nearest_hospital_lng     = 18.4733,

    -- Departure section.
    checkout_time = '10:00',
    checkout_checklist = '[
      {"id":"lock-doors",  "label":"Lock all doors and windows", "icon":"key"},
      {"id":"dishwasher",  "label":"Start the dishwasher on Eco", "icon":"home"},
      {"id":"trash",       "label":"Bins on the kerb if Wed/Sun", "icon":"home"},
      {"id":"lights",      "label":"Lights off and aircon off",   "icon":"bolt"},
      {"id":"keys",        "label":"Leave keys on the kitchen counter", "icon":"key"},
      {"id":"review",      "label":"Leave us a review — it really helps", "icon":"sun"}
    ]'::jsonb,

    updated_at = now()
where slug = 'montrose-terrace';
