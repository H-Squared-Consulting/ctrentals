// supabase/functions/agent-portal-search/index.ts
//
// Public endpoint that powers the agent portal's enquiry-form match
// modal: the agent fills in dates / beds / guests / price-tier, and
// we return the anonymised set of properties from their allow-list
// that match.
//
// Scope = the curated agent_properties join + active stock only.
// Output is intentionally stripped of every identifying field
// (property name, tagline, owner description, baseline rate); the
// agent sees the CTR code (slug), beds/baths/sleeps, suburb, hero
// image, and amenity tags. Pricing reveal happens later, when the
// team publishes a proposal back through agent-portal-read.
//
// Token validation mirrors agent-portal-read so every endpoint stands
// on its own and we don't rely on the upstream call having gated the
// session.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Same hard-coded partner the other agent-portal-* functions use.
// Scoped to a single-partner deployment; revisit when multi-tenancy lands.
const PARTNER_ID = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// ── Pricing helpers (kept inline so the function has no src/ deps).
// Mirrors src/lib/pricingEngine.ts agentGuestRate(): the same
// 30%-total-margin model the global search modal uses to classify
// properties against the 'agent' tier band. Result is whole rands,
// matching what the admin sees so the agent's filter and the team's
// filter agree on which house lands in which band.
const AGENT_TOTAL_MARGIN_PCT = 30;
function agentGuestPaysPeak(baseline: number): number | null {
  if (!Number.isFinite(baseline) || baseline <= 0) return null;
  return Math.round(baseline / (1 - AGENT_TOTAL_MARGIN_PCT / 100));
}

// ── Tier classification — clone of src/lib/priceTiers.ts. Keeps the
// boundary semantics (≤ threshold) identical so a property the admin
// sees in 'Medium' lands in the agent's 'Medium' too.
type TierKey = 'very_low' | 'low' | 'medium' | 'high' | 'very_high';
const TIER_ORDER: TierKey[] = ['very_low', 'low', 'medium', 'high', 'very_high'];
interface TierThresholds { t1: number; t2: number; t3: number; t4: number }

function tierFloor(tier: TierKey, t: TierThresholds): number | null {
  switch (tier) {
    case 'very_low':  return null;
    case 'low':       return t.t1;
    case 'medium':    return t.t2;
    case 'high':      return t.t3;
    case 'very_high': return t.t4;
  }
}
function tierCeiling(tier: TierKey, t: TierThresholds): number | null {
  switch (tier) {
    case 'very_low':  return t.t1;
    case 'low':       return t.t2;
    case 'medium':    return t.t3;
    case 'high':      return t.t4;
    case 'very_high': return null;
  }
}
function selectedTierRange(selected: TierKey[], t: TierThresholds): { floor: number | null; ceiling: number | null } | null {
  if (!selected || selected.length === 0) return null;
  let lo = TIER_ORDER.length;
  let hi = -1;
  for (const tier of selected) {
    const idx = TIER_ORDER.indexOf(tier);
    if (idx < 0) continue;
    if (idx < lo) lo = idx;
    if (idx > hi) hi = idx;
  }
  if (hi < 0) return null;
  return {
    floor:   tierFloor(TIER_ORDER[lo],   t),
    ceiling: tierCeiling(TIER_ORDER[hi], t),
  };
}

// ── Quintile fallback — identical to priceTiers.computeDefaultTiers,
// only used when the partner has no saved tiers row for the agent
// channel (fresh checkout / migration not yet applied).
function quintileDefaults(rates: number[]): TierThresholds {
  const sorted = rates.slice().sort((a, b) => a - b);
  if (sorted.length < 5) {
    return { t1: 5_000, t2: 12_000, t3: 25_000, t4: 50_000 };
  }
  const pick = (pct: number) => {
    const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * pct));
    return Math.round(sorted[idx]);
  };
  let t1 = pick(0.20);
  let t2 = pick(0.40);
  let t3 = pick(0.60);
  let t4 = pick(0.80);
  if (t2 <= t1) t2 = t1 + 1;
  if (t3 <= t2) t3 = t2 + 1;
  if (t4 <= t3) t4 = t3 + 1;
  return { t1, t2, t3, t4 };
}

interface SearchBody {
  token?: unknown;
  /** Inclusive check-in, YYYY-MM-DD. Optional. */
  checkIn?: unknown;
  /** Exclusive check-out, YYYY-MM-DD. Optional. */
  checkOut?: unknown;
  /** Exact-match bedroom counts. Empty / missing = no filter. */
  bedrooms?: unknown;
  /** Minimum sleeps the property must accommodate. */
  minSleeps?: unknown;
  /** Selected price tiers — empty / missing = no filter. */
  priceTiers?: unknown;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function asNumberArray(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0);
}

function asTierKeyArray(v: unknown): TierKey[] {
  if (!Array.isArray(v)) return [];
  const valid = new Set<string>(TIER_ORDER);
  return v.filter((x): x is TierKey => typeof x === 'string' && valid.has(x));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json(405, { ok: false, reason: 'method-not-allowed' });
  }

  let body: SearchBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, reason: 'invalid-body' });
  }

  const token = asString(body.token);
  if (!token || token.length < 16) {
    return json(400, { ok: false, reason: 'invalid-token' });
  }

  const checkIn = asString(body.checkIn);
  const checkOut = asString(body.checkOut);
  const datesValid = !!(checkIn && checkOut && checkIn < checkOut);

  const bedrooms = asNumberArray(body.bedrooms);
  const minSleeps = Number.isFinite(Number(body.minSleeps)) ? Math.max(0, Number(body.minSleeps)) : 0;
  const priceTiers = asTierKeyArray(body.priceTiers);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Resolve + validate the agent.
  const { data: agent, error: agentErr } = await admin
    .from('agents')
    .select('id, is_active, url_token_revoked_at')
    .eq('url_token', token)
    .maybeSingle();
  if (agentErr) {
    console.error('agent lookup failed:', agentErr);
    return json(500, { ok: false, reason: 'lookup-failed' });
  }
  if (!agent || agent.url_token_revoked_at || agent.is_active === false) {
    return json(404, { ok: false, reason: 'unknown-token' });
  }

  // 2. Agent's allow-list. Empty list = nothing to search.
  const { data: linkRows, error: linkErr } = await admin
    .from('agent_properties')
    .select('property_id')
    .eq('agent_id', agent.id);
  if (linkErr) {
    console.error('agent_properties lookup failed:', linkErr);
    return json(500, { ok: false, reason: 'properties-lookup-failed' });
  }
  const allowedIds = (linkRows || []).map(r => r.property_id);
  if (allowedIds.length === 0) {
    return json(200, { ok: true, matches: [] });
  }

  // 3. Property attributes — start from the allow-list, filter to
  // active (published + non-archived), apply attribute filters.
  let propsQuery = admin
    .from('partner_properties')
    .select('id, slug, bedrooms, bathrooms, sleeps, suburb, city, hero_image_url, amenity_tags, pricing_mode, is_published, is_archived')
    .in('id', allowedIds)
    .eq('is_published', true);
  if (bedrooms.length > 0) {
    propsQuery = propsQuery.in('bedrooms', bedrooms);
  }
  if (minSleeps > 0) {
    propsQuery = propsQuery.gte('sleeps', minSleeps);
  }
  const { data: propRows, error: propErr } = await propsQuery;
  if (propErr) {
    console.error('partner_properties lookup failed:', propErr);
    return json(500, { ok: false, reason: 'properties-lookup-failed' });
  }
  let candidates = (propRows || []).filter((p: any) => !p.is_archived);

  // 4. Availability filter. Drop any property with a non-cancelled
  // booking overlapping the window. Single round-trip across every
  // candidate; cheaper than per-property.
  if (datesValid && candidates.length > 0) {
    const ids = candidates.map((p: any) => p.id);
    const { data: bookings, error: bookErr } = await admin
      .from('bookings')
      .select('property_id, status')
      .in('property_id', ids)
      .lt('check_in', checkOut)
      .gt('check_out', checkIn);
    if (bookErr) {
      console.error('bookings overlap lookup failed:', bookErr);
      return json(500, { ok: false, reason: 'availability-lookup-failed' });
    }
    const busy = new Set(
      (bookings || [])
        .filter((b: any) => b.status !== 'cancelled')
        .map((b: any) => b.property_id),
    );
    candidates = candidates.filter((p: any) => !busy.has(p.id));
  }

  // 5. Price-tier filter. Same math the global search uses:
  //    - load saved 'agent' thresholds (fall back to quintile
  //      defaults over the current portfolio's baselines);
  //    - compute each property's guest-pays-peak rate via the
  //      agent rate formula;
  //    - drop properties outside (floor, ceiling].
  // Properties without a baseline are excluded — we can't classify
  // them, and silently leaking unpriced stock through a band filter
  // would confuse the agent.
  if (priceTiers.length > 0 && candidates.length > 0) {
    const year = new Date().getFullYear();

    // Saved tiers first; fall back to computed defaults only if
    // the row is missing.
    const { data: tierRows, error: tierErr } = await admin
      .from('price_tiers')
      .select('threshold_1, threshold_2, threshold_3, threshold_4')
      .eq('partner_id', PARTNER_ID)
      .eq('channel', 'agent')
      .maybeSingle();
    if (tierErr) {
      // Belt-and-braces fallback. Whatever Postgres / PostgREST is
      // unhappy about (multi-row .maybeSingle(), missing column,
      // transient), we'd rather degrade to quintile defaults than
      // 500 the whole search.
      console.error('price_tiers lookup failed (falling through to defaults):', tierErr);
    }

    let thresholds: TierThresholds | null = tierRows
      ? {
          t1: Number(tierRows.threshold_1),
          t2: Number(tierRows.threshold_2),
          t3: Number(tierRows.threshold_3),
          t4: Number(tierRows.threshold_4),
        }
      : null;

    // Compute defaults from inventory if we didn't get a saved row.
    if (!thresholds) {
      const { data: allBaselines } = await admin
        .from('baselines')
        .select('daily_rate')
        .eq('year', year);
      const rates = (allBaselines || [])
        .map((b: any) => Number(b.daily_rate))
        .map(agentGuestPaysPeak)
        .filter((n): n is number => n != null);
      thresholds = quintileDefaults(rates);
    }

    const range = selectedTierRange(priceTiers, thresholds);
    if (range) {
      const ids = candidates.map((p: any) => p.id);

      // System-mode → baselines × agent channel uplift.
      const { data: candidateBaselines, error: baseErr } = await admin
        .from('baselines')
        .select('property_id, daily_rate')
        .in('property_id', ids)
        .eq('year', year);
      if (baseErr) {
        console.error('baselines lookup failed:', baseErr);
        return json(500, { ok: false, reason: 'baselines-lookup-failed' });
      }

      // Fixed-mode properties don't have baselines. Their peak guest
      // rate lives on property_fixed_rates instead — same source the
      // admin's propertySearch reads. Without this branch every
      // fixed-mode house gets dropped from the tier filter regardless
      // of its real rate (admin sees them, agent sees zero — exact
      // bug behind the 13-vs-0 mismatch the team reported).
      const { data: seasons } = await admin
        .from('seasons')
        .select('id, key')
        .eq('partner_id', PARTNER_ID);
      const peakSeasonId = (seasons || []).find((s: any) => s.key === 'peak')?.id ?? null;
      const fixedRes = peakSeasonId
        ? await admin
            .from('property_fixed_rates')
            .select('property_id, guest_rate')
            .in('property_id', ids)
            .eq('year', year)
            .eq('season_id', peakSeasonId)
        : { data: [] as Array<{ property_id: string; guest_rate: number }> };

      const guestPaysById = new Map<string, number>();
      for (const b of (candidateBaselines || []) as any[]) {
        const rate = agentGuestPaysPeak(Number(b.daily_rate));
        if (rate != null) guestPaysById.set(b.property_id, rate);
      }
      const fixedById = new Map<string, number>();
      for (const f of ((fixedRes as any).data || []) as any[]) {
        const rate = Number(f.guest_rate);
        if (Number.isFinite(rate) && rate > 0) fixedById.set(f.property_id, rate);
      }

      candidates = candidates.filter((p: any) => {
        const isFixed = p.pricing_mode === 'fixed';
        const rate = isFixed ? fixedById.get(p.id) : guestPaysById.get(p.id);
        if (rate == null) return false;
        if (range.floor   != null && rate <= range.floor)   return false;
        if (range.ceiling != null && rate >  range.ceiling) return false;
        return true;
      });
    }
  }

  // 6. Anonymise the result rows. Every field that could leak the
  // property's identity (name, tagline, description, rate) is left
  // out — the agent gets the CTR code (slug) + structural attributes
  // they need to decide whether to enquire. Suburb is kept because
  // the user agreed it's borderline-helpful for "rough area" without
  // being house-identifying on its own.
  const matches = candidates.map((p: any) => ({
    id: p.id,
    code: String(p.slug || '').toUpperCase(),
    bedrooms: p.bedrooms ?? null,
    bathrooms: p.bathrooms ?? null,
    sleeps: p.sleeps ?? null,
    suburb: p.suburb || null,
    city: p.city || null,
    heroImageUrl: p.hero_image_url || null,
    amenityTags: typeof p.amenity_tags === 'string'
      ? p.amenity_tags
      : Array.isArray(p.amenity_tags)
        ? p.amenity_tags.join(', ')
        : '',
  }));

  return json(200, { ok: true, matches });
});
