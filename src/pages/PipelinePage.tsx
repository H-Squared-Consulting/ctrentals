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

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/ToastProvider';
import { useLayout } from '../contexts/LayoutContext';
import DataTable, { StatusBadge } from '../components/DataTable';
import DetailModal, { DetailModalSection } from '../components/DetailModal';
import type { DataRow } from '../components/DataTable';
import ActionModal from '../components/ActionModal';
import NewProposalLauncher from '../components/NewProposalLauncher';
import NightCount from '../components/NightCount';
import ProposalDetailModal from '../components/ProposalDetailModal';
import SendProposalDialog from '../components/SendProposalDialog';
import PricingModal from './PricingModal';
import { nightsBetween } from '../lib/nights';
import { CT_RENTALS_PARTNER_ID } from './constants';
import { fmtRand } from '../lib/pricingEngine';
import { notifyPipelineChanged, onPipelineChanged } from '../lib/pipelineEvents';
import {
  syncProposalFromEnquiry,
  syncEnquiryFromProposal,
  closeEnquiryOnProposalAccept,
  maybeCloseEnquiryOnProposalDecline,
  countLiveSiblings,
  type DealStatus,
  type ProposalStatus,
} from '../lib/statusSync';
import { linkOrCreateGuestForEnquiry } from '../lib/guestLinks';
import type { EnquiryPrefill } from '../components/CreateProposalModal';
import EnquiryPropertyMatchModal from '../components/EnquiryPropertyMatchModal';
import NumericMultiSelect from '../components/NumericMultiSelect';
import { initialsForEmail, TEAM_INITIALS, type TeamInitials } from '../lib/userInitials';

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
  /** Parent enquiry context for the "From ENQ-…" link in the detail
   *  modal. Both null for standalone proposals. */
  enquiry_id: string | null;
  enquiry_ref_code: string | null;
}

interface EnquirySide {
  id: string;
  ref_code: string;
  /** 1-line "what is this enquiry about" written at capture. Used
   *  as the deal card headline so 5 enquiries from the same agent
   *  are visually distinct. Nullable on rows pre-dating the field. */
  subject: string | null;
  is_agent: boolean;
  agent_id: string | null;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
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
  /** Multi-select filters captured at enquiry time — bedrooms_needed
   *  and guests_total stay as the legacy "min" mirrors so older
   *  readers keep working. The match modal uses these arrays with
   *  .in() for tighter property filtering. */
  bedrooms_options: number[] | null;
  guests_options: number[] | null;
  /** Origin tag — 'platform' for enquiries captured against an
   *  Airbnb / Booking / VRBO conversation, 'agent_portal' for those
   *  submitted via /q/:token, otherwise null. Drives the type lens
   *  filter on the kanban and decides whether source_url renders. */
  source: string | null;
  /** Back-link to the conversation thread on the originating platform.
   *  Only meaningful when source === 'platform'. Surfaced as a small
   *  clickable icon on the deal card and inline on the deal modal. */
  source_url: string | null;
  /** Agent-portal multi-property pick — the property ids the agent
   *  ticked when submitting the enquiry on /q/:token. Used by the
   *  deal modal's "Generate proposals for these N →" CTA to pre-tick
   *  the match modal. NULL on legacy + non-portal enquiries. */
  requested_property_ids: string[] | null;
  status: string;
  /** Pipeline-level status driving the kanban column. Present once the
   *  workflow rebuild migration has been applied; absent on older rows,
   *  in which case dealStage() derives it from status + linked proposals. */
  deal_status: string | null;
  /** 2-letter tag for whoever captured the enquiry — NT / HH / JH / GH.
   *  Stamped at insert via initialsForEmail(user.email). Surfaces as a
   *  small pill on the deal card and feeds the "show only mine" filter. */
  created_by_initials: string | null;
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

/** Kanban columns. Six action-shaped buckets — each tells the user a
 *  single thing to do at a glance:
 *    New (Agent)   → triage, pick property/ies, raise quote
 *    New (Direct)  → triage, raise quote
 *    Quoting       → finish + send the draft
 *    Sent          → wait, nudge after STALLED_DAYS (visual cue inside)
 *    Negotiating   → client engaged, push to close
 *    Closed        → done (won/lost accent on card)
 *  The underlying enquiries.deal_status enum carries the finer-grained
 *  internal stages; columnForDeal() maps stage + is_agent → column. */
const STAGES = [
  // 5 lifecycle columns — the agent / direct / platform split lives
  // in the type-toggle above the board, not as extra columns. Keeps
  // the kanban compact and scales when Platform (Airbnb / Booking
  // direct bookings) becomes a real enquiry source.
  // Descriptions are intentionally short single-line strings so the
  // column header is the same height in every column.
  { key: 'new',      label: 'Arrived',  description: 'No proposal yet',   emptyMsg: 'Nothing in inbox' },
  { key: 'quoting',  label: 'Quoting',  description: 'Drafts to send',    emptyMsg: 'Nothing quoting' },
  { key: 'sent',     label: 'Responded',description: 'At least 1 sent',   emptyMsg: 'Nothing sent yet' },
  { key: 'booked',   label: 'Booked',   description: 'Proposal accepted', emptyMsg: 'Nothing booked' },
  { key: 'closed',   label: 'Closed',   description: 'Expired or closed', emptyMsg: 'Nothing closed' },
] as const;

const STAGE_ACCENT: Record<string, string> = {
  new:      'var(--info)',
  quoting:  'var(--warning)',
  sent:     'var(--color-primary)',
  booked:   'var(--success)',
  // Closed = lost / expired. Neutral grey so it reads as "done,
  // archived" rather than competing with the Booked-green or
  // Quoting-amber. Distinct from the happy terminal state.
  closed:   'var(--text-light)',
};

/** Internal deal_status → display column. dealStage() still returns the
 *  fine-grained value (so card logic — stale, viewed badges, primary
 *  action — keeps working), but the kanban groups by columnForDeal(). */
type DealStageInternal = 'new' | 'drafting' | 'ready' | 'sent' | 'stalled' | 'interested' | 'won' | 'lost';
type ColumnKey = 'new' | 'quoting' | 'sent' | 'booked' | 'closed';

/** Enquiry type lens. Drives the top-of-board toggle and the search
 *  predicate; doesn't change the column shape. Platform is reserved
 *  for future Airbnb / Booking direct-source enquiries — for now
 *  every existing enquiry is agent or direct. */
type TypeFilter = 'all' | 'agent' | 'direct' | 'platform';

/** True when the enquiry's stay window is already in the past AND the
 *  deal hasn't been booked. Surfaces as "Closed (expired)" — the
 *  lead's gone cold by definition, even if nobody manually closed it.
 *  Today-or-future check_in stays in its current column. */
function isExpired(d: Deal): boolean {
  const ci = d.check_in;
  if (!ci) return false;
  const today = new Date().toISOString().slice(0, 10);
  return ci < today;
}

/** Map stage + is_agent → the column the card lives in. Rules:
 *    - new + agent → new-agent
 *    - new + direct → new-direct
 *    - drafting/ready → quoting
 *    - sent/stalled/interested → sent (interested is engagement, not
 *      a separate state any more; the cue is on the card itself)
 *    - won → booked (a booking row exists)
 *    - lost OR (any non-won stage with expired dates) → closed
 *  Expired = check_in < today AND not won. */
function columnForDeal(d: Deal): ColumnKey {
  const stage = dealStage(d);
  if (stage === 'won') return 'booked';
  if (stage === 'lost' || isExpired(d)) return 'closed';
  if (stage === 'new') return 'new';
  if (stage === 'drafting' || stage === 'ready') return 'quoting';
  // sent | stalled | interested → all sit in Sent
  return 'sent';
}

/** Stage-only helper for places that don't have the full Deal in
 *  hand. Doesn't apply the expiry rule — caller should use
 *  columnForDeal where possible. */
function columnFor(stage: DealStageInternal): ColumnKey {
  if (stage === 'won') return 'booked';
  if (stage === 'lost') return 'closed';
  if (stage === 'new') return 'new';
  if (stage === 'drafting' || stage === 'ready') return 'quoting';
  return 'sent';
}

/** Cards are dense by default (two-row layout: client + price; dates +
 *  property + action). Once a column tips past this, switch to an even
 *  tighter single-row variant. The full info is always one click away. */
const COMPACT_THRESHOLD = 12;

const PROPOSAL_STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  draft:      { label: 'Draft',      bg: '#F3F4F6', color: '#6B7280' },
  drafting:   { label: 'Drafting',   bg: '#F3F4F6', color: '#6B7280' },
  ready:      { label: 'Ready',      bg: '#FEF3C7', color: '#92400E' },
  sent:       { label: 'Sent',       bg: '#DBEAFE', color: '#1E40AF' },
  viewed:     { label: 'Viewed',     bg: '#E0E7FF', color: '#3730A3' },
  interested: { label: 'Interested', bg: '#D1FAE5', color: '#065F46' },
  // Terminal-positive: accepted / booked → solid green so the eye
  // immediately spots which proposal won, both on the deal modal
  // and in the proposals strip on the front of the card.
  accepted:   { label: 'Accepted',   bg: '#A7F3D0', color: '#064E3B' },
  booked:     { label: 'Booked',     bg: '#A7F3D0', color: '#064E3B' },
  // Terminal-negative: declined / cancelled / expired → red.
  declined:   { label: 'Declined',   bg: '#FECACA', color: '#991B1B' },
  cancelled:  { label: 'Cancelled',  bg: '#FECACA', color: '#991B1B' },
  expired:    { label: 'Expired',    bg: '#FEE2E2', color: '#991B1B' },
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

/** Internal stage key — what dealStage() returns. Use ColumnKey for
 *  display-column buckets and DealStageInternal for storage / write paths. */
type StageKey = DealStageInternal;

/** Derive which Kanban column the deal belongs in.
 *
 * Source of truth: enquiry.deal_status if present (post-migration). For
 * enquiry-rooted deals with no deal_status yet, or for standalone
 * proposals, we fall back to a derivation from manual_status + proposal
 * states. The fallback is identical to the SQL UPDATE in the workflow
 * rebuild migration, so the visual result is the same before and after.
 */
function dealStage(d: Deal): StageKey {
  // Stored deal_status is the internal vocabulary (new/drafting/ready/
  // sent/stalled/interested/won/lost). It's only trustworthy for 1:1
  // deals (one enquiry, one proposal) — multi-proposal deals are
  // managed independently and the stored value goes stale (e.g. one
  // proposal is sent while two stay drafting → stored stays
  // 'drafting' even though the deal should be in Responded). For
  // those, fall through to the proposal-state derivation below.
  // Won/Lost terminal states stay authoritative either way.
  const STORED_VALID: Set<DealStageInternal> = new Set([
    'new', 'drafting', 'ready', 'sent', 'stalled', 'interested', 'won', 'lost',
  ]);
  const stored = d.enquiry?.deal_status;
  const isMultiProposal = d.proposals.length > 1;
  if (stored && STORED_VALID.has(stored as DealStageInternal)) {
    if (!isMultiProposal || stored === 'won' || stored === 'lost') {
      return stored as StageKey;
    }
    // Multi-proposal + non-terminal stored value → fall through to
    // proposal-state derivation so the kanban reflects what's
    // actually happening across the proposals.
  }

  // 2. Manual outcomes set directly on the enquiry.
  if (d.manual_status === 'booked')    return 'won';
  if (d.manual_status === 'cancelled') return 'lost';

  // 3. Look at proposals.
  const active = d.proposals.filter(p => !INACTIVE_PROPOSAL_STATUSES.has(p.status));

  // No active proposals — derive the terminal stage from what's on file.
  // Any acceptance ⇒ won; otherwise lost. Standalone deals always hit
  // this; enquiry-rooted deals where every proposal has gone terminal
  // (e.g. accepted + auto-declined siblings) hit it too.
  if (active.length === 0 && d.proposals.length > 0) {
    const anyAccepted = d.proposals.some(p => p.status === 'accepted' || p.status === 'booked');
    return anyAccepted ? 'won' : 'lost';
  }

  // Enquiry-rooted with no proposals at all: still waiting for someone
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
    ref_code: d.enquiry.ref_code,
    client_name: d.enquiry.client_name,
    client_email: d.enquiry.client_email,
    client_phone: d.enquiry.client_phone,
    check_in: d.enquiry.check_in,
    check_out: d.enquiry.check_out,
    guests_total: d.enquiry.guests_total,
    notes: d.enquiry.notes,
    is_agent: d.enquiry.is_agent,
    agent_id: d.enquiry.agent_id,
    guest_name: d.enquiry.guest_name,
    guest_email: d.enquiry.guest_email,
    guest_phone: d.enquiry.guest_phone,
  };
}

function mapProposalRow(p: any, parentEnquiry?: { id: string; ref_code: string }): ProposalRow {
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
    enquiry_id: parentEnquiry?.id ?? p.enquiry_id ?? null,
    enquiry_ref_code: parentEnquiry?.ref_code ?? p.enquiries?.ref_code ?? null,
  };
}

// ─── Page ───────────────────────────────────────────────────────────────

export default function PipelinePage() {
  const { supabase, user } = useAuth();
  const { setPageTitle } = useLayout();

  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'board' | 'list'>('board');
  // Search can be pre-filled from URL — Home links land users here with
  // ?search=<client name> so the deal they care about pops out of the list.
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState(searchParams.get('search') || '');

  // Filter state. Two filters per page is the agreed placeholder pattern
  // across the Ops module so users can see how the controls feel before
  // we lock down the final set.
  const [stageFilter, setStageFilter] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<string>('');
  /** Top-level lens — switches which enquiry type the board shows.
   *  Defaults to 'all' so nothing's hidden unless the user actively
   *  narrows. Cards keep their type stripe + tag so even at 'all' the
   *  agent / direct / platform split is still visually scannable. */
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  /** User lens — narrow the board to enquiries captured by a specific
   *  team member (or 'mine' which resolves to whoever's signed in).
   *  'all' is the default and a no-op. Pre-rebuild rows without a
   *  created_by_initials value are hidden by any narrowing choice. */
  const [userFilter, setUserFilter] = useState<'all' | 'mine' | TeamInitials>('all');
  // Per-board-column sort. Empty / 'smart' uses the per-stage default;
  // any other value overrides for that one column.
  const [columnSort, setColumnSort] = useState<Record<string, string>>({});

  // Drill-in state
  const [openDeal, setOpenDeal] = useState<{ deal: Deal; mode: 'view' | 'edit'; focusField?: string | null } | null>(null);
  const openDealInMode = (deal: Deal, mode: 'view' | 'edit' = 'view') => setOpenDeal({ deal, mode });
  const [openProposal, setOpenProposal] = useState<ProposalRow | null>(null);
  /** Hydrated pricing_proposals row for the Edit Pricing → PricingDashboard
   *  flow. Mirrors the wiring inside PropertyEditModal so the entry point
   *  is consistent wherever a ProposalDetailModal appears. */
  const [editPricingFor, setEditPricingFor] = useState<any>(null);
  const [launcherFor, setLauncherFor] = useState<EnquiryPrefill | null>(null);
  /** Open the EnquiryPropertyMatchModal in "add proposals to
   *  existing enquiry" mode from the Deal Detail modal's Create
   *  Proposal button. Carries the deal's latest enquiry data so
   *  the property match filter reflects current beds / dates /
   *  guests. Replaces NewProposalLauncher for enquiry-attached
   *  deals — same property picker + inline pricing flow used at
   *  enquiry creation. */
  const [matchForExisting, setMatchForExisting] = useState<{
    enquiryId: string;
    refCode: string;
    payload: import('../components/EnquiryPropertyMatchModal').PendingEnquiry;
    /** Property IDs to pre-tick on open. Set when launched from
     *  the deal modal's "Generate proposals" CTA on an agent-portal
     *  enquiry — passes through to the match modal so the agent's
     *  picks land already checked. */
    initiallySelected?: string[] | null;
    /** Agent-portal hard-restriction: when set, the match modal
     *  shows ONLY these property IDs (no full portfolio listing).
     *  The team's job in this mode is to review pricing per row
     *  and untick anything they don't want to quote — they can't
     *  add properties the agent didn't ask for. */
    restrictToIds?: string[] | null;
  } | null>(null);
  /** When set, the launcher opens with no enquiry — for the "+ Standalone
   *  proposal" path. Distinct from launcherFor so the launcher knows the
   *  difference between "no enquiry" and "not open". */
  const [launcherStandalone, setLauncherStandalone] = useState(false);
  /** The single-draft proposal selected for the quick Send dialog. */
  /** Send state — array so the same dialog handles both the single
   *  proposal case and the "send all drafts in one email" batch flow
   *  surfaced inside DealDetailModal. setSendingProposals([p]) for one,
   *  setSendingProposals(drafts) for the batch. */
  const [sendingProposals, setSendingProposals] = useState<ProposalRow[] | null>(null);

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

  /** How far back to load CLOSED/BOOKED enquiries. Open / quoting /
   *  responded rows are always pulled regardless of age — those are
   *  what the team actually works on. Terminal rows older than this
   *  cutoff are deliberately left in the database; the kanban is for
   *  current pipeline, not the all-time archive.
   *
   *  Before this floor every page load shipped ~years of dead deals
   *  with full pricing snapshots, ballooning the payload past 10 MB
   *  and making the page unusable. */
  const CLOSED_LOOKBACK_DAYS = 60;

  async function fetchDeals(): Promise<Deal[]> {
    setLoading(true);
    const closedFloor = new Date(Date.now() - CLOSED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
      .toISOString();
    // PostgREST .or() — keep every row that's EITHER not-terminal
    // (open / quoting / responded / null) OR terminal but recent
    // enough to still be relevant. Phrased this way so the index on
    // (partner_id, created_at) does the heavy lifting.
    const ACTIVE_OR_RECENT =
      `deal_status.is.null,` +
      `deal_status.not.in.(won,lost),` +
      `created_at.gte.${closedFloor}`;
    const [enqRes, standaloneRes] = await Promise.all([
      // Enquiries with all their proposals + property + pricing joined.
      supabase
        .from('enquiries')
        .select('*, proposals(*, partner_properties(property_name), pricing_proposals(client_price_excl_vat, scenario_type, season_tag, owner_net, company_take, agents))')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .or(ACTIVE_OR_RECENT)
        .order('created_at', { ascending: false })
        // Safety net — even with the recency floor a runaway create-
        // loop or backfill shouldn't break the page.
        .limit(500),
      // Proposals created without an enquiry (FAB flow) — these are deals
      // in their own right. Same windowing applied: only recent rows
      // ship by default. Standalone proposals don't have deal_status
      // so a flat created_at floor is enough.
      supabase
        .from('proposals')
        .select('*, partner_properties(property_name), pricing_proposals(client_price_excl_vat, scenario_type, season_tag, owner_net, company_take, agents)')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .is('enquiry_id', null)
        .gte('created_at', closedFloor)
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

    const fromEnquiries: Deal[] = (enqRes.data || []).map((e: any) => ({
      key: e.id,
      type: 'enquiry',
      enquiry: {
        id: e.id,
        ref_code: e.ref_code,
        subject: e.subject ?? null,
        bedrooms_options: e.bedrooms_options ?? null,
        guests_options: e.guests_options ?? null,
        source: e.source ?? null,
        source_url: e.source_url ?? null,
        requested_property_ids: e.requested_property_ids ?? null,
        is_agent: !!e.is_agent,
        agent_id: e.agent_id ?? null,
        client_name: e.client_name,
        client_email: e.client_email,
        client_phone: e.client_phone,
        guest_name: e.guest_name ?? null,
        guest_email: e.guest_email ?? null,
        guest_phone: e.guest_phone ?? null,
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
        created_by_initials: e.created_by_initials ?? null,
        created_at: e.created_at,
      },
      proposals: (e.proposals || []).map((p: any) => mapProposalRow(p, { id: e.id, ref_code: e.ref_code })),
      client_name: e.client_name,
      client_email: e.client_email,
      client_phone: e.client_phone,
      check_in: e.check_in,
      check_out: e.check_out,
      guests_total: e.guests_total,
      created_at: e.created_at,
      manual_status: e.status,
      // Deal-level is_agent surfaces the Agent tag on cards. True when
      // the enquiry was explicitly raised on behalf of a guest OR any
      // existing proposal is agent-flagged (older data, pre-flag).
      is_agent: !!e.is_agent || (e.proposals || []).some((p: any) => p.is_agent),
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
    return merged;
  }

  useEffect(() => { if (supabase) fetchDeals(); }, [supabase]);

  // Refetch whenever anywhere in the app writes a proposal/enquiry — the
  // FAB-launched proposal flow, the new-enquiry form, status flips from
  // ProposalDetailModal, all dispatch a window event we subscribe to.
  // Without this the Kanban stays stale until the user hits Refresh.
  //
  // Debounced because a single user action often triggers several
  // writes in quick succession (accept cascade fires N sibling
  // updates → N events → without debounce, N full refetches in
  // parallel). 250 ms is short enough to feel instant after the
  // last write and long enough to collapse the burst into one round-
  // trip.
  useEffect(() => {
    if (!supabase) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { fetchDeals(); timer = null; }, 250);
    };
    const unsubscribe = onPipelineChanged(schedule);

    // Cross-client live updates via Supabase Realtime. The window
    // event bus above only fires within the same tab — agent-portal
    // submissions (different device entirely) need a server-pushed
    // signal to wake the kanban up. We subscribe to INSERTs +
    // UPDATEs on enquiries / proposals and feed them through the
    // same debounced refetch path so a burst of cascade updates
    // collapses to one round-trip.
    const channel = supabase
      .channel('pipeline-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'enquiries' }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'proposals' }, schedule)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  // Keep an open deal modal in sync with the latest fetched data.
  // The modal renders from a snapshot of the deal in openDeal state,
  // not a live reference into the deals array, so a refetch (e.g.
  // after deleting a proposal from inside the modal) wouldn't update
  // the rows the user is looking at. Re-seat on every deals change so
  // the body always reflects the freshest server state. Form state
  // inside DealDetailModal is keyed by deal.key so this swap doesn't
  // wipe in-progress edits.
  useEffect(() => {
    setOpenDeal(prev => {
      if (!prev) return prev;
      const targetKey = prev.deal.enquiry?.id ?? prev.deal.key;
      const next = deals.find(d => (d.enquiry?.id ?? d.key) === targetKey);
      if (!next) return prev;
      // Reference equality short-circuit so React doesn't re-render
      // the modal on every unrelated refetch.
      if (next === prev.deal) return prev;
      return { deal: next, mode: prev.mode };
    });
  }, [deals]);

  /** Card id flash-highlighted briefly when the user lands here
   *  from the New Enquiry flow (?deal=…&highlight=1). Set on URL
   *  read, cleared on a 2.8s timer so the card pulses then settles. */
  const [highlightedDealId, setHighlightedDealId] = useState<string | null>(null);

  // Deep-link: /operations/enquiries?deal=<enquiryId> jumps to that
  // deal. With `highlight=1` we flash the card on the board so the
  // user can see where their just-created enquiry landed; without
  // it we open the deal modal directly (the old behaviour used by
  // the "Review proposals" CTA and the stale-bookmark redirect).
  useEffect(() => {
    const dealId = searchParams.get('deal');
    const highlight = searchParams.get('highlight') === '1';
    if (!dealId || deals.length === 0) return;
    const target = deals.find(d => d.enquiry?.id === dealId);
    if (target) {
      if (highlight) {
        setHighlightedDealId(dealId);
        // Scroll the card into view next tick so it's actually
        // visible when the flash starts.
        setTimeout(() => {
          const el = document.querySelector<HTMLElement>(`[data-deal-id="${dealId}"]`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
        // Clear the highlight after the CSS animation completes.
        setTimeout(() => setHighlightedDealId(null), 2800);
      } else {
        setOpenDeal({ deal: target, mode: 'view' });
      }
    }
    const next = new URLSearchParams(searchParams);
    next.delete('deal');
    next.delete('highlight');
    setSearchParams(next, { replace: true });
  }, [deals, searchParams, setSearchParams]);

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

    // Type lens (top-of-board toggle). 'all' is a no-op; agent and
    // direct narrow to is_agent true/false. 'platform' is reserved
    // and currently has no rows — kept as a no-op until enquiries
    // gain a `source='platform'` value.
    if (typeFilter === 'agent') {
      result = result.filter(d => d.is_agent);
    } else if (typeFilter === 'direct') {
      // Direct = recipient is the guest AND no platform tag. Platform
      // enquiries are also non-agent but live in their own bucket.
      result = result.filter(d => !d.is_agent && d.enquiry?.source !== 'platform');
    } else if (typeFilter === 'platform') {
      result = result.filter(d => d.enquiry?.source === 'platform');
    }

    // User lens — restrict to enquiries captured by a specific team
    // member. 'mine' resolves the signed-in user's email → initials.
    // Standalone (non-enquiry) deals are dropped from narrowed views
    // since they have no captured-by stamp to compare against.
    if (userFilter !== 'all') {
      const target: TeamInitials | null =
        userFilter === 'mine' ? initialsForEmail(user?.email) : userFilter;
      if (target) {
        result = result.filter(d => d.enquiry?.created_by_initials === target);
      } else {
        // 'mine' picked but the signed-in user isn't in the team map
        // — empty result is the honest outcome, no spurious matches.
        result = [];
      }
    }

    // Stage filter — values are column keys, so compare against the
    // display column the deal lands in, not its internal stage.
    if (stageFilter) {
      result = result.filter(d => columnForDeal(d) === stageFilter);
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
  }, [deals, search, stageFilter, dateFilter, typeFilter, userFilter, user?.email]);

  /** Live counts per type for the top-of-board toggle labels.
   *  Calculated off the unfiltered deals list so the chip totals
   *  reflect the universe, not the currently-narrowed view. */
  const typeCounts = useMemo(() => {
    let agent = 0, direct = 0, platform = 0;
    for (const d of deals) {
      if (d.is_agent) agent++;
      else if (d.enquiry?.source === 'platform') platform++;
      else direct++;
    }
    return { all: deals.length, agent, direct, platform };
  }, [deals]);

  const byStage = useMemo(() => {
    const map: Record<ColumnKey, Deal[]> = {
      new: [], quoting: [], sent: [], booked: [], closed: [],
    };
    for (const d of filtered) {
      map[columnForDeal(d)].push(d);
    }
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

    // Smart default per display column:
    //   New    → oldest waiting (priority)
    //   Open   → soonest check-in (the closing window matters more than age)
    //   Closed → most recently closed first
    for (const stage of STAGES) {
      const sort = columnSort[stage.key] || 'smart';
      const list = map[stage.key as ColumnKey];
      if (sort === 'newest')           list.sort(byNewest);
      else if (sort === 'oldest')      list.sort(byOldest);
      else if (sort === 'check-in')    list.sort(byCheckIn);
      else if (sort === 'client')      list.sort(byClient);
      else {
        // Smart-sort default per column:
        //   New                → oldest first (FIFO triage)
        //   Quoting / Sent /
        //   Booked             → upcoming check-in first (urgency)
        //   Closed             → most recently closed first
        if (stage.key === 'new')          list.sort(byOldest);
        else if (stage.key === 'closed')  list.sort(byNewest);
        else                              list.sort(byCheckIn);
      }
    }
    return map;
  }, [filtered, columnSort]);

  // ── Handlers ──
  function startQuote(d: Deal) {
    setOpenDeal(null);
    if (d.enquiry) {
      // Enquiry-attached: use the new property match flow so the
      // filtered + priced + checkbox UX is the same as enquiry
      // creation. The match modal updates the enquiry on save in
      // case the user changed any context fields on the way in.
      const e = d.enquiry;
      setMatchForExisting({
        enquiryId: e.id,
        refCode: e.ref_code,
        payload: {
          subject: e.subject,
          client_name: e.client_name,
          client_email: e.client_email,
          client_phone: e.client_phone,
          check_in: e.check_in,
          check_out: e.check_out,
          bedrooms_needed: e.bedrooms_needed,
          guests_total: e.guests_total,
          bedrooms_options: e.bedrooms_options,
          guests_options: e.guests_options,
          guests_adults: e.guests_adults,
          guests_children: e.guests_children,
          nationality: e.nationality,
          budget_min: e.budget_min,
          budget_max: e.budget_max,
          notes: e.notes,
          source: e.source,
          source_url: e.source_url,
          // Carry the enquiry's agent context so the match modal +
          // the PricingModal it opens land in the right scenario.
          // Without these the per-row default snapshot + Edit pricing
          // both fall back to direct, which silently swaps an agent
          // quote into a direct one.
          is_agent: !!(e as any).is_agent,
          agent_id: (e as any).agent_id ?? null,
          guest_name:  (e as any).guest_name  ?? null,
          guest_email: (e as any).guest_email ?? null,
          guest_phone: (e as any).guest_phone ?? null,
        },
        // Pre-tick the agent's picks from /q/:token (agent-portal
        // multi-property enquiries). Null / empty for any enquiry
        // that didn't come through the portal — match modal opens
        // with no selections, same as before.
        initiallySelected: (e as any).requested_property_ids ?? null,
        // Hard-restrict the property list to the agent's picks for
        // portal enquiries so the team can't accidentally quote
        // houses the agent didn't ask about. Null for every other
        // path → modal keeps full-portfolio behaviour.
        restrictToIds: (e as any).requested_property_ids ?? null,
      });
    } else {
      // Standalone proposal (FAB or orphan): keep the legacy flow
      // because there's no enquiry to match against.
      setLauncherStandalone(true);
    }
  }

  /** Fill in a proposal's guest_name/email/phone from the latest
   *  enquiry data — covers the race where the user just added contact
   *  details to the enquiry and clicks Send before the cascade has
   *  propagated to the proposal row. Falls back to whatever's on the
   *  proposal when there's no live enquiry to read from (standalone
   *  proposals). The merge prefers enquiry contact data because that
   *  IS the canonical record once the team's been editing in the
   *  deal modal — the proposal row is just a derived snapshot. */
  function hydrateProposalContact(p: ProposalRow): ProposalRow {
    if (!p.enquiry_id) return p;
    const liveDeal = deals.find(d => d.enquiry?.id === p.enquiry_id);
    const e = liveDeal?.enquiry;
    if (!e) return p;
    const liveName  = e.guest_name  || e.client_name || p.guest_name;
    const liveEmail = e.guest_email || e.client_email || p.guest_email;
    const livePhone = e.guest_phone || e.client_phone || p.guest_phone;
    return { ...p, guest_name: liveName, guest_email: liveEmail, guest_phone: livePhone };
  }

  /** Card-level Send action: if the deal has exactly one Draft proposal,
   *  open the quick Send dialog. If it has more, open the deal detail
   *  modal so the user picks which to send. */
  function startSend(d: Deal) {
    // Tolerate both vocabularies: 'draft' (pre-workflow_rebuild) and
    // 'drafting' (post). Without the second, a single freshly-created
    // proposal would never short-circuit to the Send dialog and the user
    // would always land on the deal modal instead.
    const drafts = d.proposals.filter(p => p.status === 'draft' || p.status === 'drafting');
    if (drafts.length === 1) {
      setSendingProposals([hydrateProposalContact(drafts[0])]);
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
    // Keep deal_status in lockstep with the legacy outcome flag so the
    // kanban column matches whichever path was taken (button or dropdown).
    const dealStatus = status === 'booked'    ? 'won'
                     : status === 'cancelled' ? 'lost'
                     :                          'new';
    await supabase
      .from('enquiries')
      .update({ status, deal_status: dealStatus, updated_at: new Date().toISOString() })
      .eq('id', enquiryId);
    if (status === 'booked') {
      const deal = deals.find(d => d.enquiry?.id === enquiryId);
      if (deal) await createBookingFromDeal(deal);
    }
    // Mirror to the enquiry's sole proposal (1:1 case) so Mark Booked /
    // Cancelled flips the proposal's status the same direction.
    await syncProposalFromEnquiry(supabase, enquiryId, dealStatus as DealStatus);
    // Close the modal so the user sees the card slide to its new column,
    // the action feels definitive that way. They can reopen if they need to.
    setOpenDeal(null);
    notifyPipelineChanged();
  }

  /** Manual stage move from the modal dropdown. Writes only deal_status,
   *  leaves the legacy enquiry.status alone (won/lost still flow through
   *  updateEnquiryStatus because Mark Booked also creates a booking row). */
  async function updateDealStage(enquiryId: string, dealStatus: string) {
    await supabase
      .from('enquiries')
      .update({ deal_status: dealStatus, updated_at: new Date().toISOString() })
      .eq('id', enquiryId);
    // Mirror onto the enquiry's sole proposal (1:1 case) so the user
    // never has to update two surfaces.
    await syncProposalFromEnquiry(supabase, enquiryId, dealStatus as DealStatus);
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

  /** Pending Accept / Decline that's awaiting user confirmation. Set
   *  when the user clicks one of the proposal-row outcome buttons;
   *  cleared when they confirm or cancel via the ConfirmOutcome modal
   *  below. liveSiblings is fetched up-front so the modal copy can
   *  describe the cascade accurately ("auto-declines 2 others"). */
  const [pendingOutcome, setPendingOutcome] = useState<{
    proposal: ProposalRow;
    outcome: ProposalStatus;
    liveSiblings: number;
  } | null>(null);
  /** Set when the user tried to Accept a proposal whose parent enquiry
   *  isn't ready for it yet (today: agent enquiries with no disclosed
   *  guest). Renders an explainer modal with a single "Add guest
   *  details" CTA that drops the user straight into edit mode on the
   *  deal modal. */
  const [acceptBlocker, setAcceptBlocker] = useState<{ deal: Deal; reason: string } | null>(null);

  /** Mark a sent proposal as accepted or declined from the detail modal.
   *  Cascade rules (see statusSync helpers + closeEnquiryOnProposalAccept):
   *    Accept → enquiry closes as Won, sibling proposals auto-decline.
   *    Decline → enquiry stays Open while other proposals are live;
   *              closes as Lost only when this was the last live one.
   *  ALWAYS confirms (via the ConfirmOutcome modal below) before
   *  firing — the team asked for a second-step on both Accept and
   *  Decline regardless of cascade impact, since both are
   *  effectively irreversible once cascaded.
   */
  async function markProposalOutcome(p: ProposalRow, outcome: ProposalStatus) {
    if (outcome === 'accepted') {
      // Agent enquiries can't accept without a disclosed guest —
      // accepting would book under "Valued Guest" and orphan the
      // booking record. Surface a clear explainer + a one-click
      // path to the edit form rather than silently no-op'ing
      // (which is what a disabled button would do).
      const parent = deals.find(d => d.enquiry?.id === p.enquiry_id);
      if (parent?.is_agent && !parent.enquiry?.guest_name?.trim()) {
        setOpenProposal(null);
        setAcceptBlocker({
          deal: parent,
          reason: 'Agent enquiries need the underlying guest disclosed before a proposal can be accepted — the booking has to be attributable to a real person.',
        });
        return;
      }
    }
    if (outcome === 'accepted' || outcome === 'declined') {
      const liveSiblings = await countLiveSiblings(supabase, p.id);
      setPendingOutcome({ proposal: p, outcome, liveSiblings });
      return;
    }
    await applyProposalOutcome(p, outcome);
  }

  /** The actual mutation — runs after the user confirms (for Accept /
   *  Decline) or directly (for any other outcome that skips the
   *  confirmation gate). */
  async function applyProposalOutcome(p: ProposalRow, outcome: ProposalStatus) {
    const patch: any = { status: outcome, updated_at: new Date().toISOString() };
    if (outcome === 'accepted') {
      patch.accepted_at = new Date().toISOString();
      // Stash the proposal's CURRENT status so a later "Move back
      // to Responded" can restore it exactly (sent / interested
      // were both valid pre-accept states; we don't want to
      // guess).
      patch.previous_status = p.status;
    }
    await supabase.from('proposals').update(patch).eq('id', p.id);

    if (outcome === 'accepted') {
      await closeEnquiryOnProposalAccept(supabase, p.id);
    } else if (outcome === 'declined') {
      await maybeCloseEnquiryOnProposalDecline(supabase, p.id);
    } else {
      // Other outcomes (none today) — fall back to the 1:1 sync helper.
      await syncEnquiryFromProposal(supabase, p.id, outcome);
    }

    setOpenProposal(null);
    // We do the refetch ourselves below — emitting the pipeline event
    // here would queue a SECOND (debounced) refetch 250 ms later for
    // no benefit. Skip the notify; the explicit await is what we need.
    const refreshed = await fetchDeals();

    // Accept is a terminal action on the deal — close the modal
    // and flash the card in its new column (Booked) so the user
    // sees where it moved. Same UX as the new-enquiry highlight.
    if (outcome === 'accepted') {
      const enquiryId = openDeal?.deal.enquiry?.id;
      setOpenDeal(null);
      if (enquiryId) {
        navigate(`/operations/enquiries?deal=${encodeURIComponent(enquiryId)}&highlight=1`, { replace: true });
      }
      return;
    }

    // For decline / interested we keep the modal open and just
    // re-seat the deal so the inline rows reflect the new state.
    setOpenDeal(prev => {
      if (!prev) return prev;
      const targetId = prev.deal.enquiry?.id ?? prev.deal.key;
      const next = refreshed.find(d => (d.enquiry?.id ?? d.key) === targetId);
      return next ? { deal: next, mode: prev.mode } : prev;
    });
  }

  // ── Render ──
  return (
    <div>
      {/* Toolbar — shared shape with the Proposals page so the two Ops
          pages feel paired. View toggle sits on the left as the primary
          context-switch; filters and search next; New button anchors the
          far right as the only "make something" action. */}
      {/* One-row toolbar so the kanban gets the page. Pills + selects
          + search + count + CTA all in a single flex row, wrapping
          gracefully on narrow viewports. */}
      <div className="card" style={{ marginBottom: '12px', padding: '8px 12px' }}>
        <div className="list-toolbar" style={{ flexWrap: 'wrap', gap: 8, rowGap: 6 }}>
          <div className="list-toolbar-left" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div className="view-toggle">
              <button
                className={`view-toggle-btn ${view === 'board' ? 'active' : ''}`}
                onClick={() => setView('board')}
                title="Board view"
              >
                ▦
              </button>
              <button
                className={`view-toggle-btn ${view === 'list' ? 'active' : ''}`}
                onClick={() => setView('list')}
                title="List view"
              >
                ☰
              </button>
            </div>
            {/* Type lens — obvious pills (same .view-toggle pattern as
                the view switcher) so the dumbest user sees every
                option without clicking. Counts inline. */}
            <div className="view-toggle">
              {([
                { key: 'all',      label: 'All' },
                { key: 'agent',    label: '🤝 Agent' },
                { key: 'direct',   label: '👤 Direct' },
                { key: 'platform', label: '🔗 Platform' },
              ] as const).map(opt => {
                const count = typeCounts[opt.key];
                const isPlatformEmpty = opt.key === 'platform' && count === 0;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    className={`view-toggle-btn ${typeFilter === opt.key ? 'active' : ''}`}
                    onClick={() => !isPlatformEmpty && setTypeFilter(opt.key)}
                    title={isPlatformEmpty ? 'Platform (Airbnb / Booking) — coming soon' : opt.label}
                    disabled={isPlatformEmpty}
                    style={isPlatformEmpty ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                  >
                    {opt.label}
                    <span style={{ marginLeft: 4, opacity: 0.7, fontSize: '0.75rem' }}>{count}</span>
                  </button>
                );
              })}
            </div>
            {/* User lens — pick "mine" (signed-in user) or one of the
                four team initials. Lives next to the type lens because
                both narrow the same board; intentionally a small
                select rather than a pill row so the four-person team
                doesn't dominate the toolbar. */}
            <select
              className="list-filter-select"
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value as typeof userFilter)}
              title="Filter by who captured the enquiry"
            >
              <option value="all">All users</option>
              <option value="mine">Only mine</option>
              {TEAM_INITIALS.map(i => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
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
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button className="list-search-clear" onClick={() => setSearch('')}>✕</button>
              )}
            </div>
          </div>
          <div className="list-toolbar-right" style={{ gap: 10 }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
              {filtered.length} of {deals.length}
            </span>
            {/* "+ New Enquiry" intentionally removed — the FAB (bottom-
                right of every page) is now the single entry point so
                the team builds the muscle memory of using it. */}
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
          highlightedDealId={highlightedDealId}
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
          focusField={openDeal.focusField ?? null}
          onClose={() => setOpenDeal(null)}
          onQuote={() => startQuote(openDeal.deal)}
          onUpdateStatus={updateEnquiryStatus}
          onUpdateProposalOutcome={updateProposalOutcome}
          onSetStage={updateDealStage}
          onOpenProposal={(p) => {
            // Open the proposal detail INLINE on top of the deal modal.
            // The deal modal stays mounted underneath; closing the
            // proposal modal returns to it. ProposalDetailModal still
            // handles the full edit surface (pricing, VAT, notes,
            // archive). For the common in-line actions (Send / Accept
            // / Decline) the buttons inside the proposal row fire
            // direct without opening this modal.
            setOpenProposal(p);
          }}
          onSendProposal={(p) => setSendingProposals([hydrateProposalContact(p)])}
          onSendDrafts={(drafts) => setSendingProposals(drafts.map(hydrateProposalContact))}
          onMarkProposalOutcome={(p, outcome) => {
            if (outcome === 'interested') {
              // Interested is a status-flip with no cascade, so use the
              // generic outcome path rather than markProposalOutcome
              // (which is for accept/decline). Reuses the existing
              // updateProposalOutcome by mapping to the proposal's
              // own status update.
              supabase
                .from('proposals')
                .update({ status: 'interested', updated_at: new Date().toISOString() })
                .eq('id', p.id)
                .then(() => { fetchDeals(); });
              return;
            }
            markProposalOutcome(p, outcome);
          }}
          onEditProposalPricing={async (p) => {
            // Inline shortcut to the same PricingModal-edit flow the
            // proposal detail modal exposes — saves the user a click.
            // Mark the host context as 'deal' so onPricingSaved knows
            // to refresh the deal modal in place rather than reopen
            // the (uninvolved) proposal detail modal.
            if (!p.pricing_proposal_id) return;
            const { data } = await supabase
              .from('pricing_proposals')
              .select('*')
              .eq('id', p.pricing_proposal_id)
              .single();
            if (data) {
              setEditPricingFor({
                ...data,
                _propertyName: p.property_name,
                _reopenDealId: openDeal?.deal.enquiry?.id ?? openDeal?.deal.key ?? null,
                // Carried so PricingModal can show per-stay totals
                // (e.g. "R 770 164 · 31n total") alongside the
                // per-night R-amount. Pulled from the host deal.
                _checkIn: openDeal?.deal.check_in ?? p.check_in ?? null,
                _checkOut: openDeal?.deal.check_out ?? p.check_out ?? null,
              });
            }
          }}
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
          onEditPricing={async () => {
            if (!openProposal.pricing_proposal_id) return;
            const { data } = await supabase
              .from('pricing_proposals')
              .select('*')
              .eq('id', openProposal.pricing_proposal_id)
              .single();
            if (data) {
              setEditPricingFor({
                ...data,
                _propertyName: openProposal.property_name,
                _reopenProposalId: openProposal.id,
                // Same per-stay totals carrier as the deal-modal path.
                _checkIn: openProposal.check_in ?? null,
                _checkOut: openProposal.check_out ?? null,
              });
              setOpenProposal(null);
            }
          }}
          onSend={() => {
            setSendingProposals([hydrateProposalContact(openProposal)]);
            setOpenProposal(null);
          }}
          onAccept={() => markProposalOutcome(openProposal, 'accepted')}
          // Same gate as the deal-modal Accept button — agent
          // enquiries with no disclosed guest can't be accepted
          // because the booking has no one to attribute to. We look
          // up the parent deal in the live `deals` array (the
          // proposal row itself doesn't carry is_agent + guest_name).
          acceptDisabledReason={(() => {
            const parent = deals.find(d => d.enquiry?.id === openProposal.enquiry_id);
            if (!parent?.is_agent) return null;
            if (parent.enquiry?.guest_name?.trim()) return null;
            return 'Add the guest name on the enquiry before accepting — agent proposals need a real guest to attribute the booking.';
          })()}
          onDecline={() => markProposalOutcome(openProposal, 'declined')}
          onOpenEnquiry={(enquiryId) => {
            // No longer route to /operations/proposals (it's being
            // retired). Find the deal and open the deal modal instead.
            setOpenProposal(null);
            const deal = deals.find(d => d.enquiry?.id === enquiryId);
            if (deal) setOpenDeal({ deal, mode: 'view' });
          }}
        />
      )}

      {editPricingFor && (
        <PricingModal
          property={{ id: editPricingFor.property_id, property_name: editPricingFor._propertyName }}
          supabase={supabase}
          editPricingProposal={editPricingFor}
          // Forward the stay length so the breakdown rows render the
          // running per-stay total under every per-night R-amount
          // ("R 24 844 / night · R 770 164 · 31n total") — same UX as
          // the EnquiryPropertyMatchModal Edit pricing flow. Computed
          // from whichever host opened this modal (deal vs proposal
          // detail) so the right dates feed in.
          nights={(() => {
            const ci = editPricingFor._checkIn;
            const co = editPricingFor._checkOut;
            if (!ci || !co) return undefined;
            const n = Math.round((new Date(co).getTime() - new Date(ci).getTime()) / (1000 * 60 * 60 * 24));
            return n > 0 ? n : undefined;
          })()}
          // Lock the channel pill in EVERY edit-pricing context — the
          // scenario was set at proposal creation and changing it on
          // edit would silently convert (e.g.) an agent quote into a
          // direct one, orphaning the commission split + the proposal
          // ref code. Direct vs agent enquiry both treated identically.
          lockScenario={true}
          onClose={() => setEditPricingFor(null)}
          onPricingSaved={async () => {
            // Two host contexts can open this:
            //  - the proposal detail modal (set _reopenProposalId)
            //  - the deal modal's inline Edit pricing button
            //    (set _reopenDealId)
            // We refresh deals and re-seat whichever was open so the
            // user sees the new price without the modal beneath
            // looking stale.
            const reopenProposalId = editPricingFor?._reopenProposalId;
            const reopenDealId = editPricingFor?._reopenDealId;
            setEditPricingFor(null);
            const refreshed = await fetchDeals();
            if (reopenProposalId) {
              const next = refreshed.flatMap(d => d.proposals).find(p => p.id === reopenProposalId);
              if (next) setOpenProposal(next);
            }
            if (reopenDealId) {
              const nextDeal = refreshed.find(d => (d.enquiry?.id ?? d.key) === reopenDealId);
              if (nextDeal) setOpenDeal(prev => prev ? { deal: nextDeal, mode: prev.mode } : { deal: nextDeal, mode: 'view' });
            }
          }}
        />
      )}

      {/* Property match modal triggered from a deal card's Create
          Proposal button. Same UX as enquiry creation step 2 —
          filtered properties + inline pricing + Edit pricing — but
          inserts proposals against the EXISTING enquiry rather
          than creating a new one. */}
      {matchForExisting && (
        <EnquiryPropertyMatchModal
          supabase={supabase}
          enquiry={matchForExisting.payload}
          existingEnquiry={{ id: matchForExisting.enquiryId, ref_code: matchForExisting.refCode }}
          initiallySelected={matchForExisting.initiallySelected ?? null}
          restrictToIds={matchForExisting.restrictToIds ?? null}
          onClose={() => setMatchForExisting(null)}
          onSaved={async (enquiryId) => {
            // Snap back to the kanban so the user SEES the card move
            // out of Arrived and into Quoting. Re-opening the deal
            // modal here was confusing — it looked like "the enquiry
            // form opened again" rather than confirming the save.
            setMatchForExisting(null);
            setOpenDeal(null);
            await fetchDeals();
            navigate(`/operations/enquiries?deal=${encodeURIComponent(enquiryId)}&highlight=1`, { replace: true });
          }}
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
      {sendingProposals && sendingProposals.length > 0 && (
        <SendProposalDialog
          proposals={sendingProposals}
          supabase={supabase}
          onClose={() => setSendingProposals(null)}
          onSent={() => {
            // Mark as Sent should snap the user back to the kanban so
            // they SEE the card move into Responded — leaving them on
            // the (now stale) deal modal was confusing. Mirror the
            // Accept-cascade flow: close every dialog, refetch the
            // board, then deep-link with highlight=1 so the card flashes.
            const enquiryId = sendingProposals[0]?.enquiry_id ?? null;
            setSendingProposals(null);
            setOpenProposal(null);
            setOpenDeal(null);
            fetchDeals();
            if (enquiryId) {
              navigate(`/operations/enquiries?deal=${encodeURIComponent(enquiryId)}&highlight=1`, { replace: true });
            }
          }}
          // Back only makes sense when sending a SINGLE proposal we
          // arrived at via its detail modal. Batch send (drafts list)
          // doesn't have a single "previous" modal to return to, so
          // omit the back button entirely in that case.
          onBack={sendingProposals.length === 1 ? () => {
            const row = sendingProposals[0];
            setSendingProposals(null);
            setOpenProposal(row);
          } : undefined}
        />
      )}

      {/* Accept blocker — when the user clicks Accept on an agent
          enquiry with no disclosed guest, surface a clear "why not"
          explanation and a one-click path to fix it (drops them into
          edit mode on the deal modal with focus on the guest fields).
          Replaces the silent disabled-button UX which left the user
          unsure what to do next. */}
      {acceptBlocker && (
        <ActionModal
          title="Can't accept yet"
          subtitle="Add the guest details first"
          width={460}
          onClose={() => setAcceptBlocker(null)}
          primaryAction={
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const target = acceptBlocker.deal;
                setAcceptBlocker(null);
                // focusField triggers DealDetailModal's auto-focus
                // effect → scrollIntoView + focus on the guest name
                // input so the user lands with the cursor blinking
                // exactly where they need to type. Zero hunting.
                setOpenDeal({ deal: target, mode: 'edit', focusField: 'guest_name' });
              }}
            >
              ✏ Add guest details
            </button>
          }
        >
          <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.5 }}>
            {acceptBlocker.reason}
          </p>
          <p style={{
            margin: '12px 0 0',
            fontSize: '0.8125rem',
            lineHeight: 1.5,
            color: 'var(--text-secondary)',
            padding: '8px 10px',
            borderRadius: 6,
            background: 'var(--surface-muted, #F3F4F6)',
          }}>
            Click <strong>Add guest details</strong> to open this enquiry in edit mode and fill in the guest's name. Once saved, Accept will unlock automatically.
          </p>
        </ActionModal>
      )}

      {/* Outcome confirmation — fires for every Accept / Decline on a
          proposal row (deal modal inline + ProposalDetailModal footer).
          Replaces the previous window.confirm so the prompt reads as a
          first-class step rather than a browser pop-up, and so the
          cascade copy can be properly formatted. */}
      {pendingOutcome && (() => {
        const { proposal, outcome, liveSiblings } = pendingOutcome;
        const isAccept = outcome === 'accepted';
        const willCloseDeal = isAccept || (outcome === 'declined' && liveSiblings === 0);
        return (
          <ActionModal
            title={isAccept ? 'Mark this proposal as accepted?' : 'Mark this proposal as declined?'}
            subtitle={
              <>
                {titleCase(proposal.property_name)}
                {' '}
                <span style={{ fontFamily: 'monospace', color: 'var(--text-light)' }}>
                  · {proposal.ref_code}
                </span>
              </>
            }
            width={460}
            onClose={() => setPendingOutcome(null)}
            primaryAction={
              <button
                type="button"
                className={isAccept ? 'btn btn-primary' : 'btn btn-danger'}
                onClick={async () => {
                  const snapshot = pendingOutcome;
                  setPendingOutcome(null);
                  await applyProposalOutcome(snapshot.proposal, snapshot.outcome);
                }}
              >
                {isAccept ? '✓ Yes, accept' : '✕ Yes, decline'}
              </button>
            }
          >
            <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.5 }}>
              {isAccept
                ? `This locks the proposal as the agreed quote${liveSiblings > 0 ? ` and auto-declines the other ${liveSiblings} live proposal${liveSiblings === 1 ? '' : 's'} on this enquiry` : ''}.`
                : 'This marks the proposal as declined. The team can still see it in the deal history.'}
            </p>
            {willCloseDeal && (
              <p style={{
                margin: '12px 0 0',
                fontSize: '0.8125rem',
                lineHeight: 1.5,
                color: 'var(--text-secondary)',
                padding: '8px 10px',
                borderRadius: 6,
                background: 'var(--surface-muted, #F3F4F6)',
              }}>
                {isAccept
                  ? 'The enquiry will close as Won and move to the Booked column.'
                  : 'This is the last live proposal — the enquiry will close as Lost.'}
              </p>
            )}
          </ActionModal>
        );
      })()}
    </div>
  );
}

// ─── Kanban ─────────────────────────────────────────────────────────────

function KanbanView({
  byStage, columnSort, onColumnSortChange, onOpen, onQuote, onSend, flashStage, highlightedDealId,
}: {
  byStage: Record<string, Deal[]>;
  columnSort: Record<string, string>;
  onColumnSortChange: (stage: string, value: string) => void;
  onOpen: (d: Deal) => void;
  onQuote: (d: Deal) => void;
  onSend: (d: Deal) => void;
  flashStage?: string | null;
  highlightedDealId?: string | null;
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
              {/* Per-column sort dropdown removed — the smart per-
                  column defaults (FIFO triage for Arrived, upcoming
                  check-in first for Quoting/Responded/Booked, most-
                  recent for Closed) are what the team actually wants,
                  and an unused control just added noise to the header. */}
            </div>
          </div>
          <KanbanColumnBody
            deals={byStage[col.key]}
            stage={col.key}
            emptyMsg={col.emptyMsg}
            onOpen={onOpen}
            onQuote={onQuote}
            onSend={onSend}
            highlightedDealId={highlightedDealId}
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
  deals, stage, emptyMsg, onOpen, onQuote, onSend, highlightedDealId,
}: {
  deals: Deal[];
  stage: string;
  emptyMsg: string;
  onOpen: (d: Deal) => void;
  onQuote: (d: Deal) => void;
  onSend: (d: Deal) => void;
  highlightedDealId?: string | null;
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
          {/* New column renders as an inbox list — each enquiry is a
              dense single line with subject + agent + dates + notes
              preview, ordered FIFO. The card layout doesn't help
              here because a fresh enquiry has no property attached
              yet, so 5 cards from one agent look identical. Inbox
              rows are built for differentiating similar items. The
              rest of the columns keep the card layout because by
              then properties exist and cards differentiate. */}
          {stage === 'new'
            ? deals.map(d => (
                <InboxRow
                  key={d.key}
                  deal={d}
                  onOpen={onOpen}
                  highlighted={d.enquiry?.id === highlightedDealId}
                />
              ))
            : deals.map(d => (
                <DealCard
                  key={d.key}
                  deal={d}
                  stage={stage}
                  onOpen={onOpen}
                  onQuote={onQuote}
                  onSend={onSend}
                  compact={compact}
                  highlighted={d.enquiry?.id === highlightedDealId}
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

// ─── Inbox row (used in the New column only) ────────────────────────────
// One-line-per-enquiry view because cards make 5 enquiries from the same
// agent look identical (no property is attached at New). Inbox UX is
// built for differentiating similar items: subject leads, agent +
// dates + notes preview underneath, ref + time-ago on the right.
const InboxRow = memo(InboxRowImpl, (prev, next) =>
  // Identity compare on the value props that drive the visible UI.
  // Function props are intentionally ignored: they're closures freshly
  // created on every parent render, but their behaviour is stable
  // (they delegate to setState calls in PipelinePage). Comparing them
  // would defeat the memo entirely while adding nothing for correctness.
  prev.deal === next.deal &&
  prev.highlighted === next.highlighted
);

function InboxRowImpl({ deal, onOpen, highlighted }: { deal: Deal; onOpen: (d: Deal) => void; highlighted?: boolean }) {
  const e = deal.enquiry;
  // Agent rows: disclosed guest name wins > subject. Direct rows
  // just use the recipient (who IS the guest).
  const subject = deal.is_agent
    ? (e?.guest_name?.trim() ? titleCase(e.guest_name) : e?.subject?.trim() || '')
    : titleCase(deal.client_name);
  const notesPreview = e?.notes?.trim() || null;
  const dateRange = (deal.check_in && deal.check_out)
    ? `${fmtDate(deal.check_in)} → ${fmtDate(deal.check_out)}`
    : null;
  const agentLine = deal.is_agent
    ? `🤝 via ${titleCase(deal.client_name)}`
    : `👤 ${titleCase(deal.client_name)}`;
  const guestsLine = deal.guests_total ? `${deal.guests_total} guests` : null;
  const refCode = e?.ref_code ?? deal.proposals[0]?.ref_code ?? '';
  const ageDays = daysSince(deal.created_at);
  const ageLabel = ageDays < 1 ? 'today' : ageDays === 1 ? '1d' : `${ageDays}d`;
  const ageCls = ageDays >= 5 ? 'ops-board-card-days--warn'
    : ageDays >= 10 ? 'ops-board-card-days--hot' : '';
  // The type stripe carries over so the agent/direct visual marker
  // is consistent with what cards show in other columns.
  const typeClass = deal.is_agent ? 'ops-board-card--agent' : 'ops-board-card--direct';
  return (
    <div
      data-deal-id={deal.enquiry?.id}
      className={`ops-board-card ${typeClass} ${highlighted ? 'ops-board-card--flash' : ''}`.trim()}
      style={{
        padding: '8px 10px',
        cursor: 'pointer',
      }}
      onClick={() => onOpen(deal)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onOpen(deal); } }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
        <span style={{
          fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)',
          flex: 1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={subject || refCode}>
          {subject || <span style={{ fontStyle: 'italic', color: 'var(--text-light)' }}>(no subject — open to add)</span>}
        </span>
        <span className={`ops-board-card-days ${ageCls}`} style={{ flexShrink: 0 }}>{ageLabel}</span>
        {e?.created_by_initials && (
          <CreatorInitialsPill initials={e.created_by_initials} />
        )}
      </div>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2,
        fontSize: '0.75rem', color: 'var(--text-secondary)', minWidth: 0,
      }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agentLine}
          {dateRange && <> · {dateRange}</>}
          {guestsLine && <> · {guestsLine}</>}
        </span>
        {/* Ref code intentionally not shown — the deal modal carries
            it in the subtitle when needed. The card's job is at-a-
            glance triage; ref codes are reference data, not triage. */}
      </div>
      {notesPreview && (
        <div style={{
          marginTop: 4, fontSize: '0.75rem', color: 'var(--text-secondary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontStyle: 'italic',
        }} title={notesPreview}>
          “{notesPreview}”
        </div>
      )}
    </div>
  );
}

// ─── Deal card ──────────────────────────────────────────────────────────

const DealCard = memo(DealCardImpl, (prev, next) =>
  // Same rationale as InboxRow: skip function-prop compares so search-
  // box keystrokes + unrelated state changes don't re-render every
  // card on the board. The deal object reference is stable between
  // refetches (a new array is built, but a card whose data didn't
  // change still gets a fresh object — accepted cost for correctness).
  prev.deal === next.deal &&
  prev.stage === next.stage &&
  prev.closed === next.closed &&
  prev.compact === next.compact &&
  prev.highlighted === next.highlighted
);

function DealCardImpl({
  deal, stage, onOpen, onQuote, onSend, closed, compact, highlighted,
}: {
  deal: Deal;
  stage: string;
  onOpen: (d: Deal) => void;
  onQuote: (d: Deal) => void;
  onSend: (d: Deal) => void;
  closed?: boolean;
  compact?: boolean;
  highlighted?: boolean;
}) {
  const isClosed = closed || stage === 'won' || stage === 'lost';
  const isStale = stage === 'new' && daysSince(deal.created_at) >= STALE_DAYS;
  const isStalled = stage === 'stalled';
  const isWon = stage === 'won';
  const isLost = stage === 'lost';
  // Expired ≠ Lost. Lost is a manual outcome; expired just means the
  // stay window's already in the past with no booking — the lead's
  // cold by definition. Both end up in the Closed column, but the
  // card carries the right tag so the reason is unambiguous.
  const isExpiredCard = !isWon && !isLost && isExpired(deal);
  const stop = (fn: (e: React.MouseEvent) => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(e); };

  // For Sent column, surface a viewed badge if any proposal's been opened.
  const wasViewed = (stage === 'sent' || stage === 'stalled') &&
    deal.proposals.some(p => p.status === 'viewed' || p.viewed_at);

  // The card is purely informational; click opens the deal modal where
  // all actions live. Renders deal-shaped info: agent/guest identity
  // unambiguous, and every proposal listed inline with its property +
  // status so the parent enquiry → child proposals tree reads at a
  // glance (Phase 1 of the unified Deals board redesign).
  const proposalCount = deal.proposals.length;
  // Up to 3 proposals visible inline; the rest collapse to a "+N more"
  // line that opens the deal modal (where every proposal is listed).
  const PROPOSAL_PREVIEW_LIMIT = 3;
  const previewProposals = deal.proposals.slice(0, PROPOSAL_PREVIEW_LIMIT);
  const overflowCount = Math.max(0, proposalCount - PROPOSAL_PREVIEW_LIMIT);

  // ── Headline derivation ────────────────────────────────────────────
  // Direct deals headline with the guest name (recipient IS guest).
  // Agent deals headline with what makes them DISTINCT — the property
  // they're asking about and/or the dates. The agent name is the same
  // across every enquiry an agent submits, so leading with it makes
  // 5 enquiries in one day look identical at a glance. Leading with
  // the property/dates makes each card scannable in one beat.
  const dateRange = (deal.check_in && deal.check_out)
    ? `${fmtDate(deal.check_in)} → ${fmtDate(deal.check_out)}`
    : null;
  const propertySummary = (() => {
    if (proposalCount === 0) return null;
    if (proposalCount === 1) return titleCase(deal.proposals[0].property_name);
    return `${proposalCount} properties`;
  })();
  // Agent-deal headline priority (per the New Enquiry form's
  // identifier toggle): disclosed guest name wins > subject >
  // property+dates legacy fallback. Direct deals always use the
  // recipient name because they have no agent intermediary.
  const agentGuestHeadline = deal.is_agent
    ? (deal.enquiry?.guest_name?.trim() ? titleCase(deal.enquiry.guest_name) : null)
    : null;
  const subjectHeadline = deal.is_agent
    ? (deal.enquiry?.subject?.trim() || null)
    : null;
  const headline = agentGuestHeadline ?? subjectHeadline ?? (
    !deal.is_agent
      ? titleCase(deal.client_name)
      : (
          // Pre-identifier legacy rows: property + dates > property
          // > dates > agent name (last-resort).
          (propertySummary && dateRange) ? `${propertySummary} · ${dateRange}` :
          propertySummary ? propertySummary :
          dateRange ? dateRange :
          titleCase(deal.client_name)
        )
  );
  // Guest sub-line — only meaningful for agent deals. Direct deals'
  // client_name IS the guest, so showing a second line would just
  // duplicate. For agent deals, prefer the enquiry's disclosed
  // guest_name; "Not disclosed yet" when blank.
  const guestSubLine = deal.is_agent
    ? (deal.enquiry?.guest_name?.trim() || 'Not disclosed yet')
    : null;
  // Agent context line — only for agent deals; the small line beneath
  // the property/dates headline that tells the user WHO the agent is.
  // Format: "🤝 via Sarah · Cape Villas" or "🤝 via Sarah" if no company.
  const agentContext = deal.is_agent
    ? `🤝 via ${titleCase(deal.client_name)}`
    : null;

  // Type stripe: a 4px left border in the agent/direct accent colour so
  // the type is unmissable even when scanning a packed column. The
  // matching tag below repeats the info in words for the dumbest-user
  // model — colour AND text both work, redundantly.
  const typeClass = deal.is_agent ? 'ops-board-card--agent' : 'ops-board-card--direct';
  // Stalled / won / lost / expired get their own subtle accent on
  // top of the type stripe — colour cue without changing layout.
  const stateClass =
    isStalled     ? 'ops-board-card--stalled' :
    isWon         ? 'ops-board-card--won'     :
    isLost        ? 'ops-board-card--lost'    :
    isExpiredCard ? 'ops-board-card--lost'    : '';

  return (
    <div
      data-deal-id={deal.enquiry?.id}
      className={`ops-board-card ${typeClass} ${stateClass} ${isStale ? 'ops-board-card--stale' : ''} ${highlighted ? 'ops-board-card--flash' : ''}`.trim()}
      onClick={() => onOpen(deal)}
    >
      <div className="ops-board-card-head">
        <span className="ops-board-card-client" title={headline}>
          {headline}
        </span>
        {/* Top-right slot — was the ref_code (useful for cross-ref in
            emails but not for at-a-glance scanning on the board). Now
            shows a compact stay-sizing pill: guests count + nights.
            Two universal facts for every enquiry, helps the eye sort
            "5 from same agent" by trip size at a glance. Ref_code
            stays accessible via the deal modal subtitle. */}
        {(() => {
          const guests = deal.guests_total;
          const nights = (deal.check_in && deal.check_out)
            ? Math.round((new Date(deal.check_out).getTime() - new Date(deal.check_in).getTime()) / (1000 * 60 * 60 * 24))
            : null;
          const bits = [
            guests ? `👥 ${guests}` : null,
            nights && nights > 0 ? `🌙 ${nights}n` : null,
          ].filter(Boolean);
          if (bits.length === 0) return null;
          return (
            <span
              className="ops-board-card-ref"
              title={[
                guests ? `${guests} guests` : null,
                nights ? `${nights} nights` : null,
                deal.enquiry?.ref_code ? `Ref ${deal.enquiry.ref_code}` : null,
              ].filter(Boolean).join(' · ')}
              style={{ fontFamily: 'inherit' }}
            >
              {bits.join(' · ')}
            </span>
          );
        })()}
      </div>

      {/* Agent context line — only for agent deals. Tells the reader
          WHICH agent without making the agent's name the headline (the
          headline now leads with property + dates so 5 enquiries from
          the same agent are visually distinct). For direct deals this
          line is suppressed because the headline IS the guest. */}
      {agentContext && (
        <div style={{
          fontSize: '0.75rem',
          color: 'var(--text-secondary)',
          marginBottom: 2,
        }}>
          {agentContext}
          {guestSubLine && (
            <>
              {' · '}
              <span style={{ fontStyle: deal.enquiry?.guest_name ? 'normal' : 'italic' }}>
                Guest: {guestSubLine}
              </span>
            </>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
        {deal.is_agent
          ? <span className="ops-board-card-tag ops-board-card-tag--agent">🤝 Agent</span>
          : deal.enquiry?.source === 'platform'
            ? <span className="ops-board-card-tag" style={{ background: '#FEF3C7', color: '#92400E' }}>🔗 Platform</span>
            : <span className="ops-board-card-tag ops-board-card-tag--direct">👤 Direct</span>}
        {/* When the enquiry was tagged as Platform with a back-link,
            show a tiny 🔗 button that opens the conversation thread
            on Airbnb/Booking/etc. in a new tab. One-click jump back
            to the message without opening the deal modal. */}
        {deal.enquiry?.source === 'platform' && deal.enquiry?.source_url && (
          <a
            href={deal.enquiry.source_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Open the conversation on the platform"
            style={{
              fontSize: '0.75rem',
              padding: '1px 6px',
              borderRadius: 3,
              background: '#FEF3C7',
              color: '#92400E',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            ↗ Thread
          </a>
        )}
        {isStalled && <span className="ops-board-card-tag ops-board-card-tag--stalled">⚠ Stalled</span>}
        {isWon && <span className="ops-board-card-tag ops-board-card-tag--won">✓ Booked</span>}
        {isLost && <span className="ops-board-card-tag ops-board-card-tag--lost">✕ Closed</span>}
        {isExpiredCard && <span className="ops-board-card-tag ops-board-card-tag--lost">⏰ Expired</span>}
        {wasViewed && <span className="ops-board-card-tag ops-board-card-tag--viewed">Viewed</span>}
        {/* Sent progress badge — visible whenever at least one of
            the deal's proposals has gone out. Tells the user
            "how much of this enquiry has actually been quoted
            to the client" without opening the deal modal. */}
        {(() => {
          const sentLikeStatuses = new Set(['sent', 'viewed', 'interested', 'accepted', 'booked']);
          const sentCount = deal.proposals.filter(p => sentLikeStatuses.has(p.status)).length;
          if (sentCount === 0 || proposalCount === 0) return null;
          return (
            <span
              className="ops-board-card-tag"
              style={{ background: '#DBEAFE', color: '#1E40AF' }}
              title={`${sentCount} of ${proposalCount} proposals sent`}
            >
              📤 {sentCount}/{proposalCount} sent
            </span>
          );
        })()}
      </div>

      {/* Proposals strip — one row per proposal: property name + status
          pill. Replaces the old "1 proposal" tag + single property line.
          Now the card tells the truth about multi-property enquiries:
          which house, which status, all at once. */}
      {proposalCount > 0 && (
        <div style={{
          marginTop: 6,
          paddingTop: 6,
          borderTop: '1px solid var(--border-light)',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}>
          {previewProposals.map(p => {
            const cfg = PROPOSAL_STATUS_CONFIG[p.status] || { label: p.status, bg: '#F3F4F6', color: '#6B7280' };
            return (
              <div
                key={p.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: '0.75rem', minWidth: 0,
                }}
              >
                <span
                  style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: cfg.color, flexShrink: 0,
                  }}
                  title={cfg.label}
                />
                <span style={{
                  flex: 1, minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: 'var(--text)',
                }} title={p.property_name}>
                  {titleCase(p.property_name)}
                </span>
                <span style={{
                  fontSize: '0.6875rem', color: cfg.color, fontWeight: 500,
                  flexShrink: 0,
                }}>
                  {cfg.label}
                </span>
              </div>
            );
          })}
          {overflowCount > 0 && (
            <div style={{
              fontSize: '0.6875rem',
              color: 'var(--text-light)',
              fontStyle: 'italic',
            }}>
              +{overflowCount} more
            </div>
          )}
        </div>
      )}

      <div className="ops-board-card-meta" style={{ marginTop: 6 }}>
        {deal.check_in && deal.check_out
          ? <span>{fmtDate(deal.check_in)} to {fmtDate(deal.check_out)}<NightCount checkIn={deal.check_in} checkOut={deal.check_out} /></span>
          : <span style={{ fontStyle: 'italic' }}>No dates</span>}
        <span style={{ flex: 1 }} />
        {(() => {
          const days = daysSince(deal.created_at);
          if (days < 1) return null;
          const cls = days >= 10 ? 'ops-board-card-days--hot'
            : days >= 5 ? 'ops-board-card-days--warn' : '';
          return <span className={`ops-board-card-days ${cls}`}>{days}d</span>;
        })()}
        {deal.enquiry?.created_by_initials && (
          <CreatorInitialsPill initials={deal.enquiry.created_by_initials} />
        )}
      </div>

    </div>
  );
}

/** Small 2-letter pill on each card identifying who captured the enquiry.
 *  Anchored bottom-right of the meta row so it doesn't fight the action
 *  buttons or status pills for space. Each team member gets their own
 *  colour so the board reads at a glance even before you focus the pill:
 *    JH → black   (Jordon)
 *    GH → grey    (Gary)
 *    HH → pink    (Hayley)
 *    NT → blue    (Nicki)
 *  Unknown initials fall back to the neutral muted-grey treatment. */
const INITIALS_COLOURS: Record<string, { bg: string; fg: string }> = {
  JH: { bg: '#111827', fg: '#FFFFFF' },
  GH: { bg: '#9CA3AF', fg: '#FFFFFF' },
  HH: { bg: '#EC4899', fg: '#FFFFFF' },
  NT: { bg: '#2563EB', fg: '#FFFFFF' },
};

function CreatorInitialsPill({ initials }: { initials: string }) {
  const colour = INITIALS_COLOURS[initials] ?? {
    bg: 'var(--surface-muted, #F3F4F6)',
    fg: 'var(--text-secondary, #6B7280)',
  };
  return (
    <span
      title={`Captured by ${initials}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 22,
        height: 18,
        padding: '0 5px',
        borderRadius: 9,
        background: colour.bg,
        color: colour.fg,
        fontSize: '0.6875rem',
        fontWeight: 700,
        letterSpacing: '0.02em',
        flexShrink: 0,
      }}
    >
      {initials}
    </span>
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
        // Use the full deal so the New column splits by agent vs direct.
        const col = columnForDeal(r.deal);
        const label = STAGES.find(s => s.key === col)?.label || col;
        return (
          <span className={`ops-status-pill ops-status-pill--${col}`}>
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

/** Single proposal row inside DealDetailModal. Status-aware action UX:
 *  - Drafting / ready  → ✉ Send (primary, opens SendProposalDialog)
 *  - Sent / interested → ✓ Accept + ✕ Decline (cascading outcome)
 *  - Terminal          → status pill only, no actions
 *  Property name itself is a clickable link that opens the full
 *  ProposalDetailModal for everything else (edit pricing, VAT, notes,
 *  resend, cancel/archive). Layout reuses .editor-list-row + .btn-*
 *  classes so it sits naturally next to the rest of the modal. */
function ProposalRowInline({
  proposal,
  onOpen,
  onSend,
  onMarkOutcome,
  onEditPricing,
  onDelete,
  acceptDisabledReason,
}: {
  proposal: ProposalRow;
  onOpen: () => void;
  onSend: () => void;
  onMarkOutcome: (outcome: 'accepted' | 'declined' | 'interested') => void;
  /** Opens the full PricingModal pre-filled with this proposal's snapshot
   *  so the user can adjust daily rate + per-night total without
   *  drilling into the proposal detail page first. Only relevant when
   *  the row has a pricing_proposal_id (older rows pre-pricing didn't). */
  onEditPricing?: () => void;
  /** Only set when the deal modal is in edit mode — shows a destructive
   *  "Delete" action on the row so the user can prune unwanted quotes. */
  onDelete?: () => void;
  /** When set, the Accept button is disabled and shows this string as
   *  the hover hint. Used for agent enquiries that haven't disclosed
   *  the guest yet — accepting without a guest leaves the booking
   *  un-attributable. Decline stays available because rejecting a
   *  quote needs no guest identity. */
  acceptDisabledReason?: string | null;
}) {
  const p = proposal;
  const isDraft = p.status === 'draft' || p.status === 'drafting' || p.status === 'ready';
  const isActiveSent = p.status === 'sent' || p.status === 'viewed' || p.status === 'interested';
  const isTerminal = INACTIVE_PROPOSAL_STATUSES.has(p.status);
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

  return (
    <div
      className="editor-list-row"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      <div className="editor-list-main">
        <div className="editor-list-title">{titleCase(p.property_name)}</div>
        <div className="editor-list-sub">
          {p.guest_price != null ? <><strong>{fmtRand(p.guest_price)}</strong> / night</> : 'No pricing'}
          {/* Per-stay total — surfaced inline so the user sees both
              the headline rate AND what the guest will actually pay
              for the whole booking. Only renders when we have both
              a price and a valid night count to multiply by. */}
          {(() => {
            const n = nightsBetween(p.check_in, p.check_out);
            if (p.guest_price == null || n == null) return null;
            return (
              <span style={{ color: 'var(--text-light)' }}>
                {' · '}{fmtRand(p.guest_price * n)} · {n}n total
              </span>
            );
          })()}
          {p.scenario_type && <span style={{ color: 'var(--text-light)' }}> · {p.scenario_type}</span>}
          <span style={{ marginLeft: 8, fontFamily: 'monospace', fontSize: '0.6875rem', color: 'var(--text-light)' }}>{p.ref_code}</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <StatusBadge status={p.status} config={PROPOSAL_STATUS_CONFIG} />
        {/* Eye icon — opens the public proposal page in a new
            tab (exactly what the client / agent sees when they
            get the link). Uses the same .btn-ghost shape as the
            other compact action buttons in this row so the icon
            sits naturally without a heavier wrapper. */}
        <a
          href={`/proposal.html?ref=${encodeURIComponent(p.ref_code)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="btn btn-ghost"
          style={{ fontSize: '0.75rem', padding: '4px 8px', textDecoration: 'none' }}
          title="Preview the proposal as the recipient sees it"
        >
          👁 View
        </a>
        {onEditPricing && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: '0.75rem', padding: '4px 8px' }}
            onClick={stop(onEditPricing)}
            title="Edit pricing — opens the full calculator with daily rate + per-night totals"
          >
            ✎ Edit pricing
          </button>
        )}
        {isDraft && (
          <button
            type="button"
            className="btn btn-primary"
            style={{ fontSize: '0.75rem', padding: '4px 10px' }}
            onClick={stop(onSend)}
            title="Send this proposal"
          >
            ✉ Send
          </button>
        )}
        {isActiveSent && (
          <>
            <button
              type="button"
              className="btn btn-outline-success"
              style={{
                fontSize: '0.75rem', padding: '4px 10px',
                // Visually flag the blocked state without preventing
                // the click — disabling the button silently swallowed
                // the click and left the user wondering what to do
                // next. Now the button STILL fires; the parent shows
                // an explainer modal with a path to unblock it.
                ...(acceptDisabledReason ? { opacity: 0.55 } : {}),
              }}
              onClick={stop(() => onMarkOutcome('accepted'))}
              title={acceptDisabledReason || 'Mark accepted (cascades — closes deal, auto-declines siblings)'}
            >
              ✓ Accept
            </button>
            <button
              type="button"
              className="btn btn-outline-danger"
              style={{ fontSize: '0.75rem', padding: '4px 10px' }}
              onClick={stop(() => onMarkOutcome('declined'))}
              title="Mark declined"
            >
              ✕ Decline
            </button>
          </>
        )}
        {isTerminal && null}
        {onDelete && (
          <button
            type="button"
            className="btn btn-outline-danger"
            style={{ fontSize: '0.75rem', padding: '4px 10px' }}
            onClick={stop(onDelete)}
            title="Delete this proposal — removes it from the deal entirely"
          >
            🗑 Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Deal detail modal ──────────────────────────────────────────────────

function DealDetailModal({
  deal, initialMode = 'view', focusField = null, onClose, onQuote,
  onUpdateStatus, onUpdateProposalOutcome, onSetStage,
  onOpenProposal, onSendProposal, onSendDrafts, onMarkProposalOutcome, onEditProposalPricing,
}: {
  deal: Deal;
  initialMode?: 'view' | 'edit';
  /** When set, the modal auto-scrolls + focuses the matching
   *  `data-field="<focusField>"` input on mount. Used by the
   *  accept-blocker flow to drop the user straight onto the guest
   *  name field with the cursor ready to type. */
  focusField?: string | null;
  onClose: () => void;
  onQuote: () => void;
  onUpdateStatus: (enquiryId: string, status: string) => void;
  onUpdateProposalOutcome: (proposalId: string, outcome: 'booked' | 'cancelled' | 'draft') => void;
  onSetStage: (enquiryId: string, dealStatus: string) => void;
  onOpenProposal: (p: ProposalRow) => void;
  /** Open SendProposalDialog for a single proposal (drafting/ready). */
  onSendProposal: (p: ProposalRow) => void;
  /** Open SendProposalDialog with every drafting/ready proposal on the
   *  deal — the common "agent enquired about 3 houses, send all
   *  quotes in one email" flow. */
  onSendDrafts: (drafts: ProposalRow[]) => void;
  /** Mark a sent/interested proposal as accepted or declined.
   *  Wraps the existing cascade logic (auto-decline siblings on
   *  accept; close enquiry as lost on last decline). */
  onMarkProposalOutcome: (p: ProposalRow, outcome: 'accepted' | 'declined' | 'interested') => void;
  /** Open the full PricingModal pre-filled with this proposal's
   *  snapshot. Avoids the two-click "open proposal detail → click
   *  Edit Pricing" detour for what's usually a quick rate tweak. */
  onEditProposalPricing: (p: ProposalRow) => void;
}) {
  const { supabase } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const e = deal.enquiry;
  // For standalone deals (no enquiry), outcome lives on the proposal itself.
  // Standalone deals only ever have one proposal (FAB creates 1:1).
  const standaloneProp = !e && deal.proposals[0] ? deal.proposals[0] : null;
  // isClosed must honour the derived dealStage — Accept on a
  // proposal cascades to enquiry.deal_status='won' but doesn't touch
  // enquiry.status, so checking status alone misses booked deals
  // that came in via the per-proposal Accept path.
  const derivedStage = e ? dealStage(deal) : null;
  const isClosed = e
    ? (
        derivedStage === 'won' || derivedStage === 'lost' ||
        e.status === 'booked' || e.status === 'cancelled'
      )
    : Boolean(standaloneProp && INACTIVE_PROPOSAL_STATUSES.has(standaloneProp.status));

  const [mode, setMode] = useState<'view' | 'edit'>(initialMode);

  // Auto-focus a specific input on mount when the caller asked for it
  // (e.g. accept-blocker → "Add guest details"). Two RAFs: the first
  // lets the modal mount + body render, the second waits a paint so
  // scrollIntoView lands on the final layout. focus() is wrapped in a
  // try so a removed/null input never throws.
  useEffect(() => {
    if (!focusField) return;
    let cancelled = false;
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        const el = document.querySelector<HTMLInputElement>(
          `input[data-field="${focusField}"]`,
        );
        if (!el) return;
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.focus({ preventScroll: true });
        } catch { /* noop */ }
      });
      return () => cancelAnimationFrame(raf2);
    });
    return () => { cancelled = true; cancelAnimationFrame(raf1); };
  }, [focusField]);

  /** Resolve the agent-portal "requested properties" UUIDs into
   *  display names so the deal modal can show "Agent requested
   *  quotes for: 104 Zwaanswyk, 12 Bordeaux, 129a Zwaanswyk" rather
   *  than a list of opaque IDs. One small lookup per modal open;
   *  no-op when the enquiry didn't come through the multi-property
   *  portal flow. */
  const requestedIds = e?.requested_property_ids ?? null;
  const [requestedPropertyNames, setRequestedPropertyNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!requestedIds || requestedIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('partner_properties')
        .select('id, property_name')
        .in('id', requestedIds);
      if (cancelled || !data) return;
      const map: Record<string, string> = {};
      for (const row of data as Array<{ id: string; property_name: string }>) {
        map[row.id] = row.property_name;
      }
      setRequestedPropertyNames(map);
    })();
    return () => { cancelled = true; };
  }, [supabase, JSON.stringify(requestedIds)]);

  // Snapshot of the editable shape for both enquiry-rooted and standalone
  // deals. Standalone deals don't carry bedrooms / budget on the proposal,
  // so those fields are hidden via conditional rendering.
  const initialForm = useMemo(() => ({
    subject: e?.subject ?? '',
    client_name: e?.client_name ?? standaloneProp?.guest_name ?? '',
    client_email: e?.client_email ?? standaloneProp?.guest_email ?? '',
    client_phone: e?.client_phone ?? standaloneProp?.guest_phone ?? '',
    nationality: e?.nationality ?? '',
    check_in: e?.check_in ?? standaloneProp?.check_in ?? '',
    check_out: e?.check_out ?? standaloneProp?.check_out ?? '',
    guests_total: e?.guests_total ?? standaloneProp?.guests_total ?? null,
    bedrooms_needed: e?.bedrooms_needed ?? null,
    /** Multi-select option arrays. Seed from the row when present;
     *  otherwise wrap the legacy single value so the edit UX is
     *  always a populated chip list. */
    bedrooms_options: (e?.bedrooms_options && e.bedrooms_options.length > 0)
      ? e.bedrooms_options
      : (e?.bedrooms_needed != null ? [e.bedrooms_needed] : []),
    budget_min: e?.budget_min ?? null,
    budget_max: e?.budget_max ?? null,
    notes: e?.notes ?? standaloneProp?.notes ?? '',
    // Agent enquiries only — captured/edited in the "Guest" section
    // below. Saving these triggers a cascade to all linked proposals so
    // the proposal page personalisation flips from "Dear Guest" to the
    // disclosed guest's name.
    guest_name: e?.guest_name ?? '',
    guest_email: e?.guest_email ?? '',
    guest_phone: e?.guest_phone ?? '',
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

  /** Proposal staged for deletion. The Delete button on a proposal row
   *  doesn't fire the destructive action directly — it sets this
   *  state, which renders a styled confirm dialog (ActionModal). The
   *  actual delete only runs when the user confirms in that dialog. */
  const [confirmDeleteProposal, setConfirmDeleteProposal] = useState<ProposalRow | null>(null);
  const [deletingProposal, setDeletingProposal] = useState(false);

  /** Edit-mode-only: delete a single proposal from this deal. Cleans up
   *  the linked pricing_proposals row (best-effort), refreshes the
   *  board, and — when the last proposal is removed — flips the
   *  enquiry's deal_status back to 'new' so the card lands in Arrived,
   *  closes the modal, and flashes the card on the kanban so the user
   *  sees where it went. */
  async function performDeleteProposal(p: ProposalRow) {
    if (deletingProposal) return;
    setDeletingProposal(true);
    try {
      const isLastProposal = deal.proposals.length === 1;
      const pricingId = p.pricing_proposal_id;
      const { error: delErr } = await supabase.from('proposals').delete().eq('id', p.id);
      if (delErr) throw delErr;
      if (pricingId) {
        // Pricing rows are 1:1 with proposals — orphaned snapshots just
        // sit around forever otherwise. Failure here is non-fatal.
        await supabase.from('pricing_proposals').delete().eq('id', pricingId);
      }
      if (isLastProposal && e) {
        await supabase
          .from('enquiries')
          .update({ deal_status: 'new', updated_at: new Date().toISOString() })
          .eq('id', e.id);
      }
      toast.success('Proposal deleted');
      notifyPipelineChanged();
      setConfirmDeleteProposal(null);
      if (isLastProposal && e) {
        onClose();
        navigate(`/operations/enquiries?deal=${encodeURIComponent(e.id)}&highlight=1`, { replace: true });
      }
    } catch (err: any) {
      console.error('deleteProposal failed:', err);
      toast.error('Failed to delete: ' + (err?.message || String(err)));
    } finally {
      setDeletingProposal(false);
    }
  }

  async function save() {
    if (e) {
      // For direct (non-agent) enquiries, mirror client_* into guest_* on
      // save so the "guest_* is the underlying guest" convention stays
      // honest. For agent enquiries, guest_* is captured separately in
      // its own section and may be empty (cascade no-ops in that case).
      const guestName  = e.is_agent ? (form.guest_name  || null) : (form.client_name);
      const guestEmail = e.is_agent ? (form.guest_email || null) : (form.client_email || null);
      const guestPhone = e.is_agent ? (form.guest_phone || null) : (form.client_phone || null);

      await supabase.from('enquiries').update({
        subject: form.subject.trim() || null,
        client_name: form.client_name,
        client_email: form.client_email || null,
        client_phone: form.client_phone || null,
        nationality: form.nationality || null,
        check_in: form.check_in || null,
        check_out: form.check_out || null,
        // Keep legacy scalar columns populated with the min of the
        // multi-select so older readers (pipeline kanban, list
        // view) still get a usable single value, while the arrays
        // power the tighter property match .in() filter.
        guests_total:     form.guests_total ?? 1,
        bedrooms_needed:  form.bedrooms_options.length > 0 ? Math.min(...form.bedrooms_options) : (form.bedrooms_needed ?? 1),
        guests_options:   null,
        bedrooms_options: form.bedrooms_options.length > 0 ? form.bedrooms_options : null,
        budget_min: form.budget_min,
        budget_max: form.budget_max,
        notes: form.notes || null,
        guest_name: guestName,
        guest_email: guestEmail,
        guest_phone: guestPhone,
        updated_at: new Date().toISOString(),
      }).eq('id', e.id);

      // Cascade guest details to all linked proposals so the public
      // page personalises ("Dear Sarah,") and SendProposalDialog's
      // WhatsApp / Email buttons appear once contact details land.
      //
      // Fires whenever guest_name, guest_email OR guest_phone changed
      // — covers two real flows:
      //   1. Agent enquiry: guest disclosed later → name + contact
      //      cascade so "Dear Guest" flips to the real name.
      //   2. Direct enquiry: ladies often save with just a name first,
      //      then come back to add a phone or email. Without this
      //      cascade the proposal rows kept the original null contact
      //      and the Send dialog couldn't surface WhatsApp / Email.
      const contactChanged =
        guestName  !== initialForm.guest_name  ||
        guestEmail !== (initialForm.guest_email || null) ||
        guestPhone !== (initialForm.guest_phone || null) ||
        // Direct: client_* IS the contact, so changes there also need
        // to cascade. initialForm.client_email is a string '', not null.
        (!e.is_agent && (
          (form.client_email || null) !== (initialForm.client_email || null) ||
          (form.client_phone || null) !== (initialForm.client_phone || null)
        ));
      if (contactChanged) {
        await supabase
          .from('proposals')
          .update({
            guest_name: guestName,
            guest_email: guestEmail,
            guest_phone: guestPhone,
            updated_at: new Date().toISOString(),
          })
          .eq('enquiry_id', e.id);
      }

      // CRM auto-link: when guest details land for the first time (or
      // change), ensure a guests row exists and that the enquiry points
      // at it. Silent on failure — don't block the save UX.
      if (guestName || guestEmail) {
        try {
          await linkOrCreateGuestForEnquiry(supabase, {
            enquiryId: e.id,
            partnerId: CT_RENTALS_PARTNER_ID,
            guestName: guestName,
            guestEmail: guestEmail,
            guestPhone: guestPhone,
          });
        } catch (err) {
          console.error('Guest CRM link failed (non-blocking):', err);
        }
      }
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

  // A real guest is required before a deal can be booked — the
  // booking row needs a name (and ideally email/phone) to be useful
  // downstream (calendar, contracts, communications). For agent
  // enquiries the disclosed guest is what counts; standalone deals
  // use the proposal's own guest_name.
  const canMarkBooked = e
    ? !!(form.guest_name?.trim() || (!e.is_agent && form.client_name?.trim()))
    : !!standaloneProp?.guest_name?.trim();
  const markBookedDisabledReason = canMarkBooked
    ? null
    : e?.is_agent
      ? 'Add the guest\'s name first — Mark Booked needs real guest details to create the booking.'
      : 'Add the guest\'s name first — Mark Booked needs real guest details.';

  function markBooked() {
    if (!canMarkBooked) {
      toast.warning(markBookedDisabledReason || 'Guest details required');
      return;
    }
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

  /** Unwind a Booked deal back to Responded. Reverses the accept
   *  cascade: the accepted proposal goes back to 'sent', sibling
   *  proposals that were auto-declined as "Superseded by accepted
   *  proposal" go back to 'sent' too (the cascade always fires from
   *  a sent/interested state), and the bookings row created at
   *  accept time is deleted. Confirms first so this can't be
   *  triggered accidentally. */
  async function reopenAsResponded() {
    if (!e) return;
    const ok = window.confirm(
      `Move this booking back to Responded?\n\n` +
      `This will:\n` +
      `  • restore each proposal to its exact pre-booking state\n` +
      `  • delete the booking row created when this deal was won\n\n` +
      `Continue?`
    );
    if (!ok) return;
    try {
      // Fetch every proposal touched by the accept cascade — the
      // accepted one(s) and any cascade-declined siblings — so we
      // can restore each row's pre-cascade status individually.
      // Two separate queries because the PostgREST .or() with
      // embedded and() didn't reliably match the multi-word
      // decline_reason value. Manual declines stay declined
      // (their decline_reason isn't "Superseded by ...").
      const [acceptedRes, supersededRes] = await Promise.all([
        supabase
          .from('proposals')
          .select('id, status, previous_status')
          .eq('enquiry_id', e.id)
          .in('status', ['accepted', 'booked']),
        supabase
          .from('proposals')
          .select('id, status, previous_status')
          .eq('enquiry_id', e.id)
          .eq('status', 'declined')
          .eq('decline_reason', 'Superseded by accepted proposal'),
      ]);
      type CRow = { id: string; status: string; previous_status: string | null };
      const cascaded: CRow[] = [
        ...((acceptedRes.data || []) as CRow[]),
        ...((supersededRes.data || []) as CRow[]),
      ];

      for (const row of cascaded) {
        // Restore to previous_status when recorded; otherwise fall
        // back to a sensible default — accepted → sent (you can't
        // accept what isn't sent), superseded sibling → drafting
        // (safer than assuming it was sent).
        const isAcceptedRow = row.status === 'accepted' || row.status === 'booked';
        const fallback = isAcceptedRow ? 'sent' : 'drafting';
        const target = row.previous_status || fallback;
        await supabase
          .from('proposals')
          .update({
            status: target,
            previous_status: null,
            decline_reason: null,
            accepted_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
      }

      // Drop the booking row that was created by the accept.
      await supabase.from('bookings').delete().eq('enquiry_id', e.id);

      // Enquiry back to Responded.
      await supabase
        .from('enquiries')
        .update({ status: 'sent', deal_status: 'sent', updated_at: new Date().toISOString() })
        .eq('id', e.id);

      notifyPipelineChanged();
      toast.success('Moved back to Responded');
      onClose();
      // Trigger the kanban highlight on the moved card. Reuses the
      // same ?deal=…&highlight=1 deep-link the new-enquiry flow
      // uses, so the user can see exactly where the card landed.
      navigate(`/operations/enquiries?deal=${encodeURIComponent(e.id)}&highlight=1`, { replace: true });
    } catch (err: any) {
      console.error('reopenAsResponded failed:', err);
      toast.error('Failed to reopen: ' + (err?.message || String(err)));
    }
  }

  const title = titleCase(form.client_name) || (deal.type === 'standalone' ? 'Standalone proposal' : 'Deal');
  const stage = dealStage(deal);
  const col = columnForDeal(deal);
  const accentColour = STAGE_ACCENT[col] ?? 'var(--text-light)';
  const stageLabel = STAGES.find(s => s.key === col)?.label ?? col;

  const subtitle = (
    <>
      <span>Stage: <strong style={{ color: 'var(--text)' }}>{stageLabel}</strong></span>
      {deal.enquiry?.ref_code && (
        <span>· <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--color-primary)' }}>{deal.enquiry.ref_code}</span></span>
      )}
      {deal.type === 'standalone' && <span>· standalone proposal</span>}
      {deal.check_in && deal.check_out && (
        <span>· {fmtDate(deal.check_in)} to {fmtDate(deal.check_out)}<NightCount checkIn={deal.check_in} checkOut={deal.check_out} /></span>
      )}
    </>
  );

  // Closed-state colour cue: green for Booked (happy terminal),
  // neutral grey for Closed (lost / expired). The existing
  // .detail-modal-mode-badge--closed + .detail-modal-banner--success
  // classes are both green — only apply them when stage is 'won';
  // for 'lost' fall back to inline-styled neutral variants so we
  // don't have to fork the shared CSS.
  const isWon = stage === 'won';
  const closedBadge = isClosed
    ? (isWon
        ? <span className="detail-modal-mode-badge detail-modal-mode-badge--closed">{stageLabel}</span>
        : <span
            className="detail-modal-mode-badge"
            style={{ background: 'var(--bg)', color: 'var(--text-light)', borderColor: 'var(--border)' }}
          >{stageLabel}</span>)
    : undefined;

  // Banners: closed-deal notice wins (terminal state, more
  // important to surface). Green for Booked, grey for Closed.
  const hasProposals = deal.proposals.length > 0;
  const banner = isClosed ? (
    <div
      className={`detail-modal-banner ${isWon ? 'detail-modal-banner--success' : ''}`}
      style={!isWon ? {
        background: 'var(--bg)', color: 'var(--text-secondary)',
        border: '1px solid var(--border)',
      } : undefined}
    >
      This deal is <strong>{stageLabel}</strong>. Use Reopen below to make changes.
    </div>
  ) : undefined;

  // Edit mode disables every action button in the footer so the
  // user can't half-edit + half-act (e.g. flip stage with stale
  // dates still in the form). Save / Cancel up top are the only
  // exits from edit mode; once back in view mode everything below
  // re-enables. Title attrs explain the why on hover.
  const isEditing = mode === 'edit';
  const editingDisabledTitle = 'Save or cancel your edits to use this action';
  const footerActions = (
    <>
      {/* Add Proposal is hidden on terminal-state deals (Booked /
          Closed) — once the deal is won or lost, raising another
          quote against it doesn't make sense. To work on it again
          the user must Reopen / Move back to Responded first. */}
      {!isClosed && (
        <button
          className="btn btn-primary"
          disabled={isEditing}
          title={isEditing ? editingDisabledTitle : undefined}
          onClick={async () => {
            // If the user has unsaved edits on the deal modal, flush
            // them first so the match modal's property filter sees
            // the latest dates / beds / guest count.
            if (isDirty) await save();
            onQuote();
          }}
        >
          📝 {deal.proposals.length === 0 ? 'Create Proposal' : 'Add another proposal'}
        </button>
      )}
      {!isClosed && e && (
        // Context-aware stage move. From New the user can advance to
        // Open or jump straight to Closed; from Open the only valid
        // forward move is Closed. "Closed" writes 'lost' (the default
        // terminal state — Mark Booked is the dedicated 'won' path
        // because it also creates a booking row).
        <select
          className="list-filter-select"
          value=""
          disabled={isEditing}
          onChange={(ev) => { if (ev.target.value) onSetStage(e.id, ev.target.value); }}
          title={isEditing ? editingDisabledTitle : 'Move this deal to a different column'}
        >
          <option value="" disabled>Set stage…</option>
          {/* "Quoting" was here but the natural way to move a deal
              into Quoting is to create a proposal (which auto-flips
              the deal_status). A manual stage flip with no proposal
              left empty Quoting cards on the board — confusing. */}
          <option value="lost">Closed</option>
          {/* "Booked" isn't here — Mark Booked is the dedicated path
              because it also writes a bookings row. */}
        </select>
      )}
      {/* Mark Booked / Mark Lost dropped from the footer — both are
          now reachable per-proposal (Accept / Decline buttons on
          each proposal row cascade to Booked / Lost). Keeps the
          deal footer focused on stage navigation. */}
      {isClosed && stage === 'won' && (
        <button
          className="btn btn-outline-danger"
          onClick={reopenAsResponded}
          title="Move this booking back to Responded — reverses the accept cascade"
        >
          ↺ Move back to Responded
        </button>
      )}
      {isClosed && stage === 'lost' && (
        <button className="btn btn-ghost" onClick={reopen} title="Reopen this deal">
          ↺ Reopen
        </button>
      )}
    </>
  );

  const footerHint = mode === 'edit'
    ? <>Editing client details. <strong>Save</strong> or <strong>Cancel</strong> to use the action buttons below.</>
    : <>Click <strong>Edit</strong> to change client details.</>;

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
      {/* Section ordering is hasProposals-driven: when the deal has at
          least one proposal, surface them first (that's what the user
          most likely came here for). Otherwise fall back to the original
          Client → Stay → Proposals(empty) order so the New-stage card
          editor still feels like a data form. */}
      {(() => {
        // Subject section sits ABOVE everything else — it's the
        // headline that the kanban shows. Only relevant for AGENT
        // enquiries (direct ones use the guest name as the headline
        // already). The subject IS the auto-generated AHH/N code
        // that downstream proposal refs lock to (e.g. AHH/1-P1),
        // so it's permanently read-only — letting the user edit it
        // would orphan every child proposal ref.
        const subjectSection = (e && e.is_agent) ? (
          <DetailModalSection
            heading="Subject"
            headingRight={<span style={{ fontSize: '0.6875rem', color: 'var(--text-light)' }}>locked · auto-generated</span>}
          >
            <input
              className="form-input"
              value={form.subject || ''}
              readOnly
              disabled
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontWeight: 600,
                color: 'var(--color-primary)',
                background: 'var(--surface-muted, #F3F4F6)',
                cursor: 'not-allowed',
              }}
              title="Auto-generated enquiry code. Locked — proposal refs (e.g. AHH/1-P1) depend on it."
            />
          </DetailModalSection>
        ) : null;
        const clientSection = (
          // For agent enquiries: split the section into two — the agent
          // (read-only, source-of-truth in Settings → Agents) and the
          // underlying guest (editable, may start empty, gets disclosed
          // later). Direct enquiries keep the single "Client details"
          // section since the recipient IS the guest.
          e?.is_agent ? (
            <>
              <DetailModalSection heading="Agent (recipient)" headingRight={<span style={{ fontSize: '0.6875rem', color: 'var(--text-light)' }}>edit in Settings → Agents</span>}>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">Name</label>
                    <input className="form-input" value={form.client_name} disabled readOnly />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <input className="form-input" value={form.client_email} disabled readOnly />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Phone</label>
                    <input className="form-input" value={form.client_phone} disabled readOnly />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Nationality</label>
                    <input className="form-input" value={form.nationality} onChange={ev => update('nationality', ev.target.value)} disabled={fieldsDisabled} />
                  </div>
                </div>
              </DetailModalSection>
              <DetailModalSection
                heading="Guest"
                headingRight={!form.guest_name && <span style={{ fontSize: '0.6875rem', color: 'var(--text-light)' }}>not disclosed yet</span>}
              >
                <fieldset disabled={fieldsDisabled} className="form-fieldset-reset">
                  <div className="form-grid-2">
                    <div className="form-group">
                      <label className="form-label">Guest name</label>
                      <input
                        className="form-input"
                        data-field="guest_name"
                        value={form.guest_name}
                        onChange={ev => update('guest_name', ev.target.value)}
                        placeholder="e.g. Sarah Whitmore"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Guest email</label>
                      <input type="email" className="form-input" value={form.guest_email} onChange={ev => update('guest_email', ev.target.value)} placeholder="guest@example.com" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Guest phone</label>
                      <input className="form-input" value={form.guest_phone} onChange={ev => update('guest_phone', ev.target.value)} placeholder="+27 …" />
                    </div>
                  </div>
                  {fieldsDisabled && !form.guest_name && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4, fontStyle: 'italic' }}>
                      Click Edit and fill in the guest's details when the agent shares them — linked proposals will update automatically.
                    </div>
                  )}
                </fieldset>
              </DetailModalSection>
            </>
          ) : (
            <DetailModalSection heading="Client details">
              <fieldset disabled={fieldsDisabled} className="form-fieldset-reset">
                <div className="form-grid-2">
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
          )
        );

        const staySection = (
          <DetailModalSection heading="Stay details">
            <fieldset disabled={fieldsDisabled} className="form-fieldset-reset">
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Check-in</label>
                  <input type="date" className="form-input" value={form.check_in || ''} onChange={ev => update('check_in', ev.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    Check-out
                    {/* Night count rendered as a coloured pill so the
                        stay length is obvious at a glance — the old
                        muted-grey "(N nights)" label was too easy to
                        miss next to the date input. */}
                    {(() => {
                      const n = nightsBetween(form.check_in, form.check_out);
                      if (n == null) return null;
                      return (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: 'var(--color-primary)',
                          color: '#fff',
                          fontSize: '0.6875rem',
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                        }}>
                          🌙 {n} night{n === 1 ? '' : 's'}
                        </span>
                      );
                    })()}
                  </label>
                  <input type="date" className="form-input" value={form.check_out || ''} onChange={ev => update('check_out', ev.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Guests</label>
                  {/* Single-value select — guests is a hard count
                      (a party of 8 is a party of 8), not a range
                      like bedrooms. Property match uses .eq(). */}
                  <select
                    className="form-input"
                    value={form.guests_total ?? 1}
                    onChange={ev => update('guests_total', Number(ev.target.value))}
                    disabled={fieldsDisabled}
                  >
                    {Array.from({ length: 20 }, (_, i) => i + 1).map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                {e && (
                  <div className="form-group">
                    <label className="form-label">Bedrooms needed</label>
                    <NumericMultiSelect
                      max={10}
                      value={form.bedrooms_options}
                      onChange={(next) => update('bedrooms_options', next as any)}
                      disabled={fieldsDisabled}
                      placeholder="Pick bedrooms…"
                      singular="bedroom"
                      plural="bedrooms"
                    />
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
        );

        // Drafts batch hint — the agent-enquiry-with-multiple-properties
        // flow lands here with N drafts ready to send to one recipient.
        // One click → SendProposalDialog with proposals[N].
        const drafts = deal.proposals.filter(p => p.status === 'draft' || p.status === 'drafting');
        const proposalsSection = (
          <DetailModalSection
            heading="Proposals"
            headingRight={deal.proposals.length ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span>{deal.proposals.length}</span>
                {drafts.length >= 2 && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                    onClick={() => onSendDrafts(drafts)}
                    title={`Send all ${drafts.length} drafts to ${titleCase(deal.client_name)} in one email`}
                  >
                    ✉ Send all {drafts.length} drafts
                  </button>
                )}
              </span>
            ) : null}
          >
            {deal.proposals.length === 0 ? (
              requestedIds && requestedIds.length > 0 ? (
                // Agent-portal multi-property enquiry — the agent
                // ticked these on /q/:token. We don't auto-create
                // proposals (ladies want to triage every incoming
                // agent enquiry in Arrived first), so this section
                // surfaces the picks + a one-click path to the
                // match modal pre-checked with exactly those IDs.
                // Team can review, drop unsuitable picks, or add
                // properties the agent didn't think of before
                // committing — same match modal as every other
                // "generate proposals" path.
                <div style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(99, 102, 241, 0.06)',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    🤝 Agent requested quotes for {requestedIds.length} propert{requestedIds.length === 1 ? 'y' : 'ies'}:
                  </div>
                  <ul style={{
                    margin: 0,
                    paddingLeft: 18,
                    fontSize: '0.875rem',
                    color: 'var(--text)',
                    display: 'flex', flexDirection: 'column', gap: 2,
                  }}>
                    {requestedIds.map(id => (
                      <li key={id} style={{ fontWeight: 500 }}>
                        {requestedPropertyNames[id]
                          ? titleCase(requestedPropertyNames[id])
                          : <span style={{ color: 'var(--text-light)', fontFamily: 'monospace', fontSize: '0.75rem' }}>{id.slice(0, 8)}…</span>}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ alignSelf: 'flex-start' }}
                    onClick={async () => {
                      // Same path as the "Create Proposal" footer
                      // button — flushes any pending edits first so
                      // the match modal sees the latest dates / beds
                      // / guests, then routes through onQuote (which
                      // already passes requested_property_ids as
                      // initiallySelected via startQuote).
                      if (isDirty) await save();
                      onQuote();
                    }}
                  >
                    📝 Generate proposals for {requestedIds.length === 1 ? 'this property' : `these ${requestedIds.length}`} →
                  </button>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', lineHeight: 1.4 }}>
                    The match modal will open showing only the agent's picks — review pricing and untick any you don't want to quote.
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                  No proposals yet. Use "Create Proposal" below to add one for this client.
                </div>
              )
            ) : (() => {
              // Agent enquiries can't accept a proposal until the
              // underlying guest is disclosed — accepting a quote with
              // no guest name leaves the booking un-attributable and
              // every downstream surface (booking row, invoice, comms)
              // would render "Valued Guest". Once the user adds the
              // guest's name on the enquiry the lock lifts and Accept
              // re-enables (the deal modal cascades guest_* to every
              // child proposal on save). Direct enquiries skip the
              // check because client_name IS the guest by definition.
              const acceptDisabledReason = (deal.is_agent && !deal.enquiry?.guest_name?.trim())
                ? 'Add the guest name on this enquiry before accepting — agent proposals need a real guest to attribute the booking.'
                : null;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {deal.proposals.map(p => (
                    <ProposalRowInline
                      key={p.id}
                      proposal={p}
                      onOpen={() => onOpenProposal(p)}
                      onSend={() => onSendProposal(p)}
                      onMarkOutcome={(outcome) => onMarkProposalOutcome(p, outcome)}
                      onEditPricing={p.pricing_proposal_id ? () => onEditProposalPricing(p) : undefined}
                      onDelete={mode === 'edit' ? () => setConfirmDeleteProposal(p) : undefined}
                      acceptDisabledReason={acceptDisabledReason}
                    />
                  ))}
                </div>
              );
            })()}
          </DetailModalSection>
        );

        return hasProposals
          ? <>{subjectSection}{proposalsSection}{clientSection}{staySection}</>
          : <>{subjectSection}{clientSection}{staySection}{proposalsSection}</>;
      })()}
      {/* Confirmation gate for proposal deletion — destructive, can't
          be undone, and (when it's the last proposal) flips the deal
          back to Arrived, so it deserves a real two-step prompt
          rather than a one-click button. Rendered as a sibling of
          the modal body so it overlays cleanly on top. */}
      {confirmDeleteProposal && (
        <ActionModal
          title="Delete this proposal?"
          subtitle={
            <>
              {titleCase(confirmDeleteProposal.property_name)}
              {' '}
              <span style={{ fontFamily: 'monospace', color: 'var(--text-light)' }}>
                · {confirmDeleteProposal.ref_code}
              </span>
            </>
          }
          width={460}
          onClose={() => { if (!deletingProposal) setConfirmDeleteProposal(null); }}
          primaryAction={
            <button
              type="button"
              className="btn btn-danger"
              disabled={deletingProposal}
              onClick={() => performDeleteProposal(confirmDeleteProposal)}
            >
              {deletingProposal ? 'Deleting…' : '🗑 Delete proposal'}
            </button>
          }
        >
          <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.5 }}>
            This permanently removes the proposal and its pricing snapshot.
            It can't be undone.
          </p>
          {deal.proposals.length === 1 && e && (
            <p style={{
              margin: '12px 0 0',
              fontSize: '0.8125rem',
              lineHeight: 1.5,
              color: 'var(--text-secondary)',
              padding: '8px 10px',
              borderRadius: 6,
              background: 'var(--surface-muted, #F3F4F6)',
            }}>
              This is the last proposal on enquiry <strong>{e.ref_code}</strong>.
              Deleting it moves the card back to <strong>Arrived</strong>.
            </p>
          )}
        </ActionModal>
      )}
    </DetailModal>
  );
}
