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
  const { data: enqRows, error: enqErr } = await admin
    .from('enquiries')
    .select('id, client_name, property_id, check_in, check_out, deal_status, updated_at')
    .eq('agent_id', agent.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (enqErr) {
    console.error('enquiries lookup failed:', enqErr);
    return json(500, { ok: false, reason: 'enquiries-lookup-failed' });
  }

  // Resolve property names for the enquiries we got. One round-trip,
  // not per-row.
  const enqPropertyIds = Array.from(new Set((enqRows || []).map(e => e.property_id).filter(Boolean)));
  const propertyNameById: Record<string, { name: string; slug: string }> = {};
  if (enqPropertyIds.length > 0) {
    const { data: nameRows } = await admin
      .from('partner_properties')
      .select('id, property_name, slug')
      .in('id', enqPropertyIds);
    for (const r of (nameRows || []) as any[]) {
      propertyNameById[r.id] = { name: r.property_name || '', slug: r.slug || '' };
    }
  }

  const enquiries = (enqRows || []).map((e: any) => {
    const prop = e.property_id ? propertyNameById[e.property_id] : undefined;
    return {
      id: e.id,
      guestName: e.client_name || '',
      propertyName: prop?.name || '',
      propertySlug: prop?.slug || '',
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
