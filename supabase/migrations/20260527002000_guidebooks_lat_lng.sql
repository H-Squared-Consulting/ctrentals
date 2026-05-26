-- Guidebook PR #4 — property coordinates (GUIDEBOOK_DESIGN_GUIDE §4.2, §10.1).
--
-- Mapbox GL JS in the Directions card needs lat/lng. The Property table
-- (partner_properties) doesn't carry coordinates, so they live on the
-- guidebook row directly. Editing happens via the admin editor in a
-- later PR; for now the seed sets Montrose explicitly.

alter table guidebooks
  add column if not exists lat numeric,
  add column if not exists lng numeric;

-- Approximate centre of 9 Montrose Terrace, Constantia, Cape Town.
update guidebooks
  set lat = -34.0263,
      lng = 18.4377,
      updated_at = now()
  where slug = 'montrose-terrace';
