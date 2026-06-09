-- The original guidebooks grants (20260526201000) granted anon +
-- authenticated only, so the service_role key — used by backend tooling
-- like scripts/import-hostfully-guidebook.mjs --write — got
-- "permission denied for table guidebooks" (42501) before RLS even ran.
-- service_role bypasses RLS but still needs the table-level GRANT.

grant select, insert, update, delete on
  public.guidebooks,
  public.guidebook_house_manuals,
  public.guidebook_manual_assignments,
  public.guidebook_recommendations,
  public.guidebook_recommendation_assignments
to service_role;
