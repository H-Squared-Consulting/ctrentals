/**
 * agentPortal -- public-side service module for /q/:token.
 *
 * Every call hits one of the two Supabase edge functions:
 *   - agent-portal-read  → fetch the agent + their properties + their enquiries
 *   - agent-portal-enquire → submit a new enquiry against a property
 *
 * The public portal never touches the database directly: RLS keeps
 * the underlying tables auth-only, and the edge functions are the
 * single gate. This means the only thing the public client ships is
 * the anon Supabase URL + key (which authenticate the edge function
 * call itself), plus the agent's portal token (the auth for that
 * specific agent's data).
 */

import { supabase } from './supabase';

const FUNCTIONS_BASE = (() => {
  // supabase.functions.invoke would also work but constructing the URL
  // directly lets us keep network behaviour easy to reason about.
  // Project URL pattern: https://<ref>.supabase.co  → /functions/v1/<name>
  const url = (supabase as any).supabaseUrl as string | undefined;
  return url ? `${url.replace(/\/$/, '')}/functions/v1` : '';
})();

const ANON_KEY = (supabase as any).supabaseKey as string;

// ── Shared types (contract with the edge functions) ────────────────

export interface AgentInfo {
  id: string;
  name: string;
  agencyName?: string;
}

export interface AgentProperty {
  id: string;
  slug: string;
  name: string;
  suburb: string;
  sleeps: number;
  bedrooms: number;
  baselineRate: number;
  photoUrl: string;
}

export type AgentEnquiryStatus =
  | 'new'
  | 'proposal_sent'
  | 'booked'
  | 'declined'
  | 'cancelled';

export type AgentTierKey = 'very_low' | 'low' | 'medium' | 'high' | 'very_high';

export interface AgentEnquiry {
  id: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  guestNationality: string;
  guestsAdults: number;
  guestsChildren: number;
  /** Tier picks the agent made on the form, persisted on
   *  enquiries.budget_tiers. Empty on legacy rows. */
  budgetTiers: AgentTierKey[];
  notes: string;
  /** ISO date (YYYY-MM-DD) of when the enquiry was first submitted. */
  submittedAt: string;
  /** Agent's own free-text label for this enquiry, captured on the
   *  /q/:token form. Used as the headline on the "My Enquiries" tab
   *  so the agent recognises their own submissions ("Sarah for
   *  Easter", "Whitsun family of 6"). Distinct from the AHH/N code
   *  the team uses on the kanban (which agents never see). Empty
   *  on legacy rows submitted before the field was added. */
  agentReference: string;
  /** Legacy single-property fields — populated when the enquiry was
   *  submitted with exactly one property (old portal flow OR the
   *  current multi flow picking just one). Use requestedProperties
   *  below for the canonical list when rendering. */
  propertyName: string;
  propertySlug: string;
  /** Every property the agent ticked on the multi-property form.
   *  Falls back to a 1-element array derived from propertyName/Slug
   *  on legacy rows. */
  requestedProperties: Array<{ name: string; slug: string }>;
  /** Proposals the team has explicitly published to this agent
   *  (Publish-to-portal button on the deal modal). Only includes
   *  proposals whose published_to_agent_expires is still in the
   *  future. Empty array when none — the portal renders an
   *  "awaiting response" placeholder in that case. */
  publishedProposals: Array<{
    refCode: string;
    propertyName: string;
    /** Property slug — drives the per-proposal Brochure link on the
     *  agent portal. Empty string when the property has no slug set. */
    propertySlug: string;
    publishedAt: string;
    expiresOn: string | null;
    /** Proposal lifecycle status — when 'accepted' / 'booked' (or
     *  any other terminal state) the portal renders a read-only
     *  summary modal instead of an active link, so the agent
     *  can't keep sharing the live proposal URL post-booking. */
    status: string;
    guestPrice: number | null;
    /** Per-night rate paid out to the homeowner. Used together with
     *  guestPrice + agentEarningPerNight to render the portal-only
     *  earnings breakdown card under each published proposal. */
    ownerNet: number | null;
    /** Southern Escapes' per-night commission. Surfaced on the agent
     *  portal alongside the agent's own share so the full margin
     *  breakdown is transparent — Nicki's call: "she wants agents to
     *  know exactly where every rand goes." */
    southernEscapesPerNight: number | null;
    /** This agent's per-night commission share (already resolved against
     *  multi-agent splits server-side — agents only ever see their own
     *  slice, never the full margin or other agents' takes). Null on
     *  legacy rows or proposals without a pricing snapshot. */
    agentEarningPerNight: number | null;
    /** This agent's commission percentage, surfaced as the chip label
     *  on the breakdown card ("Your share — 15%"). */
    agentPct: number | null;
    /** Full pricing history attached to this proposal — every snapshot
     *  the team has ever saved against it, oldest first. The agent
     *  portal renders this as a v1 · v2 · v3 (current) toggle above the
     *  breakdown table so the agent can audit how the deal moved.
     *  Always contains at least the live snapshot when one is linked. */
    pricingVersions: Array<{
      snapshotId: string;
      createdAt: string;
      isCurrent: boolean;
      guestPrice: number | null;
      ownerNet: number | null;
      southernEscapesPerNight: number | null;
      agentEarningPerNight: number | null;
      agentPct: number | null;
    }>;
    checkIn: string | null;
    checkOut: string | null;
  }>;
  checkIn: string;
  checkOut: string;
  status: AgentEnquiryStatus;
  proposalShareUrl?: string;
  lastUpdated: string;
}

/** Agent-channel tier thresholds — drives the price-tier chip range
 *  subtitles on the enquiry form ("up to R3,500", "R3,500 – R8,000").
 *  Falls back to inventory-derived quintiles server-side if no saved
 *  row exists; null only if the lookup outright failed. */
export interface AgentPriceTiers {
  t1: number;
  t2: number;
  t3: number;
  t4: number;
}

export interface PortalBundle {
  agent: AgentInfo;
  properties: AgentProperty[];
  enquiries: AgentEnquiry[];
  priceTiers: AgentPriceTiers | null;
}

// ── Fetch ──────────────────────────────────────────────────────────

/** Pull the agent's record + their properties + their enquiries in
 *  one round-trip via the agent-portal-read edge function. Returns
 *  null when the token is unknown / revoked / the agent is inactive
 *  -- callers should render the "Link not valid" state. */
export async function getPortalBundle(token: string): Promise<PortalBundle | null> {
  if (!token) return null;
  const url = `${FUNCTIONS_BASE}/agent-portal-read?token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
    },
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) {
    console.error('agent-portal-read failed:', res.status, await res.text().catch(() => ''));
    return null;
  }
  const body = await res.json().catch(() => null);
  if (!body?.ok) return null;
  return {
    agent: body.agent,
    properties: body.properties || [],
    enquiries: body.enquiries || [],
    priceTiers: body.priceTiers || null,
  };
}

// ── Search (form-driven discovery) ─────────────────────────────────

export interface AgentSearchFilters {
  /** Inclusive check-in, YYYY-MM-DD. */
  checkIn?: string;
  /** Exclusive check-out, YYYY-MM-DD. */
  checkOut?: string;
  /** Exact-match bedroom counts. */
  bedrooms?: number[];
  /** Minimum guests the property must sleep. */
  minSleeps?: number;
  /** Price-tier multi-select; resolved against the 'agent' channel
   *  thresholds server-side so the agent can't see the actual rand
   *  bounds, only the tier labels. */
  priceTiers?: AgentTierKey[];
}

/** Anonymised match card returned by the search endpoint. Fields are
 *  intentionally minimal — the CTR code is the only visible identifier
 *  until the team publishes a proposal. */
export interface AgentMatch {
  id: string;
  code: string;          // slug uppercased — e.g. "CTR0011"
  bedrooms: number | null;
  bathrooms: number | null;
  sleeps: number | null;
  suburb: string | null;
  city: string | null;
  heroImageUrl: string | null;
  amenityTags: string;
}

/** Run the agent-portal-search edge function against the agent's
 *  allow-list. Returns the matching anonymised cards — never the
 *  property name or rate. Empty array on any non-2xx response so the
 *  modal can render "no matches" without a crash path. */
export async function searchAgentMatches(
  token: string,
  filters: AgentSearchFilters,
): Promise<AgentMatch[]> {
  if (!token) return [];
  const url = `${FUNCTIONS_BASE}/agent-portal-search`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      token,
      checkIn:    filters.checkIn || undefined,
      checkOut:   filters.checkOut || undefined,
      bedrooms:   filters.bedrooms || [],
      minSleeps:  filters.minSleeps || 0,
      priceTiers: filters.priceTiers || [],
    }),
  });
  if (!res.ok) {
    console.error('agent-portal-search failed:', res.status, await res.text().catch(() => ''));
    return [];
  }
  const body = await res.json().catch(() => null);
  if (!body?.ok) return [];
  return body.matches || [];
}

// ── Submit ─────────────────────────────────────────────────────────

export interface SubmitEnquiryInput {
  token: string;
  /** Properties the agent wants quoted on this single enquiry. 1..N.
   *  Server-side: persisted on enquiries.requested_property_ids and
   *  surfaced on the deal modal so the team can spin up proposals
   *  (or drop suggestions that don't fit) from one place. */
  propertyIds: string[];
  /** Agent's own short label for the enquiry — required at the form
   *  level. Surfaces back as the row title on "My Enquiries" so the
   *  agent can find this submission later. Stored separately from
   *  the AHH/N `subject` the team uses. */
  agentReference: string;
  // Guest details are optional — agents often enquire before they've
  // disclosed the guest. Empty values land as NULL guest_* fields on
  // the enquiry and can be filled in later from the Pipeline.
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  /** Guest nationality — required on the agent enquiry form so the
   *  team has it from the off when scoping a quote. Travels through
   *  to enquiries.nationality alongside the rest of the guest block. */
  guestNationality?: string;
  checkIn: string;          // YYYY-MM-DD
  checkOut: string;         // YYYY-MM-DD
  guestsAdults?: number;
  guestsChildren?: number;
  /** Price-tier selection the agent made on the search filter, persisted
   *  on enquiries.budget_tiers so the admin deal modal can render the
   *  agent's chosen band(s) instead of an empty Budget row. */
  budgetTiers?: AgentTierKey[];
  notes?: string;
}

export interface SubmitEnquiryResult {
  ok: boolean;
  enquiryId?: string;
  refCode?: string;
  reason?: string;
}

export async function submitAgentEnquiry(input: SubmitEnquiryInput): Promise<SubmitEnquiryResult> {
  const url = `${FUNCTIONS_BASE}/agent-portal-enquire`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    return { ok: false, reason: body?.reason || 'unknown' };
  }
  return { ok: true, enquiryId: body.enquiryId, refCode: body.refCode };
}

// ── Display helpers ────────────────────────────────────────────────

export function statusLabel(status: AgentEnquiryStatus): string {
  switch (status) {
    case 'new':           return 'New';
    case 'proposal_sent': return 'Proposal Sent';
    case 'booked':        return 'Booked';
    case 'declined':      return 'Declined';
    case 'cancelled':     return 'Cancelled';
  }
}
