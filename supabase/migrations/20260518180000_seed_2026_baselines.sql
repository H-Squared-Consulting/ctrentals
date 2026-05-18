-- Seed 2026 baseline daily rates from Pricing 2026 sheet (column H).
-- Monthly rate set to daily * 30 as a placeholder so the NOT-NULL
-- constraint holds; team can refine monthly rates per property
-- via the Pricing tab in the editor.

BEGIN;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 63600.0, 1908000.0, false FROM partner_properties WHERE slug = 'CTR0001'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 20606.4, 618192.0, false FROM partner_properties WHERE slug = 'CTR0002'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 21200.0, 636000.0, false FROM partner_properties WHERE slug = 'CTR0003'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 31800.0, 954000.0, false FROM partner_properties WHERE slug = 'CTR0004'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 20606.4, 618192.0, false FROM partner_properties WHERE slug = 'CTR0005'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 21606.4, 648192.0, false FROM partner_properties WHERE slug = 'CTR0006'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 40000.0, 1200000.0, false FROM partner_properties WHERE slug = 'CTR0007'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 25000.0, 750000.0, false FROM partner_properties WHERE slug = 'CTR0008'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 84000.0, 2520000.0, false FROM partner_properties WHERE slug = 'CTR0009'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 36633.6, 1099008.0, false FROM partner_properties WHERE slug = 'CTR0010'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 31800.0, 954000.0, false FROM partner_properties WHERE slug = 'CTR0011'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 52000.0, 1560000.0, false FROM partner_properties WHERE slug = 'CTR0012'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 20606.4, 618192.0, false FROM partner_properties WHERE slug = 'CTR0013'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 52000.0, 1560000.0, false FROM partner_properties WHERE slug = 'CTR0014'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 14840.0, 445200.0, false FROM partner_properties WHERE slug = 'CTR0015'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 15454.800000000001, 463644.0, false FROM partner_properties WHERE slug = 'CTR0016'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 31800.0, 954000.0, false FROM partner_properties WHERE slug = 'CTR0017'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 32000.0, 960000.0, false FROM partner_properties WHERE slug = 'CTR0018'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 57240.0, 1717200.0, false FROM partner_properties WHERE slug = 'CTR0019'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 28620.0, 858600.0, false FROM partner_properties WHERE slug = 'CTR0020'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 37312.0, 1119360.0, false FROM partner_properties WHERE slug = 'CTR0022'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 25000.0, 750000.0, false FROM partner_properties WHERE slug = 'CTR0054'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 32000.0, 960000.0, false FROM partner_properties WHERE slug = 'CTR0055'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 21200.0, 636000.0, false FROM partner_properties WHERE slug = 'CTR0023'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 14000.0, 420000.0, false FROM partner_properties WHERE slug = 'CTR0024'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 17172.0, 515160.0, false FROM partner_properties WHERE slug = 'CTR0025'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 10875.6, 326268.0, false FROM partner_properties WHERE slug = 'CTR0026'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 10303.2, 309096.0, false FROM partner_properties WHERE slug = 'CTR0027'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 12592.800000000001, 377784.0, false FROM partner_properties WHERE slug = 'CTR0028'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 9730.800000000001, 291924.0, false FROM partner_properties WHERE slug = 'CTR0029'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 22000.0, 660000.0, false FROM partner_properties WHERE slug = 'CTR0030'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 25000.0, 750000.0, false FROM partner_properties WHERE slug = 'CTR0031'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 15900.0, 477000.0, false FROM partner_properties WHERE slug = 'CTR0032'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 14840.0, 445200.0, false FROM partner_properties WHERE slug = 'CTR0033'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 13500.0, 405000.0, false FROM partner_properties WHERE slug = 'CTR0034'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 13737.6, 412128.0, false FROM partner_properties WHERE slug = 'CTR0035'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 20606.4, 618192.0, false FROM partner_properties WHERE slug = 'CTR0036'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 16027.2, 480816.0, false FROM partner_properties WHERE slug = 'CTR0037'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 45000.0, 1350000.0, false FROM partner_properties WHERE slug = 'CTR0038'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 24727.68, 741830.4, false FROM partner_properties WHERE slug = 'CTR0040'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 13737.6, 412128.0, false FROM partner_properties WHERE slug = 'CTR0042'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 30750.0, 922500.0, false FROM partner_properties WHERE slug = 'CTR0043'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 20000.0, 600000.0, false FROM partner_properties WHERE slug = 'CTR0044'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 9540.0, 286200.0, false FROM partner_properties WHERE slug = 'CTR0056'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 18020.0, 540600.0, false FROM partner_properties WHERE slug = 'CTR0057'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 30000.0, 900000.0, false FROM partner_properties WHERE slug = 'CTR0058'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 23320.0, 699600.0, false FROM partner_properties WHERE slug = 'CTR0045'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 13250.0, 397500.0, false FROM partner_properties WHERE slug = 'CTR0047'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 10875.6, 326268.0, false FROM partner_properties WHERE slug = 'CTR0048'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 18889.2, 566676.0, false FROM partner_properties WHERE slug = 'CTR0049'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 10303.2, 309096.0, false FROM partner_properties WHERE slug = 'CTR0050'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 9158.4, 274752.0, false FROM partner_properties WHERE slug = 'CTR0051'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 4579.2, 137376.0, false FROM partner_properties WHERE slug = 'CTR0052'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 8480.0, 254400.0, false FROM partner_properties WHERE slug = 'CTR0054'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 4300.0, 129000.0, false FROM partner_properties WHERE slug = 'CTR0053'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
INSERT INTO baselines (property_id, year, daily_rate, monthly_rate, locked)
  SELECT id, 2026, 6360.0, 190800.0, false FROM partner_properties WHERE slug = 'CTR0055'
  ON CONFLICT (property_id, year) DO UPDATE SET daily_rate = EXCLUDED.daily_rate, monthly_rate = EXCLUDED.monthly_rate, updated_at = now() WHERE NOT baselines.locked;
COMMIT;
