/**
 * Agent portal -- mock service module.
 *
 * The public agent portal at /q/:token talks to three functions in this
 * file. Right now they return hardcoded fixture data so the frontend
 * can be built and reviewed by Hayley without any backend in place.
 *
 * When Hayley signs off the UX, these three function bodies get
 * swapped out for real Supabase edge function calls (agent-portal-read
 * and agent-portal-enquire). The shapes of AgentInfo, AgentProperty
 * and AgentEnquiry are the contract the UI depends on, so they need
 * to match the eventual edge function response.
 */

export interface AgentInfo {
  id: string;
  name: string;
  agencyName?: string;
}

export interface AgentProperty {
  id: string;
  slug: string;            // e.g. 'CTR0007' — links to /brochures/<slug>
  name: string;            // e.g. 'Ainsty Walk'
  suburb: string;          // e.g. 'Constantia'
  sleeps: number;
  bedrooms: number;
  baselineRate: number;    // ZAR per night, at normal season, agent scenario
  photoUrl: string;        // cover image
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
  checkIn: string;          // ISO date
  checkOut: string;
  status: AgentEnquiryStatus;
  proposalShareUrl?: string;   // set once status >= 'proposal_sent'
  lastUpdated: string;      // ISO date
}

// ── Fixture data (replace when backend lands) ─────────────────────

const FIXTURE_AGENT: AgentInfo = {
  id: 'fixture-agent-sarah',
  name: 'Sarah Bennett',
  agencyName: 'Bennett Travel, London',
};

const FIXTURE_PROPERTIES: AgentProperty[] = [
  {
    id: 'fixture-prop-1',
    slug: 'CTR0003',
    name: 'Ainsty Walk',
    suburb: 'Constantia',
    sleeps: 6,
    bedrooms: 3,
    baselineRate: 4200,
    photoUrl: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=600&h=400&fit=crop',
  },
  {
    id: 'fixture-prop-2',
    slug: 'CTR0007',
    name: '3 Bones',
    suburb: 'Pagesvlei',
    sleeps: 5,
    bedrooms: 3,
    baselineRate: 5800,
    photoUrl: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=600&h=400&fit=crop',
  },
  {
    id: 'fixture-prop-3',
    slug: 'CTR0027',
    name: 'Cherry Lane',
    suburb: 'Bishopscourt',
    sleeps: 4,
    bedrooms: 2,
    baselineRate: 3600,
    photoUrl: 'https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=600&h=400&fit=crop',
  },
  {
    id: 'fixture-prop-4',
    slug: 'CTR0017',
    name: 'Runway House',
    suburb: 'Constantia',
    sleeps: 5,
    bedrooms: 3,
    baselineRate: 5200,
    photoUrl: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=600&h=400&fit=crop',
  },
  {
    id: 'fixture-prop-5',
    slug: 'CTR0019',
    name: 'Buitenzorg Manor House',
    suburb: 'Constantia',
    sleeps: 5,
    bedrooms: 3,
    baselineRate: 6800,
    photoUrl: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=600&h=400&fit=crop',
  },
  {
    id: 'fixture-prop-6',
    slug: 'CTR0029',
    name: 'Pinehurst',
    suburb: 'Constantia',
    sleeps: 4,
    bedrooms: 2,
    baselineRate: 3900,
    photoUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=600&h=400&fit=crop',
  },
];

const FIXTURE_ENQUIRIES: AgentEnquiry[] = [
  {
    id: 'fixture-enq-1',
    guestName: 'James Smith',
    propertyName: 'Ainsty Walk',
    propertySlug: 'CTR0003',
    checkIn: '2027-03-08',
    checkOut: '2027-03-15',
    status: 'new',
    lastUpdated: '2026-05-23',
  },
  {
    id: 'fixture-enq-2',
    guestName: 'Anna Jones',
    propertyName: '3 Bones',
    propertySlug: 'CTR0007',
    checkIn: '2027-03-22',
    checkOut: '2027-03-29',
    status: 'proposal_sent',
    proposalShareUrl: 'https://admin.southernescapes.co.za/p/example-proposal-token',
    lastUpdated: '2026-05-22',
  },
  {
    id: 'fixture-enq-3',
    guestName: 'Kate Brown',
    propertyName: 'Cherry Lane',
    propertySlug: 'CTR0027',
    checkIn: '2027-04-01',
    checkOut: '2027-04-08',
    status: 'booked',
    lastUpdated: '2026-05-20',
  },
];

// Small artificial delay so the UI shows a real loading state during
// development. Set to 0 to disable. Removed when we swap to real calls.
const MOCK_DELAY_MS = 300;

function delay<T>(value: T): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(value), MOCK_DELAY_MS));
}

// ── Service functions (frontend calls these) ──────────────────────

/** Look up an agent by their portal URL token. Returns null if the
 *  token is unknown or revoked. */
export async function getAgentByToken(token: string): Promise<AgentInfo | null> {
  if (!token) return delay(null);
  // Mock: any non-empty token resolves to Sarah. Real impl validates
  // against agents.url_token and returns 404 if revoked.
  return delay(FIXTURE_AGENT);
}

/** Curated list of properties this agent is allowed to sell. Filtered
 *  via the agent_properties join table once the backend is live. */
export async function getAgentProperties(token: string): Promise<AgentProperty[]> {
  if (!token) return delay([]);
  return delay(FIXTURE_PROPERTIES);
}

/** All enquiries this agent has submitted, newest first. */
export async function getAgentEnquiries(token: string): Promise<AgentEnquiry[]> {
  if (!token) return delay([]);
  return delay(FIXTURE_ENQUIRIES);
}

/** Pretty-print the status pill label. */
export function statusLabel(status: AgentEnquiryStatus): string {
  switch (status) {
    case 'new':           return 'New';
    case 'proposal_sent': return 'Proposal Sent';
    case 'booked':        return 'Booked';
    case 'declined':      return 'Declined';
    case 'cancelled':     return 'Cancelled';
  }
}
