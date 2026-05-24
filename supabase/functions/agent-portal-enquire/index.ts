// supabase/functions/agent-portal-enquire/index.ts
//
// Public endpoint hit by the agent portal's Enquire modal. The agent
// has already been resolved by agent-portal-read (which validated
// their token); we validate the token here too because each function
// must stand on its own — anyone could call this URL directly.
//
// Creates an enquiry row tagged with agent_id, property_id and
// source='agent_portal' so Hayley can see in the Pipeline where the
// lead came from.

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

interface EnquireBody {
  token?: unknown;
  propertyId?: unknown;
  guestName?: unknown;
  guestEmail?: unknown;
  guestPhone?: unknown;
  checkIn?: unknown;
  checkOut?: unknown;
  guestsAdults?: unknown;
  guestsChildren?: unknown;
  notes?: unknown;
}

function asString(v: unknown, max = 500): string {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return t.length > max ? t.slice(0, max) : t;
}

function asInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === 'string' && v.trim()) {
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json(405, { ok: false, reason: 'method-not-allowed' });
  }

  let body: EnquireBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, reason: 'invalid-json' });
  }

  const token       = asString(body.token, 128);
  const propertyId  = asString(body.propertyId, 64);
  const guestName   = asString(body.guestName, 200);
  const guestEmail  = asString(body.guestEmail, 200).toLowerCase();
  const guestPhone  = asString(body.guestPhone, 60);
  const checkIn     = asString(body.checkIn, 20);
  const checkOut    = asString(body.checkOut, 20);
  const adults      = asInt(body.guestsAdults);
  const children    = asInt(body.guestsChildren);
  const notes       = asString(body.notes, 2000);

  if (!token || token.length < 16) {
    return json(400, { ok: false, reason: 'invalid-token' });
  }
  if (!propertyId)             return json(400, { ok: false, reason: 'missing-property' });
  if (!isIsoDate(checkIn))     return json(400, { ok: false, reason: 'invalid-check-in' });
  if (!isIsoDate(checkOut))    return json(400, { ok: false, reason: 'invalid-check-out' });
  if (checkOut <= checkIn)     return json(400, { ok: false, reason: 'check-out-before-check-in' });
  if (adults !== null && (adults < 0 || adults > 50))     return json(400, { ok: false, reason: 'invalid-adults' });
  if (children !== null && (children < 0 || children > 50)) return json(400, { ok: false, reason: 'invalid-children' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Validate the token + resolve the agent (must be active, not revoked).
  //    We pull name/email/phone too because they become the enquiry's
  //    client_* recipient fields (matches the manual /enquiry/new flow:
  //    for agent enquiries the agent IS the recipient, not the guest).
  //    The agents table is single-tenant (no partner_id column) — we
  //    hard-code the CT Rentals partner ID below for the enquiry insert.
  const PARTNER_ID = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
  const { data: agent, error: agentErr } = await admin
    .from('agents')
    .select('id, name, email, phone, is_active, url_token_revoked_at')
    .eq('url_token', token)
    .maybeSingle();
  if (agentErr) {
    console.error('agent lookup failed:', agentErr);
    return json(500, { ok: false, reason: 'lookup-failed' });
  }
  if (!agent || agent.url_token_revoked_at || agent.is_active === false) {
    return json(404, { ok: false, reason: 'unknown-token' });
  }

  // 2. Confirm the property is one this agent is actually allowed to sell.
  //    Belt-and-braces against someone forging a propertyId on a real token.
  const { data: link, error: linkErr } = await admin
    .from('agent_properties')
    .select('agent_id')
    .eq('agent_id', agent.id)
    .eq('property_id', propertyId)
    .maybeSingle();
  if (linkErr) {
    console.error('agent_properties lookup failed:', linkErr);
    return json(500, { ok: false, reason: 'lookup-failed' });
  }
  if (!link) {
    return json(403, { ok: false, reason: 'property-not-allowed' });
  }

  // 3. Compute total guests if both adults+children given.
  const guestsTotal = (adults || 0) + (children || 0) || null;

  // 4. Mint a ref_code in the same ENQ-YYYYMMDD-NAM-XX format the
  //    /enquiry/new UI uses, so manual + portal enquiries look alike
  //    in the Pipeline. NAM is built from the agent's name (or 'AGT'
  //    fallback) since they're the recipient on the record.
  const refCode = (() => {
    const d = new Date();
    const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const clean = (agent.name || 'AGT').replace(/[^A-Za-z]/g, '').toUpperCase();
    const namePart = (clean.slice(0, 3) || 'AGT').padEnd(3, 'X');
    const tail = Math.floor(Math.random() * 0xff).toString(16).toUpperCase().padStart(2, '0');
    return `ENQ-${day}-${namePart}-${tail}`;
  })();

  // 5. Insert the enquiry. Mirrors the manual agent-enquiry insert in
  //    src/pages/EnquiryForm.tsx: client_* = the agent (the recipient
  //    Hayley actually communicates with), guest_* = optional disclosure.
  const payload = {
    partner_id: PARTNER_ID,
    ref_code: refCode,
    is_agent: true,
    agent_id: agent.id,
    property_id: propertyId,
    client_name: agent.name || '',
    client_email: agent.email || null,
    client_phone: agent.phone || null,
    guest_name: guestName || null,
    guest_email: guestEmail || null,
    guest_phone: guestPhone || null,
    check_in: checkIn,
    check_out: checkOut,
    bedrooms_needed: 1,
    guests_total: guestsTotal || 1,
    guests_adults: adults,
    guests_children: children,
    notes: notes || null,
    source: 'agent_portal',
    deal_status: 'new',
  };

  const { data: inserted, error: insertErr } = await admin
    .from('enquiries')
    .insert(payload)
    .select('id')
    .single();
  if (insertErr) {
    console.error('enquiry insert failed:', insertErr);
    return json(500, { ok: false, reason: 'insert-failed' });
  }

  return json(200, { ok: true, enquiryId: inserted.id });
});
