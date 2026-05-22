-- Invitation-only signup — allow-list table.
--
-- The portal previously let anyone hitting /login open the "Create Account"
-- tab and self-register. This table flips that to invitation-only: an
-- email only completes signup if a corresponding row exists here with
-- accepted_at IS NULL and expires_at > now().
--
-- Option B (per the implementation plan in GitHub issue #1): we lean on
-- Supabase's built-in invite flow for the email + token, so this table
-- doesn't carry its own token column. Supabase Auth handles the link;
-- this table is purely the allow-list of who's been invited and whether
-- they've completed the flow yet.
--
-- Service-role only — no client access at all. The accept-invite edge
-- function reads/writes with the service-role key. Client RLS hardening
-- on other data tables (using this allow-list) is a follow-up PR.

CREATE TABLE IF NOT EXISTS public.admin_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at timestamptz,
  invited_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_invites_email_idx
  ON public.admin_invites(lower(email));

ALTER TABLE public.admin_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role only" ON public.admin_invites;
CREATE POLICY "service role only"
  ON public.admin_invites
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Seed every existing auth.users row as already-accepted. Without this,
-- the four known accounts would be locked out the moment the accept-invite
-- function starts gating access against this table. We mark them
-- accepted_at = created_at so they pass any "accepted_at IS NOT NULL"
-- check immediately. Emails are lower-cased so future lookups (which
-- match on lower(email)) never miss.
INSERT INTO public.admin_invites (email, accepted_at, invited_by, created_at)
SELECT
  lower(email),
  COALESCE(email_confirmed_at, created_at, now()),
  id,
  COALESCE(created_at, now())
FROM auth.users
WHERE email IS NOT NULL
ON CONFLICT (email) DO NOTHING;
