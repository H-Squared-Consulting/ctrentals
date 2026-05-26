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

export interface AgentEnquiry {
  id: string;
  guestName: string;
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
    publishedAt: string;
    expiresOn: string | null;
    /** Proposal lifecycle status — when 'accepted' / 'booked' (or
     *  any other terminal state) the portal renders a read-only
     *  summary modal instead of an active link, so the agent
     *  can't keep sharing the live proposal URL post-booking. */
    status: string;
    guestPrice: number | null;
    checkIn: string | null;
    checkOut: string | null;
  }>;
  checkIn: string;
  checkOut: string;
  status: AgentEnquiryStatus;
  proposalShareUrl?: string;
  lastUpdated: string;
}

export interface PortalBundle {
  agent: AgentInfo;
  properties: AgentProperty[];
  enquiries: AgentEnquiry[];
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
  };
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
  checkIn: string;          // YYYY-MM-DD
  checkOut: string;         // YYYY-MM-DD
  guestsAdults?: number;
  guestsChildren?: number;
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
