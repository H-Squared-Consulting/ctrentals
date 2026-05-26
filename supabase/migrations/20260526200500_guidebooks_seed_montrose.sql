-- Demo seed: a real, published 9-Montrose-Terrace guidebook backed by a
-- curated subset of the shared library entries we'd build out in full.
-- Idempotent — each insert is ON CONFLICT (slug) DO UPDATE so re-running
-- the migration after content tweaks is safe.

-- ── Shared house-manual library ──────────────────────────────────────
insert into guidebook_house_manuals (slug, title, category, body_html, icon, is_standard) values
  ('standard-load-shedding', 'Load-Shedding in Cape Town', 'Utilities',
    '<p>Cape Town occasionally experiences scheduled power outages known as <strong>load-shedding</strong>. The home is equipped with a small inverter that keeps WiFi, key lights and phone chargers running during outages.</p><p>Check the current schedule on the <em>EskomSePush</em> app (free, iOS/Android) — set it to <strong>Area: Cape Town 7</strong> for accurate timings in our suburb.</p><p>If power doesn''t return within 30 minutes of the scheduled end, please WhatsApp the host.</p>',
    'bolt', true),
  ('standard-grocery-shopping', 'Grocery Shopping', 'Errands',
    '<p>The closest supermarkets are <strong>Woolworths Constantia Village</strong> (5 min drive — best for everyday + fresh produce) and <strong>Checkers Constantia</strong> (slightly cheaper, broader range).</p><p>For specialty items: <strong>Hartlief Constantia Deli</strong> for cold meats and German bread, <strong>Metro Organics on Kendal Rd</strong> for organic produce.</p><p>All deliver to the property via the apps <em>Sixty60</em> (Checkers) or <em>WoolworthsDash</em>.</p>',
    'shopping-cart', true),
  ('standard-laundry-notice', 'Laundry', 'Inside the home',
    '<p>The washing machine is located off the kitchen. <strong>Cold wash only</strong> please — the home runs on a heat pump and hot washes trip the breaker.</p><p>Tumble dryer next to the washer. Empty the lint filter after each cycle (top compartment, lift up).</p><p>An iron and board are in the laundry cupboard.</p>',
    'washing-machine', true),
  ('standard-emergencies-constantia', 'Emergencies (Constantia)', 'Safety',
    '<p><strong>In an emergency dial 10111</strong> (SAPS) or <strong>10177</strong> (Ambulance).</p><p>The nearest 24-hour private hospital is <strong>Constantiaberg Mediclinic</strong> (021 799 2911) — 8 minutes by car. The nearest 24-hour pharmacy is the <strong>Constantia Village Dis-Chem</strong>.</p><p>Armed-response is provided by <strong>ADT Security</strong>; the panic button is on the master bedroom wall. Press and hold for 2 seconds.</p>',
    'alert', true),
  ('standard-transportation', 'Getting Around', 'Transport',
    '<p>The easiest way to get around Cape Town is <strong>Uber</strong> or <strong>Bolt</strong> — both have wide coverage and are typically R60–R200 per trip in the southern suburbs.</p><p>For day trips and wine tours, we recommend <strong>Just Mich Tours</strong> (private guide, see Recommendations) or <strong>Cape Town Hop-On Hop-Off</strong> (Red Bus).</p><p>If you''re renting a car, the property has secure off-street parking for two vehicles.</p>',
    'car', true),
  ('standard-suntan', 'Sun-tan / Self-Tanning Notice', 'Care of the home',
    '<p>Cape Town''s sun is fierce — SPF 30+ is a must, especially between 10am and 4pm.</p><p>A gentle ask: please avoid using <strong>self-tanning sprays or lotions</strong> on the white linen — the stains are extremely difficult to remove and we''ve had to replace bedding before. Use a separate towel if applying.</p>',
    'sun', true),
  ('mt-keys-access', 'Keys & Access', 'Arrival',
    '<p>You''ll be met at the property at check-in. The host (Hayley) will hand over <strong>two sets of keys</strong>: a front-door bunch and a separate gate remote.</p><p>The alarm code and WiFi password are written on the card on the kitchen counter.</p>',
    'key', false),
  ('mt-pool-outdoors', 'Pool & Outdoors', 'Outside the home',
    '<p>The pool is a heated saltwater pool — comfortable year-round. The cover lifts off easily (lever on the south side). Please replace it overnight to keep the heat in.</p><p>The outdoor braai (BBQ) is gas-powered. Spare gas bottle is in the side cupboard. <strong>Lighter and tongs are in the top drawer of the outdoor unit.</strong></p>',
    'pool', false),
  ('mt-house-rules', 'House Rules', 'House rules',
    '<p>A few quiet asks to keep the home special for the next guests:</p><ul><li>No smoking indoors (the patio is fine — please use the ashtray)</li><li>No parties or events</li><li>Quiet hours from 10pm to 7am</li><li>Pets only by prior arrangement</li></ul>',
    'home', false)
on conflict (slug) do update set
  title = excluded.title,
  category = excluded.category,
  body_html = excluded.body_html,
  icon = excluded.icon,
  is_standard = excluded.is_standard,
  updated_at = now();

-- ── Shared recommendation library ────────────────────────────────────
insert into guidebook_recommendations (slug, name, category, description, address, website, image_url) values
  ('table-mountain-aerial-cableway', 'Table Mountain Aerial Cableway', 'Top attractions',
    'The single most iconic Cape Town experience. The rotating cable car lifts you to the 1,067m summit in five minutes. Best at sunrise or just before sunset. Tickets are cheaper online and the queues at the top station are shorter for the descent if you go later in the day.',
    'Tafelberg Rd, Gardens, Cape Town', 'https://www.tablemountain.net/',
    'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=800'),
  ('kirstenbosch', 'Kirstenbosch National Botanical Garden', 'Top attractions',
    'World-class indigenous garden set against the slopes of Table Mountain. The Boomslang canopy walkway is a must. In summer (Nov–Apr) the Sunday-evening concerts on the lawn are legendary — pack a picnic and arrive early.',
    'Rhodes Dr, Newlands, Cape Town', 'https://www.sanbi.org/gardens/kirstenbosch/',
    'https://images.unsplash.com/photo-1547149099-d7f4cd13b04a?w=800'),
  ('constantia-wine-farms', 'Constantia Wine Farms', 'Wine & dining',
    'You''re a 5-minute drive from South Africa''s oldest wine route. Start at Groot Constantia (the original, 1685), then work down to Klein Constantia for the famous Vin de Constance, Steenberg for the bubbles, and Buitenverwachting for lunch under the oaks. Designated driver recommended.',
    'Constantia Valley, Cape Town', 'https://www.constantiawineroute.com/', null),
  ('groot-constantia', 'Groot Constantia Museum', 'Top attractions',
    'The historic homestead at Groot Constantia is open as a museum and gives you the full story of the Cape''s Dutch East India Company roots and the rise of South African wine. The Cape Dutch architecture alone is worth the visit.',
    'Groot Constantia Rd, Constantia', 'https://www.grootconstantia.co.za/', null),
  ('robben-island', 'Robben Island', 'Top attractions',
    'The prison-island where Nelson Mandela spent 18 of his 27 years incarcerated. Ferry departs from the V&A Waterfront and tours are led by former political prisoners — booking 1–2 weeks ahead is essential, especially in summer.',
    'Nelson Mandela Gateway, V&A Waterfront', 'https://www.robben-island.org.za/', null),
  ('cape-point', 'Cape Point', 'Day trips',
    'The dramatic headland at the south-western tip of Africa, an hour''s drive south through Chapman''s Peak. Combine it with Boulders Beach (penguins!) and lunch in Simon''s Town for a full day out. Pack a jacket — it''s always windier than you expect.',
    'Cape Point Rd, Cape Point', 'https://www.capepoint.co.za/', null),
  ('la-colombe', 'La Colombe', 'Wine & dining',
    'Consistently ranked among the world''s 50 best restaurants. The 8-course chef''s tasting menu is a 3-hour journey through fine-dining South African cuisine, set in a forest treehouse. Book 4–6 weeks ahead for dinner, 2–3 weeks for lunch.',
    'Silvermist Estate, Constantia Nek', 'https://www.lacolombe.co.za/', null),
  ('foxcroft', 'Foxcroft', 'Wine & dining',
    'La Colombe''s sister bistro — same kitchen pedigree, more relaxed, set on the Highgrove Estate. Excellent for a long lunch. The bread course alone is worth the visit.',
    'High Constantia, Constantia', 'https://foxcroft.restaurant/', null),
  ('chefs-warehouse-tintswalo', 'Chefs Warehouse at Tintswalo Atlantic', 'Wine & dining',
    'Liam Tomlin''s coastal outpost — eight tapas-style courses on the deck of Tintswalo Atlantic, with the waves breaking 5m below. The drive out via Chapman''s Peak is itself part of the experience.',
    'Hout Bay, Cape Town', 'https://tintswalo.com/atlantic/dining/', null),
  ('jack-black-brewing', 'Jack Black Brewing Co.', 'Bars & breweries',
    'Cape Town''s favourite local brewery — taproom in Diep River, 15 minutes from the house. Their lager is the standard pour at most of the city''s good restaurants. Tours on Saturdays.',
    'Diep River, Cape Town', 'https://www.jackblackbeer.com/', null),
  ('babylonstoren', 'Babylonstoren', 'Day trips',
    'A working farm + gardens + 5-star hotel in the Franschhoek Valley, an hour''s drive from the house. The Garden Restaurant is one of the country''s most photographed dining rooms. Worth a full day — combine with a morning at Boschendal next door.',
    'Klapmuts-Simondium Rd, Franschhoek', 'https://www.babylonstoren.com/', null),
  ('district-six-museum', 'District Six Museum', 'Culture',
    'A small, deeply moving museum on the history of forced removals during apartheid. An essential first-stop for any guest wanting to understand Cape Town beyond the postcard. Allow 90 minutes.',
    '25A Buitenkant St, Cape Town', 'https://www.districtsix.co.za/', null),
  ('castle-of-good-hope', 'Castle of Good Hope', 'Culture',
    'The oldest colonial building in South Africa (1666). The military museum is small but well-curated; the Key Ceremony at 10am is a fun spectacle. Free guided tours run on the hour.',
    'Buitenkant St, Cape Town', 'https://www.castleofgoodhope.co.za/', null),
  ('heritage-market-constantia-uitsig', 'Heritage Market @ Constantia Uitsig', 'Markets',
    'The most charming small Saturday market in the Southern Suburbs — 10 minutes from the house. Excellent coffee, fresh croissants, local cheese and a great kid-friendly lawn. 9am–1pm on Saturdays only.',
    'Spaanschemat River Rd, Constantia', null, null),
  ('cape-town-best-beaches', 'Best Beaches', 'Beaches',
    'Three to know: <strong>Camps Bay</strong> for the scene and Atlantic sunsets (cold water); <strong>Clifton 4th</strong> for the picture-perfect cove (also cold); <strong>Muizenberg</strong> for the warm Indian Ocean and the colourful bathing boxes (and best beginner surfing).',
    null, null, null),
  ('first-thursdays', 'First Thursdays', 'Culture',
    'On the first Thursday of every month, the galleries and shops along Bree St + Loop St in the city centre stay open until 9pm with free drinks and live music. A great way to feel the city''s creative pulse. Park near the Long St end and wander.',
    'Bree St / Loop St, Cape Town', 'https://first-thursdays.co.za/', null),
  ('hope-gin-distillery', 'Hope Gin Distillery', 'Bars & breweries',
    'Salt River''s tiny urban gin distillery — tours include a tasting flight of four signature gins paired with mixers and snacks. Quieter and more personal than the wine-farm experiences.',
    'Salt River, Cape Town', 'https://www.hopedistillery.co.za/', null),
  ('norval-foundation', 'Norval Foundation', 'Culture',
    'A world-class contemporary African art museum 8 minutes from the house. Excellent rotating exhibitions, a sculpture garden, and the Skotnes Restaurant on the deck is a lovely lunch spot.',
    '4 Steenberg Rd, Tokai', 'https://www.norvalfoundation.org/', null),
  ('chapmans-peak-drive', 'Chapman''s Peak Drive', 'Day trips',
    'One of the most scenic coastal drives in the world — 9km of cliff-hugging road between Hout Bay and Noordhoek. Drive it late afternoon for the light. Toll fee is R65 per car. Closes occasionally for rockfall (check the website).',
    'Chapman''s Peak Dr, Hout Bay', 'https://www.chapmanspeakdrive.co.za/', null),
  ('boulders-beach-penguins', 'Boulders Beach', 'Top attractions',
    'The colony of African penguins at Boulders is one of the only places in the world you can see them at this range. Use the entry near the Foxy Beach boardwalk for the best photos. Pair with lunch in Simon''s Town and Cape Point.',
    'Kleintuin Rd, Simon''s Town', 'https://www.sanparks.org/parks/table-mountain/', null)
on conflict (slug) do update set
  name = excluded.name,
  category = excluded.category,
  description = excluded.description,
  address = excluded.address,
  website = excluded.website,
  image_url = excluded.image_url,
  updated_at = now();

-- ── The Montrose Terrace guidebook itself ────────────────────────────
insert into guidebooks (
  slug, property_name, host_name,
  street_name, street_number, city, country_code, postal_code,
  hero_image_url,
  checkin_text, directions_text, parking_text,
  wifi_ssid, wifi_password, wifi_notes,
  checkout_text, is_published
) values (
  'montrose-terrace', '9 Montrose Terrace', 'Hayley Harrod',
  'Montrose Terrace', '9', 'Cape Town', 'ZA', '7806',
  'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1600',
  'Check-in is from <strong>3pm</strong>. Hayley will meet you at the property — please send a WhatsApp 30 minutes before arrival so we can time the handover. If you''re landing late, we can arrange a key-safe in advance.',
  'From Cape Town International, take the M3 south towards Muizenberg and exit at Constantia Main Rd. Turn right at the Constantia Village shopping centre, then second left into Spaanschemat River Rd. Montrose Terrace is the third right. The house is #9, on the left, with a green gate and a stone-pillar entrance.',
  '<p>The property has <strong>secure off-street parking for two vehicles</strong> behind the gate. A third car can park on the verge but please keep the driveway clear for the neighbours.</p>',
  'Montrose-Terrace-Guest', 'WelcomeHome2026',
  'Two networks broadcast at the property — the guest network (above) and a host-only network you can ignore. The router lives in the study cupboard if you need to power-cycle it.',
  'Check-out by <strong>10am</strong> please. Leave the keys on the kitchen counter and pull the front door closed — it locks automatically. A short check-out checklist sits next to the kettle.',
  true
)
on conflict (slug) do update set
  property_name = excluded.property_name,
  host_name = excluded.host_name,
  street_name = excluded.street_name,
  street_number = excluded.street_number,
  city = excluded.city,
  country_code = excluded.country_code,
  postal_code = excluded.postal_code,
  hero_image_url = excluded.hero_image_url,
  checkin_text = excluded.checkin_text,
  directions_text = excluded.directions_text,
  parking_text = excluded.parking_text,
  wifi_ssid = excluded.wifi_ssid,
  wifi_password = excluded.wifi_password,
  wifi_notes = excluded.wifi_notes,
  checkout_text = excluded.checkout_text,
  is_published = excluded.is_published,
  updated_at = now();

-- Attach the house manuals (ordered).
with gb as (select id from guidebooks where slug = 'montrose-terrace')
insert into guidebook_manual_assignments (guidebook_id, manual_id, position)
select gb.id, m.id, ord.pos
from gb,
     (values
       ('mt-keys-access', 1),
       ('mt-house-rules', 2),
       ('mt-pool-outdoors', 3),
       ('standard-load-shedding', 4),
       ('standard-grocery-shopping', 5),
       ('standard-laundry-notice', 6),
       ('standard-transportation', 7),
       ('standard-emergencies-constantia', 8),
       ('standard-suntan', 9)
     ) as ord(slug, pos)
join guidebook_house_manuals m on m.slug = ord.slug
on conflict (guidebook_id, manual_id) do update set position = excluded.position;

-- Attach the recommendations (ordered).
with gb as (select id from guidebooks where slug = 'montrose-terrace')
insert into guidebook_recommendation_assignments (guidebook_id, recommendation_id, position)
select gb.id, r.id, ord.pos
from gb,
     (values
       ('table-mountain-aerial-cableway', 1),
       ('kirstenbosch', 2),
       ('cape-point', 3),
       ('boulders-beach-penguins', 4),
       ('chapmans-peak-drive', 5),
       ('robben-island', 6),
       ('constantia-wine-farms', 7),
       ('groot-constantia', 8),
       ('babylonstoren', 9),
       ('la-colombe', 10),
       ('foxcroft', 11),
       ('chefs-warehouse-tintswalo', 12),
       ('jack-black-brewing', 13),
       ('hope-gin-distillery', 14),
       ('norval-foundation', 15),
       ('district-six-museum', 16),
       ('castle-of-good-hope', 17),
       ('heritage-market-constantia-uitsig', 18),
       ('first-thursdays', 19),
       ('cape-town-best-beaches', 20)
     ) as ord(slug, pos)
join guidebook_recommendations r on r.slug = ord.slug
on conflict (guidebook_id, recommendation_id) do update set position = excluded.position;
