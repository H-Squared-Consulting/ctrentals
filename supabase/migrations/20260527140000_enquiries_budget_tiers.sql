-- Enquiries budget: replace the legacy numeric min/max range with a
-- multi-select of canonical price tiers (very_low → very_high) keyed
-- off the enquiry's source channel. Single source of truth for budget
-- now matches the global search modal — no parallel filtering logic.
--
-- Historical budget_min / budget_max values on existing rows are
-- intentionally not backfilled into tiers (the conversion is fuzzy
-- and the team is fine with starting fresh on the new shape).

alter table enquiries
  drop column if exists budget_min,
  drop column if exists budget_max,
  add  column if not exists budget_tiers text[];
