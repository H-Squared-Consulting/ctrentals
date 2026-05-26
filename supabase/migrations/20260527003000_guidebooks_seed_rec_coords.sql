-- Guidebook PR #6 — recommendation coordinates.
-- Populates lat/lng on the seeded Cape Town recommendations so the
-- new Map view has pins to render. Idempotent via slug match.

update guidebook_recommendations set lat = -33.9544, lng = 18.4036 where slug = 'table-mountain-aerial-cableway';
update guidebook_recommendations set lat = -33.9881, lng = 18.4329 where slug = 'kirstenbosch';
update guidebook_recommendations set lat = -34.0270, lng = 18.4170 where slug = 'constantia-wine-farms';
update guidebook_recommendations set lat = -34.0276, lng = 18.4198 where slug = 'groot-constantia';
update guidebook_recommendations set lat = -33.8061, lng = 18.3722 where slug = 'robben-island';
update guidebook_recommendations set lat = -34.3568, lng = 18.4974 where slug = 'cape-point';
update guidebook_recommendations set lat = -34.0254, lng = 18.4039 where slug = 'la-colombe';
update guidebook_recommendations set lat = -34.0299, lng = 18.4185 where slug = 'foxcroft';
update guidebook_recommendations set lat = -34.0710, lng = 18.3550 where slug = 'chefs-warehouse-tintswalo';
update guidebook_recommendations set lat = -34.0250, lng = 18.4628 where slug = 'jack-black-brewing';
update guidebook_recommendations set lat = -33.7910, lng = 18.9296 where slug = 'babylonstoren';
update guidebook_recommendations set lat = -33.9290, lng = 18.4234 where slug = 'district-six-museum';
update guidebook_recommendations set lat = -33.9255, lng = 18.4275 where slug = 'castle-of-good-hope';
update guidebook_recommendations set lat = -34.0399, lng = 18.4222 where slug = 'heritage-market-constantia-uitsig';
update guidebook_recommendations set lat = -33.9520, lng = 18.3776 where slug = 'cape-town-best-beaches';
update guidebook_recommendations set lat = -33.9215, lng = 18.4181 where slug = 'first-thursdays';
update guidebook_recommendations set lat = -33.9293, lng = 18.4593 where slug = 'hope-gin-distillery';
update guidebook_recommendations set lat = -34.0445, lng = 18.4322 where slug = 'norval-foundation';
update guidebook_recommendations set lat = -34.0689, lng = 18.3441 where slug = 'chapmans-peak-drive';
update guidebook_recommendations set lat = -34.1972, lng = 18.4519 where slug = 'boulders-beach-penguins';
