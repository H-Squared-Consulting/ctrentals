// supabase/functions/agent-portal-enquire/index.ts
//
// Public endpoint hit by the agent portal's Enquire flow. The agent
// has already been resolved by agent-portal-read (which validated
// their token); we validate the token here too because each function
// must stand on its own — anyone could call this URL directly.
//
// Accepts 1..N property IDs in a single submission. We persist ONE
// enquiry row tagged with agent_id, source='agent_portal', and the
// picked property IDs as requested_property_ids (uuid[]). No
// proposals are auto-created — the team consciously triages every
// agent enquiry in Arrived before generating proposals via the deal
// modal's "Generate proposals for these N →" CTA (which opens the
// match modal pre-checked with these IDs).
//
// Ref code follows the AHH/N scheme (agent's two-letter code + a
// per-agent suffix counter), matching the manual /enquiry/new flow
// so the kanban + ref codes stay consistent across entry points.

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
  /** Preferred: array of property ids the agent ticked. */
  propertyIds?: unknown;
  /** Legacy single-property field — still accepted so old clients
   *  that haven't updated yet don't break. Normalised to a 1-element
   *  propertyIds below. */
  propertyId?: unknown;
  /** Agent's own short label for this enquiry. Required at the form
   *  level so the agent can recognise their submissions on the My
   *  Enquiries tab (e.g. "Sarah & Mark, Easter"). Stored on
   *  enquiries.agent_reference; separate from the AHH/N `subject`
   *  the team uses. */
  agentReference?: unknown;
  subject?: unknown;
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

/** Normalise the body's property fields into a deduped, validated
 *  array of UUID-shaped strings. Caps at 50 to stop a malformed
 *  client from posting 10k ids. */
function normalisePropertyIds(body: EnquireBody): string[] {
  const out = new Set<string>();
  const push = (raw: unknown) => {
    const s = asString(raw, 64);
    if (!s) return;
    // Cheap UUID shape check — server's INSERT will catch malformed
    // values anyway, but rejecting obviously bogus input early gives
    // a cleaner 400 response.
    if (/^[0-9a-f-]{32,40}$/i.test(s)) out.add(s);
  };
  if (Array.isArray(body.propertyIds)) {
    for (const id of body.propertyIds) push(id);
  }
  if (body.propertyId) push(body.propertyId);
  return [...out].slice(0, 50);
}

/** Compute the next agent-enquiry ref code in the AHH/N scheme.
 *  Mirrors src/lib/refCodes.ts → nextAgentEnquiryRefCode (we
 *  can't import that helper from a Deno edge function so the
 *  logic is duplicated here — same max-suffix lookup against
 *  enquiries.subject scoped by agent_id). */
async function nextAgentEnquiryRefCode(
  admin: any,
  agentId: string,
  agentRefCode: string,
): Promise<string> {
  const { data, error } = await admin
    .from('enquiries')
    .select('subject')
    .eq('agent_id', agentId)
    .like('subject', `${agentRefCode}/%`);
  if (error) {
    console.error('nextAgentEnquiryRefCode lookup failed:', error);
    return `${agentRefCode}/1`;
  }
  const escaped = agentRefCode.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  const re = new RegExp(`^${escaped}\\/(\\d+)$`);
  let maxN = 0;
  for (const row of (data || []) as Array<{ subject: string | null }>) {
    const m = re.exec(row.subject || '');
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  return `${agentRefCode}/${maxN + 1}`;
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

  const token          = asString(body.token, 128);
  const propertyIds    = normalisePropertyIds(body);
  const subject        = asString(body.subject, 120);
  const agentReference = asString(body.agentReference, 120);
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
  // propertyIds.length === 0 is allowed — that's a "general
  // enquiry" (dates only, no specific houses). agent_reference is
  // still required so the agent's My Enquiries tab has a label.
  if (!agentReference)           return json(400, { ok: false, reason: 'missing-agent-reference' });
  if (!isIsoDate(checkIn))       return json(400, { ok: false, reason: 'invalid-check-in' });
  if (!isIsoDate(checkOut))      return json(400, { ok: false, reason: 'invalid-check-out' });
  if (checkOut <= checkIn)       return json(400, { ok: false, reason: 'check-out-before-check-in' });
  if (adults !== null && (adults < 0 || adults > 50))     return json(400, { ok: false, reason: 'invalid-adults' });
  if (children !== null && (children < 0 || children > 50)) return json(400, { ok: false, reason: 'invalid-children' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Validate the token + resolve the agent (must be active, not revoked).
  //    Also pull ref_code for the AHH/N enquiry code, and name/email/phone
  //    which become the enquiry's client_* recipient fields (for agent
  //    enquiries the agent IS the recipient, not the guest).
  //    The agents table is single-tenant (no partner_id column) — we
  //    hard-code the CT Rentals partner ID below for the enquiry insert.
  const PARTNER_ID = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
  const { data: agent, error: agentErr } = await admin
    .from('agents')
    .select('id, name, email, phone, ref_code, is_active, url_token_revoked_at')
    .eq('url_token', token)
    .maybeSingle();
  if (agentErr) {
    console.error('agent lookup failed:', agentErr);
    return json(500, { ok: false, reason: 'lookup-failed' });
  }
  if (!agent || agent.url_token_revoked_at || agent.is_active === false) {
    return json(404, { ok: false, reason: 'unknown-token' });
  }
  if (!agent.ref_code) {
    // Backfill migration ran on 25 May 2026 — any agent missing a
    // ref_code at this point is brand-new and hasn't been picked up
    // yet. Fail loud rather than silently inventing a code that
    // collides with the next backfill / manual save.
    console.error('agent has no ref_code:', agent.id);
    return json(500, { ok: false, reason: 'agent-not-coded' });
  }

  // 2. Confirm every picked property is one this agent is actually
  //    allowed to sell. Belt-and-braces against someone forging
  //    propertyIds on a real token. Single round-trip with .in() so
  //    we don't fan out per-property. Skipped entirely for general
  //    enquiries (zero properties) — nothing to validate.
  if (propertyIds.length > 0) {
    const { data: links, error: linkErr } = await admin
      .from('agent_properties')
      .select('property_id')
      .eq('agent_id', agent.id)
      .in('property_id', propertyIds);
    if (linkErr) {
      console.error('agent_properties lookup failed:', linkErr);
      return json(500, { ok: false, reason: 'lookup-failed' });
    }
    const allowedSet = new Set((links || []).map((l: any) => l.property_id));
    const disallowed = propertyIds.filter(id => !allowedSet.has(id));
    if (disallowed.length > 0) {
      console.warn('agent', agent.id, 'tried to enquire on disallowed ids:', disallowed);
      return json(403, { ok: false, reason: 'property-not-allowed' });
    }
  }

  // 3. Compute total guests if both adults+children given.
  const guestsTotal = (adults || 0) + (children || 0) || null;

  // 4. Mint a ref_code in the AHH/N scheme. For agent enquiries the
  //    subject doubles as the ref_code (matches how the manual
  //    /enquiry/new flow handles it). If the caller supplied a
  //    subject we ignore it — the AHH/N code is what the kanban
  //    card shows by design.
  const refCode = await nextAgentEnquiryRefCode(admin, agent.id, agent.ref_code);

  // 5. Insert the enquiry. Mirrors the manual agent-enquiry insert in
  //    src/pages/EnquiryForm.tsx (Save / close path): client_* is the
  //    agent (the recipient Hayley actually communicates with), guest_*
  //    is the optionally disclosed guest, and requested_property_ids
  //    carries the agent's pick into the deal modal as context for the
  //    "Generate proposals" CTA.
  const payload = {
    partner_id: PARTNER_ID,
    ref_code: refCode,
    subject: refCode,
    agent_reference: agentReference,
    is_agent: true,
    agent_id: agent.id,
    // Legacy single-property column — keep set to the FIRST id when
    // there's exactly one, otherwise leave null so the array column
    // is the only source of truth for multi-property enquiries.
    property_id: propertyIds.length === 1 ? propertyIds[0] : null,
    requested_property_ids: propertyIds,
    client_name: agent.name || '',
    client_email: agent.email || null,
    client_phone: agent.phone || null,
    guest_name: guestName || null,
    guest_email: guestEmail || null,
    guest_phone: guestPhone || null,
    check_in: checkIn,
    check_out: checkOut,
    bedrooms_needed: null,
    guests_total: guestsTotal,
    guests_adults: adults,
    guests_children: children,
    notes: notes || (subject ? `Agent note: ${subject}` : null),
    // Every agent-portal enquiry is auto-assigned to BOTH team
    // members so either can pick it up. Stored as a comma-separated
    // list — the kanban pill + the "users" filter on the team side
    // both split on commas, so a card stamped "NT,HH" surfaces
    // under either lens. Distinct from the internal /enquiry/new
    // path which stamps a single creator's initials.
    created_by_initials: 'NT,HH',
    source: 'agent_portal',
    deal_status: 'new',
  };

  const { data: inserted, error: insertErr } = await admin
    .from('enquiries')
    .insert(payload)
    .select('id, ref_code')
    .single();
  if (insertErr) {
    console.error('enquiry insert failed:', insertErr);
    return json(500, { ok: false, reason: 'insert-failed' });
  }

  return json(200, { ok: true, enquiryId: inserted.id, refCode: inserted.ref_code });
});
