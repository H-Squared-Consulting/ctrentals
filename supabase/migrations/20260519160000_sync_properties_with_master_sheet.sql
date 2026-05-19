-- Sync partner_properties to match the team's master CTR-code spreadsheet
-- exactly. After this runs the DB has rows for CTR0001–CTR0063 mapping 1:1
-- to Sheet1 of "house numbers".
--
-- Ordering matters — slug moves use a temp slug to dodge the unique
-- index, and deletes run before any insert that reuses a slug.

BEGIN;

-- ── 1. Delete House Harrod (test) — frees CTR0060 ──────────────────────
DELETE FROM partner_properties WHERE slug = 'CTR0060';

-- ── 2. Slug moves ───────────────────────────────────────────────────────
-- Sequenced so each target slug is guaranteed free at the moment of update.
--   (a) Hohenhort (CTR0059) → CTR0060 "15 Hohenhort Ave"  [target free after step 1]
--   (b) Upper Primrose @ 48 (CTR0064) → CTR0059 "48 Upper Primrose"  [target free after a]
--   (c) Sohland cottage (CTR0055) → temp slug  [frees CTR0055]
--   (d) Sweet Valley Estate (CTR0063) → CTR0055 "Valley Road" / "10 Valley Rd"
--       (user confirmed: same property)  [target free after c]
--   (e) Sohland cottage (temp slug) → CTR0063  [target free after d]
--   (f) Ivy House (CTR0061) → CTR0001 "24A Klaasens"  (CTR0001 was empty;
--       user confirmed: Ivy House = 24A Klaasens, same property)
--   (g) "34 Eyton Road" (CTR0032) → CTR0039 inactive  (sheet CTR0039
--       is "34 Eyton Road" marked inactive)

-- (a)
UPDATE partner_properties
SET slug = 'CTR0060', property_name = '15 Hohenhort Ave'
WHERE slug = 'CTR0059';

-- (b)
UPDATE partner_properties
SET slug = 'CTR0059', property_name = '48 Upper Primrose'
WHERE slug = 'CTR0064';

-- (c)
UPDATE partner_properties SET slug = 'CTR_TMP_55' WHERE slug = 'CTR0055';

-- (d)
UPDATE partner_properties
SET slug = 'CTR0055', property_name = 'Valley Road', address_line1 = '10 Valley Rd'
WHERE slug = 'CTR0063';

-- (e)
UPDATE partner_properties
SET slug = 'CTR0063', property_name = 'Sohland cottage'
WHERE slug = 'CTR_TMP_55';

-- (f)
UPDATE partner_properties
SET slug = 'CTR0001', property_name = '24A Klaasens'
WHERE slug = 'CTR0061';

-- (g)
UPDATE partner_properties
SET slug = 'CTR0039', property_name = '34 Eyton Road', is_published = false
WHERE slug = 'CTR0032';

-- ── 3. Renames (slug stays, property_name aligns with sheet) ────────────
UPDATE partner_properties SET property_name = '4 The Wood, Zonnestral'          WHERE slug = 'CTR0002';
UPDATE partner_properties SET property_name = '7 Ainsty Walk'                   WHERE slug = 'CTR0003';
UPDATE partner_properties SET property_name = '9 Montrose Terrace'              WHERE slug = 'CTR0004';
UPDATE partner_properties SET property_name = '144 Constantia Main Rd'          WHERE slug = 'CTR0005';
UPDATE partner_properties SET property_name = '2 Sohland Avenue'                WHERE slug = 'CTR0006';
UPDATE partner_properties SET property_name = '3 Bones-44 Pagesvlei Road'       WHERE slug = 'CTR0007';
UPDATE partner_properties SET property_name = '4 Michael Storer Avenue'         WHERE slug = 'CTR0008';
UPDATE partner_properties SET property_name = '7 Dawn Avenue (Villa Kilimani)'  WHERE slug = 'CTR0009';
UPDATE partner_properties SET property_name = '9 Kirstenbosch Drive'            WHERE slug = 'CTR0010';
UPDATE partner_properties SET property_name = '12 Ave Bordeaux'                 WHERE slug = 'CTR0011';
UPDATE partner_properties SET property_name = '12 Dunkeld Avenue'               WHERE slug = 'CTR0012';
UPDATE partner_properties SET property_name = '20 Le Seur Ave'                  WHERE slug = 'CTR0013';
UPDATE partner_properties SET property_name = '44A Pagasvlei Road'              WHERE slug = 'CTR0014';
UPDATE partner_properties SET property_name = '64 Strawberry Lane'              WHERE slug = 'CTR0015';
UPDATE partner_properties SET property_name = '73 Brommersvlei Road'            WHERE slug = 'CTR0016';
UPDATE partner_properties SET property_name = 'Runway House, 2 Vineyard Ave'    WHERE slug = 'CTR0017';
UPDATE partner_properties SET property_name = 'Boulderwood, Valley Road*'       WHERE slug = 'CTR0018';
UPDATE partner_properties SET property_name = 'Buitenzorg- The Manor House*'    WHERE slug = 'CTR0019';
UPDATE partner_properties SET property_name = '9 Hillwood Ave'                  WHERE slug = 'CTR0020';
UPDATE partner_properties SET property_name = '4 Bellvue (Ayodele)'             WHERE slug = 'CTR0022';
UPDATE partner_properties SET property_name = '1 Military Rd-Leopard Rock'      WHERE slug = 'CTR0023';
UPDATE partner_properties SET property_name = '3 Connor Close'                  WHERE slug = 'CTR0024';
UPDATE partner_properties SET property_name = '3 Alphen Drive'                  WHERE slug = 'CTR0025';
UPDATE partner_properties SET property_name = '4 Soetvlei'                      WHERE slug = 'CTR0026';
UPDATE partner_properties SET property_name = '5 Cherry Lane'                   WHERE slug = 'CTR0027';
UPDATE partner_properties SET property_name = '7 The Valley Close'              WHERE slug = 'CTR0028';
UPDATE partner_properties SET property_name = '7 Pinehurst Road'                WHERE slug = 'CTR0029';
UPDATE partner_properties SET property_name = '9 Eugene Marais'                 WHERE slug = 'CTR0030';
UPDATE partner_properties SET property_name = '11 Fulham Road, Camps Bay'       WHERE slug = 'CTR0031';
UPDATE partner_properties SET property_name = '15 Durham Ave'                   WHERE slug = 'CTR0033';
UPDATE partner_properties SET property_name = '18 Strawberry Lane'              WHERE slug = 'CTR0034';
UPDATE partner_properties SET property_name = '12 Strawberry Fields'            WHERE slug = 'CTR0035';
UPDATE partner_properties SET property_name = '19 Upper Primrose'               WHERE slug = 'CTR0036';
UPDATE partner_properties SET property_name = '19 Urmarah Close'                WHERE slug = 'CTR0037';
UPDATE partner_properties SET property_name = '30 Invernmark Crescent'          WHERE slug = 'CTR0038';
UPDATE partner_properties SET property_name = '37 Bishopscourt Drive'           WHERE slug = 'CTR0040';
UPDATE partner_properties SET property_name = '89 Atlantic Drive, Onrus'        WHERE slug = 'CTR0042';
UPDATE partner_properties SET property_name = '98 Zwaanswyk Road(Meadow House)' WHERE slug = 'CTR0043';
UPDATE partner_properties SET property_name = '19 Picardie Avenue'              WHERE slug = 'CTR0044';
UPDATE partner_properties SET property_name = '5 Durham Avenue'                 WHERE slug = 'CTR0045';
UPDATE partner_properties SET property_name = '27 Urmarah'                      WHERE slug = 'CTR0047';
UPDATE partner_properties SET property_name = '40 Rathfelder Avenue'            WHERE slug = 'CTR0048';
UPDATE partner_properties SET property_name = '129A Zwaanswyk Road'             WHERE slug = 'CTR0049';
UPDATE partner_properties SET property_name = 'Buitenzorg- The Pool House*'     WHERE slug = 'CTR0050';
UPDATE partner_properties SET property_name = 'Buitenzorg- The Garden Cottage*' WHERE slug = 'CTR0051';
UPDATE partner_properties SET property_name = 'Boulderwood cottage*'            WHERE slug = 'CTR0052';
UPDATE partner_properties SET property_name = 'Klaasenbosch cottage'            WHERE slug = 'CTR0053';
UPDATE partner_properties SET property_name = 'Orleans Ave'                     WHERE slug = 'CTR0054';
UPDATE partner_properties SET property_name = 'Bergzicht Close'                 WHERE slug = 'CTR0056';
UPDATE partner_properties SET property_name = '21 Bordeaux Ave'                 WHERE slug = 'CTR0057';
UPDATE partner_properties SET property_name = '104 Zwaanswyk'                   WHERE slug = 'CTR0058';
UPDATE partner_properties SET property_name = 'Kent'                            WHERE slug = 'CTR0062';

-- ── 4. Inserts (5 rows that exist on sheet but not in DB) ───────────────
-- partner_id matches CT_RENTALS_PARTNER_ID in src/pages/constants.ts.
-- Inactive entries get is_published=false; row stays so the CTR sequence
-- has no gaps and historical proposals can still resolve.
INSERT INTO partner_properties (slug, property_name, address_line1, partner_id, is_published, is_archived) VALUES
  ('CTR0021', 'Roderick Way',                    NULL,            '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', false, false),
  ('CTR0032', 'Eyton Road',                      '27 Eyton Road', '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', false, false),
  ('CTR0041', '41 Shrewsbury Way',               NULL,            '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', false, false),
  ('CTR0046', '19 Constantia Nek (Olive Grove)', NULL,            '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', false, false),
  ('CTR0061', '33a Upper Primrose',              NULL,            '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0', true,  false);

-- ── 5. Sanity check — expected 63 rows for CTR0001–CTR0063, no gaps ────
DO $$
DECLARE total_count int;
BEGIN
  SELECT COUNT(*) INTO total_count FROM partner_properties WHERE slug LIKE 'CTR%';
  IF total_count <> 63 THEN
    RAISE EXCEPTION 'Property sync failed: expected 63 rows, got %.', total_count;
  END IF;
END $$;

COMMIT;
