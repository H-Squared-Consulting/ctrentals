// supabase/functions/agent-portal-read/index.ts
//
// Public endpoint hit by the agent portal at /q/:token to fetch the
// agent's record, their curated property list, and their submitted
// enquiries. No authentication header — the URL token *is* the auth.
//
// Token is matched against agents.url_token where url_token is not
// NULL and url_token_revoked_at is NULL. On success we also bump
// url_token_last_used_at fire-and-forget so Hayley can spot dormant
// portals from the Agents page.
//
// We use the service-role key so RLS doesn't get in the way; the
// endpoint itself is the gate, and the validation logic below is what
// keeps the data safe.

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
  // Accept token via query string (?token=) or POST body {token}.
  const url = new URL(req.url);
  const qToken = url.searchParams.get('token');
  if (qToken) return qToken.trim();
  return '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(405, { ok: false, reason: 'method-not-allowed' });
  }

  // Pull the token. Support POST body for clients that prefer it.
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

  // 1. Resolve the agent.
  const { data: agent, error: agentErr } = await admin
    .from('agents')
    .select('id, name, company, is_active, url_token_revoked_at')
    .eq('url_token', token)
    .maybeSingle();

  if (agentErr) {
    console.error('agent lookup failed:', agentErr);
    return json(500, { ok: false, reason: 'lookup-failed' });
  }
  if (!agent || agent.url_token_revoked_at || agent.is_active === false) {
    return json(404, { ok: false, reason: 'unknown-token' });
  }

  // 2. Curated property list (join via agent_properties).
  const { data: linkRows, error: linkErr } = await admin
    .from('agent_properties')
    .select('property_id')
    .eq('agent_id', agent.id);
  if (linkErr) {
    console.error('agent_properties lookup failed:', linkErr);
    return json(500, { ok: false, reason: 'properties-lookup-failed' });
  }
  const propertyIds = (linkRows || []).map(r => r.property_id);

  let properties: any[] = [];
  if (propertyIds.length > 0) {
    const { data: propRows, error: propErr } = await admin
      .from('partner_properties')
      .select('id, slug, property_name, suburb, bedrooms, sleeps, hero_image_url, price_from, is_archived, is_published')
      .in('id', propertyIds)
      .order('property_name');
    if (propErr) {
      console.error('partner_properties lookup failed:', propErr);
      return json(500, { ok: false, reason: 'properties-lookup-failed' });
    }
    // Only return active (published, non-archived) properties even if a
    // since-archived one is still in the agent's allow-list.
    properties = (propRows || [])
      .filter((p: any) => !p.is_archived && p.is_published)
      .map((p: any) => ({
        id: p.id,
        slug: p.slug || '',
        name: p.property_name || '',
        suburb: p.suburb || '',
        sleeps: p.sleeps || 0,
        bedrooms: p.bedrooms || 0,
        baselineRate: Number(p.price_from) || 0,
        photoUrl: p.hero_image_url || '',
      }));
  }

  // 3. Enquiries this agent has submitted. Recent first, capped at 100.
  //    Also pull agent_reference (the agent's own label for the
  //    enquiry — what they fill in on the form, distinct from the
  //    AHH/N `subject` the team uses) and requested_property_ids
  //    (multi-property pick) so we can render rich row details.
  const { data: enqRows, error: enqErr } = await admin
    .from('enquiries')
    .select('id, client_name, agent_reference, property_id, requested_property_ids, check_in, check_out, deal_status, updated_at')
    .eq('agent_id', agent.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (enqErr) {
    console.error('enquiries lookup failed:', enqErr);
    return json(500, { ok: false, reason: 'enquiries-lookup-failed' });
  }

  // Resolve property names for the enquiries we got. One round-trip
  // covering BOTH the single-property column (legacy) and every
  // entry in requested_property_ids (multi-property pick) so the
  // portal can render "104 Zwaanswyk, 12 Bordeaux" inline on each
  // row without a fan-out lookup.
  const enqPropertyIds = new Set<string>();
  for (const e of (enqRows || []) as any[]) {
    if (e.property_id) enqPropertyIds.add(e.property_id);
    for (const id of (e.requested_property_ids || []) as string[]) {
      if (id) enqPropertyIds.add(id);
    }
  }
  const propertyNameById: Record<string, { name: string; slug: string }> = {};
  if (enqPropertyIds.size > 0) {
    const { data: nameRows } = await admin
      .from('partner_properties')
      .select('id, property_name, slug')
      .in('id', [...enqPropertyIds]);
    for (const r of (nameRows || []) as any[]) {
      propertyNameById[r.id] = { name: r.property_name || '', slug: r.slug || '' };
    }
  }

  // Published proposals for these enquiries — agent-visible only
  // while the publish hasn't expired (expiry = enquiry's check-in,
  // set by the team at publish time). One round-trip across every
  // enquiry; the array is empty for legacy / unpublished cases.
  const enqIds = (enqRows || []).map((e: any) => e.id).filter(Boolean);
  const todayIso = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const publishedByEnquiry: Record<string, Array<{
    refCode: string;
    propertyName: string;
    publishedAt: string;
    expiresOn: string | null;
    /** Lifecycle status — drives whether the portal renders an
     *  active "View proposal →" link (drafting/sent/viewed/etc.)
     *  or a read-only "View summary" modal (accepted/booked/
     *  declined/cancelled). Once accepted/booked we lock the
     *  proposal page so the agent can't keep sharing the live
     *  link after the booking's been confirmed. */
    status: string;
    /** Snapshot fields for the summary modal — guest_price (per
     *  night) + check-in/out so the portal can render an overview
     *  without needing to hit the public proposal page. */
    guestPrice: number | null;
    checkIn: string | null;
    checkOut: string | null;
  }>> = {};
  if (enqIds.length > 0) {
    const { data: pubRows, error: pubErr } = await admin
      .from('proposals')
      .select('id, ref_code, enquiry_id, property_id, status, check_in, check_out, published_to_agent_at, published_to_agent_expires, pricing_proposals(client_price_excl_vat)')
      .in('enquiry_id', enqIds)
      .not('published_to_agent_at', 'is', null)
      .gte('published_to_agent_expires', todayIso)
      .order('published_to_agent_at', { ascending: false });
    if (pubErr) {
      console.warn('published proposals lookup failed (non-fatal):', pubErr);
    }
    // Also resolve any property names we don't already have cached.
    const extraPropertyIds = (pubRows || [])
      .map((p: any) => p.property_id)
      .filter((id: string) => id && !propertyNameById[id]);
    if (extraPropertyIds.length > 0) {
      const { data: extraNames } = await admin
        .from('partner_properties')
        .select('id, property_name, slug')
        .in('id', extraPropertyIds);
      for (const r of (extraNames || []) as any[]) {
        propertyNameById[r.id] = { name: r.property_name || '', slug: r.slug || '' };
      }
    }
    for (const p of (pubRows || []) as any[]) {
      if (!p.enquiry_id) continue;
      const prop = p.property_id ? propertyNameById[p.property_id] : undefined;
      // pricing_proposals join returns either an object (single
      // FK) or null. Pull client_price_excl_vat for the per-night
      // figure surfaced on the summary modal.
      const pricingJoin = p.pricing_proposals;
      const guestPrice = pricingJoin && typeof pricingJoin === 'object'
        ? (Number(pricingJoin.client_price_excl_vat) || null)
        : null;
      (publishedByEnquiry[p.enquiry_id] ||= []).push({
        refCode: p.ref_code || '',
        propertyName: prop?.name || '',
        publishedAt: p.published_to_agent_at || '',
        expiresOn: p.published_to_agent_expires || null,
        status: p.status || '',
        guestPrice,
        checkIn: p.check_in || null,
        checkOut: p.check_out || null,
      });
    }
  }

  const enquiries = (enqRows || []).map((e: any) => {
    const legacyProp = e.property_id ? propertyNameById[e.property_id] : undefined;
    // Resolve the multi-property list to display names; fall back
    // to the legacy single-property when the multi column is empty.
    const requestedIds: string[] = Array.isArray(e.requested_property_ids) && e.requested_property_ids.length > 0
      ? e.requested_property_ids
      : (e.property_id ? [e.property_id] : []);
    const requestedProperties = requestedIds
      .map(id => propertyNameById[id])
      .filter(Boolean)
      .map(p => ({ name: p!.name, slug: p!.slug }));
    return {
      id: e.id,
      guestName: e.client_name || '',
      agentReference: e.agent_reference || '',
      propertyName: legacyProp?.name || '',
      propertySlug: legacyProp?.slug || '',
      requestedProperties,
      // Proposals the team has explicitly published to this agent
      // (status flipped to Sent + published_to_agent_* set). Empty
      // array when no published-and-unexpired proposals exist; the
      // portal renders an "awaiting response" placeholder in that
      // case.
      publishedProposals: publishedByEnquiry[e.id] || [],
      checkIn: e.check_in,
      checkOut: e.check_out,
      status: mapDealStatus(e.deal_status),
      lastUpdated: (e.updated_at || '').slice(0, 10),
    };
  });

  // 4. Fire-and-forget: bump last-used. Don't block the response on it.
  admin
    .from('agents')
    .update({ url_token_last_used_at: new Date().toISOString() })
    .eq('id', agent.id)
    .then(({ error }) => { if (error) console.warn('last_used update failed:', error); });

  return json(200, {
    ok: true,
    agent: {
      id: agent.id,
      name: agent.name || '',
      agencyName: agent.company || '',
    },
    properties,
    enquiries,
  });
});

/** Map the enquiries.deal_status enum onto the portal's AgentEnquiryStatus. */
function mapDealStatus(s: string | null | undefined): string {
  switch (s) {
    case 'new':         return 'new';
    case 'drafting':
    case 'ready':       return 'new';      // still pre-send from the agent's POV
    case 'sent':        return 'proposal_sent';
    case 'interested':  return 'proposal_sent';
    case 'won':         return 'booked';
    case 'lost':        return 'declined';
    case 'stalled':     return 'new';
    default:            return 'new';
  }
}
