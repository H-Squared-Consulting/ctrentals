/**
 * Agent portal -- service module.
 *
 * Two modes today:
 *   1. Real-agent mode. If the URL token matches an agent in the mock
 *      admin store (localStorage, see mockAdminStore.ts), the portal
 *      loads that agent's record + their assigned properties from
 *      Supabase. Used to demo the end-to-end flow locally.
 *   2. Fixture mode. The literal token 'test-token' returns a hardcoded
 *      Sarah Bennett + six made-up properties + three made-up enquiries
 *      so the visual treatment can be shown without enabling a real
 *      agent.
 *
 * When the real backend lands the mock-store lookups get replaced with
 * Supabase edge function calls (the shapes below stay as the contract).
 */

import { supabase } from './supabase';
import {
  getAgentIdByToken,
  getPropertyIdsForAgent,
} from './mockAdminStore';
import { CT_RENTALS_PARTNER_ID } from '../pages/constants';

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
  baselineRate: number;    // 0 means "Pricing on request"
  photoUrl: string;        // '' means no photo on file
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

// ── Fixture data (token = 'test-token') ───────────────────────────

const FIXTURE_TOKEN = 'test-token';

const FIXTURE_AGENT: AgentInfo = {
  id: 'fixture-agent-sarah',
  name: 'Sarah Bennett',
  agencyName: 'Bennett Travel, London',
};

const FIXTURE_PROPERTIES: AgentProperty[] = [
  { id: 'fixture-prop-1', slug: 'CTR0003', name: 'Ainsty Walk',             suburb: 'Constantia',   sleeps: 6, bedrooms: 3, baselineRate: 4200, photoUrl: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=600&h=400&fit=crop' },
  { id: 'fixture-prop-2', slug: 'CTR0007', name: '3 Bones',                 suburb: 'Pagesvlei',    sleeps: 5, bedrooms: 3, baselineRate: 5800, photoUrl: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=600&h=400&fit=crop' },
  { id: 'fixture-prop-3', slug: 'CTR0027', name: 'Cherry Lane',             suburb: 'Bishopscourt', sleeps: 4, bedrooms: 2, baselineRate: 3600, photoUrl: 'https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=600&h=400&fit=crop' },
  { id: 'fixture-prop-4', slug: 'CTR0017', name: 'Runway House',            suburb: 'Constantia',   sleeps: 5, bedrooms: 3, baselineRate: 5200, photoUrl: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=600&h=400&fit=crop' },
  { id: 'fixture-prop-5', slug: 'CTR0019', name: 'Buitenzorg Manor House',  suburb: 'Constantia',   sleeps: 5, bedrooms: 3, baselineRate: 6800, photoUrl: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=600&h=400&fit=crop' },
  { id: 'fixture-prop-6', slug: 'CTR0029', name: 'Pinehurst',               suburb: 'Constantia',   sleeps: 4, bedrooms: 2, baselineRate: 3900, photoUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=600&h=400&fit=crop' },
];

const FIXTURE_ENQUIRIES: AgentEnquiry[] = [
  { id: 'fixture-enq-1', guestName: 'James Smith', propertyName: 'Ainsty Walk', propertySlug: 'CTR0003', checkIn: '2027-03-08', checkOut: '2027-03-15', status: 'new',           lastUpdated: '2026-05-23' },
  { id: 'fixture-enq-2', guestName: 'Anna Jones',  propertyName: '3 Bones',     propertySlug: 'CTR0007', checkIn: '2027-03-22', checkOut: '2027-03-29', status: 'proposal_sent', proposalShareUrl: 'https://admin.southernescapes.co.za/p/example-proposal-token', lastUpdated: '2026-05-22' },
  { id: 'fixture-enq-3', guestName: 'Kate Brown',  propertyName: 'Cherry Lane', propertySlug: 'CTR0027', checkIn: '2027-04-01', checkOut: '2027-04-08', status: 'booked',        lastUpdated: '2026-05-20' },
];

// ── Service functions (frontend calls these) ──────────────────────

/** Look up the agent behind a portal token. Returns null if the
 *  token is unknown or revoked. */
export async function getAgentByToken(token: string): Promise<AgentInfo | null> {
  if (!token) return null;

  // 1. Try the mock admin store for a real agent.
  const agentId = getAgentIdByToken(token);
  if (agentId) {
    const { data, error } = await supabase
      .from('agents')
      .select('id, name, company, is_active')
      .eq('id', agentId)
      .single();
    if (error || !data) return null;
    if (data.is_active === false) return null;
    return {
      id: data.id,
      name: data.name,
      agencyName: data.company || undefined,
    };
  }

  // 2. Fixture token for visual previews.
  if (token === FIXTURE_TOKEN) return FIXTURE_AGENT;

  return null;
}

/** Curated list of properties this agent can sell. */
export async function getAgentProperties(token: string): Promise<AgentProperty[]> {
  if (!token) return [];

  // Real agent → load assigned properties from Supabase.
  const agentId = getAgentIdByToken(token);
  if (agentId) {
    const propertyIds = getPropertyIdsForAgent(agentId);
    if (propertyIds.length === 0) return [];
    const { data, error } = await supabase
      .from('partner_properties')
      .select('id, slug, property_name, suburb, bedrooms, sleeps, hero_image_url, price_from')
      .in('id', propertyIds)
      .eq('partner_id', CT_RENTALS_PARTNER_ID)
      .order('property_name');
    if (error || !data) return [];
    return data
      .filter((p: any) => p)
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

  // Fixture preview.
  if (token === FIXTURE_TOKEN) return FIXTURE_PROPERTIES;

  return [];
}

/** Enquiries this agent has submitted. Real backend wiring lands later;
 *  for now real agents see an empty list and only the fixture has demo
 *  enquiries. */
export async function getAgentEnquiries(token: string): Promise<AgentEnquiry[]> {
  if (!token) return [];
  if (token === FIXTURE_TOKEN) return FIXTURE_ENQUIRIES;
  return [];
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
