-- Guidebooks: per-property arrival + info pages, served publicly at
-- /g/:slug. Replaces the externally-hosted Hostfully guidebooks the
-- ladies pay for. Schema follows the same shared-library-plus-per-
-- property-overrides pattern Hostfully exports in their CSV.
--
--   guidebooks                              1 row per property
--   guidebook_house_manuals                 shared library of how-to entries
--   guidebook_manual_assignments            which manuals attach to which guidebook (ordered)
--   guidebook_recommendations               shared library of places/activities
--   guidebook_recommendation_assignments    which recs attach to which guidebook (ordered)
--
-- Public anon read is gated on guidebooks.is_published so unfinished
-- drafts stay private until the host flips them on.

create table if not exists guidebooks (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references partner_properties(id) on delete set null,
  slug text not null unique,
  property_name text not null,
  host_name text,
  street_name text,
  street_number text,
  city text,
  country_code text,
  postal_code text,
  hero_image_url text,
  checkin_text text,
  directions_text text,
  parking_text text,
  wifi_ssid text,
  wifi_password text,
  wifi_notes text,
  checkout_text text,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists guidebooks_slug_idx on guidebooks(slug);

create table if not exists guidebook_house_manuals (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  category text,
  body_html text,
  icon text,
  is_standard boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists guidebook_manual_assignments (
  id uuid primary key default gen_random_uuid(),
  guidebook_id uuid not null references guidebooks(id) on delete cascade,
  manual_id uuid not null references guidebook_house_manuals(id) on delete cascade,
  position int not null default 0,
  override_body_html text,
  unique (guidebook_id, manual_id)
);

create index if not exists guidebook_manual_assignments_gb_idx
  on guidebook_manual_assignments(guidebook_id, position);

create table if not exists guidebook_recommendations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category text,
  description text,
  address text,
  phone text,
  website text,
  image_url text,
  lat numeric,
  lng numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists guidebook_recommendation_assignments (
  id uuid primary key default gen_random_uuid(),
  guidebook_id uuid not null references guidebooks(id) on delete cascade,
  recommendation_id uuid not null references guidebook_recommendations(id) on delete cascade,
  position int not null default 0,
  unique (guidebook_id, recommendation_id)
);

create index if not exists guidebook_rec_assignments_gb_idx
  on guidebook_recommendation_assignments(guidebook_id, position);

-- RLS — anon reads only published guidebooks (and their joins),
-- authenticated users (the admin portal) manage everything.
alter table guidebooks enable row level security;
alter table guidebook_house_manuals enable row level security;
alter table guidebook_manual_assignments enable row level security;
alter table guidebook_recommendations enable row level security;
alter table guidebook_recommendation_assignments enable row level security;

drop policy if exists guidebooks_public_read on guidebooks;
create policy guidebooks_public_read on guidebooks
  for select to anon using (is_published);

drop policy if exists guidebook_house_manuals_public_read on guidebook_house_manuals;
create policy guidebook_house_manuals_public_read on guidebook_house_manuals
  for select to anon using (true);

drop policy if exists guidebook_manual_assignments_public_read on guidebook_manual_assignments;
create policy guidebook_manual_assignments_public_read on guidebook_manual_assignments
  for select to anon using (
    exists (select 1 from guidebooks g where g.id = guidebook_id and g.is_published)
  );

drop policy if exists guidebook_recommendations_public_read on guidebook_recommendations;
create policy guidebook_recommendations_public_read on guidebook_recommendations
  for select to anon using (true);

drop policy if exists guidebook_recommendation_assignments_public_read on guidebook_recommendation_assignments;
create policy guidebook_recommendation_assignments_public_read on guidebook_recommendation_assignments
  for select to anon using (
    exists (select 1 from guidebooks g where g.id = guidebook_id and g.is_published)
  );

drop policy if exists guidebooks_auth_all on guidebooks;
create policy guidebooks_auth_all on guidebooks
  for all to authenticated using (true) with check (true);

drop policy if exists guidebook_house_manuals_auth_all on guidebook_house_manuals;
create policy guidebook_house_manuals_auth_all on guidebook_house_manuals
  for all to authenticated using (true) with check (true);

drop policy if exists guidebook_manual_assignments_auth_all on guidebook_manual_assignments;
create policy guidebook_manual_assignments_auth_all on guidebook_manual_assignments
  for all to authenticated using (true) with check (true);

drop policy if exists guidebook_recommendations_auth_all on guidebook_recommendations;
create policy guidebook_recommendations_auth_all on guidebook_recommendations
  for all to authenticated using (true) with check (true);

drop policy if exists guidebook_recommendation_assignments_auth_all on guidebook_recommendation_assignments;
create policy guidebook_recommendation_assignments_auth_all on guidebook_recommendation_assignments
  for all to authenticated using (true) with check (true);
