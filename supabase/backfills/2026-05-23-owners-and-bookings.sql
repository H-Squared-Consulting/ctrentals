-- ============================================================
-- CT Rentals: Backfill Home Owners, Property Links and Bookings
-- ============================================================
--
-- For Jordon to run against the CTR Supabase project.
-- Wrapped in a transaction so it is all-or-nothing, and ends
-- with ROLLBACK so the first run is a DRY RUN and changes
-- nothing. After eyeballing the counts and the spot-check list,
-- change the final ROLLBACK to COMMIT and run it again.
--
-- Sources:
--   * Owners spreadsheet (May 2026)              -> 49 owners
--   * 2026 / 2027 season booking calendar         -> 41 bookings
--
-- Year mapping for bookings (confirmed with Gazza):
--   October, November, December dates -> 2026
--   January, February, March, April   -> 2027
--
-- Status rule: any booking whose check-out is on or before
-- today (2026-05-23) goes in as 'checked_out'; everything else
-- goes in as 'confirmed'. With the year mapping above, every
-- booking in this dump is future-dated, so all are 'confirmed'.
--
-- Properties looked up by slug. Owners and guests created
-- fresh. Hayley will review in the admin portal afterwards.
-- ============================================================

-- ============================================================
-- IMPORTANT — RUN-ORDER NOTE FOR JORDON
-- ============================================================
-- This script and PR #21 (property_owners join table for joint
-- ownership) are intentionally independent. Cleanest order:
--
--   1. Run this backfill first. It only inserts rows and sets
--      the legacy partner_properties.owner_id column.
--   2. Merge PR #21 second. Its migration creates the
--      property_owners join table and backfills it from
--      partner_properties.owner_id (which this script will
--      have just populated), so the join table lands complete.
--
-- If the order ends up reversed (PR #21 merges first, this
-- backfill runs second), the "Safety" block in Section 3 below
-- detects the property_owners table at runtime and writes the
-- same link rows itself. ON CONFLICT DO NOTHING keeps it safe
-- to run twice. So either order works, no manual cleanup
-- needed from you.
-- ============================================================

BEGIN;

-- ── 1. INSERT OWNERS ───────────────────────────────────────
INSERT INTO home_owners
  (partner_id, name, email, phone, company, payment_notes, notes)
VALUES
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Kym Dalley',                'kymdalley@mweb.co.za',           '082 9225981',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Georgina Ratcliffe',        'georgina@conova.co.za',          '082 5599155',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'James Manser Tanfield',     'james@advertisingwarehouse.co.za','082 3353555',    NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Yianni Pouroullis & Kate',  'yianni@icon.co.za',              '082 3763675 / 082 8808313', NULL, NULL, 'Joint owners'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Ané Parry',                  'ane.parry@gmail.com',            '082 8558509',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Julie',                      'julieb@pathcare.org',            '083 639 0102',    NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Bernice Raaff',              'bernicer@mweb.co.za',            '082 9251347',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Tarick Yildirim',            'gary@threebones.com',            '082 3333944',     NULL, NULL, 'Managed by Gary (082 3333944)'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Matt & Kirsty Mundy',        'matt@procrit.co.za',             '082 3090556',     NULL, NULL, 'Joint owners'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Sally Ferguson',             'sally@appleaday.co.za',          '083 2318399',     NULL, NULL, 'Also owns 7 Dawn Avenue (no slug yet)'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Jessica Van Sittert',        'jessicavansittert@icloud.com',   '082 3399800',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Lorraine & Pete Martin',     'lorrainefleurmartin@gmail.com',  '074 5846899',     NULL, NULL, 'Joint owners. 12 Ave Bordeaux. Slug needs confirming (two Bordeaux properties).'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Danica Slatter',             'danica@slatter.co.za',           '072 2967545',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Chris Edwards',              'chris.edwards@absa.africa',      '071 3955722',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Thomas Quinton',             'quintonorama@gmail.com',         '+44 7789 000616', NULL, NULL, '44A Pagasvlei Road. No matching slug, needs adding.'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Kelly Maconachie',           'kelly@channelmobile.co.za',      '083 4628584',     NULL, NULL, '64 Strawberry Lane. Slug needs confirming (multiple Strawberry Lanes).'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Hayley Muir',                'coxallhj@mweb.co.za',            '083 6352541',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Sally Hutton',               'sally.hutton@webberwentzel.com', '083 2872791',     NULL, NULL, 'Surname also seen as Roward'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Sharon Richey',              'sharon.richey@becausexm.com',    '063 9818499',     NULL, NULL, 'Owns all three Buitenzorg cottages'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Helen Schultz',              NULL,                              '082 209 2655',   NULL, NULL, '19 Picardie Avenue. No email on file.'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Tricia Francois',            'tricia@the-jones.tv',            '082 9070699',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Fiona Ross',                 'fiona.ross@virgin.com',          '083 3241234',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Kate Judge',                 'kate@judgehome.co.za',           '082 4591344',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Lindsay Voogt',              'lindsay.voogt@gmail.com',        '082 8861000',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Shirley Bosman',             'shirley@sagprint.co.za',         '083 4571935',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Leigh-Ann Cooke',            'leigh-ann@bluechip.co.za',       '082 5599400',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Kate Naughton',              'kate@iafricaleisuresafaris.com', '082 7885703',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Des Potter',                 'despotter4@gmail.com',           '082 3251987',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Sally Mckenzie',             'sally@bordeauxonbritannia.co.za','084 8804655',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Lynne Hudson',               'lynne.j.hudson@icloud.com',      '083 4112261',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Angie Lander',               'angie.lander1998@gmail.com',     '083 4450152',     NULL, NULL, '18 Strawberry Lane. Slug needs confirming.'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Gina Malherbe',              'gina@komdev.com',                '082 4923501',     NULL, NULL, 'Also known as Mills. Property unspecified in source.'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Hayley Sherman',             'hayley@hayleysherman.co.za',     '082 3236469',     NULL, NULL, '19 Upper Primrose. Slug needs confirming.'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Bridget van Breda',          'vanillaessence@mweb.co.za',      '084 5044185',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Sharon Dickinson',           'sharon@dickinson.co.za',         '082 8712013',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Carol Watson',               'carolwatson01@gmail.com',        '083 6584284',     NULL, NULL, '31 6th Street Hermanus. No matching slug.'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Kim Gloyne',                 'kim@vanilaevents.co.za',         '072 2505842',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Lisa King',                  'lisamaryking@gmail.com',         '072 2417479',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Mia Daly',                   'mia@africansafaritravelexpert.com','084 511 7092',  NULL, NULL, 'Maiden name Schoeman. 41 Shrewsbury Way (no matching slug).'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Ursula Morris',              'ursulamorris9@gmail.com',        '083 3252215',     NULL, NULL, '45 Rathfelder. Slug needs confirming.'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Lyndsey Pharo',              NULL,                              '082 079 7961',   NULL, NULL, '45 Talana Close. No email, no matching slug.'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Adele Berry',                'adeleb@berrydon.co.za',          '082 8877141',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Simone Hirsh',               'design@simonekatherine.com',     '082 3331010',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Andrew VC',                  'vc@bigskyprod.com',              '072 6624403',     NULL, NULL, '12 Upper Primrose. Slug needs confirming.'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Tracey Steyn',               'traceysteyn@gmail.com',          '084 5551815',     NULL, NULL, '19 Constantia Nek, Olive Grove. No matching slug.'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Karen Botten',               'kabotten@tlkomsa.net',           '082 7800218',     NULL, NULL, '40 Rathfelder Avenue. Slug needs confirming.'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Anna-Marie Bos',             'anna@bosct.co.za',               '082 4181114',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Frankie Wyer',               'frankiewyer@gmail.com',          '082 4691606',     NULL, NULL, NULL),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Cindy Elder',                'cindyelder@intekom.co.za',       '083 4549997',     NULL, NULL, NULL);


-- ── 2. LINK OWNERS TO PROPERTIES ───────────────────────────
-- 35 confident matches. Each UPDATE finds the owner by email
-- and the property by slug, both scoped to the CTR partner.

UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'georgina@conova.co.za' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0002' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'james@advertisingwarehouse.co.za' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0003' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'yianni@icon.co.za' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0004' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'ane.parry@gmail.com' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0005' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'bernicer@mweb.co.za' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0006' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'gary@threebones.com' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0007' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'matt@procrit.co.za' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0008' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'jessicavansittert@icloud.com' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0010' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'danica@slatter.co.za' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0012' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'chris.edwards@absa.africa' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0013' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'coxallhj@mweb.co.za' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0016' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'sally.hutton@webberwentzel.com' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0017' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'kymdalley@mweb.co.za' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0018' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'sharon.richey@becausexm.com' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0019' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'julieb@pathcare.org' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0020' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'tricia@the-jones.tv' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0023' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'fiona.ross@virgin.com' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0024' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'kate@judgehome.co.za' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0025' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'lindsay.voogt@gmail.com' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0026' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'shirley@sagprint.co.za' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0027' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'leigh-ann@bluechip.co.za' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0028' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'kate@iafricaleisuresafaris.com' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0029' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'despotter4@gmail.com' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0030' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'sally@bordeauxonbritannia.co.za' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0031' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'kim@vanilaevents.co.za' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0032' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'lynne.j.hudson@icloud.com' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0033' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'vanillaessence@mweb.co.za' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0037' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'sharon@dickinson.co.za' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0038' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'lisamaryking@gmail.com' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0040' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'adeleb@berrydon.co.za' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0042' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'sally@appleaday.co.za' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0043' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE name = 'Helen Schultz' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0044' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'design@simonekatherine.com' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0045' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'sharon.richey@becausexm.com' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0050' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'sharon.richey@becausexm.com' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0051' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'frankiewyer@gmail.com' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0052' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'cindyelder@intekom.co.za' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0053' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
UPDATE partner_properties SET owner_id = (SELECT id FROM home_owners WHERE email = 'anna@bosct.co.za' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0') WHERE slug = 'CTR0058' AND partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';


-- ── 3. SAFETY: mirror links into property_owners if it exists ──
-- Forward-compat with PR #21 in case it has already merged.
-- If property_owners does not exist yet, this block does
-- nothing and PR #21's own backfill will pick up our rows
-- when its migration runs. If it does exist, we write one
-- is_primary=true row per linked property. ON CONFLICT keeps
-- it safe to run more than once.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'property_owners'
  ) THEN
    INSERT INTO property_owners (property_id, owner_id, is_primary)
    SELECT pp.id, pp.owner_id, true
      FROM partner_properties pp
     WHERE pp.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0'
       AND pp.owner_id IS NOT NULL
    ON CONFLICT (property_id, owner_id) DO NOTHING;
  END IF;
END$$;


-- ── 4. INSERT BOOKINGS (with guests created inline) ────────
-- Each block is one self-contained CTE: insert the guest,
-- capture its id via RETURNING, then insert the booking joined
-- to that guest and to the property by slug.
--
-- All bookings come in as 'confirmed' (none are in the past).
-- Manager is Hayley for all (the one Nicki-managed booking is
-- in the skip list at the bottom). Notes carry across the
-- "agent" platform tag and any extras text from the source.

-- March 2027 ---------------------------------------------------
WITH g AS (INSERT INTO guests (partner_id, name, phone, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Kavin', NULL, 'India', 'repeat') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_phone, guest_nationality, guests_total, guests_adults, guests_children, check_in, check_out, platform, manager, house_contact, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Kavin', NULL, 'India', 2, 2, NULL, '2027-03-03'::date, '2027-03-09'::date, 'repeat', 'Hayley', 'Lynne', NULL, 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0033' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, phone, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Spencer Fleischer', '+1 415 816 6153', 'vrbo') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_phone, guests_total, guests_adults, check_in, check_out, platform, manager, house_contact, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Spencer Fleischer', '+1 415 816 6153', 2, 2, '2027-03-05'::date, '2027-03-18'::date, 'vrbo', 'Hayley', 'Jess', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0062' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, phone, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Andrew & Gina Bell', '+44 7903 730967', 'United Kingdom', 'airbnb') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_phone, guest_nationality, guests_total, guests_adults, guests_children, check_in, check_out, platform, manager, house_contact, extras, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Andrew & Gina Bell', '+44 7903 730967', 'United Kingdom', 3, 2, 1, '2027-03-06'::date, '2027-03-11'::date, 'airbnb', 'Hayley', 'Bernice', 'Bath and cot', '4.5 month baby (Serena)', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0055' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Nina Trowe', 'Germany', 'direct') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, guests_children, check_in, check_out, platform, manager, house_contact, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Nina Trowe', 'Germany', 7, 1, 6, '2027-03-08'::date, '2027-03-22'::date, 'direct', 'Hayley', 'Jess', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0010' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'David Thomson & Kylie', 'United Kingdom', 'agent') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, check_in, check_out, platform, manager, house_contact, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'David Thomson & Kylie', 'United Kingdom', 2, 2, '2027-03-10'::date, '2027-03-17'::date, 'other', 'Hayley', 'Cindy Elder', 'Booked via agent', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0053' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Francesco & Hilla', 'agent') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guests_total, guests_adults, check_in, check_out, platform, manager, house_contact, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Francesco & Hilla', 2, 2, '2027-03-11'::date, '2027-04-07'::date, 'other', 'Hayley', 'Frankie', 'Booked via agent', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0052' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Darren & Nicola Holdcroft', 'United Kingdom', 'direct') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_adults, check_in, check_out, platform, manager, house_contact, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Darren & Nicola Holdcroft', 'United Kingdom', 2, '2027-03-16'::date, '2027-06-16'::date, 'other', 'Hayley', 'Carmel', '2 adults, 3 sons and friends at ad hoc times', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0022' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, phone, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Olivia Harris', '+61 437 386 010', 'direct') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_phone, check_in, check_out, platform, manager, house_contact, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Olivia Harris', '+61 437 386 010', '2027-03-20'::date, '2027-03-22'::date, 'other', 'Hayley', 'Anna', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0061' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Matt & Amanda Spittle', 'United Kingdom', 'direct') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, guests_children, check_in, check_out, platform, manager, house_contact, extras, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Matt & Amanda Spittle', 'United Kingdom', 4, 2, 2, '2027-03-31'::date, '2027-04-09'::date, 'other', 'Hayley', 'Bernice', 'Early check in (1pm), late checkout (3pm)', 'Family gathering, local family also staying over', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0006' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

-- April 2027 ---------------------------------------------------
WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Justin Fenn', 'South Africa', 'direct') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, check_in, check_out, platform, manager, house_contact, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Justin Fenn', 'South Africa', 5, 5, '2027-04-03'::date, '2027-04-12'::date, 'direct', 'Hayley', 'Shirley', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0027' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Kavin Mittal', 'India', 'repeat') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, check_in, check_out, platform, manager, house_contact, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Kavin Mittal', 'India', 2, 2, '2027-04-06'::date, '2027-05-06'::date, 'repeat', 'Hayley', 'James', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0003' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Sacha', 'South Africa', 'direct') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, check_in, check_out, platform, manager, house_contact, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Sacha', 'South Africa', 2, 2, '2027-04-20'::date, '2027-06-15'::date, 'direct', 'Hayley', 'Shirley', '2 adults, 3 dogs', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0027' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, phone, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Kumeshen', '+27 82 785 4365', 'South Africa', 'repeat') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_phone, guest_nationality, guests_total, guests_adults, guests_children, check_in, check_out, platform, manager, house_contact, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Kumeshen', '+27 82 785 4365', 'South Africa', 4, 2, 2, '2027-04-25'::date, '2027-05-02'::date, 'repeat', 'Hayley', 'Cindy Elder', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0053' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

-- October to December 2026 -------------------------------------
WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Production', 'Germany', 'repeat') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, check_in, check_out, platform, manager, house_contact, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Production', 'Germany', '2026-10-15'::date, '2026-11-28'::date, 'repeat', 'Hayley', 'Jess', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0010' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Julian', 'United Kingdom', 'repeat') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, check_in, check_out, platform, manager, house_contact, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Julian', 'United Kingdom', 6, 6, '2026-10-18'::date, '2026-10-30'::date, 'repeat', 'Hayley', 'Shirley', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0027' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'John and June', 'United Kingdom', 'repeat') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, check_in, check_out, platform, manager, house_contact, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'John and June', 'United Kingdom', 2, 2, '2026-11-12'::date, '2026-12-10'::date, 'repeat', 'Hayley', 'Karen', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0048' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Susan Rowett', 'agent') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guests_total, guests_adults, guests_children, check_in, check_out, platform, manager, house_contact, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Susan Rowett', 12, 8, 4, '2026-12-14'::date, '2026-12-28'::date, 'other', 'Hayley', 'Anna', 'Booked via agent (PH). Children ages 5, 7, 16, 18', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0061' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, phone, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Meghan Mundy', '+1 585 746 5395', 'United States', 'airbnb') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_phone, guest_nationality, guests_total, guests_adults, check_in, check_out, platform, manager, house_contact, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Meghan Mundy', '+1 585 746 5395', 'United States', 8, 8, '2026-12-15'::date, '2026-12-28'::date, 'airbnb', 'Hayley', 'Jess', 'Nephew''s wedding', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0010' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Annelize', 'repeat') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, check_in, check_out, platform, manager, house_contact, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Annelize', '2026-12-18'::date, '2027-01-02'::date, 'repeat', 'Hayley', 'Adele', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0042' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, phone, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Ellen McCabe Wackwitz', '+1 650 703 368', NULL, 'vrbo') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_phone, guests_total, guests_adults, guests_children, check_in, check_out, platform, manager, house_contact, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Ellen McCabe Wackwitz', '+1 650 703 368', 8, 6, 2, '2026-12-19'::date, '2026-12-26'::date, 'vrbo', 'Hayley', 'Bernice', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0006' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, phone, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Ian Lien', '+65 9667 1409', 'Singapore', 'airbnb') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_phone, guest_nationality, guests_total, check_in, check_out, platform, manager, house_contact, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Ian Lien', '+65 9667 1409', 'Singapore', 5, '2026-12-19'::date, '2027-01-02'::date, 'airbnb', 'Hayley', 'Lyndsey', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0026' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Maarten', 'Germany', 'repeat') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, guests_children, check_in, check_out, platform, manager, house_contact, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Maarten', 'Germany', 6, 2, 4, '2026-12-19'::date, '2027-01-02'::date, 'repeat', 'Hayley', 'Helen', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0044' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'David', 'United Kingdom', 'repeat') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, guests_children, check_in, check_out, platform, manager, house_contact, extras, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'David', 'United Kingdom', 11, 8, 3, '2026-12-20'::date, '2027-01-01'::date, 'repeat', 'Hayley', 'Kate', '4 king/queen beds. Late checkout on 1st', '8 adults, 3 grandchildren', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0004' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Jacqui O''Sullivan', 'South Africa', 'repeat') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, guests_children, check_in, check_out, platform, manager, house_contact, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Jacqui O''Sullivan', 'South Africa', 6, 4, 2, '2026-12-20'::date, '2027-01-02'::date, 'repeat', 'Hayley', 'Tricia', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0023' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Oleg Andreev', 'United States', 'airbnb') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, guests_children, check_in, check_out, platform, manager, house_contact, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Oleg Andreev', 'United States', 13, 8, 5, '2026-12-20'::date, '2027-01-03'::date, 'airbnb', 'Hayley', 'James', '8 adults, 2 kids, 3 infants (1.5y.o and 2 x 2y.o). Cots? Pool fence?', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0003' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, phone, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Mark Hauser', '+41 78 608 98 27', 'Switzerland', 'airbnb') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_phone, guest_nationality, guests_total, guests_adults, guests_children, check_in, check_out, platform, manager, house_contact, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Mark Hauser', '+41 78 608 98 27', 'Switzerland', 9, 6, 3, '2026-12-24'::date, '2027-01-07'::date, 'airbnb', 'Hayley', 'Leigh', '6 adults, 2 kids, 1 infant', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0054' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Wesley - LE (Katinka)', 'Sweden', 'agent') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, guests_children, check_in, check_out, platform, manager, house_contact, extras, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Wesley - LE (Katinka)', 'Sweden', 5, 3, 2, '2026-12-26'::date, '2027-01-07'::date, 'other', 'Hayley', 'Hannah', 'Early check in 26th', 'Parents and nanny. Kids Catherine (3) and Ian (5). Booked via agent.', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0028' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Carolin Leitermann', 'Germany', 'direct') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, check_in, check_out, platform, manager, house_contact, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Carolin Leitermann', 'Germany', 6, 6, '2026-12-26'::date, '2027-01-09'::date, 'direct', 'Hayley', 'Pete', '6 adults (TBC)', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0025' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Rose Llewellyn', 'United Kingdom', 'direct') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, check_in, check_out, platform, manager, house_contact, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Rose Llewellyn', 'United Kingdom', '2026-12-26'::date, '2027-01-10'::date, 'direct', 'Hayley', 'Bridget', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0037' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Charlie (Pierre)', 'United Kingdom', 'repeat') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, guests_children, check_in, check_out, platform, manager, house_contact, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Charlie (Pierre)', 'United Kingdom', 8, 6, 2, '2026-12-27'::date, '2027-01-09'::date, 'repeat', 'Hayley', 'Carmel', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0022' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Vanessa Jeffrey', 'United Kingdom', 'repeat') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, check_in, check_out, platform, manager, house_contact, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Vanessa Jeffrey', 'United Kingdom', 2, 2, '2026-12-28'::date, '2027-01-08'::date, 'repeat', 'Hayley', 'Bernice', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0055' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Thor & Kristen (Sam)', 'United Kingdom', 'repeat') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, guests_children, check_in, check_out, platform, manager, house_contact, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Thor & Kristen (Sam)', 'United Kingdom', 5, 2, 3, '2026-12-28'::date, '2027-01-11'::date, 'repeat', 'Hayley', 'Julie', 'Family and friends to join ad hoc', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0020' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, phone, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Jonas Kriebel', '+49 151 1500 2828', 'agent') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_phone, guests_total, guests_adults, check_in, check_out, platform, manager, house_contact, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Jonas Kriebel', '+49 151 1500 2828', 10, 10, '2026-12-29'::date, '2027-01-07'::date, 'other', 'Hayley', 'Anna', 'Booked via agent (PH)', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0061' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

-- January to February 2027 -------------------------------------
WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Freddie & Lizzie Wright', 'United Kingdom', 'agent') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, guests_children, check_in, check_out, platform, manager, house_contact, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Freddie & Lizzie Wright', 'United Kingdom', 10, 8, 2, '2027-01-02'::date, '2027-01-09'::date, 'other', 'Hayley', 'Kate', '8 adults, 1 toddler, 1 infant. Booked via agent.', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0004' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Kyri', 'United Kingdom', 'direct') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, check_in, check_out, platform, manager, house_contact, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Kyri', 'United Kingdom', 11, '2027-01-03'::date, '2027-01-15'::date, 'direct', 'Hayley', 'Jess', '10 guests + 1 infant. Confirm adult/child split for baby equipment.', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0010' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Thomas Holtrop', 'Germany', 'repeat') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, check_in, check_out, platform, manager, house_contact, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Thomas Holtrop', 'Germany', 1, 1, '2027-01-10'::date, '2027-01-30'::date, 'repeat', 'Hayley', 'Anna-Marie', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0058' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Jonathan & Anne Walker', 'United Kingdom', 'repeat') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, check_in, check_out, platform, manager, house_contact, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Jonathan & Anne Walker', 'United Kingdom', 4, 4, '2027-01-28'::date, '2027-02-14'::date, 'repeat', 'Hayley', 'Kate', 'Will use as base to explore. 60th birthday trip.', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0029' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Mike (Celeste)', 'United Kingdom', 'agent') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, check_in, check_out, platform, manager, house_contact, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Mike (Celeste)', 'United Kingdom', 2, 2, '2027-02-07'::date, '2027-03-07'::date, 'other', 'Hayley', 'Tarik', '2 adults plus friends. Booked via agent.', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0007' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Stephen - LE', 'Germany', 'agent') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, check_in, check_out, platform, manager, house_contact, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Stephen - LE', 'Germany', 4, 4, '2027-02-22'::date, '2027-03-08'::date, 'other', 'Hayley', 'Bernice', 'Booked via agent', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0055' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Martene - LE (Axel & Christiane)', 'Germany', 'agent') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, check_in, check_out, platform, manager, house_contact, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Martene - LE (Axel & Christiane)', 'Germany', 2, 2, '2027-03-01'::date, '2027-04-11'::date, 'other', 'Hayley', 'Sally', '2 adults plus friends. Booked via agent.', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0017' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

WITH g AS (INSERT INTO guests (partner_id, name, country, source) VALUES ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', 'Celeste - Bridget', 'United States', 'agent') RETURNING id)
INSERT INTO bookings (partner_id, property_id, guest_id, guest_name, guest_nationality, guests_total, guests_adults, guests_children, check_in, check_out, platform, manager, house_contact, notes, status, created_at, updated_at)
SELECT '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', p.id, g.id, 'Celeste - Bridget', 'United States', 6, 5, 1, '2027-04-17'::date, '2027-04-25'::date, 'other', 'Hayley', 'Tarik', '5 adults, 1 child (13 months). Booked via agent.', 'confirmed', now(), now()
FROM g, partner_properties p WHERE p.slug = 'CTR0007' AND p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';


-- ── 5. VERIFICATION ────────────────────────────────────────
-- Expected:
--   home_owners                  = 49
--   properties with owner linked = 38   (35 by email + Picardie by name + Sharon's 2 Buitenzorgs counted in the 35 — net 36 properties)
--   property_owners (if exists)  = same as above
--   guests                       = 41
--   bookings                     = 41

SELECT 'home_owners inserted' AS check_name, count(*) AS row_count
  FROM home_owners
 WHERE partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

SELECT 'properties with owner linked' AS check_name, count(*) AS row_count
  FROM partner_properties
 WHERE partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0'
   AND owner_id IS NOT NULL;

SELECT 'guests inserted' AS check_name, count(*) AS row_count
  FROM guests
 WHERE partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

SELECT 'bookings inserted' AS check_name, count(*) AS row_count
  FROM bookings
 WHERE partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

-- property_owners count if PR #21 has merged. Will silently
-- show zero rows (not error) if the table doesn't exist yet.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'property_owners'
  ) THEN
    RAISE NOTICE 'property_owners row count: %', (
      SELECT count(*) FROM property_owners po
        JOIN partner_properties pp ON pp.id = po.property_id
       WHERE pp.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0'
    );
  ELSE
    RAISE NOTICE 'property_owners table does not exist yet (PR #21 not merged) — fine, skipping.';
  END IF;
END$$;

-- Every property and its linked owner (or NULL).
SELECT p.slug, p.property_name, o.name AS owner_name, o.email AS owner_email
  FROM partner_properties p
  LEFT JOIN home_owners o ON o.id = p.owner_id
 WHERE p.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0'
 ORDER BY p.slug;

-- Every booking by check-in date.
SELECT b.check_in, b.check_out, b.guest_name, p.slug AS property, b.platform, b.status
  FROM bookings b
  JOIN partner_properties p ON p.id = b.property_id
 WHERE b.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0'
 ORDER BY b.check_in, b.guest_name;

-- Any guest record without a booking (would indicate a broken
-- link in the inserts above). Should return zero rows.
SELECT g.id, g.name, g.created_at
  FROM guests g
  LEFT JOIN bookings b ON b.guest_id = g.id
 WHERE g.partner_id = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0'
   AND b.id IS NULL;


-- ── 6. NEEDS MANUAL HANDLING IN ADMIN PORTAL ───────────────
-- These owners are inserted but NOT auto-linked to a property,
-- and the bookings below were NOT inserted because the property
-- could not be resolved. Hayley to handle in the admin portal.
--
-- OWNERS NOT AUTO-LINKED
--   Ambiguous (multiple properties share the name):
--     Lorraine & Pete Martin  -- 12 Ave Bordeaux        (CTR0011 or CTR0057)
--     Andrew VC               -- 12 Upper Primrose       (CTR0036 or CTR0064)
--     Hayley Sherman          -- 19 Upper Primrose       (CTR0036 or CTR0064)
--     Kelly Maconachie        -- 64 Strawberry Lane      (CTR0015 or CTR0034)
--     Angie Lander            -- 18 Strawberry Lane      (CTR0015 or CTR0034)
--     Ursula Morris           -- 45 Rathfelder           (CTR0048, also Karen Botten)
--     Karen Botten            -- 40 Rathfelder Avenue    (CTR0048, also Ursula Morris)
--   No matching slug:
--     Thomas Quinton          -- 44A Pagasvlei Road
--     Carol Watson            -- 31 6th Street, Hermanus
--     Mia Daly                -- 41 Shrewsbury Way
--     Lyndsey Pharo           -- 45 Talana Close
--     Tracey Steyn            -- 19 Constantia Nek (Olive Grove)
--   No property given in source:
--     Gina Malherbe
--
-- BOOKINGS NOT INSERTED (need Hayley to add manually)
--     Olly                    -- 18 - 28 Dec   Boulderwood + Cottage (combined listing)
--     Martene                 -- 20 Dec - 4 Jan  Pagasvlei (no slug)
--     Naeema (Andrew Flloyd)  -- 20 Dec - 6 Jan  64 Strawberry (ambiguous slug)
--     Galit                   -- 23 Dec - 9 Jan  104 Zwaanswyk (no slug)
--     Roger                   -- 23 Dec - 15 Jan Hermanus (no slug, managed by Nicki)
--     Daniel Kanfer           -- 25 Dec - 3 Jan  Bordeaux (ambiguous slug)
--     Craig & Diana Griffin   -- 5 Jan - 10 Mar  12 Bordeaux (ambiguous slug)
--     Rainer                  -- 15 Jan - 10 Feb Skydance (no slug)


-- ── 7. FINISH ──────────────────────────────────────────────
-- DRY RUN by default. To save the data, change the line below
-- from ROLLBACK to COMMIT and run the file again.

ROLLBACK;
-- COMMIT;
