// supabase/functions/booking-form-read/index.ts
//
// Public endpoint hit by the self-serve booking form at /f/:token to fetch the
// minimal booking context + the form type + any prior submission (so re-opening
// the link prefills). No authentication header — the URL token IS the auth.
//
// Token is matched against booking_form_tokens.token where token is not NULL
// and revoked_at is NULL. On success we bump last_used_at fire-and-forget.
//
// We use the service-role key so RLS doesn't get in the way; the endpoint
// itself is the gate, and the token validation below is what keeps it safe.
// Deliberately minimal context — guest name, house, dates only. No financials,
// no other guests, no PII beyond what's needed to confirm "this is your stay".

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function readToken(req: Request): string {
  const url = new URL(req.url);
  const qToken = url.searchParams.get('token');
  if (qToken) return qToken.trim();
  return '';
}

/** Which booking_details columns belong to each form type — so we only ever
 *  return (and later only ever write) the right slice. */
const GUEST_COLS = [
  'guest_flight_details', 'guest_check_in_time', 'guest_check_out_time',
  'guest_weekend_housekeeping', 'guest_staff_requirements',
  'guest_baby_cot', 'guest_baby_high_chair', 'guest_submitted_at',
];
const AGENT_COLS = [
  'agent_guest_name', 'agent_guests_count', 'agent_check_in', 'agent_check_out',
  'agent_house', 'agent_contact_number', 'agent_flight_details',
  'agent_check_in_time', 'agent_check_out_time', 'agent_staff_requirements',
  'agent_rates', 'agent_payment_terms', 'agent_other_requests',
  'agent_indemnity_signed', 'agent_breakages_deposit', 'agent_submitted_at',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(405, { ok: false, reason: 'method-not-allowed' });
  }

  let token = readToken(req);
  if (!token && req.method === 'POST') {
    try {
      const body = await req.json();
      if (typeof body?.token === 'string') token = body.token.trim();
    } catch { /* ignore; falls through to invalid-token */ }
  }
  if (!token || token.length < 16) {
    return json(400, { ok: false, reason: 'invalid-token' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Resolve the token → its booking + form type. Reject revoked/unknown.
  const { data: tok, error: tokErr } = await admin
    .from('booking_form_tokens')
    .select('id, booking_id, form_type, revoked_at')
    .eq('token', token)
    .maybeSingle();
  if (tokErr) {
    console.error('token lookup failed:', tokErr);
    return json(500, { ok: false, reason: 'lookup-failed' });
  }
  if (!tok || tok.revoked_at) {
    return json(404, { ok: false, reason: 'unknown-token' });
  }
  const formType = tok.form_type as 'guest' | 'agent';

  // 2. Minimal booking context (no financials / other PII).
  const { data: booking, error: bookErr } = await admin
    .from('bookings')
    .select('guest_name, check_in, check_out, guests_total, property_id')
    .eq('id', tok.booking_id)
    .maybeSingle();
  if (bookErr) {
    console.error('booking lookup failed:', bookErr);
    return json(500, { ok: false, reason: 'lookup-failed' });
  }
  if (!booking) {
    return json(404, { ok: false, reason: 'unknown-token' });
  }

  let propertyName = '';
  if (booking.property_id) {
    const { data: prop } = await admin
      .from('partner_properties')
      .select('property_name')
      .eq('id', booking.property_id)
      .maybeSingle();
    propertyName = prop?.property_name || '';
  }

  // 3. Prior submission for THIS form type only (so re-opening prefills).
  const cols = formType === 'guest' ? GUEST_COLS : AGENT_COLS;
  const { data: details } = await admin
    .from('booking_details')
    .select(cols.join(', '))
    .eq('booking_id', tok.booking_id)
    .maybeSingle();
  const submission: Record<string, unknown> = {};
  if (details) {
    for (const c of cols) submission[c] = (details as any)[c] ?? null;
  }
  const submittedAt = formType === 'guest'
    ? (details as any)?.guest_submitted_at ?? null
    : (details as any)?.agent_submitted_at ?? null;

  // 4. Fire-and-forget: bump last-used.
  admin
    .from('booking_form_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', tok.id)
    .then(({ error }) => { if (error) console.warn('last_used update failed:', error); });

  return json(200, {
    ok: true,
    formType,
    booking: {
      guestName: booking.guest_name || '',
      propertyName,
      checkIn: booking.check_in || null,
      checkOut: booking.check_out || null,
      guestsTotal: Number(booking.guests_total) || null,
    },
    submission,
    submittedAt,
  });
});
