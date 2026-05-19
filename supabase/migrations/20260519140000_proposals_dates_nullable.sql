-- Proposals created from the calculator may not have firm dates yet (an
-- agent quote is often pricing-only; the agent's client picks their own
-- dates later). Allow check_in / check_out / guests_total to be null so
-- the proposal page can render only the fields that were actually filled
-- in, rather than padding with misleading defaults.

ALTER TABLE proposals
  ALTER COLUMN check_in DROP NOT NULL,
  ALTER COLUMN check_out DROP NOT NULL,
  ALTER COLUMN guests_total DROP NOT NULL;
