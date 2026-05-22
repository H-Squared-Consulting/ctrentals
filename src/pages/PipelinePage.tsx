/**
 * PipelinePage -- Operations → Pipeline
 *
 * Replaces the old split Enquiries / Proposals pages. A "deal" is one
 * client's journey: an enquiry plus the proposals raised for it (or a
 * standalone proposal with no parent enquiry). One card per deal.
 *
 * Columns reflect the actual workflow stage, derived from data:
 *   To quote  → enquiry exists, no active proposals raised
 *   Quoted    → proposals raised, none sent yet (all Draft)
 *   Sent      → some proposal sent / viewed, none yet Interested
 *   Interested→ a proposal flipped to Interested
 *   Closed    → enquiry manually marked booked / cancelled, or all
 *               proposals expired / archived (collapsed at the bottom)
 *
 * Kanban + Table toggle; search by client / property / ref code; stale
 * indicators surface enquiries sitting un-quoted and Draft proposals
 * sitting un-sent.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import DataTable, { StatusBadge } from '../components/DataTable';
import DetailModal, { DetailModalSection } from '../components/DetailModal';
import type { DataRow } from '../components/DataTable';
import NewProposalLauncher from '../components/NewProposalLauncher';
import ProposalDetailModal from '../components/ProposalDetailModal';
import SendProposalDialog from '../components/SendProposalDialog';
import { CT_RENTALS_PARTNER_ID } from './constants';
import { fmtRand } from '../lib/pricingEngine';
import { notifyPipelineChanged, onPipelineChanged } from '../lib/pipelineEvents';
import type { EnquiryPrefill } from '../components/CreateProposalModal';

// ─── Data shapes ────────────────────────────────────────────────────────

interface ProposalRow {
  id: string;
  ref_code: string;
  property_id: string;
  property_name: string;
  pricing_proposal_id: string | null;
  status: string;
  is_agent: boolean;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  check_in: string | null;
  check_out: string | null;
  guests_total: number | null;
  notes: string | null;
  created_at: string;
  sent_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
  guest_price: number | null;
  scenario_type: string | null;
  season_tag: string | null;
  owner_net: number | null;
  company_take: number | null;
  agents: Array<{ id: string; pct: number }> | null;
}

interface EnquirySide {
  id: string;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  check_in: string;
  check_out: string;
  bedrooms_needed: number;
  guests_total: number;
  guests_adults: number | null;
  guests_children: number | null;
  nationality: string | null;
  budget_min: number | null;
  budget_max: number | null;
  notes: string | null;
  status: string;
  /** Pipeline-level status driving the kanban column. Present once the
   *  workflow rebuild migration has been applied; absent on older rows,
   *  in which case dealStage() derives it from status + linked proposals. */
  deal_status: string | null;
  created_at: string;
}

interface Deal {
  /** Unique key. Enquiry id for enquiry-rooted deals, "p-{proposalId}" for
   *  standalone proposal deals (created from the FAB without an enquiry). */
  key: string;
  type: 'enquiry' | 'standalone';
  enquiry: EnquirySide | null;
  proposals: ProposalRow[];
  // Surface fields for sort / search / card display:
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  check_in: string | null;
  check_out: string | null;
  guests_total: number | null;
  created_at: string;
  /** Manual status on the enquiry side, if any — independent of the
   *  derived Kanban stage (so the ladies can mark booked / cancelled
   *  without auto-derivation getting it wrong via agents). */
  manual_status: string | null;
  is_agent: boolean;
}

const STAGES = [
  { key: 'new',        label: 'New',        description: 'Arrived, untouched',           emptyMsg: 'Nothing new' },
  { key: 'drafting',   label: 'Drafting',   description: 'Proposal being written',       emptyMsg: 'No drafts in flight' },
  { key: 'ready',      label: 'Ready',      description: 'Written, awaiting send',       emptyMsg: 'Nothing ready' },
  { key: 'sent',       label: 'Sent',       description: 'Out with the client',          emptyMsg: 'Nothing awaiting response' },
  { key: 'stalled',    label: 'Stalled',    description: '5+ days no client response',   emptyMsg: 'Nothing stalled' },
  { key: 'interested', label: 'Interested', description: 'Client engaged, close it',     emptyMsg: 'No live leads' },
  { key: 'won',        label: 'Won',        description: 'Booked',                       emptyMsg: 'No wins yet' },
  { key: 'lost',       label: 'Lost',       description: 'Closed, not booked',           emptyMsg: 'No losses' },
] as const;

/** Top-border accent per stage. References CSS tokens defined in app.css
 *  so colour theming stays in one place if the brand palette shifts. */
const STAGE_ACCENT: Record<string, string> = {
  new:        'var(--info)',
  drafting:   'var(--text-secondary)',
  ready:      'var(--warning)',
  sent:       'var(--info)',
  stalled:    'var(--color-accent-warm)',
  interested: 'var(--success)',
  won:        'var(--color-primary)',
  lost:       'var(--text-light)',
};

/** Cards are dense by default (two-row layout: client + price; dates +
 *  property + action). Once a column tips past this, switch to an even
 *  tighter single-row variant. The full info is always one click away. */
const COMPACT_THRESHOLD = 12;

const PROPOSAL_STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  draft: { label: 'Draft', bg: '#F3F4F6', color: '#6B7280' },
  sent: { label: 'Sent', bg: '#DBEAFE', color: '#1E40AF' },
  viewed: { label: 'Viewed', bg: '#E0E7FF', color: '#3730A3' },
  interested: { label: 'Interested', bg: '#D1FAE5', color: '#065F46' },
  expired: { label: 'Expired', bg: '#FEE2E2', color: '#991B1B' },
};

const STALE_DAYS = 3;
/** A deal in Sent for this many days auto-flips visually to Stalled.
 *  Pre-migration this is computed from the newest proposal's sent_at;
 *  post-migration it can be driven by stored deal_status. */
const STALLED_DAYS = 5;

// ─── Helpers ────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

function fmtDateLong(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

/** Normalise free-text user input to Title Case so "hayley", "HAYLEY"
 *  and "HaYley" all render as "Hayley". Handles spaces, hyphens and
 *  apostrophes (Jean-Paul, O'Brien) without bespoke logic. */
function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

function nightsBetween(checkIn: string | null, checkOut: string | null): number | null {
  if (!checkIn || !checkOut) return null;
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return ms > 0 ? Math.round(ms / (1000 * 60 * 60 * 24)) : null;
}

function fmtRelative(iso: string): string {
  const days = daysSince(iso);
  if (days < 1) return 'Today';
  if (days === 1) return '1d ago';
  if (days < 7) return `${days}d ago`;
  if (days < 14) return '1w ago';
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 60) return '1mo ago';
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// Proposal statuses that no longer drive deal activity. Includes BOTH
// the pre-migration values (expired, archived, booked, cancelled) and the
// post-migration values (accepted, declined) so the kanban works on either.
const INACTIVE_PROPOSAL_STATUSES = new Set([
  'expired', 'archived', 'booked', 'cancelled',  // pre-migration
  'accepted', 'declined',                         // post-migration
]);

type StageKey = typeof STAGES[number]['key'];

/** Derive which Kanban column the deal belongs in.
 *
 * Source of truth: enquiry.deal_status if present (post-migration). For
 * enquiry-rooted deals with no deal_status yet, or for standalone
 * proposals, we fall back to a derivation from manual_status + proposal
 * states. The fallback is identical to the SQL UPDATE in the workflow
 * rebuild migration, so the visual result is the same before and after.
 */
function dealStage(d: Deal): StageKey {
  // 1. Stored deal_status takes priority once migration is applied.
  const stored = d.enquiry?.deal_status;
  if (stored && STAGES.some(s => s.key === stored)) {
    return stored as StageKey;
  }

  // 2. Manual outcomes set directly on the enquiry.
  if (d.manual_status === 'booked')    return 'won';
  if (d.manual_status === 'cancelled') return 'lost';

  // 3. Look at proposals.
  const active = d.proposals.filter(p => !INACTIVE_PROPOSAL_STATUSES.has(p.status));

  // Standalone deals lose if their lone proposal is finished.
  if (d.type === 'standalone' && active.length === 0) {
    const onlyAccepted = d.proposals.some(p => p.status === 'accepted' || p.status === 'booked');
    return onlyAccepted ? 'won' : 'lost';
  }

  // Enquiry-rooted with no active proposals: still waiting for someone
  // on our side to do something.
  if (active.length === 0) return 'new';

  // Post-migration: any proposal in 'ready' raises the deal to Ready.
  if (active.some(p => p.status === 'ready')) return 'ready';

  // Pre-migration 'interested' on a proposal → deal-level Interested.
  // Post-migration: only the deal_status drives Interested, so this branch
  // is harmless because no proposal status would equal 'interested' once
  // the migration has run.
  if (active.some(p => p.status === 'interested')) return 'interested';

  // Anything sent (or pre-migration viewed) puts the deal in Sent unless
  // it's been sitting too long, in which case Stalled.
  const sentish = active.filter(p => p.status === 'sent' || p.status === 'viewed');
  if (sentish.length > 0) {
    const newestSent = Math.max(...sentish.map(p =>
      p.sent_at ? new Date(p.sent_at).getTime() : new Date(p.created_at).getTime()
    ));
    const daysSent = (Date.now() - newestSent) / (1000 * 60 * 60 * 24);
    return daysSent >= STALLED_DAYS ? 'stalled' : 'sent';
  }

  // Drafts only — still being written.
  return 'drafting';
}

/** Build the EnquiryPrefill payload used by NewProposalLauncher. */
function prefillFromDeal(d: Deal): EnquiryPrefill | null {
  if (!d.enquiry) return null;
  return {
    id: d.enquiry.id,
    client_name: d.enquiry.client_name,
    client_email: d.enquiry.client_email,
    client_phone: d.enquiry.client_phone,
    check_in: d.enquiry.check_in,
    check_out: d.enquiry.check_out,
    guests_total: d.enquiry.guests_total,
    notes: d.enquiry.notes,
  };
}

function mapProposalRow(p: any): ProposalRow {
  return {
    id: p.id,
    ref_code: p.ref_code,
    property_id: p.property_id,
    property_name: p.partner_properties?.property_name || '—',
    pricing_proposal_id: p.pricing_proposal_id,
    status: p.status,
    is_agent: p.is_agent,
    guest_name: p.guest_name,
    guest_email: p.guest_email,
    guest_phone: p.guest_phone,
    check_in: p.check_in,
    check_out: p.check_out,
    guests_total: p.guests_total,
    notes: p.notes,
    created_at: p.created_at,
    sent_at: p.sent_at,
    viewed_at: p.viewed_at,
    accepted_at: p.accepted_at,
    guest_price: p.pricing_proposals?.client_price_excl_vat ?? null,
    scenario_type: p.pricing_proposals?.scenario_type ?? null,
    season_tag: p.pricing_proposals?.season_tag ?? null,
    owner_net: p.pricing_proposals?.owner_net ?? null,
    company_take: p.pricing_proposals?.company_take ?? null,
    agents: p.pricing_proposals?.agents ?? null,
  };
}

// ─── Page ───────────────────────────────────────────────────────────────

export default function PipelinePage() {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();

  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'board' | 'list'>('board');
  // Search can be pre-filled from URL — Home links land users here with
  // ?search=<client name> so the deal they care about pops out of the list.
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [search, setSearch] = useState(searchParams.get('search') || '');

  // Filter state. Two filters per page is the agreed placeholder pattern
  // across the Ops module so users can see how the controls feel before
  // we lock down the final set.
  const [stageFilter, setStageFilter] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<string>('');
  // Per-board-column sort. Empty / 'smart' uses the per-stage default;
  // any other value overrides for that one column.
  const [columnSort, setColumnSort] = useState<Record<string, string>>({});

  // Drill-in state
  const [openDeal, setOpenDeal] = useState<{ deal: Deal; mode: 'view' | 'edit' } | null>(null);
  const openDealInMode = (deal: Deal, mode: 'view' | 'edit' = 'view') => setOpenDeal({ deal, mode });
  const [openProposal, setOpenProposal] = useState<ProposalRow | null>(null);
  const [launcherFor, setLauncherFor] = useState<EnquiryPrefill | null>(null);
  /** When set, the launcher opens with no enquiry — for the "+ Standalone
   *  proposal" path. Distinct from launcherFor so the launcher knows the
   *  difference between "no enquiry" and "not open". */
  const [launcherStandalone, setLauncherStandalone] = useState(false);
  /** The single-draft proposal selected for the quick Send dialog. */
  const [sendingProposal, setSendingProposal] = useState<ProposalRow | null>(null);

  useEffect(() => { setPageTitle('Enquiries'); }, [setPageTitle]);

  // Honour Home's deep-link: ?stage=<key> flashes a highlight on that column
  // so the user lands on the one they came to act on. We scroll it into
  // view (desktop layout is fixed 4-wide so this only really matters on
  // narrower viewports, but it's free safety). The param is cleared once
  // applied so a refresh doesn't keep re-flashing it.
  const stageFromUrl = searchParams.get('stage');
  const [flashStage, setFlashStage] = useState<string | null>(null);
  useEffect(() => {
    if (!stageFromUrl) return;
    setFlashStage(stageFromUrl);
    const next = new URLSearchParams(searchParams);
    next.delete('stage');
    setSearchParams(next, { replace: true });
    const t = setTimeout(() => setFlashStage(null), 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageFromUrl]);

  async function fetchDeals() {
    setLoading(true);
    const [enqRes, standaloneRes] = await Promise.all([
      // Enquiries with all their proposals + property + pricing joined.
      supabase
        .from('enquiries')
        .select('*, proposals(*, partner_properties(property_name), pricing_proposals(client_price_excl_vat, scenario_type, season_tag, owner_net, company_take, agents))')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .order('created_at', { ascending: false }),
      // Proposals created without an enquiry (FAB flow) — these are deals
      // in their own right.
      supabase
        .from('proposals')
        .select('*, partner_properties(property_name), pricing_proposals(client_price_excl_vat, scenario_type, season_tag, owner_net, company_take, agents)')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .is('enquiry_id', null)
        .order('created_at', { ascending: false }),
    ]);

    const fromEnquiries: Deal[] = (enqRes.data || []).map((e: any) => ({
      key: e.id,
      type: 'enquiry',
      enquiry: {
        id: e.id,
        client_name: e.client_name,
        client_email: e.client_email,
        client_phone: e.client_phone,
        check_in: e.check_in,
        check_out: e.check_out,
        bedrooms_needed: e.bedrooms_needed,
        guests_total: e.guests_total,
        guests_adults: e.guests_adults,
        guests_children: e.guests_children,
        nationality: e.nationality,
        budget_min: e.budget_min,
        budget_max: e.budget_max,
        notes: e.notes,
        status: e.status,
        deal_status: e.deal_status ?? null,
        created_at: e.created_at,
      },
      proposals: (e.proposals || []).map(mapProposalRow),
      client_name: e.client_name,
      client_email: e.client_email,
      client_phone: e.client_phone,
      check_in: e.check_in,
      check_out: e.check_out,
      guests_total: e.guests_total,
      created_at: e.created_at,
      manual_status: e.status,
      is_agent: (e.proposals || []).some((p: any) => p.is_agent),
    }));

    const fromStandalone: Deal[] = (standaloneRes.data || []).map((p: any) => {
      const row = mapProposalRow(p);
      return {
        key: `p-${p.id}`,
        type: 'standalone',
        enquiry: null,
        proposals: [row],
        client_name: row.guest_name,
        client_email: row.guest_email,
        client_phone: row.guest_phone,
        check_in: row.check_in,
        check_out: row.check_out,
        guests_total: row.guests_total,
        created_at: row.created_at,
        manual_status: null,
        is_agent: row.is_agent,
      };
    });

    // Most-recent activity first. For enquiry deals, use the latest of
    // enquiry created_at and any proposal created_at so a fresh quote
    // bumps an old enquiry back to the top.
    const merged = [...fromEnquiries, ...fromStandalone];
    merged.sort((a, b) => {
      const aTime = Math.max(new Date(a.created_at).getTime(), ...a.proposals.map(p => new Date(p.created_at).getTime()));
      const bTime = Math.max(new Date(b.created_at).getTime(), ...b.proposals.map(p => new Date(p.created_at).getTime()));
      return bTime - aTime;
    });
    setDeals(merged);
    setLoading(false);
  }

  useEffect(() => { if (supabase) fetchDeals(); }, [supabase]);

  // Refetch whenever anywhere in the app writes a proposal/enquiry — the
  // FAB-launched proposal flow, the new-enquiry form, status flips from
  // ProposalDetailModal, all dispatch a window event we subscribe to.
  // Without this the Kanban stays stale until the user hits Refresh.
  useEffect(() => onPipelineChanged(() => { fetchDeals(); }), [supabase]);

  // ── Filtering + sorting ──
  const filtered = useMemo(() => {
    let result = deals;

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(d => {
        if (d.client_name?.toLowerCase().includes(q)) return true;
        if (d.client_email?.toLowerCase().includes(q)) return true;
        return d.proposals.some(p =>
          p.property_name.toLowerCase().includes(q) ||
          p.ref_code.toLowerCase().includes(q)
        );
      });
    }

    // Stage filter
    if (stageFilter) {
      result = result.filter(d => dealStage(d) === stageFilter);
    }

    // Date filter
    if (dateFilter === 'has-dates') {
      result = result.filter(d => d.check_in && d.check_out);
    } else if (dateFilter === 'next-30') {
      const now = Date.now();
      const cutoff = now + 30 * 24 * 60 * 60 * 1000;
      result = result.filter(d => {
        if (!d.check_in) return false;
        const t = new Date(d.check_in).getTime();
        return t >= now && t <= cutoff;
      });
    } else if (dateFilter === 'past') {
      const now = Date.now();
      result = result.filter(d => {
        if (!d.check_in) return false;
        return new Date(d.check_in).getTime() < now;
      });
    }

    return result;
  }, [deals, search, stageFilter, dateFilter]);

  const byStage = useMemo(() => {
    const map: Record<string, Deal[]> = {
      new: [], drafting: [], ready: [], sent: [], stalled: [], interested: [], won: [], lost: [],
    };
    for (const d of filtered) {
      map[dealStage(d)].push(d);
    }
    // Comparator helpers, used by both the smart-default sort and the
    // per-column override sort.
    const byCheckIn = (a: Deal, b: Deal) => {
      if (!a.check_in && !b.check_in) return 0;
      if (!a.check_in) return 1;
      if (!b.check_in) return -1;
      return a.check_in.localeCompare(b.check_in);
    };
    const byOldest = (a: Deal, b: Deal) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    const byNewest = (a: Deal, b: Deal) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    const byClient = (a: Deal, b: Deal) =>
      (a.client_name || '').localeCompare(b.client_name || '');
    const oldestDraftAt = (d: Deal) => {
      const drafts = d.proposals
        .filter(p => p.status === 'draft' || p.status === 'drafting')
        .map(p => new Date(p.created_at).getTime());
      return drafts.length ? Math.min(...drafts) : Number.POSITIVE_INFINITY;
    };

    // For each column, pick its sort: explicit override > smart default.
    for (const stage of STAGES) {
      const sort = columnSort[stage.key] || 'smart';
      const list = map[stage.key];
      if (sort === 'newest')           list.sort(byNewest);
      else if (sort === 'oldest')      list.sort(byOldest);
      else if (sort === 'check-in')    list.sort(byCheckIn);
      else if (sort === 'client')      list.sort(byClient);
      else {
        // Smart default per stage:
        //   New        → oldest waiting (priority)
        //   Drafting   → oldest draft (lingered)
        //   Ready      → oldest (don't pile up)
        //   Sent       → soonest check-in (closing window)
        //   Stalled    → oldest (most overdue first)
        //   Interested → soonest check-in (close fast)
        //   Won / Lost → recent first
        if (stage.key === 'new')             list.sort(byOldest);
        else if (stage.key === 'drafting')   list.sort((a, b) => oldestDraftAt(a) - oldestDraftAt(b));
        else if (stage.key === 'ready')      list.sort(byOldest);
        else if (stage.key === 'sent')       list.sort(byCheckIn);
        else if (stage.key === 'stalled')    list.sort(byOldest);
        else if (stage.key === 'interested') list.sort(byCheckIn);
        else                                  list.sort(byNewest);
      }
    }
    return map;
  }, [filtered, columnSort]);

  // ── Handlers ──
  function startQuote(d: Deal) {
    setOpenDeal(null);
    if (d.enquiry) {
      setLauncherFor(prefillFromDeal(d));
    } else {
      setLauncherStandalone(true);
    }
  }

  /** Card-level Send action: if the deal has exactly one Draft proposal,
   *  open the quick Send dialog. If it has more, open the deal detail
   *  modal so the user picks which to send. */
  function startSend(d: Deal) {
    const drafts = d.proposals.filter(p => p.status === 'draft');
    if (drafts.length === 1) {
      setSendingProposal(drafts[0]);
    } else {
      openDealInMode(d, 'view');
    }
  }

  /** Insert a bookings row for a deal that's just been marked Won.
   *  Skips quietly if a booking for this enquiry already exists, so the
   *  Mark Booked action can be safely retried. */
  async function createBookingFromDeal(deal: Deal) {
    if (deal.enquiry) {
      const existing = await supabase
        .from('bookings')
        .select('id')
        .eq('enquiry_id', deal.enquiry.id)
        .maybeSingle();
      if (existing.data) return;
    }
    // Pick the most-recently-active proposal as the booking source. Falls
    // back to whatever's first so we always have a property + price.
    const featured =
      deal.proposals.find(p =>
        ['interested', 'sent', 'viewed', 'accepted', 'booked'].includes(p.status),
      ) ||
      deal.proposals[0];
    if (!featured) return;

    const e = deal.enquiry;
    await supabase.from('bookings').insert({
      partner_id: CT_RENTALS_PARTNER_ID,
      property_id: featured.property_id,
      enquiry_id: e?.id ?? null,
      guest_name: featured.guest_name || e?.client_name || '',
      guest_email: featured.guest_email ?? e?.client_email ?? null,
      guest_phone: featured.guest_phone ?? e?.client_phone ?? null,
      guest_nationality: e?.nationality ?? null,
      guests_total: featured.guests_total ?? e?.guests_total ?? 1,
      guests_adults: e?.guests_adults ?? null,
      guests_children: e?.guests_children ?? null,
      check_in: featured.check_in ?? e?.check_in,
      check_out: featured.check_out ?? e?.check_out,
      total_amount: featured.guest_price ?? null,
      currency: 'ZAR',
      status: 'confirmed',
    });
  }

  async function updateEnquiryStatus(enquiryId: string, status: string) {
    await supabase
      .from('enquiries')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', enquiryId);
    if (status === 'booked') {
      const deal = deals.find(d => d.enquiry?.id === enquiryId);
      if (deal) await createBookingFromDeal(deal);
    }
    // Close the modal so the user sees the card slide to its new column,
    // the action feels definitive that way. They can reopen if they need to.
    setOpenDeal(null);
    notifyPipelineChanged();
  }

  /** Outcome mutation for standalone-proposal deals (no enquiry to flip),
   *  so the proposal itself carries the booked/cancelled marker. */
  async function updateProposalOutcome(proposalId: string, outcome: 'booked' | 'cancelled' | 'draft') {
    await supabase
      .from('proposals')
      .update({ status: outcome })
      .eq('id', proposalId);
    if (outcome === 'booked') {
      const deal = deals.find(d => d.proposals.some(p => p.id === proposalId));
      if (deal) await createBookingFromDeal(deal);
    }
    setOpenDeal(null);
    notifyPipelineChanged();
  }

  // ── Render ──
  return (
    <div>
      {/* Toolbar — shared shape with the Proposals page so the two Ops
          pages feel paired. View toggle sits on the left as the primary
          context-switch; filters and search next; New button anchors the
          far right as the only "make something" action. */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            <div className="view-toggle">
              <button
                className={`view-toggle-btn ${view === 'board' ? 'active' : ''}`}
                onClick={() => setView('board')}
                title="Board view"
              >
                ▦ Board
              </button>
              <button
                className={`view-toggle-btn ${view === 'list' ? 'active' : ''}`}
                onClick={() => setView('list')}
                title="List view"
              >
                ☰ List
              </button>
            </div>
            <select
              className="list-filter-select"
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              title="Filter by stage"
            >
              <option value="">All stages</option>
              {STAGES.map(s => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
            <select
              className="list-filter-select"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              title="Filter by check-in date"
            >
              <option value="">Any dates</option>
              <option value="has-dates">Has dates</option>
              <option value="next-30">Next 30 days</option>
              <option value="past">Past check-in</option>
            </select>
            <div className="list-search">
              <span className="list-search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search by client, property, ref code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button className="list-search-clear" onClick={() => setSearch('')}>✕</button>
              )}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
              {filtered.length} of {deals.length}
            </span>
          </div>
          <div className="list-toolbar-right">
            <button
              className="btn btn-primary"
              onClick={() => { window.location.href = '/enquiry/new'; }}
            >
              + New Enquiry
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="page-loader"><div className="spinner" /></div>
      ) : view === 'board' ? (
        <KanbanView
          byStage={byStage}
          columnSort={columnSort}
          onColumnSortChange={(stage, value) =>
            setColumnSort(prev => ({ ...prev, [stage]: value }))
          }
          onOpen={(d) => openDealInMode(d, 'view')}
          onQuote={startQuote}
          onSend={startSend}
          flashStage={flashStage}
        />
      ) : (
        <TableView
          deals={filtered}
          loading={loading}
          onOpen={openDealInMode}
        />
      )}

      {/* Deal detail */}
      {openDeal && (
        <DealDetailModal
          deal={openDeal.deal}
          initialMode={openDeal.mode}
          onClose={() => setOpenDeal(null)}
          onQuote={() => startQuote(openDeal.deal)}
          onUpdateStatus={updateEnquiryStatus}
          onUpdateProposalOutcome={updateProposalOutcome}
          onOpenProposal={setOpenProposal}
        />
      )}

      {/* Per-proposal detail */}
      {openProposal && (
        <ProposalDetailModal
          proposal={{
            ...openProposal,
            property_name: openProposal.property_name,
          }}
          supabase={supabase}
          onClose={() => setOpenProposal(null)}
          onChange={fetchDeals}
        />
      )}

      {/* Quote flow (with enquiry pre-fill) */}
      {launcherFor && (
        <NewProposalLauncher
          enquiryPrefill={launcherFor}
          onClose={() => { setLauncherFor(null); fetchDeals(); }}
        />
      )}

      {/* Quote flow (standalone) */}
      {launcherStandalone && (
        <NewProposalLauncher
          onClose={() => { setLauncherStandalone(false); fetchDeals(); }}
        />
      )}

      {/* Quick Send confirmation — moves the card to Sent on confirm */}
      {sendingProposal && (
        <SendProposalDialog
          proposal={sendingProposal}
          supabase={supabase}
          onClose={() => setSendingProposal(null)}
          onSent={() => { setSendingProposal(null); fetchDeals(); }}
        />
      )}

    </div>
  );
}

// ─── Kanban ─────────────────────────────────────────────────────────────

function KanbanView({
  byStage, columnSort, onColumnSortChange, onOpen, onQuote, onSend, flashStage,
}: {
  byStage: Record<string, Deal[]>;
  columnSort: Record<string, string>;
  onColumnSortChange: (stage: string, value: string) => void;
  onOpen: (d: Deal) => void;
  onQuote: (d: Deal) => void;
  onSend: (d: Deal) => void;
  flashStage?: string | null;
}) {
  return (
    <div className="ops-board">
      {STAGES.map(col => (
        <div
          key={col.key}
          className={`ops-board-column ${flashStage === col.key ? 'ops-board-column--flash' : ''}`}
        >
          <div
            className="ops-board-column-header"
            style={{ borderTopColor: STAGE_ACCENT[col.key] ?? 'var(--text-light)' }}
          >
            <div className="ops-board-column-header-top">
              <span className="ops-board-column-label">{col.label}</span>
              <span className="ops-board-column-count">{byStage[col.key].length}</span>
            </div>
            <div className="ops-board-column-header-bottom">
              <span className="ops-board-column-sub">{col.description}</span>
              <select
                className="ops-board-column-sort"
                value={columnSort[col.key] || 'smart'}
                onChange={(e) => onColumnSortChange(col.key, e.target.value)}
                title="Sort this column"
              >
                <option value="smart">Smart</option>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="check-in">Check-in</option>
                <option value="client">Client A-Z</option>
              </select>
            </div>
          </div>
          <KanbanColumnBody
            deals={byStage[col.key]}
            stage={col.key}
            emptyMsg={col.emptyMsg}
            onOpen={onOpen}
            onQuote={onQuote}
            onSend={onSend}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Kanban column body (scroll + overflow affordance) ────────────────
// A wrapper around the scrollable list of cards that detects when more
// content sits below the fold and surfaces:
//   • a bottom-edge fade so the cut-off feels intentional
//   • a sticky "↓ N more" pill the user can click to jump to the bottom
// Without these, the auto-hiding macOS scrollbar leaves overflow completely
// invisible on first load — exactly the bug the user was hitting.

function KanbanColumnBody({
  deals, stage, emptyMsg, onOpen, onQuote, onSend,
}: {
  deals: Deal[];
  stage: string;
  emptyMsg: string;
  onOpen: (d: Deal) => void;
  onQuote: (d: Deal) => void;
  onSend: (d: Deal) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ hasMore: false, hiddenBelow: 0 });
  const compact = deals.length > COMPACT_THRESHOLD;

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;

    const update = () => {
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
      const overflows = el.scrollHeight > el.clientHeight + 2;
      let hidden = 0;
      if (overflows && !atBottom) {
        const visibleBottom = el.scrollTop + el.clientHeight;
        for (const child of Array.from(el.children) as HTMLElement[]) {
          if (child.offsetTop + child.offsetHeight / 2 > visibleBottom) hidden++;
        }
      }
      setOverflow({ hasMore: overflows && !atBottom, hiddenBelow: hidden });
    };

    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
    // Re-run when the deal list changes — adding / removing cards changes
    // whether the column overflows.
  }, [deals.length]);

  function scrollToBottom() {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }

  return (
    <div className="ops-board-column-body" ref={bodyRef}>
      {deals.length === 0 ? (
        <div className="ops-board-empty">{emptyMsg}</div>
      ) : (
        <>
          {deals.map(d => (
            <DealCard
              key={d.key}
              deal={d}
              stage={stage}
              onOpen={onOpen}
              onQuote={onQuote}
              onSend={onSend}
              compact={compact}
            />
          ))}
          {overflow.hasMore && (
            <button
              type="button"
              className="ops-board-action"
              onClick={scrollToBottom}
              title="Scroll to see hidden cards"
              style={{ marginTop: '4px' }}
            >
              ↓ {overflow.hiddenBelow} more
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─── Deal card ──────────────────────────────────────────────────────────

function DealCard({
  deal, stage, onOpen, onQuote, onSend, closed, compact,
}: {
  deal: Deal;
  stage: string;
  onOpen: (d: Deal) => void;
  onQuote: (d: Deal) => void;
  onSend: (d: Deal) => void;
  closed?: boolean;
  compact?: boolean;
}) {
  const isClosed = closed || stage === 'won' || stage === 'lost';
  const isStale = stage === 'new' && daysSince(deal.created_at) >= STALE_DAYS;
  const stop = (fn: (e: React.MouseEvent) => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(e); };

  // For Sent column, surface a viewed badge if any proposal's been opened.
  const wasViewed = (stage === 'sent' || stage === 'stalled') &&
    deal.proposals.some(p => p.status === 'viewed' || p.viewed_at);

  // Card primary action depends on stage:
  //   New        → "Create Proposal" (opens the quote flow)
  //   Drafting / Ready → "Send proposal" (drives the deal toward Sent)
  //   Sent / Stalled / Interested → "+ Add proposal" (secondary action)
  //   Won / Lost → no primary (closed)
  const draftCount = deal.proposals.filter(p =>
    p.status === 'draft' || p.status === 'drafting'
  ).length;
  let primary: { label: string; onClick: () => void } | null = null;
  if (!isClosed) {
    if (stage === 'new') {
      primary = { label: '📝 Create Proposal', onClick: () => onQuote(deal) };
    } else if (stage === 'drafting' || stage === 'ready') {
      primary = {
        label: draftCount > 1 ? `📤 Send proposals (${draftCount})` : '📤 Send proposal',
        onClick: () => onSend(deal),
      };
    } else {
      // sent / stalled / interested
      primary = { label: '+ Add proposal', onClick: () => onQuote(deal) };
    }
  }

  // Pick the proposal to feature in the card headline — prefer an active
  // one, fall back to whatever's first. Standalone deals only ever have one
  // proposal, so this is a no-op for them.
  const featured = deal.proposals.find(p => !INACTIVE_PROPOSAL_STATUSES.has(p.status)) || deal.proposals[0] || null;
  const featuredPrice = featured?.guest_price ?? null;
  const featuredProperty = featured?.property_name;
  const extraProposals = Math.max(0, deal.proposals.length - 1);

  return (
    <div
      className={`ops-board-card ${isStale ? 'ops-board-card--stale' : ''}`}
      onClick={() => onOpen(deal)}
    >
      <div className="ops-board-card-head">
        <span className="ops-board-card-client" title={deal.client_name}>
          {titleCase(deal.client_name)}
        </span>
        {featuredPrice != null ? (
          <span className="ops-board-card-amount">{fmtRand(featuredPrice)}</span>
        ) : (
          <span
            className="ops-board-card-amount"
            style={{ color: 'var(--text-light)' }}
            title={deal.type === 'standalone' ? 'Standalone proposal, no enquiry' : 'From enquiry'}
          >
            {deal.type === 'standalone' ? '★' : '✉'}
          </span>
        )}
      </div>

      {(deal.is_agent || wasViewed) && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          {deal.is_agent && <span className="ops-board-card-tag ops-board-card-tag--agent">Agent</span>}
          {wasViewed && <span className="ops-board-card-tag ops-board-card-tag--viewed">Viewed</span>}
        </div>
      )}

      {featuredProperty && (
        <div className="ops-board-card-property" title={featuredProperty}>{titleCase(featuredProperty)}</div>
      )}

      <div className="ops-board-card-meta">
        {deal.check_in && deal.check_out
          ? <span>{fmtDate(deal.check_in)} to {fmtDate(deal.check_out)}</span>
          : <span style={{ fontStyle: 'italic' }}>No dates</span>}
        {extraProposals > 0 && <span>· +{extraProposals} more</span>}
        <span style={{ flex: 1 }} />
        {(() => {
          const days = daysSince(deal.created_at);
          if (days < 1) return null;
          const cls = days >= 10 ? 'ops-board-card-days--hot'
            : days >= 5 ? 'ops-board-card-days--warn' : '';
          return <span className={`ops-board-card-days ${cls}`}>{days}d</span>;
        })()}
      </div>

      {primary && (
        <div className="ops-board-card-actions">
          <button
            className="ops-board-action ops-board-action--primary"
            onClick={stop(primary.onClick)}
          >
            {primary.label}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Table view ─────────────────────────────────────────────────────────

interface TableRow extends DataRow {
  key: string;
  type: 'enquiry' | 'standalone';
  deal: Deal;
  client_name: string;
  property: string;
  check_in: string | null;
  check_out: string | null;
  nights: number | null;
  guests_total: number | null;
  proposals_count: number;
  stage: string;
  manual_status: string | null;
  created_at: string;
}

function TableView({ deals, loading, onOpen }: { deals: Deal[]; loading: boolean; onOpen: (d: Deal, mode?: 'view' | 'edit') => void }) {
  const rows: TableRow[] = deals.map(d => {
    const featured = d.proposals.find(p => !INACTIVE_PROPOSAL_STATUSES.has(p.status)) || d.proposals[0];
    return {
      key: d.key,
      type: d.type,
      deal: d,
      client_name: d.client_name,
      property: featured?.property_name ?? '',
      check_in: d.check_in,
      check_out: d.check_out,
      nights: nightsBetween(d.check_in, d.check_out),
      guests_total: d.guests_total,
      proposals_count: d.proposals.length,
      stage: dealStage(d),
      manual_status: d.manual_status,
      created_at: d.created_at,
    };
  });

  const columns = [
    {
      key: 'client_name', label: 'Client', sortable: true,
      render: (row: DataRow) => {
        const r = row as TableRow;
        const email = r.deal.client_email;
        const name = titleCase(r.client_name);
        return (
          <div className="list-client-text">
            <span className="list-client-name" title={name}>
              {name}
              {r.deal.is_agent && <span className="ops-board-card-tag ops-board-card-tag--agent" style={{ marginLeft: 6 }}>Agent</span>}
              {r.type === 'standalone' && <span style={{ fontSize: '0.625rem', color: 'var(--text-light)', marginLeft: 6 }} title="Standalone proposal, no enquiry">★</span>}
            </span>
            {email && <span className="list-client-meta" title={email}>{email.toLowerCase()}</span>}
          </div>
        );
      },
    },
    {
      key: 'property', label: 'Property', sortable: true, hideOnMobile: true,
      render: (row: DataRow) => {
        const r = row as TableRow;
        const featured = r.deal.proposals.find(p => !INACTIVE_PROPOSAL_STATUSES.has(p.status)) || r.deal.proposals[0];
        const name = featured?.property_name ? titleCase(featured.property_name) : null;
        return name
          ? <span className="list-property" title={name}>{name}</span>
          : <span className="list-dates-empty">—</span>;
      },
    },
    {
      key: 'check_in', label: 'Dates', sortable: true,
      render: (row: DataRow) => {
        const r = row as TableRow;
        if (!r.check_in || !r.check_out) return <span className="list-dates-empty">No dates</span>;
        return (
          <span className="list-dates">
            {fmtDate(r.check_in)}<span className="list-dates-arrow">→</span>{fmtDate(r.check_out)}
          </span>
        );
      },
    },
    {
      key: 'nights', label: 'Nights', align: 'center' as const, width: '80px', sortable: true,
      render: (row: DataRow) => {
        const r = row as TableRow;
        const n = nightsBetween(r.check_in, r.check_out);
        return n != null ? n : <span className="list-dates-empty">—</span>;
      },
    },
    {
      key: 'proposals_count', label: 'Props', align: 'center' as const, width: '70px', sortable: true,
      render: (row: DataRow) => {
        const r = row as TableRow;
        const color = r.proposals_count === 0 ? '#92400E' : '#065F46';
        const bg = r.proposals_count === 0 ? '#FEF3C7' : '#D1FAE5';
        return <span className="status-badge" style={{ background: bg, color }}>{r.proposals_count}</span>;
      },
    },
    {
      key: 'stage', label: 'Stage', align: 'center' as const, sortable: true,
      render: (row: DataRow) => {
        const r = row as TableRow;
        const label = STAGES.find(s => s.key === r.stage)?.label || r.stage;
        return (
          <span className={`ops-status-pill ops-status-pill--${r.stage}`}>
            <span className="ops-status-pill-dot" />
            {label}
          </span>
        );
      },
    },
    {
      key: 'created_at', label: 'Created', sortable: true, hideOnMobile: true,
      render: (row: DataRow) => (
        <span className="list-relative" title={fmtDateLong((row as TableRow).created_at)}>
          {fmtRelative((row as TableRow).created_at)}
        </span>
      ),
    },
    {
      key: 'actions', label: '', align: 'right' as const, width: '90px',
      render: (row: DataRow) => (
        <div className="list-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="list-action-icon"
            title="View deal"
            onClick={() => onOpen((row as TableRow).deal, 'view')}
          >
            👁
          </button>
          <button
            type="button"
            className="list-action-icon"
            title="Edit deal"
            onClick={() => onOpen((row as TableRow).deal, 'edit')}
          >
            ✏️
          </button>
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      loading={loading}
      searchable={false}
      resultsBarContent={null}
      defaultSort={{ key: 'created_at', direction: 'desc' }}
      onRowClick={(row: DataRow) => onOpen((row as TableRow).deal, 'view')}
      pageSize={25}
      emptyMessage="No deals yet. Create an enquiry or use the FAB to start a proposal."
    />
  );
}

// ─── Deal detail modal ──────────────────────────────────────────────────

function DealDetailModal({
  deal, initialMode = 'view', onClose, onQuote, onUpdateStatus, onUpdateProposalOutcome, onOpenProposal,
}: {
  deal: Deal;
  initialMode?: 'view' | 'edit';
  onClose: () => void;
  onQuote: () => void;
  onUpdateStatus: (enquiryId: string, status: string) => void;
  onUpdateProposalOutcome: (proposalId: string, outcome: 'booked' | 'cancelled' | 'draft') => void;
  onOpenProposal: (p: ProposalRow) => void;
}) {
  const { supabase } = useAuth();
  const e = deal.enquiry;
  // For standalone deals (no enquiry), outcome lives on the proposal itself.
  // Standalone deals only ever have one proposal (FAB creates 1:1).
  const standaloneProp = !e && deal.proposals[0] ? deal.proposals[0] : null;
  const isClosed = e
    ? (e.status === 'booked' || e.status === 'cancelled')
    : Boolean(standaloneProp && INACTIVE_PROPOSAL_STATUSES.has(standaloneProp.status));

  const [mode, setMode] = useState<'view' | 'edit'>(initialMode);

  // Snapshot of the editable shape for both enquiry-rooted and standalone
  // deals. Standalone deals don't carry bedrooms / budget on the proposal,
  // so those fields are hidden via conditional rendering.
  const initialForm = useMemo(() => ({
    client_name: e?.client_name ?? standaloneProp?.guest_name ?? '',
    client_email: e?.client_email ?? standaloneProp?.guest_email ?? '',
    client_phone: e?.client_phone ?? standaloneProp?.guest_phone ?? '',
    nationality: e?.nationality ?? '',
    check_in: e?.check_in ?? standaloneProp?.check_in ?? '',
    check_out: e?.check_out ?? standaloneProp?.check_out ?? '',
    guests_total: e?.guests_total ?? standaloneProp?.guests_total ?? null,
    bedrooms_needed: e?.bedrooms_needed ?? null,
    budget_min: e?.budget_min ?? null,
    budget_max: e?.budget_max ?? null,
    notes: e?.notes ?? standaloneProp?.notes ?? '',
  }), [deal.key]);
  const [form, setForm] = useState(initialForm);
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm);
  const fieldsDisabled = mode === 'view';

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function requestClose() {
    if (mode === 'edit' && isDirty) {
      const ok = window.confirm('You have unsaved changes. Discard them?');
      if (!ok) return;
    }
    onClose();
  }

  async function save() {
    if (e) {
      await supabase.from('enquiries').update({
        client_name: form.client_name,
        client_email: form.client_email || null,
        client_phone: form.client_phone || null,
        nationality: form.nationality || null,
        check_in: form.check_in || null,
        check_out: form.check_out || null,
        guests_total: form.guests_total,
        bedrooms_needed: form.bedrooms_needed,
        budget_min: form.budget_min,
        budget_max: form.budget_max,
        notes: form.notes || null,
        updated_at: new Date().toISOString(),
      }).eq('id', e.id);
    } else if (standaloneProp) {
      await supabase.from('proposals').update({
        guest_name: form.client_name,
        guest_email: form.client_email || null,
        guest_phone: form.client_phone || null,
        guest_nationality: form.nationality || null,
        check_in: form.check_in || null,
        check_out: form.check_out || null,
        guests_total: form.guests_total,
        notes: form.notes || null,
        updated_at: new Date().toISOString(),
      }).eq('id', standaloneProp.id);
    }
    notifyPipelineChanged();
    setMode('view');
  }

  function markBooked() {
    if (e) onUpdateStatus(e.id, 'booked');
    else if (standaloneProp) onUpdateProposalOutcome(standaloneProp.id, 'booked');
  }
  function markCancelled() {
    if (e) onUpdateStatus(e.id, 'cancelled');
    else if (standaloneProp) onUpdateProposalOutcome(standaloneProp.id, 'cancelled');
  }
  function reopen() {
    if (e) onUpdateStatus(e.id, 'new');
    else if (standaloneProp) onUpdateProposalOutcome(standaloneProp.id, 'draft');
  }

  const title = titleCase(form.client_name) || (deal.type === 'standalone' ? 'Standalone proposal' : 'Deal');
  const stage = dealStage(deal);
  const accentColour = STAGE_ACCENT[stage] ?? 'var(--text-light)';
  const stageLabel = STAGES.find(s => s.key === stage)?.label ?? stage;

  const subtitle = (
    <>
      <span>Stage: <strong style={{ color: 'var(--text)' }}>{stageLabel}</strong></span>
      {deal.type === 'standalone' && <span>· standalone proposal</span>}
      {deal.check_in && deal.check_out && (
        <span>· {fmtDate(deal.check_in)} to {fmtDate(deal.check_out)}</span>
      )}
    </>
  );

  const closedBadge = isClosed
    ? <span className="detail-modal-mode-badge detail-modal-mode-badge--closed">{stageLabel}</span>
    : undefined;

  const banner = isClosed ? (
    <div className="detail-modal-banner detail-modal-banner--success">
      This deal is <strong>{stageLabel}</strong>. Use Reopen below to make changes.
    </div>
  ) : undefined;

  const footerActions = (
    <>
      <button className="btn btn-primary" onClick={onQuote}>
        📝 {deal.proposals.length === 0 ? 'Create Proposal' : 'Add another proposal'}
      </button>
      {!isClosed && (
        <>
          <button
            className="btn btn-outline-success"
            onClick={markBooked}
            title="Mark deal as Won (creates a booking)"
          >
            ✓ Mark Booked
          </button>
          <button
            className="btn btn-outline-danger"
            onClick={markCancelled}
            title="Mark deal as Lost"
          >
            ✕ Mark Lost
          </button>
        </>
      )}
      {isClosed && (
        <button className="btn btn-ghost" onClick={reopen} title="Reopen this deal">
          ↺ Reopen
        </button>
      )}
    </>
  );

  const footerHint = mode === 'edit'
    ? <>Editing client details. <strong>Save</strong> to keep changes.</>
    : <>Click <strong>Edit</strong> to change client details. Action buttons work in either mode.</>;

  return (
    <DetailModal
      title={title}
      subtitle={subtitle}
      accentColour={accentColour}
      mode={mode}
      onModeChange={setMode}
      canEdit={!isClosed}
      isDirty={isDirty}
      onSave={save}
      onCancel={() => { setForm(initialForm); setMode('view'); }}
      closedBadge={closedBadge}
      banner={banner}
      footerActions={footerActions}
      footerHint={footerHint}
      onClose={onClose}
    >
      <DetailModalSection heading="Client details">
        <fieldset disabled={fieldsDisabled} style={{ border: 0, padding: 0, margin: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
            <div className="form-group">
              <label className="form-label">Client name</label>
              <input className="form-input" value={form.client_name} onChange={ev => update('client_name', ev.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input type="email" className="form-input" value={form.client_email} onChange={ev => update('client_email', ev.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input className="form-input" value={form.client_phone} onChange={ev => update('client_phone', ev.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Nationality</label>
              <input className="form-input" value={form.nationality} onChange={ev => update('nationality', ev.target.value)} />
            </div>
          </div>
        </fieldset>
      </DetailModalSection>

      <DetailModalSection heading="Stay details">
        <fieldset disabled={fieldsDisabled} style={{ border: 0, padding: 0, margin: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
            <div className="form-group">
              <label className="form-label">Check-in</label>
              <input type="date" className="form-input" value={form.check_in || ''} onChange={ev => update('check_in', ev.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Check-out</label>
              <input type="date" className="form-input" value={form.check_out || ''} onChange={ev => update('check_out', ev.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Guests</label>
              <input type="number" min={1} className="form-input" value={form.guests_total ?? ''} onChange={ev => update('guests_total', ev.target.value ? Number(ev.target.value) : null)} />
            </div>
            {e && (
              <div className="form-group">
                <label className="form-label">Bedrooms needed</label>
                <input type="number" min={0} className="form-input" value={form.bedrooms_needed ?? ''} onChange={ev => update('bedrooms_needed', ev.target.value ? Number(ev.target.value) : null)} />
              </div>
            )}
            {e && (
              <>
                <div className="form-group">
                  <label className="form-label">Budget min</label>
                  <input type="number" className="form-input" value={form.budget_min ?? ''} onChange={ev => update('budget_min', ev.target.value ? Number(ev.target.value) : null)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Budget max</label>
                  <input type="number" className="form-input" value={form.budget_max ?? ''} onChange={ev => update('budget_max', ev.target.value ? Number(ev.target.value) : null)} />
                </div>
              </>
            )}
          </div>
          <div className="form-group" style={{ marginTop: 4 }}>
            <label className="form-label">Notes</label>
            <textarea className="form-input" rows={3} value={form.notes} onChange={ev => update('notes', ev.target.value)} />
          </div>
        </fieldset>
      </DetailModalSection>

      <DetailModalSection heading="Proposals" headingRight={deal.proposals.length || null}>
        {deal.proposals.length === 0 ? (
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
            No proposals yet. Use "Create Proposal" below to add one for this client.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {deal.proposals.map(p => (
              <button
                key={p.id}
                onClick={() => onOpenProposal(p)}
                className="editor-list-row"
                style={{ cursor: 'pointer', background: 'var(--bg)', border: '1px solid var(--border)', textAlign: 'left' }}
              >
                <div className="editor-list-main">
                  <div className="editor-list-title">{titleCase(p.property_name)}</div>
                  <div className="editor-list-sub">
                    {p.guest_price != null ? <><strong>{fmtRand(p.guest_price)}</strong> / night</> : 'No pricing'}
                    {p.scenario_type && <span style={{ color: 'var(--text-light)' }}> · {p.scenario_type}</span>}
                    <span style={{ marginLeft: 8, fontFamily: 'monospace', fontSize: '0.6875rem', color: 'var(--text-light)' }}>{p.ref_code}</span>
                  </div>
                </div>
                <StatusBadge status={p.status} config={PROPOSAL_STATUS_CONFIG} />
              </button>
            ))}
          </div>
        )}
      </DetailModalSection>
    </DetailModal>
  );
}
