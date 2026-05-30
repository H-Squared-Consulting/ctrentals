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
    .select('id, client_name, client_email, client_phone, agent_reference, property_id, requested_property_ids, check_in, check_out, deal_status, updated_at, created_at, guests_adults, guests_children, nationality, budget_tiers, notes')
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
  const publishedByEnquiry: Record<string, Array<any>> = {};
  if (enqIds.length > 0) {
    const { data: pubRows, error: pubErr } = await admin
      .from('proposals')
      .select('id, ref_code, enquiry_id, property_id, status, check_in, check_out, published_to_agent_at, published_to_agent_expires, pricing_proposal_id')
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

    // Pull every pricing snapshot ever attached to these proposals via
    // the proposal_id back-ref (added in
    // 20260530080000_pricing_proposals_proposal_backlink.sql). One round-
    // trip; client groups them per proposal so the agent portal can
    // render a version-toggle on the earnings card.
    const proposalIds = (pubRows || []).map((p: any) => p.id).filter(Boolean);
    const versionsByProposal: Record<string, Array<any>> = {};
    if (proposalIds.length > 0) {
      const { data: versionRows, error: versionsErr } = await admin
        .from('pricing_proposals')
        .select('id, proposal_id, created_at, client_price_excl_vat, owner_net, company_take, agents')
        .in('proposal_id', proposalIds)
        .order('created_at', { ascending: true });
      if (versionsErr) {
        console.warn('pricing_proposals version lookup failed (non-fatal):', versionsErr);
      }
      for (const v of (versionRows || []) as any[]) {
        if (!v.proposal_id) continue;
        (versionsByProposal[v.proposal_id] ||= []).push(v);
      }
    }

    /** Compute this agent's per-night commission for a single
     *  pricing snapshot. Same math as the admin's ProposalDetailModal:
     *  total agent take = guest − owner − CTR, then scale by the
     *  agent's % of total agent pct for multi-agent splits. Falls
     *  through to null when any of the inputs are missing. */
    function snapshotToVersion(snap: any, isCurrent: boolean) {
      const guestPrice = snap?.client_price_excl_vat != null
        ? (Number(snap.client_price_excl_vat) || null) : null;
      const ownerNet = snap?.owner_net != null
        ? (Number(snap.owner_net) || null) : null;
      const companyTake = snap?.company_take != null
        ? (Number(snap.company_take) || null) : null;
      let agentEarningPerNight: number | null = null;
      let agentPct: number | null = null;
      if (guestPrice != null && ownerNet != null && companyTake != null) {
        const totalAgentTake = guestPrice - ownerNet - companyTake;
        const agentsArr = Array.isArray(snap?.agents)
          ? snap.agents as Array<{ id?: string; pct?: number }>
          : [];
        const myEntry = agentsArr.find((a: any) => a?.id === agent.id);
        const totalPct = agentsArr.reduce((s: number, a: any) => s + (Number(a?.pct) || 0), 0);
        if (myEntry && totalPct > 0 && totalAgentTake > 0) {
          agentPct = Number(myEntry.pct) || 0;
          agentEarningPerNight = Math.round((agentPct / totalPct) * totalAgentTake);
        } else if (agentsArr.length === 0 && totalAgentTake > 0) {
          agentEarningPerNight = Math.round(totalAgentTake);
        }
      }
      return {
        snapshotId: snap?.id || '',
        createdAt: snap?.created_at || '',
        isCurrent,
        guestPrice,
        ownerNet,
        southernEscapesPerNight: companyTake,
        agentEarningPerNight,
        agentPct,
      };
    }

    for (const p of (pubRows || []) as any[]) {
      if (!p.enquiry_id) continue;
      const prop = p.property_id ? propertyNameById[p.property_id] : undefined;

      // Build the version chain. If the proposal has no back-linked
      // snapshots (pre-migration data, or trigger hasn't fired yet),
      // fall back to fetching the currently-linked snapshot directly
      // so the portal still shows at least the live pricing.
      let snapshots = versionsByProposal[p.id] || [];
      if (snapshots.length === 0 && p.pricing_proposal_id) {
        const { data: liveSnap } = await admin
          .from('pricing_proposals')
          .select('id, proposal_id, created_at, client_price_excl_vat, owner_net, company_take, agents')
          .eq('id', p.pricing_proposal_id)
          .maybeSingle();
        if (liveSnap) snapshots = [liveSnap];
      }

      const pricingVersions = snapshots.map(s =>
        snapshotToVersion(s, s.id === p.pricing_proposal_id),
      );
      // Current version drives the headline numbers on the row (the
      // ones surfaced before the agent expands the version toggle).
      const current = pricingVersions.find(v => v.isCurrent)
        || pricingVersions[pricingVersions.length - 1]
        || null;

      (publishedByEnquiry[p.enquiry_id] ||= []).push({
        refCode: p.ref_code || '',
        propertyName: prop?.name || '',
        publishedAt: p.published_to_agent_at || '',
        expiresOn: p.published_to_agent_expires || null,
        status: p.status || '',
        guestPrice:               current?.guestPrice ?? null,
        ownerNet:                 current?.ownerNet ?? null,
        southernEscapesPerNight:  current?.southernEscapesPerNight ?? null,
        agentEarningPerNight:     current?.agentEarningPerNight ?? null,
        agentPct:                 current?.agentPct ?? null,
        pricingVersions,
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
      guestEmail: e.client_email || '',
      guestPhone: e.client_phone || '',
      guestNationality: e.nationality || '',
      guestsAdults: Number(e.guests_adults) || 0,
      guestsChildren: Number(e.guests_children) || 0,
      budgetTiers: Array.isArray(e.budget_tiers) ? e.budget_tiers : [],
      notes: e.notes || '',
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
      submittedAt: (e.created_at || '').slice(0, 10),
      lastUpdated: (e.updated_at || '').slice(0, 10),
    };
  });

  // 4. Agent-channel tier thresholds — used by the enquiry form's
  //    price chips to render "up to R…" / "R… – R…" subtitles, same
  //    as PriceBucketFilter on the admin side. Tolerates the table
  //    not existing yet (returns null; the form just hides the
  //    subtitles). Same quintile-defaults fallback as priceTiers.ts
  //    if the row is missing.
  let priceTiers: { t1: number; t2: number; t3: number; t4: number } | null = null;
  try {
    // Without the partner_id scope, .maybeSingle() trips on multiple
    // rows (one per partner). Single-partner deployment today, but
    // belt-and-braces so this can't regress.
    const PARTNER_ID = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';
    const { data: tierRows } = await admin
      .from('price_tiers')
      .select('threshold_1, threshold_2, threshold_3, threshold_4')
      .eq('partner_id', PARTNER_ID)
      .eq('channel', 'agent')
      .maybeSingle();
    if (tierRows) {
      priceTiers = {
        t1: Number(tierRows.threshold_1),
        t2: Number(tierRows.threshold_2),
        t3: Number(tierRows.threshold_3),
        t4: Number(tierRows.threshold_4),
      };
    } else {
      // Defaults — compute quintile boundaries off this year's
      // baselines so a freshly-deployed portal still shows
      // meaningful ranges before the admin tunes them.
      const year = new Date().getFullYear();
      const { data: allBaselines } = await admin
        .from('baselines')
        .select('daily_rate')
        .eq('year', year);
      const AGENT_TOTAL_MARGIN_PCT = 30;
      const guestRates = (allBaselines || [])
        .map((b: any) => Number(b.daily_rate))
        .filter((n: number) => Number.isFinite(n) && n > 0)
        .map((n: number) => Math.round(n / (1 - AGENT_TOTAL_MARGIN_PCT / 100)))
        .sort((a: number, b: number) => a - b);
      if (guestRates.length >= 5) {
        const pick = (pct: number) => {
          const idx = Math.min(guestRates.length - 1, Math.floor((guestRates.length - 1) * pct));
          return Math.round(guestRates[idx]);
        };
        let t1 = pick(0.20), t2 = pick(0.40), t3 = pick(0.60), t4 = pick(0.80);
        if (t2 <= t1) t2 = t1 + 1;
        if (t3 <= t2) t3 = t2 + 1;
        if (t4 <= t3) t4 = t3 + 1;
        priceTiers = { t1, t2, t3, t4 };
      } else {
        priceTiers = { t1: 5_000, t2: 12_000, t3: 25_000, t4: 50_000 };
      }
    }
  } catch (err) {
    console.warn('price_tiers lookup failed (non-fatal):', err);
  }

  // 5. Fire-and-forget: bump last-used. Don't block the response on it.
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
    priceTiers,
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
