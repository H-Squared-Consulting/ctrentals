// supabase/functions/booking-form-submit/index.ts
//
// Public endpoint hit by the self-serve booking form at /f/:token to write the
// recipient's answers back into booking_details. The URL token IS the auth; we
// re-validate it here because each function must stand on its own.
//
// CRITICAL: this NEVER touches the bookings core columns (check_in/out,
// property_id, guest_name, guests_total). The agent's declared dates/house/
// guests land as agent_* values in booking_details for staff to reconcile —
// they never silently move a booking on the calendar.
//
// Idempotent: ON CONFLICT (booking_id) DO UPDATE writes only the active
// form_type's columns, so the two forms can't clobber each other and a
// resubmission overwrites + re-stamps submitted_at.

import { createClient } from 'jsr:@supabase/supabase-js@2';

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

function asString(v: unknown, max = 2000): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}
function asBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}
function asInt(v: unknown, min: number, max: number): number | null {
  let n: number | null = null;
  if (typeof v === 'number' && Number.isFinite(v)) n = Math.floor(v);
  else if (typeof v === 'string' && v.trim()) { const p = parseInt(v, 10); if (Number.isFinite(p)) n = p; }
  if (n === null) return null;
  return Math.min(max, Math.max(min, n));
}
function asNumber(v: unknown): number | null {
  let n: number | null = null;
  if (typeof v === 'number' && Number.isFinite(v)) n = v;
  else if (typeof v === 'string' && v.trim()) { const p = parseFloat(v); if (Number.isFinite(p)) n = p; }
  if (n === null || n < 0) return null;
  return n;
}
/** 'HH:MM' lenient, blank allowed (null). Anything else → null. */
function asTime(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return /^\d{2}:\d{2}$/.test(t) ? t : null;
}
function asIsoDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

interface SubmitBody {
  token?: unknown;
  formType?: unknown;
  fields?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json(405, { ok: false, reason: 'method-not-allowed' });
  }

  let body: SubmitBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, reason: 'invalid-json' });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const formType = body.formType === 'guest' || body.formType === 'agent' ? body.formType : null;
  const f = (body.fields && typeof body.fields === 'object') ? body.fields : {};
  if (!token || token.length < 16) return json(400, { ok: false, reason: 'invalid-token' });
  if (!formType) return json(400, { ok: false, reason: 'invalid-form-type' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Validate token → resolve booking + assert form_type matches.
  const { data: tok, error: tokErr } = await admin
    .from('booking_form_tokens')
    .select('id, booking_id, form_type, revoked_at')
    .eq('token', token)
    .maybeSingle();
  if (tokErr) {
    console.error('token lookup failed:', tokErr);
    return json(500, { ok: false, reason: 'lookup-failed' });
  }
  if (!tok || tok.revoked_at) return json(404, { ok: false, reason: 'unknown-token' });
  if (tok.form_type !== formType) return json(409, { ok: false, reason: 'form-type-mismatch' });

  const now = new Date().toISOString();

  // 2. Build the write — ONLY this form type's columns. Never bookings core.
  const row: Record<string, unknown> = { booking_id: tok.booking_id, updated_at: now };
  if (formType === 'guest') {
    row.guest_flight_details       = asString(f.guest_flight_details);
    row.guest_check_in_time        = asTime(f.guest_check_in_time);
    row.guest_check_out_time       = asTime(f.guest_check_out_time);
    row.guest_weekend_housekeeping = asBool(f.guest_weekend_housekeeping);
    row.guest_staff_requirements   = asString(f.guest_staff_requirements);
    row.guest_baby_cot             = asBool(f.guest_baby_cot);
    row.guest_baby_high_chair      = asBool(f.guest_baby_high_chair);
    row.guest_submitted_at         = now;
  } else {
    row.agent_guest_name         = asString(f.agent_guest_name, 200);
    row.agent_guests_count       = asInt(f.agent_guests_count, 0, 100);
    row.agent_check_in           = asIsoDate(f.agent_check_in);
    row.agent_check_out          = asIsoDate(f.agent_check_out);
    row.agent_house              = asString(f.agent_house, 200);
    row.agent_contact_number     = asString(f.agent_contact_number, 60);
    row.agent_flight_details     = asString(f.agent_flight_details);
    row.agent_check_in_time      = asTime(f.agent_check_in_time);
    row.agent_check_out_time     = asTime(f.agent_check_out_time);
    row.agent_staff_requirements = asString(f.agent_staff_requirements);
    row.agent_rates              = asString(f.agent_rates);
    row.agent_payment_terms      = asString(f.agent_payment_terms);
    row.agent_other_requests     = asString(f.agent_other_requests);
    row.agent_indemnity_signed   = asBool(f.agent_indemnity_signed);
    row.agent_breakages_deposit  = asNumber(f.agent_breakages_deposit);
    row.agent_submitted_at       = now;
  }

  // 3. Upsert. onConflict booking_id → only this form type's columns get
  //    overwritten (the other form's columns aren't in `row`, so they survive).
  const { error: upErr } = await admin
    .from('booking_details')
    .upsert(row, { onConflict: 'booking_id' });
  if (upErr) {
    console.error('booking_details upsert failed:', upErr);
    return json(500, { ok: false, reason: 'insert-failed' });
  }

  // 4. Stamp the token submitted_at + last_used_at.
  await admin
    .from('booking_form_tokens')
    .update({ submitted_at: now, last_used_at: now })
    .eq('id', tok.id);

  return json(200, { ok: true });
});
