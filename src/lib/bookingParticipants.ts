/**
 * bookingParticipants -- IO resolvers for the booking management phase.
 *
 * The engine in ./managementEmails is deliberately pure: it takes already
 * resolved owner / agent / guidebook / staff records and turns them into a
 * checklist of actions and a variable catalog for the email templates. This
 * module is the other half: the database access that fetches those records.
 * Keeping the two apart means the engine stays unit-testable with plain
 * objects, and all the Supabase coupling lives here.
 *
 * Two flavours of API:
 *   - Single-booking resolvers (resolveOwnerForProperty, resolveAgentForEnquiry,
 *     resolveGuidebookForProperty, loadStaffSettings, loadMarks) for the
 *     per-booking Management section.
 *   - One bulk resolver (loadParticipantsBulk) for the global "Actions due"
 *     dashboard, which needs participants for many bookings at once and so
 *     batches the queries with `.in(...)` to avoid an N+1 storm.
 *
 * Owner resolution mirrors HomeOwnersPage: a property's owners live in the
 * property_owners join table (primary first), each pointing at a home_owners
 * row; if there's no link we fall back to the legacy partner_properties.owner_id
 * single-FK column so older properties still resolve.
 */

import { CT_RENTALS_PARTNER_ID } from '../pages/constants';
import { INITIALS_TO_NAME, type TeamInitials } from './userInitials';
import type { MarkRow, StaffSettings } from './managementEmails';

/** Loosely-typed Supabase client — matches how the rest of the codebase
 *  passes the auth-context client around (see agentPortalAdmin.ts). */
type Client = any;

/** What the engine needs about the property owner. Raw DB values; the
 *  engine applies titleCase / toLowerCase formatting when it builds vars. */
export interface ResolvedOwner {
  name: string;
  email: string | null;
  phone: string | null;
  payment_notes: string | null;
}

export interface ResolvedAgent {
  name: string;
  email: string | null;
  phone: string | null;
}

export interface ResolvedGuidebook {
  slug: string;
  is_published: boolean;
}

// ── small helpers ──────────────────────────────────────────────────

/** Supabase embeds a to-one relation as an object, but depending on how it
 *  infers cardinality it can hand back a single-element array. Normalise. */
function unwrapOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function mapOwner(ho: any): ResolvedOwner {
  return {
    name: ho?.name || '',
    email: ho?.email ?? null,
    phone: ho?.phone ?? null,
    payment_notes: ho?.payment_notes ?? null,
  };
}

function uniq(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v)));
}

// ── Single-booking resolvers ───────────────────────────────────────

/**
 * Resolve the property's primary owner. Reads property_owners (primary first,
 * then oldest link) and falls back to the legacy partner_properties.owner_id
 * column when no join rows exist. Returns null when the property has no owner.
 */
export async function resolveOwnerForProperty(
  supabase: Client,
  propertyId: string,
): Promise<ResolvedOwner | null> {
  if (!propertyId) return null;

  // 1. property_owners join — primary first, then oldest link as tie-break.
  const { data: links } = await supabase
    .from('property_owners')
    .select('owner_id, is_primary, created_at, home_owners(name, email, phone, payment_notes)')
    .eq('property_id', propertyId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });
  const chosen = (links || []).find((l: any) => unwrapOne(l.home_owners));
  if (chosen) {
    const ho = unwrapOne(chosen.home_owners);
    if (ho) return mapOwner(ho);
  }

  // 2. Legacy fallback: partner_properties.owner_id -> home_owners.
  const { data: prop } = await supabase
    .from('partner_properties')
    .select('owner_id')
    .eq('id', propertyId)
    .maybeSingle();
  if (prop?.owner_id) {
    const { data: ho } = await supabase
      .from('home_owners')
      .select('name, email, phone, payment_notes')
      .eq('id', prop.owner_id)
      .maybeSingle();
    if (ho) return mapOwner(ho);
  }

  return null;
}

/**
 * Resolve the agent behind an enquiry. The booking's channel is "agent" only
 * when its enquiry carries an agent_id, so this returns null for direct and
 * platform bookings (no enquiry, or an enquiry with no agent).
 */
export async function resolveAgentForEnquiry(
  supabase: Client,
  enquiryId: string | null,
): Promise<ResolvedAgent | null> {
  if (!enquiryId) return null;
  const { data: enq } = await supabase
    .from('enquiries')
    .select('agent_id')
    .eq('id', enquiryId)
    .maybeSingle();
  if (!enq?.agent_id) return null;
  const { data: agent } = await supabase
    .from('agents')
    .select('name, email, phone')
    .eq('id', enq.agent_id)
    .maybeSingle();
  if (!agent) return null;
  return { name: agent.name || '', email: agent.email ?? null, phone: agent.phone ?? null };
}

/**
 * Resolve the guidebook for a property. Prefers a published guidebook when a
 * property somehow has more than one row. The engine only emits a guidebook
 * URL when a row exists and is published, but we return is_published so it can
 * make that call. Uses guidebooks.slug (NOT partner_properties.slug).
 */
export async function resolveGuidebookForProperty(
  supabase: Client,
  propertyId: string,
): Promise<ResolvedGuidebook | null> {
  if (!propertyId) return null;
  const { data } = await supabase
    .from('guidebooks')
    .select('slug, is_published')
    .eq('property_id', propertyId)
    .order('is_published', { ascending: false })
    .limit(1);
  const row = (data || [])[0];
  if (!row) return null;
  return { slug: row.slug, is_published: !!row.is_published };
}

/**
 * Load the signature + bank details for the drafting user, keyed by their
 * team initials (NT/HH/JH/GH). Returns sensible defaults when no row exists
 * yet (display name from INITIALS_TO_NAME, empty signature) so a fresh
 * install still drafts emails. When initials is null (an unrecognised email)
 * we return an empty-but-valid StaffSettings; the settings page disables save
 * in that case.
 */
export async function loadStaffSettings(
  supabase: Client,
  initials: string | null,
): Promise<StaffSettings> {
  const defaultName =
    initials && initials in INITIALS_TO_NAME
      ? INITIALS_TO_NAME[initials as TeamInitials]
      : '';
  const defaults: StaffSettings = {
    initials: initials || '',
    display_name: defaultName,
    reply_email: null,
    reply_phone: null,
    signature: '',
    bank_sa: null,
    bank_uk: null,
  };
  if (!initials) return defaults;

  const { data } = await supabase
    .from('staff_settings')
    .select('initials, display_name, reply_email, reply_phone, signature, bank_sa, bank_uk')
    .eq('partner_id', CT_RENTALS_PARTNER_ID)
    .eq('initials', initials)
    .maybeSingle();
  if (!data) return defaults;

  return {
    initials: data.initials || initials,
    display_name: data.display_name || defaultName,
    reply_email: data.reply_email ?? null,
    reply_phone: data.reply_phone ?? null,
    signature: data.signature ?? '',
    bank_sa: data.bank_sa ?? null,
    bank_uk: data.bank_uk ?? null,
  };
}

/**
 * Load the sparse "marks" for a booking, keyed by action_key. A row exists
 * only once a staffer has acted on an item; pending items have no row, so the
 * engine treats absence as pending.
 */
export async function loadMarks(
  supabase: Client,
  bookingId: string,
): Promise<Record<string, MarkRow>> {
  const out: Record<string, MarkRow> = {};
  if (!bookingId) return out;
  const { data } = await supabase
    .from('management_actions')
    .select('action_key, status, due_date, sent_at, sent_by')
    .eq('booking_id', bookingId);
  for (const r of (data || []) as any[]) {
    out[r.action_key] = {
      action_key: r.action_key,
      status: r.status,
      due_date: r.due_date ?? null,
      sent_at: r.sent_at ?? null,
      sent_by: r.sent_by ?? null,
    };
  }
  return out;
}

// ── Bulk resolver (Actions-due dashboard) ──────────────────────────

export interface BulkParticipants {
  ownerByProperty: Map<string, ResolvedOwner>;
  agentByEnquiry: Map<string, ResolvedAgent>;
  guidebookByProperty: Map<string, ResolvedGuidebook>;
  marksByBooking: Map<string, Record<string, MarkRow>>;
  /** enquiry id -> { agent_id }. Lets the dashboard resolve each booking's
   *  channel without a separate enquiries round-trip (we already fetch the
   *  enquiries here for agent resolution, so we hand the map back too). */
  enquiryById: Map<string, { agent_id: string | null }>;
}

/**
 * Resolve participants + marks for many bookings in one pass. Batches each
 * lookup with `.in(...)` so the dashboard issues a handful of queries instead
 * of four per booking, AND fires the independent lookups concurrently rather
 * than as a waterfall. Bookings are expected to carry id, property_id and
 * enquiry_id; anything missing is simply skipped.
 */
export async function loadParticipantsBulk(
  supabase: Client,
  bookings: any[],
): Promise<BulkParticipants> {
  const ownerByProperty = new Map<string, ResolvedOwner>();
  const agentByEnquiry = new Map<string, ResolvedAgent>();
  const guidebookByProperty = new Map<string, ResolvedGuidebook>();
  const marksByBooking = new Map<string, Record<string, MarkRow>>();
  const enquiryById = new Map<string, { agent_id: string | null }>();

  const propertyIds = uniq((bookings || []).map(b => b?.property_id));
  const enquiryIds = uniq((bookings || []).map(b => b?.enquiry_id));
  const bookingIds = uniq((bookings || []).map(b => b?.id));

  const empty = Promise.resolve({ data: [] as any[] });

  // Batch 1 — the four independent lookups, concurrently. Owners, enquiries
  // (channel + agents), guidebooks and marks don't depend on each other.
  const [ownerLinksRes, enqRes, gbRes, marksRes] = await Promise.all([
    propertyIds.length
      ? supabase
          .from('property_owners')
          .select('property_id, owner_id, is_primary, created_at, home_owners(name, email, phone, payment_notes)')
          .in('property_id', propertyIds)
      : empty,
    enquiryIds.length
      ? supabase.from('enquiries').select('id, agent_id').in('id', enquiryIds)
      : empty,
    propertyIds.length
      ? supabase.from('guidebooks').select('property_id, slug, is_published').in('property_id', propertyIds)
      : empty,
    bookingIds.length
      ? supabase
          .from('management_actions')
          .select('booking_id, action_key, status, due_date, sent_at, sent_by')
          .in('booking_id', bookingIds)
      : empty,
  ]);

  // ── Owners: property_owners join, primary first, per property ──
  const grouped = new Map<string, any[]>();
  for (const l of (ownerLinksRes.data || []) as any[]) {
    if (!grouped.has(l.property_id)) grouped.set(l.property_id, []);
    grouped.get(l.property_id)!.push(l);
  }
  for (const [pid, list] of grouped) {
    list.sort(
      (a, b) =>
        Number(b.is_primary) - Number(a.is_primary) ||
        String(a.created_at).localeCompare(String(b.created_at)),
    );
    const chosen = list.find(l => unwrapOne(l.home_owners));
    if (chosen) ownerByProperty.set(pid, mapOwner(unwrapOne(chosen.home_owners)));
  }

  // ── Enquiries: channel map (every enquiry) + agent ids to resolve ──
  const enqs = (enqRes.data || []) as any[];
  for (const e of enqs) enquiryById.set(e.id, { agent_id: e.agent_id ?? null });
  const agentIds = uniq(enqs.map((e: any) => e.agent_id));

  // ── Guidebooks: per property, prefer published ──
  for (const g of (gbRes.data || []) as any[]) {
    if (!g.property_id) continue;
    const existing = guidebookByProperty.get(g.property_id);
    if (!existing || (!existing.is_published && g.is_published)) {
      guidebookByProperty.set(g.property_id, { slug: g.slug, is_published: !!g.is_published });
    }
  }

  // ── Marks: management_actions per booking ──
  for (const m of (marksRes.data || []) as any[]) {
    if (!marksByBooking.has(m.booking_id)) marksByBooking.set(m.booking_id, {});
    marksByBooking.get(m.booking_id)![m.action_key] = {
      action_key: m.action_key,
      status: m.status,
      due_date: m.due_date ?? null,
      sent_at: m.sent_at ?? null,
      sent_by: m.sent_by ?? null,
    };
  }

  // Batch 2 — the two dependent lookups, concurrently: legacy owner fallback
  // (needs which properties still lack an owner) + agent records (need the
  // agent ids from the enquiries above).
  const missingOwnerProps = propertyIds.filter(pid => !ownerByProperty.has(pid));
  const [legacyPropsRes, agentsRes] = await Promise.all([
    missingOwnerProps.length
      ? supabase.from('partner_properties').select('id, owner_id').in('id', missingOwnerProps)
      : empty,
    agentIds.length
      ? supabase.from('agents').select('id, name, email, phone').in('id', agentIds)
      : empty,
  ]);

  // Legacy owner fallback: partner_properties.owner_id -> home_owners.
  const legacyProps = (legacyPropsRes.data || []) as any[];
  const legacyOwnerIds = uniq(legacyProps.map((p: any) => p.owner_id));
  if (legacyOwnerIds.length) {
    const { data: hos } = await supabase
      .from('home_owners')
      .select('id, name, email, phone, payment_notes')
      .in('id', legacyOwnerIds);
    const hoById = new Map<string, any>((hos || []).map((h: any) => [h.id, h]));
    for (const p of legacyProps) {
      const ho = p.owner_id ? hoById.get(p.owner_id) : null;
      if (ho) ownerByProperty.set(p.id, mapOwner(ho));
    }
  }

  // Agents: enquiry.agent_id -> agents.
  const agentById = new Map<string, ResolvedAgent>();
  for (const a of (agentsRes.data || []) as any[]) {
    agentById.set(a.id, { name: a.name || '', email: a.email ?? null, phone: a.phone ?? null });
  }
  for (const e of enqs) {
    const agent = e.agent_id ? agentById.get(e.agent_id) : null;
    if (agent) agentByEnquiry.set(e.id, agent);
  }

  return { ownerByProperty, agentByEnquiry, guidebookByProperty, marksByBooking, enquiryById };
}
