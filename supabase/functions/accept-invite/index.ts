// supabase/functions/accept-invite/index.ts
//
// Final step of the invitation-only signup flow (see GitHub issue #1,
// Option B). The /accept-invite frontend page lands the user, verifies
// Supabase's invite token via auth.verifyOtp(), and then calls this
// function with the chosen password.
//
// We trust the Authorization header (set by the just-established session)
// to identify the user. From there we:
//   1. Confirm the user's email exists in admin_invites with
//      accepted_at IS NULL and expires_at > now().
//   2. Set the user's password via the admin API.
//   3. Mark the invite as accepted.
//   4. Sign them out if any step fails so we don't leave a half-baked
//      authenticated session lying around.
//
// Error responses are deliberately generic for failure cases that could
// be probed by an attacker (no token / wrong email / etc.) — the page
// only needs enough info to show a sensible message.

import { createClient } from 'jsr:@supabase/supabase-js@2';

interface Body {
  password?: unknown;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json(405, { ok: false, reason: 'method-not-allowed' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Pull the JWT off the request — set by the client after verifyOtp ran.
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return json(401, { ok: false, reason: 'not-authenticated' });
  }
  const jwt = authHeader.slice('Bearer '.length);

  // A client that resolves the caller against the anon key + their JWT.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userResult, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userResult?.user) {
    return json(401, { ok: false, reason: 'not-authenticated' });
  }
  const user = userResult.user;
  const email = (user.email || '').toLowerCase();
  if (!email) {
    return json(400, { ok: false, reason: 'no-email-on-account' });
  }

  // Parse + validate the requested password.
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, reason: 'invalid-json' });
  }
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 8) {
    return json(400, { ok: false, reason: 'password-too-short' });
  }

  // Admin client — bypasses RLS so we can read/write admin_invites.
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Allow-list check. Look up the invite row by lower(email) to match
  // the index in the migration.
  const { data: invite, error: inviteErr } = await admin
    .from('admin_invites')
    .select('id, expires_at, accepted_at')
    .eq('email', email)
    .maybeSingle();

  if (inviteErr) {
    console.error('admin_invites lookup failed:', inviteErr);
    return json(500, { ok: false, reason: 'lookup-failed' });
  }
  if (!invite) {
    // Email isn't on the allow-list. Burn the session so we don't leave
    // a logged-in but unauthorized user wandering around.
    await admin.auth.admin.signOut(jwt).catch(() => { /* best-effort */ });
    return json(403, { ok: false, reason: 'not-invited' });
  }
  if (invite.accepted_at) {
    await admin.auth.admin.signOut(jwt).catch(() => { /* best-effort */ });
    return json(409, { ok: false, reason: 'already-accepted' });
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    await admin.auth.admin.signOut(jwt).catch(() => { /* best-effort */ });
    return json(410, { ok: false, reason: 'expired' });
  }

  // Set the user's password.
  const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, {
    password,
  });
  if (updateErr) {
    console.error('updateUserById failed:', updateErr);
    return json(500, { ok: false, reason: 'password-update-failed' });
  }

  // Mark the invite as accepted. If this fails the user still has their
  // password set — surface a warning but don't tear the account down.
  const { error: acceptErr } = await admin
    .from('admin_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id);
  if (acceptErr) {
    console.error('admin_invites accept failed:', acceptErr);
  }

  return json(200, { ok: true });
});
