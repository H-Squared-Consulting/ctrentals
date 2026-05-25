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
  propertyName: string;
  propertySlug: string;
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
  propertyId: string;
  /** Required — short summary of the trip the agent is enquiring
   *  about. Becomes the headline on the kanban so the Southern
   *  Escapes team can distinguish multiple enquiries from the same
   *  agent at a glance. */
  subject: string;
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
  return { ok: true, enquiryId: body.enquiryId };
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
