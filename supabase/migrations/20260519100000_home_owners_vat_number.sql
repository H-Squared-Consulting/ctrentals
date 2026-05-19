-- Home owners: drop default_commission_pct (commission lives elsewhere,
-- not on the owner), add vat_number for owners renting through a
-- registered company that needs VAT invoicing.

ALTER TABLE home_owners
  DROP COLUMN IF EXISTS default_commission_pct;

ALTER TABLE home_owners
  ADD COLUMN IF NOT EXISTS vat_number text;
