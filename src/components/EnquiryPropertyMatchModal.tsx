/**
 * EnquiryPropertyMatchModal -- second step of the new direct-enquiry
 * flow. Opens after the user clicks "Continue" on /enquiry/new.
 *
 * Lists active properties that match the enquiry:
 *   - bedrooms ∈ enquiry.bedrooms_options (exact match, multi-select)
 *   - no overlapping booking (kind='booking' confirmed/tentative)
 *     or block (kind='block') in the requested check_in→check_out
 *
 * Guests count is captured on the enquiry for the proposal/quote
 * downstream but is intentionally NOT a property filter — too
 * strict in practice (e.g. an 8-sleeper home is fine for 6).
 *
 * Each row shows photo, name, key stats, daily rate (from the
 * baselines table for the current year), total stay (rate × nights),
 * an ✎ Edit pricing button (opens PricingModal in snapshot-only
 * mode) and a checkbox to include this property's proposal.
 *
 * Final "Save enquiry + N proposals" button atomically inserts the
 * enquiry row, then a pricing_proposal + proposal per ticked
 * property, then navigates to the Enquiries kanban with a brief
 * highlight on the new card.
 */

import { useEffect, useMemo, useState } from 'react';
import ActionModal from './ActionModal';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './ToastProvider';
import { CT_RENTALS_PARTNER_ID } from '../pages/constants';
import { calculatePricing, CTR_DEFAULT, fmtRand } from '../lib/pricingEngine';
import { nextDirectEnquiryRefCode, nextProposalRefCodeFor, nextAgentProposalRefCode } from '../lib/refCodes';
import { initialsForEmail } from '../lib/userInitials';
import { linkOrCreateGuestForEnquiry } from '../lib/guestLinks';
import { syncEnquiryFromProposal } from '../lib/statusSync';
import { notifyPipelineChanged } from '../lib/pipelineEvents';
import { searchProperties } from '../lib/propertySearch';
import PricingModal from '../pages/PricingModal';
import type { PricingSnapshot } from './PricingDashboard';

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

/** Per-tier colour for the season pill on each property row. Falls
 *  back to a neutral grey for unknown tags. Matches the kanban's
 *  "obvious at a glance" vibe — Peak red because it's the anchor /
 *  top rate, Winter blue because it's coldest / cheapest. */
function seasonPillColour(tag: string): { bg: string; fg: string } {
  const t = tag.toLowerCase();
  if (t.includes('peak'))     return { bg: '#FEE2E2', fg: '#991B1B' };
  if (t.includes('high'))     return { bg: '#FEF3C7', fg: '#92400E' };
  if (t.includes('shoulder')) return { bg: '#E0F2FE', fg: '#075985' };
  if (t.includes('winter'))   return { bg: '#DBEAFE', fg: '#1E40AF' };
  return { bg: '#F3F4F6', fg: '#6B7280' };
}

interface PropertyRow {
  id: string;
  property_name: string;
  suburb: string | null;
  city: string | null;
  bedrooms: number | null;
  sleeps: number | null;
  hero_image_url: string | null;
}

interface BaselineRow {
  property_id: string;
  year: number;
  daily_rate: number | string;
}

/** Shape of the captured enquiry — held in memory by EnquiryForm
 *  and passed in. Nothing is persisted until the final Save. */
export interface PendingEnquiry {
  subject: string | null;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  check_in: string;
  check_out: string;
  bedrooms_needed: number;
  guests_total: number;
  /** Multi-select arrays. When present, the property match filter
   *  uses them with `.in()` for an exact-match search across
   *  multiple bed/guest counts. Falls back to the single _needed
   *  / _total values (>=) when absent. */
  bedrooms_options?: number[] | null;
  guests_options?: number[] | null;
  guests_adults: number | null;
  guests_children: number | null;
  nationality: string | null;
  budget_min: number | null;
  budget_max: number | null;
  notes: string | null;
  source: string | null;
  source_url: string | null;
  /** Agent-enquiry context. When `is_agent` is true the modal:
   *   - persists the row with is_agent=true + agent_id
   *   - uses pre-supplied ref_code (the agent's AHH/N code) as
   *     both ref_code AND subject instead of generating a D###
   *   - falls through to legacy proposal ref codes (PD#####N
   *     only applies to direct enquiries with D### parents)
   *   - applies AGENT pricing defaults (commission + CTR) rather
   *     than direct scenario defaults
   *  Optional everywhere else so existing direct callers don't
   *  need to set them. */
  is_agent?: boolean;
  agent_id?: string | null;
  ref_code?: string | null;
  /** Disclosed guest details for an agent enquiry. When the agent
   *  hasn't shared them yet these stay null and a "Valued Guest"
   *  placeholder is used at the proposal level. Direct enquiries
   *  reuse client_* for these (already the recipient). */
  guest_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
}

interface Props {
  supabase: any;
  enquiry: PendingEnquiry;
  onClose: () => void;
  /** Fires once the enquiry + proposals are persisted. The id and
   *  ref_code of the new enquiry are passed back so the host can
   *  navigate to the kanban with a highlight on the new card. */
  onSaved: (enquiryId: string, refCode: string) => void;
  /** When set, the modal operates in "add proposals to existing
   *  enquiry" mode: skips the enquiry INSERT (the row already
   *  exists), UPDATEs the row with any edited context fields from
   *  the passed-in enquiry payload, and inserts proposals against
   *  the existing id with PD####N codes derived from the existing
   *  ref_code. Used by the Deal modal's Create Proposal button. */
  existingEnquiry?: { id: string; ref_code: string } | null;
  /** Property IDs to pre-tick on open. Used by the agent-portal
   *  flow: when an agent submits a multi-property enquiry the
   *  picked IDs land on `enquiries.requested_property_ids`, and
   *  the deal modal's "Generate proposals for these N →" CTA
   *  passes them here so the match modal opens with exactly those
   *  rows checked. The user can still tick additional matches or
   *  un-tick suggestions before saving. */
  initiallySelected?: string[] | null;
  /** When set, the property list is HARD-FILTERED to only these
   *  IDs (and the bedrooms filter is skipped). Used exclusively
   *  for the agent-portal flow where the agent has already named
   *  the houses they want quoted — the team's job is to review
   *  pricing per row, not pick from the whole portfolio. The
   *  bedroom/availability subtitle and search box still apply
   *  within the restricted set. Empty / null = no restriction
   *  (every other entry point keeps showing all matches). */
  restrictToIds?: string[] | null;
}

interface SeasonRow {
  id: string;
  key: string;
  name: string;
  multiplier: number | string;
  date_ranges: Array<{ start: string; end: string }>;
  sort_order: number;
}

/** Pick the season whose date_ranges (MM-DD) cover the check-in. */
function seasonForDate(seasons: SeasonRow[], checkIn: string | null): SeasonRow | null {
  if (!checkIn) return seasons.find(s => s.key === 'peak') || seasons[0] || null;
  const mmdd = checkIn.slice(5);
  for (const s of seasons) {
    for (const r of (s.date_ranges || [])) {
      if (!r.start || !r.end) continue;
      const inRange = r.start <= r.end
        ? (mmdd >= r.start && mmdd <= r.end)
        : (mmdd >= r.start || mmdd <= r.end);
      if (inRange) return s;
    }
  }
  return seasons.find(s => s.key === 'peak') || seasons[0] || null;
}

/** Generic-agent fallback commission when the picked agent's row
 *  has no default_commission_pct set. Matches buildAgentSnapshot. */
const GENERIC_AGENT_PCT = 15;

/** Pure-compute default snapshot from pre-fetched data — no awaits.
 *  The match modal batch-loads baselines + seasons once on mount;
 *  this function then runs synchronously per property in-memory.
 *  Removes the previous "50 properties × 2 queries each" fan-out
 *  that caused slow + flaky loads in the picker.
 *
 *  Defaults the season to PEAK (the anchor / highest tier) so the
 *  team always starts from the top of the rate card and discounts
 *  down via Edit pricing when they want a different season. Auto-
 *  picking by stay date was confusing — a December enquiry might
 *  silently land on Peak while a June one defaulted to Winter, even
 *  though the team always wants Peak as the negotiating anchor. */
function buildDefaultDirectSnapshot(
  baselineRow: BaselineRow | null,
  seasons: SeasonRow[],
  args: { propertyId: string; checkIn: string | null },
): PricingSnapshot | null {
  if (!baselineRow) return null;
  const baseline = Number(baselineRow.daily_rate) || 0;
  if (baseline <= 0) return null;

  const seasonRow = seasons.find(s => s.key === 'peak') || seasons[0] || null;
  const seasonMultiplier = seasonRow ? Number(seasonRow.multiplier) : 1;

  const breakdown = calculatePricing({
    baseline,
    scenarioType: 'direct',
    ctrPct: CTR_DEFAULT.direct,
    agentPct: 0,
    seasonMultiplier,
    platformFeePct: 0,
    platformFixedFee: 0,
    reducedBaseline: null,
    reducedCtrPct: null,
    reducedAgentPct: null,
    solveFor: 'guest',
    targetGuestPrice: null,
    vatEnabled: false,
    vatRatePct: 0,
  } as any);

  return {
    propertyId: args.propertyId,
    scenarioType: 'direct',
    agentId: null,
    agents: [],
    channelId: null,
    baseline,
    totalMarginPct: CTR_DEFAULT.direct,
    ctrPct: CTR_DEFAULT.direct,
    agentPct: 0,
    reducedBaseline: null,
    reducedCtrPct: null,
    reducedAgentPct: null,
    seasonTag: seasonRow?.name || 'peak',
    seasonMultiplier,
    breakdown: {
      ownerNet: breakdown.ownerNet,
      ctrTake: breakdown.ctrTake,
      agentTake: 0,
      platformFees: 0,
      clientPriceExclVat: breakdown.clientPriceExclVat,
      vatAmount: 0,
      clientPriceInclVat: breakdown.clientPriceExclVat,
      adjustedBaseline: breakdown.adjustedBaseline,
      totalMarginPct: breakdown.totalMarginPct,
      effectiveCtrMarginPct: breakdown.effectiveCtrMarginPct,
      effectiveTotalMarkupPct: breakdown.effectiveTotalMarkupPct,
    },
  } as any;
}

/** Agent-scenario sibling of buildDefaultDirectSnapshot — same
 *  batched-data signature so it slots into the same per-property
 *  loop, with an extra `agentPct` and `agentId` so each row
 *  carries the right commission. CTR + agent split + peak season
 *  default mirror buildAgentSnapshot's behaviour. */
function buildDefaultAgentSnapshot(
  baselineRow: BaselineRow | null,
  seasons: SeasonRow[],
  args: { propertyId: string; agentId: string; agentPct: number },
): PricingSnapshot | null {
  if (!baselineRow) return null;
  const baseline = Number(baselineRow.daily_rate) || 0;
  if (baseline <= 0) return null;

  const seasonRow = seasons.find(s => s.key === 'peak') || seasons[0] || null;
  const seasonMultiplier = seasonRow ? Number(seasonRow.multiplier) : 1;
  const ctrPct = CTR_DEFAULT.agent;

  const breakdown = calculatePricing({
    baseline,
    scenarioType: 'agent',
    ctrPct,
    agentPct: args.agentPct,
    seasonMultiplier,
    platformFeePct: 0,
    platformFixedFee: 0,
    reducedBaseline: null,
    reducedCtrPct: null,
    reducedAgentPct: null,
    solveFor: 'guest',
    targetGuestPrice: null,
    vatEnabled: false,
    vatRatePct: 0,
  } as any);

  return {
    propertyId: args.propertyId,
    scenarioType: 'agent',
    agentId: args.agentId,
    agents: [{ id: args.agentId, pct: args.agentPct }],
    channelId: null,
    baseline,
    totalMarginPct: ctrPct + args.agentPct,
    ctrPct,
    agentPct: args.agentPct,
    reducedBaseline: null,
    reducedCtrPct: null,
    reducedAgentPct: null,
    seasonTag: seasonRow?.name || 'peak',
    seasonMultiplier,
    breakdown: {
      ownerNet: breakdown.ownerNet,
      ctrTake: breakdown.ctrTake,
      agentTake: (breakdown as any).agentTake ?? 0,
      platformFees: 0,
      clientPriceExclVat: breakdown.clientPriceExclVat,
      vatAmount: 0,
      clientPriceInclVat: breakdown.clientPriceExclVat,
      adjustedBaseline: breakdown.adjustedBaseline,
      totalMarginPct: breakdown.totalMarginPct,
      effectiveCtrMarginPct: breakdown.effectiveCtrMarginPct,
      effectiveTotalMarkupPct: breakdown.effectiveTotalMarkupPct,
    },
  } as any;
}

export default function EnquiryPropertyMatchModal({ supabase, enquiry, onClose, onSaved, existingEnquiry, initiallySelected, restrictToIds }: Props) {
  const toast = useToast();
  const { user } = useAuth();
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [loading, setLoading] = useState(true);
  /** Set if any of the 4 startup queries blow up. Surfaces an inline
   *  error + Retry button instead of leaving the user stuck on a
   *  spinner forever, which is what we used to do before. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Bump to force the startup effect to re-run on Retry. */
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Per-property snapshot map. Populated lazily — properties with
   *  no entry use the on-the-fly default snapshot at save time. */
  const [snapshots, setSnapshots] = useState<Record<string, PricingSnapshot>>({});
  /** Per-property default snapshot cache so the row can render the
   *  daily rate + total without re-computing on every render. */
  const [defaults, setDefaults] = useState<Record<string, PricingSnapshot | null>>({});
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nights = useMemo(() => {
    return Math.round(
      (new Date(enquiry.check_out).getTime() - new Date(enquiry.check_in).getTime()) /
      (1000 * 60 * 60 * 24)
    );
  }, [enquiry.check_in, enquiry.check_out]);

  // Load matching properties + their default pricing in 4 queries
  // total (properties, bookings, baselines, seasons) — regardless
  // of how many properties match. The old implementation fired 2
  // queries PER property which was slow and unreliable; this is
  // O(1) in property count.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
      const year = new Date().getFullYear();
      // Hand the filter step over to the shared searchProperties()
      // helper — one source of truth for "what properties match
      // this enquiry?" across the platform (GlobalSearchModal,
      // EnquiryForm preview, this match modal). Bedrooms + dates
      // + price + restrict-to-IDs all map straight through. The
      // helper also returns the per-night dailyRate, which we
      // index below for the pricing snapshot phase that's
      // specific to this modal.
      const bedFilterRaw = (enquiry.bedrooms_options && enquiry.bedrooms_options.length > 0)
        ? enquiry.bedrooms_options
        : (enquiry.bedrooms_needed != null ? [enquiry.bedrooms_needed] : null);
      const searchPromise = searchProperties(supabase, {
        bedrooms: bedFilterRaw && bedFilterRaw.length > 0 ? bedFilterRaw : undefined,
        checkIn:  enquiry.check_in,
        checkOut: enquiry.check_out,
        priceMin: enquiry.budget_min ?? null,
        priceMax: enquiry.budget_max ?? null,
        restrictToIds: restrictToIds ?? null,
      });
      // Seasons + agent are STILL fetched locally — they feed the
      // per-row pricing snapshot computation which is specific to
      // this modal (not part of the filter step). Batched into
      // the same Promise.all so we keep the four-round-trip budget.
      const agentQuery = enquiry.is_agent && enquiry.agent_id
        ? supabase.from('agents').select('id, default_commission_pct').eq('id', enquiry.agent_id).maybeSingle()
        : Promise.resolve({ data: null });
      const [searched, seasonsRes, agentRes] = await Promise.all([
        searchPromise,
        supabase
          .from('seasons')
          .select('id, key, name, multiplier, date_ranges, sort_order')
          .eq('partner_id', CT_RENTALS_PARTNER_ID)
          .order('sort_order'),
        agentQuery,
      ]);

      if (cancelled) return;

      // Map searchProperties' flat result shape back onto the
      // PropertyRow this component already renders against — keeps
      // the rest of the file (search box, selected-set logic,
      // pricing snapshots, save flow) untouched.
      const free: PropertyRow[] = searched.map((p) => ({
        id: p.id,
        property_name: p.name,
        suburb: p.suburb,
        city: p.city,
        bedrooms: p.bedrooms,
        sleeps: p.sleeps,
        hero_image_url: p.heroImageUrl,
      }));
      setProperties(free);
      // Pre-tick any caller-supplied selections that survived the
      // bedrooms + availability filters. Agent-portal flow lands
      // here with the properties the agent ticked on /q/:token —
      // intersecting with `free` means we silently drop ones that
      // got booked between submission and triage rather than
      // surfacing a confusing "this property was checked but isn't
      // in the list" state. Only seeded ONCE (first load) so the
      // user's manual ticks aren't clobbered on retry.
      if (initiallySelected && initiallySelected.length > 0) {
        const freeIds = new Set(free.map(p => p.id));
        setSelected(prev => {
          if (prev.size > 0) return prev;
          const seed = new Set<string>();
          for (const id of initiallySelected) {
            if (freeIds.has(id)) seed.add(id);
          }
          return seed;
        });
      }
      setLoading(false);

      // Build a per-property baseline lookup from searchProperties'
      // returned daily rate (it already pulled baselines.daily_rate
      // for the current year as part of the filter step). Same
      // BaselineRow shape the snapshot builders expect — year is
      // canonical "current year" since searchProperties scopes to
      // that, and property_id is the FK column it filtered on.
      const baselineByProperty = new Map<string, BaselineRow>();
      for (const p of searched) {
        if (p.dailyRate != null) {
          baselineByProperty.set(p.id, {
            property_id: p.id,
            year,
            daily_rate: p.dailyRate,
          });
        }
      }
      const seasons = (seasonsRes.data as SeasonRow[]) || [];

      // Synchronous compute per property — no awaits, no fan-out.
      // Pick agent vs direct snapshot per enquiry mode so the team
      // sees the right indicative pricing on the picker rows BEFORE
      // they tick anything.
      const out: Record<string, PricingSnapshot | null> = {};
      const isAgentMode = !!(enquiry.is_agent && enquiry.agent_id);
      const agentPct = isAgentMode
        ? (agentRes.data?.default_commission_pct != null
            ? Number(agentRes.data.default_commission_pct)
            : GENERIC_AGENT_PCT)
        : 0;
      for (const p of free) {
        const baseline = baselineByProperty.get(p.id) ?? null;
        out[p.id] = isAgentMode
          ? buildDefaultAgentSnapshot(baseline, seasons, {
              propertyId: p.id,
              agentId: enquiry.agent_id as string,
              agentPct,
            })
          : buildDefaultDirectSnapshot(baseline, seasons, {
              propertyId: p.id,
              checkIn: enquiry.check_in,
            });
      }
      setDefaults(out);
      } catch (err: any) {
        if (cancelled) return;
        console.error('EnquiryPropertyMatchModal load failed:', err);
        setLoadError(err?.message || 'Failed to load properties');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Re-fetch when the enquiry's filter inputs change OR the user
    // hits Retry (loadAttempt bump). bedrooms_options included so
    // multi-select changes on the host don't get stale results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, enquiry.bedrooms_needed, enquiry.guests_total, enquiry.check_in, enquiry.check_out, enquiry.is_agent, enquiry.agent_id, JSON.stringify(enquiry.bedrooms_options ?? []), JSON.stringify(restrictToIds ?? []), loadAttempt]);

  // Search filter (name + suburb) applied on the matched set.
  const filtered = useMemo(() => {
    if (!search.trim()) return properties;
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
    return properties.filter(p => {
      const hay = [p.property_name, p.suburb, p.city].filter(Boolean).join(' ').toLowerCase();
      return terms.every(t => hay.includes(t));
    });
  }, [properties, search]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  function effectiveSnapshot(propertyId: string): PricingSnapshot | null {
    return snapshots[propertyId] ?? defaults[propertyId] ?? null;
  }

  async function handleSaveAll() {
    if (saving) return;
    setSaving(true);
    try {
      // 1. Resolve the enquiry row — INSERT for fresh enquiries,
      //    UPDATE-in-place for the "add proposals to existing"
      //    case (Deal modal → Create Proposal). The UPDATE flushes
      //    any context edits the user made (dates, guests, notes)
      //    that affected which properties matched.
      let enq: { id: string; ref_code: string };
      if (existingEnquiry) {
        const { data: updated, error: updErr } = await supabase
          .from('enquiries')
          .update({
            subject: enquiry.subject,
            client_name: enquiry.client_name,
            client_email: enquiry.client_email,
            client_phone: enquiry.client_phone,
            check_in: enquiry.check_in,
            check_out: enquiry.check_out,
            bedrooms_needed: enquiry.bedrooms_needed,
            guests_total: enquiry.guests_total,
            bedrooms_options: enquiry.bedrooms_options ?? null,
            guests_options:   enquiry.guests_options ?? null,
            guests_adults: enquiry.guests_adults,
            guests_children: enquiry.guests_children,
            nationality: enquiry.nationality,
            budget_min: enquiry.budget_min,
            budget_max: enquiry.budget_max,
            notes: enquiry.notes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingEnquiry.id)
          .select('id, ref_code')
          .single();
        if (updErr) throw updErr;
        enq = updated;
      } else {
        // Agent enquiries pre-supply a ref_code (AHH/N) computed
        // client-side; direct enquiries generate the next D### here.
        // guest_* mirrors client_* for direct (recipient = guest)
        // but is the optionally-disclosed guest for agent (may be
        // null; downstream surfaces "Valued Guest" placeholder).
        const isAgentEnquiry = !!enquiry.is_agent;
        const refCode = isAgentEnquiry && enquiry.ref_code
          ? enquiry.ref_code
          : await nextDirectEnquiryRefCode(supabase);
        const guestName  = isAgentEnquiry ? (enquiry.guest_name ?? null) : enquiry.client_name;
        const guestEmail = isAgentEnquiry ? (enquiry.guest_email ?? null) : enquiry.client_email;
        const guestPhone = isAgentEnquiry ? (enquiry.guest_phone ?? null) : enquiry.client_phone;
        const { data: inserted, error: enqErr } = await supabase
          .from('enquiries')
          .insert({
            partner_id: CT_RENTALS_PARTNER_ID,
            ref_code: refCode,
            is_agent: isAgentEnquiry,
            agent_id: isAgentEnquiry ? (enquiry.agent_id ?? null) : null,
            subject: enquiry.subject,
            client_name: enquiry.client_name,
            client_email: enquiry.client_email,
            client_phone: enquiry.client_phone,
            guest_name: guestName,
            guest_email: guestEmail,
            guest_phone: guestPhone,
            check_in: enquiry.check_in,
            check_out: enquiry.check_out,
            bedrooms_needed: enquiry.bedrooms_needed,
            guests_total: enquiry.guests_total,
            bedrooms_options: enquiry.bedrooms_options ?? null,
            guests_options:   enquiry.guests_options ?? null,
            guests_adults: enquiry.guests_adults,
            guests_children: enquiry.guests_children,
            nationality: enquiry.nationality,
            budget_min: enquiry.budget_min,
            budget_max: enquiry.budget_max,
            notes: enquiry.notes,
            source: enquiry.source,
            source_url: enquiry.source_url,
            created_by_initials: initialsForEmail(user?.email),
          })
          .select('id, ref_code')
          .single();
        if (enqErr) throw enqErr;
        enq = inserted;
      }

      // 2. CRM auto-link (best-effort, non-blocking on failure).
      //    Skip when reusing an existing enquiry — that link was
      //    already established at the original save. For agent
      //    enquiries, use the (optionally disclosed) guest details
      //    rather than client_* (which is the AGENT's contact, not
      //    the guest). When nothing's disclosed we skip — no guest
      //    to link yet.
      const isAgentEnquiry = !!enquiry.is_agent;
      const crmName  = isAgentEnquiry ? (enquiry.guest_name  ?? null) : enquiry.client_name;
      const crmEmail = isAgentEnquiry ? (enquiry.guest_email ?? null) : enquiry.client_email;
      const crmPhone = isAgentEnquiry ? (enquiry.guest_phone ?? null) : enquiry.client_phone;
      if (!existingEnquiry && (crmName || crmEmail)) {
        try {
          await linkOrCreateGuestForEnquiry(supabase, {
            enquiryId: enq.id,
            partnerId: CT_RENTALS_PARTNER_ID,
            guestName: crmName,
            guestEmail: crmEmail,
            guestPhone: crmPhone,
          });
        } catch (err) {
          console.error('Guest CRM link failed (non-blocking):', err);
        }
      }

      // 3. For each selected property: insert pricing_proposal +
      //    proposal. PD####N codes per the new direct scheme.
      //    SERIAL, not parallel — each call computes the next ref
      //    code from MAX(existing PD#####N), so running them in
      //    parallel would race + 409 on the proposals.ref_code
      //    UNIQUE index. Single-deal ops; serial is fine.
      const selectedIds = [...selected];
      const results: Array<{ ok: boolean; reason?: string }> = [];
      for (const pid of selectedIds) {
        const snap = effectiveSnapshot(pid);
        if (!snap) { results.push({ ok: false, reason: 'no-pricing' }); continue; }
        try {
          const b = snap.breakdown;
          const pricingPayload = {
            property_id: snap.propertyId,
            scenario_type: snap.scenarioType,
            agent_id: snap.agentId,
            agents: (snap.agents || []).map((a: any) => ({ id: a.id, pct: a.pct })),
            channel_profile_id: snap.channelId,
            baseline_used: snap.baseline,
            baseline_mode: 'daily' as const,
            commission_pct: snap.totalMarginPct,
            reduced_baseline: snap.reducedBaseline,
            reduced_commission_pct:
              snap.reducedCtrPct !== null || snap.reducedAgentPct !== null
                ? (snap.reducedCtrPct ?? snap.ctrPct) + (snap.reducedAgentPct ?? snap.agentPct)
                : null,
            season_tag: snap.seasonTag,
            season_multiplier: snap.seasonMultiplier,
            calc_method: 'margin' as const,
            owner_net: b.ownerNet,
            company_take: b.ctrTake,
            client_price_excl_vat: b.clientPriceExclVat,
            vat_enabled: false,
            vat_rate_pct: 0,
            vat_amount: 0,
            client_price_incl_vat: b.clientPriceExclVat,
            status: 'draft' as const,
            expiry_date: null,
            notes: null,
          };
          const { data: pp, error: ppErr } = await supabase
            .from('pricing_proposals')
            .insert(pricingPayload)
            .select('id')
            .single();
          if (ppErr) throw ppErr;

          // Per-stream proposal ref code:
          //   Direct (D### parent) → PD####N via nextProposalRefCodeFor
          //   Agent  (AHH/N parent) → AHH/N-P1, -P2, … via nextAgentProposalRefCode
          // Both are serial-safe (single deal) and scoped to the parent.
          const proposalRefCode = isAgentEnquiry
            ? await nextAgentProposalRefCode(supabase, enq.id, enq.ref_code)
            : ((await nextProposalRefCodeFor(supabase, enq.ref_code)) || `PROP-${pid.slice(0, 6)}`);
          // Proposal guest_* mirrors the enquiry's resolved guest
          // details — for agent enquiries with nothing disclosed yet
          // we drop in the "Valued Guest" placeholder so the kanban
          // card and the proposal-builder both have something to
          // render (later disclosure cascades and replaces it).
          const proposalGuestName = isAgentEnquiry
            ? (enquiry.guest_name?.trim() || 'Valued Guest')
            : enquiry.client_name;
          const proposalPayload = {
            ref_code: proposalRefCode,
            partner_id: CT_RENTALS_PARTNER_ID,
            enquiry_id: enq.id,
            property_id: pid,
            pricing_proposal_id: pp.id,
            guest_id: null,
            guest_name: proposalGuestName,
            guest_email: isAgentEnquiry ? (enquiry.guest_email ?? null) : enquiry.client_email,
            guest_phone: isAgentEnquiry ? (enquiry.guest_phone ?? null) : enquiry.client_phone,
            guests_total: enquiry.guests_total,
            check_in: enquiry.check_in,
            check_out: enquiry.check_out,
            status: 'drafting' as const,
            is_agent: isAgentEnquiry,
            notes: null,
          };
          const { data: pr, error: prErr } = await supabase
            .from('proposals')
            .insert(proposalPayload)
            .select('id')
            .single();
          if (prErr) throw prErr;
          await syncEnquiryFromProposal(supabase, pr.id, 'drafting');
          results.push({ ok: true });
        } catch (err: any) {
          console.error('auto-proposal failed for property', pid, err);
          results.push({ ok: false, reason: err?.message || 'unknown' });
        }
      }

      const ok = results.filter(r => r.ok).length;
      const failed = results.length - ok;
      if (failed > 0) {
        toast.warning(`${ok} of ${results.length} proposals created; ${failed} failed (check console)`);
      } else if (existingEnquiry) {
        toast.success(`${ok} proposal${ok === 1 ? '' : 's'} added to ${enq.ref_code}`);
      } else if (ok > 0) {
        toast.success(`Enquiry ${enq.ref_code} saved with ${ok} draft proposal${ok === 1 ? '' : 's'}`);
      } else {
        toast.success(`Enquiry ${enq.ref_code} saved`);
      }

      notifyPipelineChanged();
      onSaved(enq.id, enq.ref_code);
    } catch (err: any) {
      console.error('handleSaveAll failed:', err);
      toast.error('Failed to save: ' + (err?.message || String(err)));
    } finally {
      setSaving(false);
    }
  }

  const selectedCount = selected.size;
  const primaryLabel = selectedCount === 0
    ? 'Save enquiry'
    : `Save enquiry + ${selectedCount} proposal${selectedCount === 1 ? '' : 's'}`;

  return (
    <>
      <ActionModal
        title="Pick properties to quote"
        subtitle={
          <>
            {/* Subtitle mirrors the exact-match filter — no "+"
                phrasing because the .in() filter only includes the
                explicit counts the user picked. */}
            {(() => {
              const nightStr = <><strong>{nights} night{nights === 1 ? '' : 's'}</strong></>;
              // Agent-portal restricted view: list only the houses
              // the agent named. Subtitle reflects that — no point
              // saying "all properties" when we're showing N of them.
              if (restrictToIds && restrictToIds.length > 0) {
                return (
                  <>
                    Showing the <strong>{restrictToIds.length} propert{restrictToIds.length === 1 ? 'y' : 'ies'}</strong> the agent asked about, for {nightStr}.
                    Review pricing and untick any you don't want to quote.
                  </>
                );
              }
              // No-bedrooms case: agent-portal enquiries don't ask
              // for bedroom counts (the agent picked specific
              // houses) so the filter degrades to "everything free
              // on those dates" — say that explicitly so the user
              // doesn't read a blank "X beds" and assume the modal
              // is broken.
              const rawBeds = (enquiry.bedrooms_options && enquiry.bedrooms_options.length > 0)
                ? enquiry.bedrooms_options
                : (enquiry.bedrooms_needed != null ? [enquiry.bedrooms_needed] : null);
              if (!rawBeds || rawBeds.length === 0) {
                return (
                  <>
                    Showing <strong>all properties</strong> free for {nightStr} on those dates.
                    Tick the ones you want to quote.
                  </>
                );
              }
              const bedStr = `${rawBeds.join(', ')} bed${rawBeds.length === 1 && rawBeds[0] === 1 ? '' : 's'}`;
              return (
                <>
                  Showing properties with <strong>{bedStr}</strong>,
                  free for {nightStr} on those dates.
                  Tick the ones you want to quote.
                </>
              );
            })()}
          </>
        }
        width={720}
        primaryAction={
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveAll}
            // Block Save while the property list is still loading or
            // failed to load — saving against a half-rendered list
            // would persist proposals against stale property data.
            disabled={saving || loading || !!loadError}
            title={loading ? 'Wait for the property list to finish loading' : undefined}
          >
            {saving ? 'Saving…' : loading ? 'Loading…' : primaryLabel}
          </button>
        }
        // Replace "Cancel" with "Back" — this is step 2 of a two-step
        // flow, not a discard action. The form data on step 1 stays
        // populated when we go back, so nothing is lost.
        cancelLabel="← Back"
        onClose={onClose}
      >
        <input
          type="search"
          className="form-input"
          placeholder="Search properties by name or suburb…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 12 }}
        />

        {loadError ? (
          <div style={{
            padding: 16,
            border: '1px dashed var(--color-danger, #DC2626)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-danger, #DC2626)',
            fontSize: '0.8125rem',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}>
            <span>Couldn't load properties: {loadError}</span>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: '0.75rem' }}
              onClick={() => setLoadAttempt(n => n + 1)}
            >
              ↻ Retry
            </button>
          </div>
        ) : loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading properties…</div>
        ) : filtered.length === 0 ? (
          <div style={{
            padding: 24,
            textAlign: 'center',
            color: 'var(--text-secondary)',
            border: '1px dashed var(--border)',
            borderRadius: 'var(--radius-sm)',
          }}>
            No matching properties available for these dates. You can save the enquiry without proposals and add them later from the Enquiries board.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(p => {
              const snap = effectiveSnapshot(p.id);
              const dailyRate = snap?.breakdown.clientPriceExclVat ?? null;
              const totalStay = dailyRate != null ? dailyRate * nights : null;
              const noPricing = dailyRate == null;
              const isSel = selected.has(p.id);
              return (
                <div
                  key={p.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: 10,
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    background: isSel ? 'var(--bg)' : 'var(--surface)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    disabled={noPricing}
                    onChange={() => toggle(p.id)}
                    style={{ flexShrink: 0 }}
                  />
                  {p.hero_image_url ? (
                    <img
                      src={p.hero_image_url}
                      alt=""
                      style={{ width: 60, height: 44, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                    />
                  ) : (
                    <div style={{
                      width: 60, height: 44, background: 'var(--bg)', borderRadius: 4,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>🏠</div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)' }}>
                      {titleCase(p.property_name)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {p.bedrooms != null && p.bedrooms > 0 && <>{p.bedrooms} bed</>}
                      {p.sleeps != null && p.sleeps > 0 && <> · {p.sleeps} guests</>}
                      {p.suburb && <> · {titleCase(p.suburb)}</>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 140 }}>
                    {noPricing ? (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', fontStyle: 'italic' }}>
                        No pricing set
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                          <div style={{ fontSize: '0.875rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                            {fmtRand(dailyRate!)} <span style={{ fontSize: '0.6875rem', fontWeight: 400, color: 'var(--text-light)' }}>/ night</span>
                          </div>
                          {/* Tiny season pill so users can see at a
                              glance what tier the default snapshot is
                              priced at. Reads from the snapshot's
                              seasonTag so per-row Edit pricing
                              overrides are reflected. */}
                          {snap?.seasonTag && (
                            <span
                              title={`Pricing tier · ${snap.seasonTag}`}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                padding: '1px 6px',
                                borderRadius: 4,
                                background: seasonPillColour(snap.seasonTag).bg,
                                color: seasonPillColour(snap.seasonTag).fg,
                                fontSize: '0.625rem',
                                fontWeight: 700,
                                letterSpacing: '0.04em',
                                textTransform: 'uppercase',
                              }}
                            >
                              {snap.seasonTag}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                          {fmtRand(totalStay!)} <span style={{ color: 'var(--text-light)' }}>· {nights}n total</span>
                        </div>
                      </>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: '0.6875rem', padding: '2px 8px', marginTop: 4 }}
                      onClick={() => setEditingPropertyId(p.id)}
                      disabled={noPricing}
                      title={noPricing ? 'Set a baseline rate on Settings → Pricing first' : 'Adjust pricing for this property'}
                    >
                      ✎ Edit pricing
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ActionModal>

      {editingPropertyId && (() => {
        const p = properties.find(x => x.id === editingPropertyId);
        if (!p) return null;
        return (
          <PricingModal
            property={{ id: p.id, property_name: p.property_name }}
            supabase={supabase}
            // Pre-tag with the right scenario so the PricingDashboard
            // skips State A (Direct / Agent / Platform picker) — for
            // agent enquiries it pre-selects the picked agent so the
            // commission split matches the row default.
            enquiryPrefill={{
              id: '',
              client_name: enquiry.client_name,
              client_email: enquiry.client_email,
              client_phone: enquiry.client_phone,
              check_in: enquiry.check_in,
              check_out: enquiry.check_out,
              guests_total: enquiry.guests_total,
              notes: enquiry.notes,
              is_agent: !!enquiry.is_agent,
              agent_id: enquiry.agent_id ?? null,
              guest_name:  enquiry.guest_name  ?? null,
              guest_email: enquiry.guest_email ?? null,
              guest_phone: enquiry.guest_phone ?? null,
            }}
            // Snapshot-only mode — closes itself + returns the snapshot.
            onSnapshotReady={(snap) => {
              setSnapshots(prev => ({ ...prev, [p.id]: snap }));
              setSelected(prev => {
                const next = new Set(prev);
                next.add(p.id);
                return next;
              });
              setEditingPropertyId(null);
            }}
            initialSnapshot={snapshots[p.id] ?? null}
            nights={nights}
            // This whole flow is the direct-enquiry path — lock the
            // channel pill so the user can't silently flip the
            // snapshot into an agent / platform quote (which would
            // rewire the maths against an enquiry that has no agent
            // attached). enquiryPrefill above also pre-selects direct
            // so the dashboard lands in State B from the off.
            lockScenario
            onClose={() => setEditingPropertyId(null)}
          />
        );
      })()}
    </>
  );
}
