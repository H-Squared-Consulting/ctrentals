-- RLS policies alone aren't enough on Supabase — the role also needs
-- the corresponding table-level GRANT or PostgREST returns 403 before
-- RLS even gets evaluated. Mirrors the pattern in 20260525130000_admin_handles.

grant select on public.guidebooks                                to anon, authenticated;
grant select on public.guidebook_house_manuals                   to anon, authenticated;
grant select on public.guidebook_manual_assignments              to anon, authenticated;
grant select on public.guidebook_recommendations                 to anon, authenticated;
grant select on public.guidebook_recommendation_assignments      to anon, authenticated;

grant insert, update, delete on public.guidebooks                                to authenticated;
grant insert, update, delete on public.guidebook_house_manuals                   to authenticated;
grant insert, update, delete on public.guidebook_manual_assignments              to authenticated;
grant insert, update, delete on public.guidebook_recommendations                 to authenticated;
grant insert, update, delete on public.guidebook_recommendation_assignments      to authenticated;
