-- Add company and email columns to agents, then seed initial agents
-- Run in Supabase SQL Editor

ALTER TABLE agents ADD COLUMN IF NOT EXISTS company text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS email text;

-- Insert all agents (default commission 15% — edit per-agent in the UI as needed)
INSERT INTO agents (name, company, email, default_commission_pct) VALUES
  -- Luxury Escapes
  ('Wesley Evenwel',   'Luxury Escapes',         'wesley@luxuryescapes.capetown',   15),
  ('Stephen Bornman',  'Luxury Escapes',         'stephen@luxuryescapes.capetown',  15),
  ('Milly Whelan',     'Luxury Escapes',         'milly@luxuryescapes.capetown',    15),
  ('Martene Evenwel',  'Luxury Escapes',         'martene@luxuryescapes.capetown',  15),
  -- Cape Concierge
  ('Anneline Klaase',  'Cape Concierge',         'anneline@capeconcierge.co.za',    15),
  -- Cape Villa Collection
  ('Hayley van Rooyen','Cape Villa Collection',  'hayley@capevillacollection.com',  15),
  ('Sue Nixon',        'Cape Villa Collection',  'sue@capevillacollection.com',     15),
  ('Kylie Minor',      'Cape Villa Collection',  'Kylie@capevillacollection.com',   15),
  -- Capsol
  ('Danielle Perold',  'Capsol',                 'danielle@capsol.co.za',           15),
  ('Naeema Jacobs',    'Capsol',                 'naeema@capsol.co.za',             15),
  -- Villas In Cape Town
  ('Pierre Vermaak',   'Villas In Cape Town',    'pierre@villasincapetown.com',     15),
  -- Dogon
  ('Cailine McCann',   'Dogon',                  'cailine@dgproperties.co.za',      15),
  -- The Luxury Travel Book
  ('Freddie Marquis',  'The Luxury Travel Book', 'freddie@theluxurytravelbook.com', 15),
  ('Jamie Marquis',    'The Luxury Travel Book', 'Jamie@theluxurytravelbook.com',   15),
  -- Cape Villa Rentals
  ('Kelly Bates',      'Cape Villa Rentals',     'kelly@capevillarentals.com',      15),
  -- Steadfast
  ('Leande Den Duik',  'Steadfast',              'leande@steadfast.africa',         15),
  ('Billi Head',       'Steadfast',              'billi@steadfast.africa',          15),
  -- Constantia Hideaways
  ('Vibeke',           'Constantia Hideaways',   'vibeke@constantiahideaways.co.za',15),
  -- Hyde & Seek
  ('Sanela Bozic',     'Hyde & Seek',            'info@hydeandseek.co.za',          15),
  -- Vacationer
  ('Celeste Lombard',  'Vacationer',             'celeste@vacationer.co.za',        15);
