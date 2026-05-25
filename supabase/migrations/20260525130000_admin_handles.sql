-- admin_handles: short URL-safe handles → admin email, used by the public
-- brochure to show the sharer's email contact pill without leaking the
-- full email address in the share URL. The brochure URL carries `?s=jh`
-- and the public page resolves `jh` to `jordon@hsquared-consulting.com`
-- via this table.
--
-- Reads are public (anon SELECT) so the static brochure can do the lookup.
-- Writes are service-role only — handles are seeded by hand here.

create table if not exists public.admin_handles (
  handle text primary key check (handle ~ '^[a-z0-9]{2,8}$'),
  email  text not null unique,
  created_at timestamptz not null default now()
);

alter table public.admin_handles enable row level security;

drop policy if exists "admin_handles public read" on public.admin_handles;
create policy "admin_handles public read"
  on public.admin_handles
  for select
  to anon, authenticated
  using (true);

grant select on public.admin_handles to anon, authenticated;

insert into public.admin_handles (handle, email) values
  ('jh', 'jordon@hsquared-consulting.com')
on conflict (handle) do nothing;
