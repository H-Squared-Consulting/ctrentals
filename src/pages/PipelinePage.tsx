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
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import DataTable, { StatusBadge } from '../components/DataTable';
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
  { key: 'to_quote',   label: 'Enquiry',          description: 'Needs a proposal',       emptyMsg: 'Nothing pending' },
  { key: 'quoted',     label: 'Proposal created', description: 'Drafts not yet sent',    emptyMsg: 'No drafts' },
  { key: 'sent',       label: 'Proposal Sent',    description: 'Out with the recipient', emptyMsg: 'Nothing awaiting response' },
  { key: 'interested', label: 'Interested',       description: 'Close the sale',         emptyMsg: 'No active leads' },
] as const;

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

const INACTIVE_PROPOSAL_STATUSES = new Set(['expired', 'archived', 'booked', 'cancelled']);

/** Derive which Kanban column the deal belongs in.
 *
 * For enquiry-rooted deals, the enquiry's manual_status (booked/cancelled)
 * drives the Closed column — the "agent-side bookings" escape valve.
 *
 * For standalone proposals (no enquiry), the proposal's own status carries
 * the outcome: booked / cancelled / expired / archived all count as
 * inactive, dropping the deal to Closed.
 */
function dealStage(d: Deal): typeof STAGES[number]['key'] | 'closed' {
  if (d.manual_status === 'booked' || d.manual_status === 'cancelled') return 'closed';

  const active = d.proposals.filter(p => !INACTIVE_PROPOSAL_STATUSES.has(p.status));

  if (d.type === 'standalone' && active.length === 0) return 'closed';
  if (active.length === 0) return 'to_quote';
  if (active.some(p => p.status === 'interested')) return 'interested';
  if (active.some(p => p.status === 'sent' || p.status === 'viewed')) return 'sent';
  return 'quoted';  // everything in draft
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
  };
}

// ─── Page ───────────────────────────────────────────────────────────────

export default function PipelinePage() {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();

  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'kanban' | 'table'>('kanban');
  // Search can be pre-filled from URL — Home links land users here with
  // ?search=<client name> so the deal they care about pops out of the list.
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [closedCollapsed, setClosedCollapsed] = useState(true);

  // Drill-in state
  const [openDeal, setOpenDeal] = useState<Deal | null>(null);
  const [openProposal, setOpenProposal] = useState<ProposalRow | null>(null);
  const [launcherFor, setLauncherFor] = useState<EnquiryPrefill | null>(null);
  /** When set, the launcher opens with no enquiry — for the "+ Standalone
   *  proposal" path. Distinct from launcherFor so the launcher knows the
   *  difference between "no enquiry" and "not open". */
  const [launcherStandalone, setLauncherStandalone] = useState(false);
  /** The single-draft proposal selected for the quick Send dialog. */
  const [sendingProposal, setSendingProposal] = useState<ProposalRow | null>(null);

  useEffect(() => { setPageTitle('Pipeline'); }, [setPageTitle]);

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
        .select('*, proposals(*, partner_properties(property_name), pricing_proposals(client_price_excl_vat, scenario_type, season_tag, owner_net, company_take))')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .order('created_at', { ascending: false }),
      // Proposals created without an enquiry (FAB flow) — these are deals
      // in their own right.
      supabase
        .from('proposals')
        .select('*, partner_properties(property_name), pricing_proposals(client_price_excl_vat, scenario_type, season_tag, owner_net, company_take)')
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

  // ── Filtering + grouping ──
  const filtered = useMemo(() => {
    if (!search.trim()) return deals;
    const q = search.toLowerCase();
    return deals.filter(d => {
      if (d.client_name?.toLowerCase().includes(q)) return true;
      if (d.client_email?.toLowerCase().includes(q)) return true;
      return d.proposals.some(p =>
        p.property_name.toLowerCase().includes(q) ||
        p.ref_code.toLowerCase().includes(q)
      );
    });
  }, [deals, search]);

  const byStage = useMemo(() => {
    const map: Record<string, Deal[]> = { to_quote: [], quoted: [], sent: [], interested: [], closed: [] };
    for (const d of filtered) {
      map[dealStage(d)].push(d);
    }
    // Stage-aware sort so the most actionable card sits on top of each
    // column — scrolling becomes optional rather than required:
    //   To propose → oldest enquiry first (longest waiting = highest priority)
    //   Proposed   → oldest draft first   (drafts that have lingered)
    //   Sent       → soonest check-in     (closing window shrinking)
    //   Interested → soonest check-in     (hot leads, close them fast)
    //   Closed     → recent first         (archival, kept as-is)
    const byCheckIn = (a: Deal, b: Deal) => {
      if (!a.check_in && !b.check_in) return 0;
      if (!a.check_in) return 1;
      if (!b.check_in) return -1;
      return a.check_in.localeCompare(b.check_in);
    };
    const byOldest = (a: Deal, b: Deal) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    const oldestDraftAt = (d: Deal) => {
      const drafts = d.proposals.filter(p => p.status === 'draft').map(p => new Date(p.created_at).getTime());
      return drafts.length ? Math.min(...drafts) : Number.POSITIVE_INFINITY;
    };
    map.to_quote.sort(byOldest);
    map.quoted.sort((a, b) => oldestDraftAt(a) - oldestDraftAt(b));
    map.sent.sort(byCheckIn);
    map.interested.sort(byCheckIn);
    // .closed left at default (recency)
    return map;
  }, [filtered]);

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
      setOpenDeal(d);
    }
  }

  async function updateEnquiryStatus(enquiryId: string, status: string) {
    await supabase
      .from('enquiries')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', enquiryId);
    // Close the modal so the user sees the card slide to its new column —
    // the action feels definitive that way. They can reopen if they need to.
    setOpenDeal(null);
    notifyPipelineChanged();
  }

  /** Outcome mutation for standalone-proposal deals — there's no enquiry
   *  to flip, so the proposal itself carries the booked/cancelled marker. */
  async function updateProposalOutcome(proposalId: string, outcome: 'booked' | 'cancelled' | 'draft') {
    await supabase
      .from('proposals')
      .update({ status: outcome })
      .eq('id', proposalId);
    setOpenDeal(null);
    notifyPipelineChanged();
  }

  // ── Render ──
  return (
    <div>
      {/* Toolbar */}
      <div className="proposals-toolbar">
        <div className="proposals-view-toggle">
          <button
            className={`pricing-toggle-btn ${view === 'kanban' ? 'active' : ''}`}
            onClick={() => setView('kanban')}
          >
            ◰ Kanban
          </button>
          <button
            className={`pricing-toggle-btn ${view === 'table' ? 'active' : ''}`}
            onClick={() => setView('table')}
          >
            ☰ Table
          </button>
        </div>
        <input
          type="search"
          className="form-input"
          placeholder="Search by client, property, ref code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, maxWidth: '320px' }}
        />
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" style={{ fontSize: '0.75rem' }} onClick={() => fetchDeals()}>↻ Refresh</button>
      </div>

      {loading ? (
        <div className="page-loader"><div className="spinner" /></div>
      ) : view === 'kanban' ? (
        <KanbanView
          byStage={byStage}
          closedCollapsed={closedCollapsed}
          setClosedCollapsed={setClosedCollapsed}
          onOpen={setOpenDeal}
          onQuote={startQuote}
          onSend={startSend}
          flashStage={flashStage}
        />
      ) : (
        <TableView
          deals={filtered}
          loading={loading}
          onOpen={setOpenDeal}
        />
      )}

      {/* Deal detail */}
      {openDeal && (
        <DealDetailModal
          deal={openDeal}
          onClose={() => setOpenDeal(null)}
          onQuote={() => startQuote(openDeal)}
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
  byStage, closedCollapsed, setClosedCollapsed, onOpen, onQuote, onSend, flashStage,
}: {
  byStage: Record<string, Deal[]>;
  closedCollapsed: boolean;
  setClosedCollapsed: (v: boolean) => void;
  onOpen: (d: Deal) => void;
  onQuote: (d: Deal) => void;
  onSend: (d: Deal) => void;
  flashStage?: string | null;
}) {
  return (
    <>
      <div className="proposals-kanban" style={{ gridTemplateColumns: `repeat(${STAGES.length}, minmax(0, 1fr))` }}>
        {STAGES.map(col => (
          <div
            key={col.key}
            className={`proposals-kanban-col ${flashStage === col.key ? 'proposals-kanban-col--flash' : ''}`}
          >
            <div className="proposals-kanban-header">
              <div>
                <strong>{col.label}</strong>
                <span className="proposals-kanban-count">{byStage[col.key].length}</span>
              </div>
              <span className="proposals-kanban-sub">{col.description}</span>
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

      {byStage.closed.length > 0 && (
        <div className="proposals-closed">
          <button
            className="btn btn-ghost"
            style={{ fontSize: '0.75rem' }}
            onClick={() => setClosedCollapsed(!closedCollapsed)}
          >
            {closedCollapsed ? '▸' : '▾'} Closed ({byStage.closed.length}) — booked / cancelled
          </button>
          {!closedCollapsed && (
            <div className="proposals-kanban-body" style={{ marginTop: '8px' }}>
              {byStage.closed.map(d => (
                <DealCard
                  key={d.key}
                  deal={d}
                  stage="closed"
                  onOpen={onOpen}
                  onQuote={onQuote}
                  onSend={onSend}
                  closed
                  compact={byStage.closed.length > COMPACT_THRESHOLD}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
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
    <div className="proposals-kanban-bodywrap">
      <div className="proposals-kanban-body" ref={bodyRef}>
        {deals.length === 0 ? (
          <div className="proposals-kanban-empty">{emptyMsg}</div>
        ) : (
          deals.map(d => (
            <DealCard
              key={d.key}
              deal={d}
              stage={stage}
              onOpen={onOpen}
              onQuote={onQuote}
              onSend={onSend}
              compact={compact}
            />
          ))
        )}
      </div>
      <div className={`proposals-kanban-fade ${overflow.hasMore ? 'proposals-kanban-fade--visible' : ''}`} />
      {overflow.hasMore && (
        <button
          type="button"
          className="proposals-kanban-morepill"
          onClick={scrollToBottom}
          title="Scroll to see hidden cards"
        >
          ↓ {overflow.hiddenBelow} more
        </button>
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
  const isStale = stage === 'to_quote' && daysSince(deal.created_at) >= STALE_DAYS;
  const stop = (fn: (e: React.MouseEvent) => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(e); };

  // For Sent column, surface a viewed badge if any proposal's been opened.
  const wasViewed = stage === 'sent' && deal.proposals.some(p => p.status === 'viewed' || p.viewed_at);

  // Card primary action depends on stage:
  //   To propose  → "Create Proposal" (opens the quote flow)
  //   Proposed    → "Send proposal"   (drives the deal toward Sent)
  //   Sent / Interested → "+ Add proposal" (secondary; usually no urgent action)
  const draftCount = deal.proposals.filter(p => p.status === 'draft').length;
  let primary: { label: string; onClick: () => void } | null = null;
  if (!closed) {
    if (stage === 'to_quote') {
      primary = { label: '📝 Create Proposal', onClick: () => onQuote(deal) };
    } else if (stage === 'quoted') {
      primary = {
        label: draftCount > 1 ? `📤 Send proposals (${draftCount})` : '📤 Send proposal',
        onClick: () => onSend(deal),
      };
    } else {
      // sent / interested
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
      className={`proposal-card proposal-card--dense ${isStale ? 'proposal-card--stale' : ''} ${closed ? 'proposal-card--closed' : ''} ${compact ? 'proposal-card--compact' : ''}`}
      onClick={() => onOpen(deal)}
    >
      <div className="proposal-card-head">
        <div className="proposal-card-guest">
          {isStale && <span className="proposal-card-stale-dot" title={`${daysSince(deal.created_at)} days without a proposal`} />}
          <span className="proposal-card-name">{deal.client_name}</span>
          {deal.is_agent && <span className="proposal-card-agent">Agent</span>}
          {wasViewed && <span className="proposal-card-viewed" title="Recipient opened the proposal">✓</span>}
        </div>
        {featuredPrice != null ? (
          <span className="proposal-card-price">{fmtRand(featuredPrice)}</span>
        ) : (
          <span className="proposal-card-ref" title={deal.type === 'standalone' ? 'Standalone proposal — no enquiry' : 'From enquiry'}>
            {deal.type === 'standalone' ? '★' : '✉'}
          </span>
        )}
      </div>

      <div className="proposal-card-foot">
        <span className="proposal-card-meta">
          {deal.check_in && deal.check_out
            ? <>{fmtDate(deal.check_in)} → {fmtDate(deal.check_out)}</>
            : <span style={{ color: 'var(--text-light)', fontStyle: 'italic' }}>No dates</span>}
          {featuredProperty && <span className="proposal-card-meta-sep"> · {featuredProperty}</span>}
          {extraProposals > 0 && <span style={{ color: 'var(--text-light)' }}> +{extraProposals}</span>}
        </span>
        {primary && (
          <button
            className="proposal-card-action proposal-card-action--advance"
            onClick={stop(primary.onClick)}
          >
            {primary.label}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Table view ─────────────────────────────────────────────────────────

interface TableRow extends DataRow {
  key: string;
  type: 'enquiry' | 'standalone';
  deal: Deal;
  client_name: string;
  check_in: string | null;
  check_out: string | null;
  guests_total: number | null;
  proposals_count: number;
  stage: string;
  manual_status: string | null;
  created_at: string;
}

function TableView({ deals, loading, onOpen }: { deals: Deal[]; loading: boolean; onOpen: (d: Deal) => void }) {
  const rows: TableRow[] = deals.map(d => ({
    key: d.key,
    type: d.type,
    deal: d,
    client_name: d.client_name,
    check_in: d.check_in,
    check_out: d.check_out,
    guests_total: d.guests_total,
    proposals_count: d.proposals.length,
    stage: dealStage(d),
    manual_status: d.manual_status,
    created_at: d.created_at,
  }));

  const columns = [
    {
      key: 'client_name', label: 'Client', sortable: true,
      render: (row: DataRow) => {
        const r = row as TableRow;
        return (
          <span>
            {r.deal.is_agent && <span className="status-badge" style={{ background: '#E0E7FF', color: '#3730A3', marginRight: '6px', fontSize: '0.5625rem' }}>Agent</span>}
            {r.client_name}
            {r.type === 'standalone' && <span style={{ fontSize: '0.625rem', color: 'var(--text-light)', marginLeft: '6px' }} title="Standalone proposal — no enquiry">★</span>}
          </span>
        );
      },
    },
    {
      key: 'check_in', label: 'Dates', sortable: true,
      render: (row: DataRow) => {
        const r = row as TableRow;
        if (!r.check_in || !r.check_out) return <span style={{ color: 'var(--text-light)' }}>—</span>;
        return `${fmtDate(r.check_in)} → ${fmtDate(r.check_out)}`;
      },
    },
    { key: 'guests_total', label: 'Guests', align: 'center' as const, width: '70px', render: (row: DataRow) => (row as TableRow).guests_total ?? '—' },
    {
      key: 'proposals_count', label: 'Proposals', align: 'center' as const, width: '90px', sortable: true,
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
        const label = STAGES.find(s => s.key === r.stage)?.label || (r.stage === 'closed' ? 'Closed' : r.stage);
        const colorMap: Record<string, { bg: string; color: string }> = {
          to_quote: { bg: '#FEF3C7', color: '#92400E' },
          quoted: { bg: '#F3F4F6', color: '#6B7280' },
          sent: { bg: '#DBEAFE', color: '#1E40AF' },
          interested: { bg: '#D1FAE5', color: '#065F46' },
          closed: { bg: '#F3F4F6', color: '#6B7280' },
        };
        const cfg = colorMap[r.stage] || colorMap.closed;
        return <span className="status-badge" style={{ background: cfg.bg, color: cfg.color }}>{label}</span>;
      },
    },
    {
      key: 'created_at', label: 'Created', sortable: true, hideOnMobile: true,
      render: (row: DataRow) => fmtDateLong((row as TableRow).created_at),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      loading={loading}
      searchable={false}
      defaultSort={{ key: 'created_at', direction: 'desc' }}
      onRowClick={(row: DataRow) => onOpen((row as TableRow).deal)}
      pageSize={25}
      emptyMessage="No deals — create an enquiry or use the FAB to start a proposal."
    />
  );
}

// ─── Deal detail modal ──────────────────────────────────────────────────

function DealDetailModal({
  deal, onClose, onQuote, onUpdateStatus, onUpdateProposalOutcome, onOpenProposal,
}: {
  deal: Deal;
  onClose: () => void;
  onQuote: () => void;
  onUpdateStatus: (enquiryId: string, status: string) => void;
  onUpdateProposalOutcome: (proposalId: string, outcome: 'booked' | 'cancelled' | 'draft') => void;
  onOpenProposal: (p: ProposalRow) => void;
}) {
  const e = deal.enquiry;
  // For standalone deals (no enquiry), outcome lives on the proposal itself.
  // Standalone deals only ever have one proposal (FAB creates 1:1).
  const standaloneProp = !e && deal.proposals[0] ? deal.proposals[0] : null;
  const isClosed = e
    ? (e.status === 'booked' || e.status === 'cancelled')
    : Boolean(standaloneProp && INACTIVE_PROPOSAL_STATUSES.has(standaloneProp.status));

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(ev) => ev.stopPropagation()} style={{ maxWidth: '720px' }}>
        <div className="modal-header">
          <h2 className="modal-title">
            {deal.client_name}
            {deal.type === 'standalone' && <span style={{ fontSize: '0.6875rem', color: 'var(--text-light)', marginLeft: '8px', fontWeight: 400 }}>(standalone proposal)</span>}
          </h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body">
          {/* Client / stay details */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', fontSize: '0.8125rem', marginBottom: '14px' }}>
            <div><span style={{ color: 'var(--text-light)' }}>Email</span><br />{deal.client_email || '—'}</div>
            <div><span style={{ color: 'var(--text-light)' }}>Phone</span><br />{deal.client_phone || '—'}</div>
            <div><span style={{ color: 'var(--text-light)' }}>Check-in</span><br />{fmtDateLong(deal.check_in)}</div>
            <div><span style={{ color: 'var(--text-light)' }}>Check-out</span><br />{fmtDateLong(deal.check_out)}</div>
            <div><span style={{ color: 'var(--text-light)' }}>Guests</span><br />{deal.guests_total ?? '—'}</div>
            {e && <div><span style={{ color: 'var(--text-light)' }}>Bedrooms needed</span><br />{e.bedrooms_needed}</div>}
            {e?.budget_min || e?.budget_max ? (
              <div><span style={{ color: 'var(--text-light)' }}>Budget</span><br />{fmtRand(e?.budget_min || 0)} – {fmtRand(e?.budget_max || 0)}</div>
            ) : null}
            {e?.nationality && <div><span style={{ color: 'var(--text-light)' }}>Nationality</span><br />{e.nationality}</div>}
          </div>

          {e?.notes && (
            <div style={{ padding: '10px 12px', background: '#F9FAFB', borderRadius: 'var(--radius-sm)', marginBottom: '14px', fontSize: '0.8125rem' }}>
              <strong style={{ fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>Notes</strong>
              <div style={{ marginTop: '4px' }}>{e.notes}</div>
            </div>
          )}


          {/* Proposals list */}
          <div style={{ paddingTop: '12px', borderTop: '1px solid var(--border-light)' }}>
            <strong style={{ fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
              Proposals ({deal.proposals.length})
            </strong>
            {deal.proposals.length === 0 ? (
              <div style={{ marginTop: '8px', fontSize: '0.8125rem', color: 'var(--text-light)' }}>
                No proposals yet. Use "Create Proposal" below to add one for this client.
              </div>
            ) : (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {deal.proposals.map(p => (
                  <button
                    key={p.id}
                    onClick={() => onOpenProposal(p)}
                    className="editor-list-row"
                    style={{ cursor: 'pointer', background: 'var(--bg)', border: '1px solid var(--border)', textAlign: 'left' }}
                  >
                    <div className="editor-list-main">
                      <div className="editor-list-title">{p.property_name}</div>
                      <div className="editor-list-sub">
                        {p.guest_price != null ? <><strong>{fmtRand(p.guest_price)}</strong> / night</> : 'No pricing'}
                        {p.scenario_type && <span style={{ color: 'var(--text-light)' }}> · {p.scenario_type}</span>}
                        <span style={{ marginLeft: '8px', fontFamily: 'monospace', fontSize: '0.6875rem', color: 'var(--text-light)' }}>{p.ref_code}</span>
                      </div>
                    </div>
                    <StatusBadge status={p.status} config={PROPOSAL_STATUS_CONFIG} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onQuote}>
            📝 {deal.proposals.length === 0 ? 'Create Proposal' : 'Add another proposal'}
          </button>
          {/* Outcome actions — work on both enquiry-rooted and standalone
              deals. For enquiry deals they flip the enquiry's manual
              status; for standalone they flip the proposal's status. */}
          {!isClosed && (
            <>
              <button
                className="btn btn-outline"
                style={{ color: '#065F46', borderColor: '#065F46' }}
                onClick={markBooked}
                title="Move this deal to Closed (Booked)"
              >
                ✓ Mark Booked
              </button>
              <button
                className="btn btn-ghost"
                style={{ color: '#991B1B' }}
                onClick={markCancelled}
                title="Move this deal to Closed (Cancelled)"
              >
                ✕ Cancel
              </button>
            </>
          )}
          {isClosed && (
            <button
              className="btn btn-ghost"
              onClick={reopen}
              title="Reopen this deal — moves out of Closed"
            >
              ↺ Reopen
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
