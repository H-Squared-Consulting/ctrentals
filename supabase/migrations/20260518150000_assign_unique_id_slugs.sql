-- Migration: assign Unique IDs as slugs
-- Replaces address-based slugs with the team's CTR codes so brochure URLs
-- (e.g. /brochures/CTR0001) don't leak property addresses.

BEGIN;
UPDATE partner_properties SET slug = 'CTR0005' WHERE id = 'cbff99f1-e719-429e-b477-b3c36c422e8e';  -- 144 Constantia Main Road
UPDATE partner_properties SET slug = 'CTR0047' WHERE id = '8d72a3f3-4d9a-4635-821e-dff1b3673aa3';  -- 27 Urmarah
UPDATE partner_properties SET slug = 'CTR0007' WHERE id = '0d999b93-73be-4b40-9eda-c0970226fb40';  -- 3 Bones
UPDATE partner_properties SET slug = 'CTR0032' WHERE id = '58c8aa98-9cf1-4a25-936e-acb3ad5f2582';  -- 34 Eyton Road
UPDATE partner_properties SET slug = 'CTR0045' WHERE id = 'ccb04a04-8348-430a-85a6-e1f6092f6ab5';  -- 5 Durham Avenue
UPDATE partner_properties SET slug = 'CTR0003' WHERE id = 'cf300ea4-09e9-4e58-b063-e38e886c3a26';  -- Ainsty
UPDATE partner_properties SET slug = 'CTR0025' WHERE id = '09c3a5ee-0203-4745-9f6c-2b411a59d293';  -- Alphen
UPDATE partner_properties SET slug = 'CTR0042' WHERE id = 'f1376727-fb0e-421f-ace9-f80c89098b42';  -- Atlantic Drive
UPDATE partner_properties SET slug = 'CTR0022' WHERE id = '7390c018-0722-465c-a4d6-da22140a48ce';  -- Bellvue
UPDATE partner_properties SET slug = 'CTR0056' WHERE id = '82cafb5b-12fd-47fc-acc7-2e6698010e29';  -- Bergzicht Close
UPDATE partner_properties SET slug = 'CTR0040' WHERE id = '8989e28b-c0e3-418d-bd01-06592d4f1d2e';  -- Bishopscourt Drive
UPDATE partner_properties SET slug = 'CTR0057' WHERE id = '72ce491e-2f5b-488d-958f-f76e546f59df';  -- Bordeaux
UPDATE partner_properties SET slug = 'CTR0011' WHERE id = '3fff857f-7d78-4e0b-a36d-1ccd45abd77c';  -- Bordeaux
UPDATE partner_properties SET slug = 'CTR0018' WHERE id = '6cf89838-ef56-4241-a16f-79b27e7241a0';  -- Boulderwood
UPDATE partner_properties SET slug = 'CTR0052' WHERE id = 'aa38b1ac-7f8e-4ae5-bc07-5f3009df16e5';  -- Boulderwood Cottage
UPDATE partner_properties SET slug = 'CTR0016' WHERE id = '42e44645-c067-40e4-b2d7-d17e4091e183';  -- Brommersvlei
UPDATE partner_properties SET slug = 'CTR0051' WHERE id = 'a463bd18-5799-4204-b1fa-fee90ef009cf';  -- Buitenzorg Garden Cottage
UPDATE partner_properties SET slug = 'CTR0019' WHERE id = 'a633ff91-7991-4d07-a43a-b43e4adde0ca';  -- Buitenzorg Manor House
UPDATE partner_properties SET slug = 'CTR0050' WHERE id = '67e42556-30a8-4177-9c8b-67aa87bf9d36';  -- Buitenzorg Pool House
UPDATE partner_properties SET slug = 'CTR0027' WHERE id = '2072aefa-fcf4-4c21-8873-d2c23e2714f6';  -- Cherry Lane
UPDATE partner_properties SET slug = 'CTR0024' WHERE id = '0a73a7da-7079-407f-9335-1e8b0a167b2a';  -- Connor Close
UPDATE partner_properties SET slug = 'CTR0049' WHERE id = 'f6168724-c805-4112-944e-9f63dc3fd9b2';  -- Copper House
UPDATE partner_properties SET slug = 'CTR0012' WHERE id = 'fe3e1e73-e065-4e63-b653-f09ba7007d46';  -- Dunkeld
UPDATE partner_properties SET slug = 'CTR0033' WHERE id = 'cb7b887a-a24c-47f7-885a-f54b3c405b18';  -- Durham
UPDATE partner_properties SET slug = 'CTR0030' WHERE id = '2f8a5358-cb4d-4509-8f51-8e8f023150dd';  -- Eugene Marais
UPDATE partner_properties SET slug = 'CTR0014' WHERE id = 'bab83547-1912-489a-ba76-65e7fee0bab3';  -- Forest House
UPDATE partner_properties SET slug = 'CTR0031' WHERE id = 'afc85fbd-116a-4e67-a49c-a9b3872e81e8';  -- Fulham
UPDATE partner_properties SET slug = 'CTR0020' WHERE id = '73db7cef-7cfd-411f-bd83-bc4f5a91e0b6';  -- Hillwood
UPDATE partner_properties SET slug = 'CTR0059' WHERE id = '24260971-151a-4de1-a67a-ef42e54be4c6';  -- Hohenhort
UPDATE partner_properties SET slug = 'CTR0060' WHERE id = '1c109aca-e4a6-4c37-9053-f42f2ce42c0e';  -- House Harrod
UPDATE partner_properties SET slug = 'CTR0038' WHERE id = '4364de5c-0504-4469-b158-b121072704e3';  -- Invermark
UPDATE partner_properties SET slug = 'CTR0061' WHERE id = 'e410510f-e9ec-41c9-bb12-c2480b965b06';  -- Ivy House
UPDATE partner_properties SET slug = 'CTR0062' WHERE id = '80c4c715-eb17-45cc-a753-24d1a09faacc';  -- Kent
UPDATE partner_properties SET slug = 'CTR0010' WHERE id = '9bae794c-8c1b-4c18-977e-72e77ec941ca';  -- Kirstenbosch
UPDATE partner_properties SET slug = 'CTR0053' WHERE id = 'ef5b2ddf-5e37-4d14-a113-792ecedb6de9';  -- Klaasenbosch Cottage
UPDATE partner_properties SET slug = 'CTR0013' WHERE id = '9f29ce6f-fd4d-4ad7-8f2d-e1b8b41ddaf6';  -- Le Seur
UPDATE partner_properties SET slug = 'CTR0043' WHERE id = '6e91108a-f3e8-4f77-869f-f10540e2980b';  -- Meadow House
UPDATE partner_properties SET slug = 'CTR0008' WHERE id = '029015dd-188b-4b5f-ae38-93cb409220f2';  -- Michael Storer
UPDATE partner_properties SET slug = 'CTR0023' WHERE id = '67af4160-ba5a-4a89-aea9-f95720c4e610';  -- Military
UPDATE partner_properties SET slug = 'CTR0004' WHERE id = 'df6182fb-2555-4424-bd89-dce1a830ee93';  -- Montrose Terrace
UPDATE partner_properties SET slug = 'CTR0054' WHERE id = '544f875c-832e-4744-8c8d-64794176aa96';  -- Orleans
UPDATE partner_properties SET slug = 'CTR0044' WHERE id = 'b8ed4ef8-b96c-44ad-832b-02b6d6b89026';  -- Picardie
UPDATE partner_properties SET slug = 'CTR0029' WHERE id = 'cbe023fa-92a3-40f8-b418-e98c556c1076';  -- Pinehurst
UPDATE partner_properties SET slug = 'CTR0048' WHERE id = '538989f5-3369-40e3-8df5-ec6ec113dbca';  -- Rathfelder
UPDATE partner_properties SET slug = 'CTR0017' WHERE id = '4508045c-3587-4aaa-a7fe-d4d50004d14d';  -- Runway House
UPDATE partner_properties SET slug = 'CTR0026' WHERE id = 'ee1edcdf-5e89-4bc9-b039-0a87534fff48';  -- Soetvlei
UPDATE partner_properties SET slug = 'CTR0006' WHERE id = 'edf8edb5-a4f0-4ea2-97ff-85bc2535cefe';  -- Sohland
UPDATE partner_properties SET slug = 'CTR0055' WHERE id = '86febea5-a734-486a-84aa-99e694f05099';  -- Sohland cottage
UPDATE partner_properties SET slug = 'CTR0035' WHERE id = '4b38b9da-4903-4c02-ab86-e4a644e8ec00';  -- Strawberry Fields
UPDATE partner_properties SET slug = 'CTR0034' WHERE id = 'a7ad16ad-5355-44c4-8044-54c56d900643';  -- Strawberry Lane
UPDATE partner_properties SET slug = 'CTR0015' WHERE id = 'b567cd9d-078b-492a-bacb-0d83bc0d2501';  -- Strawberry Lane
UPDATE partner_properties SET slug = 'CTR0063' WHERE id = 'c1cce0d6-fc3a-489e-8c94-8bcb7018f91a';  -- Sweet Valley Estate
UPDATE partner_properties SET slug = 'CTR0002' WHERE id = '144704b6-bbdb-4765-bd0b-820f205c0aaa';  -- The Wood
UPDATE partner_properties SET slug = 'CTR0064' WHERE id = 'a0098fa8-3c6c-4701-aa1a-e1e84e248d8e';  -- Upper Primrose
UPDATE partner_properties SET slug = 'CTR0036' WHERE id = 'f096e077-eb4b-42af-9b74-bd7cbdc7e7cb';  -- Upper Primrose
UPDATE partner_properties SET slug = 'CTR0037' WHERE id = 'a47e72bf-7d93-428a-80db-2d9eae493f3d';  -- Urmarah Close
UPDATE partner_properties SET slug = 'CTR0028' WHERE id = '9a2cbed3-f7bd-4597-a676-b28987cfa73a';  -- Valley Close
UPDATE partner_properties SET slug = 'CTR0009' WHERE id = '4869342a-46d8-4152-88cf-10274519f072';  -- Villa Kilimani
UPDATE partner_properties SET slug = 'CTR0058' WHERE id = '02a7b92a-aa93-4cfe-a550-f4c81acff8fd';  -- Zwaanswyk
COMMIT;
