/**
 * ProposalsPage — Operations → Proposals
 *
 * One card / row per proposal, grouped into five columns by proposal
 * status. Mirrors PipelinePage's structure (toolbar with view toggle,
 * search, board/list views) so the two Ops pages feel like one product.
 *
 * Pre-migration the proposals table has eight legacy status values; we
 * collapse them into the agreed five columns via columnFor(). Post
 * workflow_rebuild migration, statuses map 1:1.
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import DataTable from '../components/DataTable';
import type { DataRow } from '../components/DataTable';
import NewProposalLauncher from '../components/NewProposalLauncher';
import NightCount from '../components/NightCount';
import ProposalDetailModal, { type ProposalForDetail } from '../components/ProposalDetailModal';
import SendProposalDialog, { type SendableProposal } from '../components/SendProposalDialog';
import PricingModal from './PricingModal';
import {
  syncEnquiryFromProposal,
  closeEnquiryOnProposalAccept,
  maybeCloseEnquiryOnProposalDecline,
  countLiveSiblings,
  type ProposalStatus,
} from '../lib/statusSync';
import { notifyPipelineChanged } from '../lib/pipelineEvents';
import { CT_RENTALS_PARTNER_ID } from './constants';
import { nightsBetween } from '../lib/nights';

interface ProposalRow extends ProposalForDetail {
  property_name: string;
  decline_reason: string | null;
  /** Carrier for the per-enquiry view ("show only proposals from this
   *  enquiry" deep-link from the Pipeline page). Null for standalone
   *  proposals raised without a parent enquiry. enquiry_ref_code is the
   *  human-readable handle surfaced in the detail modal subtitle. */
  enquiry_id: string | null;
  enquiry_ref_code: string | null;
}

const COLUMNS = [
  { key: 'drafting', label: 'Drafting', description: 'Being written',          emptyMsg: 'No drafts' },
  { key: 'sent',     label: 'Sent',     description: 'Out with the client',    emptyMsg: 'Nothing awaiting response' },
  { key: 'accepted', label: 'Accepted', description: 'Client said yes',        emptyMsg: 'No acceptances yet' },
  { key: 'declined', label: 'Declined', description: 'Closed without booking', emptyMsg: 'No declines' },
] as const;

const COLUMN_ACCENT: Record<string, string> = {
  drafting: 'var(--text-secondary)',
  sent:     'var(--info)',
  accepted: 'var(--success)',
  declined: 'var(--text-light)',
};

/** Map any proposal status (legacy or new) to one of the four columns.
 *  'ready' is folded into 'drafting' — Ready was retired from the kanban
 *  since writing-and-sending is one step in practice. Any historical
 *  proposals still sitting on status='ready' surface under Drafting so
 *  they don't disappear from view. */
function columnFor(status: string): string {
  switch (status) {
    case 'draft':
    case 'drafting':
    case 'ready':
      return 'drafting';
    case 'sent':
    case 'viewed':
    case 'interested':
      return 'sent';
    case 'booked':
    case 'accepted':
      return 'accepted';
    case 'expired':
    case 'archived':
    case 'cancelled':
    case 'declined':
      return 'declined';
    default:
      return 'sent';
  }
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

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

function fmtDateLong(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ProposalsPage() {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();
  const [searchParams, setSearchParams] = useSearchParams();
  /** When a user clicks "View proposals" on a Pipeline enquiry card, we
   *  deep-link here with ?enquiry=<id>. The page narrows to just that
   *  enquiry's proposals plus a banner to clear the filter. */
  const enquiryFilter = searchParams.get('enquiry');
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [search, setSearch] = useState('');
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [openProposal, setOpenProposal] = useState<ProposalRow | null>(null);
  /** Send-flow modal — opened from the detail modal's Continue button.
   *  All cards route through detail first; Continue leads here. */
  const [sendingProposal, setSendingProposal] = useState<SendableProposal | null>(null);

  /** Write the chosen outcome on the proposal then cascade:
   *    Accept → enquiry closes, sibling proposals auto-decline.
   *    Decline → enquiry stays Open until the last live proposal goes;
   *              then closes.
   *  Confirms before destructive cascades so the user knows what'll
   *  happen to siblings / the parent enquiry. */
  async function markOutcome(p: ProposalRow, outcome: ProposalStatus) {
    const liveSiblings = await countLiveSiblings(supabase, p.id);

    if (outcome === 'accepted' && liveSiblings > 0) {
      const ok = window.confirm(
        `Accepting this will close this enquiry and auto-decline the other ${liveSiblings} proposal${liveSiblings === 1 ? '' : 's'}. Continue?`,
      );
      if (!ok) return;
    }
    if (outcome === 'declined' && liveSiblings === 0) {
      const ok = window.confirm(
        'This is the last live proposal on the enquiry — declining will close the enquiry. Continue?',
      );
      if (!ok) return;
    }

    const patch: any = { status: outcome, updated_at: new Date().toISOString() };
    if (outcome === 'accepted') patch.accepted_at = new Date().toISOString();
    await supabase.from('proposals').update(patch).eq('id', p.id);

    if (outcome === 'accepted') {
      await closeEnquiryOnProposalAccept(supabase, p.id);
    } else if (outcome === 'declined') {
      await maybeCloseEnquiryOnProposalDecline(supabase, p.id);
    } else {
      await syncEnquiryFromProposal(supabase, p.id, outcome);
    }

    notifyPipelineChanged();
    setOpenProposal(null);
    await fetchProposals();
  }

  function toSendable(p: ProposalRow): SendableProposal {
    // Attach _row so the Send dialog's Back button can hand the original
    // ProposalRow back to setOpenProposal without a parallel state.
    return {
      id: p.id,
      ref_code: p.ref_code,
      property_name: p.property_name,
      guest_name: p.guest_name,
      guest_email: p.guest_email,
      guest_phone: p.guest_phone,
      is_agent: p.is_agent,
      _row: p,
    } as SendableProposal & { _row: ProposalRow };
  }
  /** Hydrated pricing_proposals row for the Edit Pricing → PricingDashboard
   *  flow. Mirrors the wiring in PipelinePage / PropertyEditModal so the
   *  entry point appears wherever a proposal is opened. */
  const [editPricingFor, setEditPricingFor] = useState<any>(null);

  // Two filter placeholders, mirroring Enquiries.
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [propertyFilter, setPropertyFilter] = useState<string>('');
  // Per-board-column sort.
  const [columnSort, setColumnSort] = useState<Record<string, string>>({});

  useEffect(() => { setPageTitle('Proposals'); }, [setPageTitle]);

  async function fetchProposals(): Promise<ProposalRow[]> {
    if (!supabase) return [];
    setLoading(true);
    // decline_reason is added by the workflow_rebuild migration. Until that
    // runs in Supabase, omit it from the select so we don't get a column
    // error. The field is read defensively below via ?? null.
    const { data, error } = await supabase
      .from('proposals')
      .select(`
        id, ref_code, property_id, status, is_agent, enquiry_id,
        guest_name, guest_email, guest_phone, check_in, check_out,
        guests_total, notes, pricing_proposal_id,
        created_at, sent_at, viewed_at, accepted_at,
        partner_properties(property_name),
        enquiries(ref_code),
        pricing_proposals(client_price_excl_vat, scenario_type, season_tag, owner_net, company_take, agents)
      `)
      .eq('partner_id', CT_RENTALS_PARTNER_ID)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Proposals fetch failed:', error);
      setProposals([]);
      setLoading(false);
      return [];
    }
    const mapped: ProposalRow[] = (data || []).map((p: any) => ({
      id: p.id,
      ref_code: p.ref_code,
      property_id: p.property_id,
      property_name: p.partner_properties?.property_name || '—',
      pricing_proposal_id: p.pricing_proposal_id ?? null,
      status: p.status,
      is_agent: !!p.is_agent,
      enquiry_id: p.enquiry_id ?? null,
      enquiry_ref_code: p.enquiries?.ref_code ?? null,
      guest_name: p.guest_name || '—',
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
      decline_reason: p.decline_reason ?? null,
      guest_price: p.pricing_proposals?.client_price_excl_vat ?? null,
      scenario_type: p.pricing_proposals?.scenario_type ?? null,
      season_tag: p.pricing_proposals?.season_tag ?? null,
      owner_net: p.pricing_proposals?.owner_net ?? null,
      company_take: p.pricing_proposals?.company_take ?? null,
      agents: p.pricing_proposals?.agents ?? null,
    }));
    setProposals(mapped);
    setLoading(false);
    return mapped;
  }

  useEffect(() => { fetchProposals(); }, [supabase]);

  const propertyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of proposals) if (p.property_name) set.add(p.property_name);
    return Array.from(set).sort();
  }, [proposals]);

  const filtered = useMemo(() => {
    let result = proposals;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(p =>
        p.guest_name.toLowerCase().includes(q) ||
        (p.guest_email?.toLowerCase().includes(q) ?? false) ||
        p.property_name.toLowerCase().includes(q) ||
        p.ref_code.toLowerCase().includes(q)
      );
    }

    if (statusFilter) {
      result = result.filter(p => columnFor(p.status) === statusFilter);
    }

    if (propertyFilter) {
      result = result.filter(p => p.property_name === propertyFilter);
    }

    // Deep-link narrowing from a Pipeline enquiry card.
    if (enquiryFilter) {
      result = result.filter(p => p.enquiry_id === enquiryFilter);
    }

    return result;
  }, [proposals, search, statusFilter, propertyFilter, enquiryFilter]);

  /** Pull the enquiring client's name off the first matching proposal so
   *  the deep-link banner reads "Showing proposals for <name>" instead of
   *  a raw UUID. Empty when the filter is off. */
  const enquiryBannerName = useMemo(() => {
    if (!enquiryFilter) return '';
    const match = proposals.find(p => p.enquiry_id === enquiryFilter);
    return match ? titleCase(match.guest_name) : '';
  }, [enquiryFilter, proposals]);

  /** Map of enquiry_id → number of sibling proposals (including self).
   *  Built from the full proposals list (not filtered) so the count stays
   *  honest when the user is viewing a subset. Cards use this to surface
   *  "📎 3 in this deal" so multi-proposal deals are obvious at a glance. */
  const siblingCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of proposals) {
      if (!p.enquiry_id) continue;
      m.set(p.enquiry_id, (m.get(p.enquiry_id) ?? 0) + 1);
    }
    return m;
  }, [proposals]);

  function focusEnquiry(enquiryId: string) {
    const next = new URLSearchParams(searchParams);
    next.set('enquiry', enquiryId);
    setSearchParams(next, { replace: true });
  }

  // ── Multi-select for batch send ───────────────────────────────────────
  // Always available — checkboxes live on every card, no mode toggle to
  // enter or exit. The first selection locks a recipient key (email if
  // present, name otherwise); any card whose recipient doesn't match
  // becomes disabled until cleared. Selection actions surface inline in
  // the toolbar count area only when ≥1 is selected, so the page stays
  // visually quiet when nobody's selecting.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchSending, setBatchSending] = useState(false);

  function recipientKey(p: ProposalRow): string {
    const email = (p.guest_email || '').trim().toLowerCase();
    if (email) return `e:${email}`;
    return `n:${(p.guest_name || '').trim().toLowerCase()}`;
  }

  /** The recipient locked in by the first selected proposal. Once set,
   *  other cards with a different key become disabled. Null when nothing
   *  is selected — every card is eligible. */
  const lockedRecipientKey = useMemo(() => {
    if (selectedIds.size === 0) return null;
    const first = proposals.find(p => selectedIds.has(p.id));
    return first ? recipientKey(first) : null;
  }, [selectedIds, proposals]);

  const selectedProposals = useMemo(
    () => proposals.filter(p => selectedIds.has(p.id)),
    [proposals, selectedIds],
  );

  function toggleSelected(p: ProposalRow) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.add(p.id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  const byColumn = useMemo(() => {
    const map: Record<string, ProposalRow[]> = {
      drafting: [], sent: [], accepted: [], declined: [],
    };
    for (const p of filtered) {
      const key = columnFor(p.status);
      (map[key] ?? map.sent).push(p);
    }
    const byNewest = (a: ProposalRow, b: ProposalRow) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    const byOldest = (a: ProposalRow, b: ProposalRow) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    const byCheckIn = (a: ProposalRow, b: ProposalRow) => {
      if (!a.check_in && !b.check_in) return 0;
      if (!a.check_in) return 1;
      if (!b.check_in) return -1;
      return a.check_in.localeCompare(b.check_in);
    };
    const byClient = (a: ProposalRow, b: ProposalRow) =>
      (a.guest_name || '').localeCompare(b.guest_name || '');

    for (const col of COLUMNS) {
      const sort = columnSort[col.key] || 'smart';
      const list = map[col.key];
      if (sort === 'newest')        list.sort(byNewest);
      else if (sort === 'oldest')   list.sort(byOldest);
      else if (sort === 'check-in') list.sort(byCheckIn);
      else if (sort === 'client')   list.sort(byClient);
      else {
        // Smart: most-actionable first per column
        if (col.key === 'drafting')      list.sort(byOldest);
        else if (col.key === 'sent')     list.sort(byCheckIn);
        else                             list.sort(byNewest);
      }
    }
    return map;
  }, [filtered, columnSort]);

  return (
    <div>
      {/* Workspace explainer. The primary view of pipeline is on the
          Enquiries board — every deal card there now lists its
          proposals inline with status pills. This page exists for the
          ops the kanban can't do gracefully: multi-select send across
          deals, filter by property, search by recipient. The banner
          says so once so the team knows where to look for what. */}
      {!enquiryFilter && (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 14px', marginBottom: 12,
            background: 'var(--bg, #F9FAFB)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
            fontSize: '0.75rem', color: 'var(--text-secondary)',
          }}
        >
          <span>
            📄 <strong>Proposals workspace</strong> — for batch send, filtering by property, and recipient search. The day-to-day pipeline view is on the <strong>Enquiries</strong> board.
          </span>
        </div>
      )}

      {/* Deep-link narrowing banner. Shown when ?enquiry=<id> is in the
          URL — typically arrived via a click on a Pipeline enquiry card.
          Clearing it strips the URL param and reveals all proposals. */}
      {enquiryFilter && (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', marginBottom: 12,
            background: 'var(--bg-info, #EFF6FF)', border: '1px solid var(--info)', borderRadius: 'var(--radius-sm)',
            fontSize: '0.8125rem',
          }}
        >
          <span>
            Showing proposals for {enquiryBannerName ? <strong>{enquiryBannerName}</strong> : 'this enquiry'}
            {' '}({filtered.length} of {proposals.length})
          </span>
          <button
            className="btn btn-ghost"
            style={{ fontSize: '0.75rem', padding: '2px 10px' }}
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('enquiry');
              setSearchParams(next, { replace: true });
            }}
          >
            ✕ Show all proposals
          </button>
        </div>
      )}

      {/* Toolbar — view modes + actions on top row, filters + search below. */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="list-toolbar" style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: 12, marginBottom: 12 }}>
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
          </div>
          <div className="list-toolbar-right">
            <button
              className="btn btn-primary"
              onClick={() => setLauncherOpen(true)}
            >
              + New Proposal
            </button>
          </div>
        </div>


        <div className="list-toolbar">
          <div className="list-toolbar-left">
            <select
              className="list-filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              title="Filter by status"
            >
              <option value="">All statuses</option>
              {COLUMNS.map(c => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
            <select
              className="list-filter-select"
              value={propertyFilter}
              onChange={(e) => setPropertyFilter(e.target.value)}
              title="Filter by property"
            >
              <option value="">All properties</option>
              {propertyOptions.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
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
          </div>
          <div className="list-toolbar-right" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {selectedIds.size > 0 ? (
              // Inline selection actions. Sits in the same slot as the
              // count so the toolbar never grows or jumps when items get
              // selected — only the contents swap.
              <>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  <strong>{selectedIds.size}</strong> selected for{' '}
                  <strong>{titleCase(selectedProposals[0]?.guest_name || '')}</strong>
                </span>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                  onClick={clearSelection}
                >
                  Clear
                </button>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: '0.75rem', padding: '4px 12px' }}
                  disabled={batchSending}
                  onClick={() => setBatchSending(true)}
                >
                  📤 Send {selectedIds.size}
                </button>
              </>
            ) : (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
                {filtered.length} of {proposals.length}
              </span>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="page-loader"><div className="spinner" /></div>
      ) : view === 'board' ? (
        <BoardView
          byColumn={byColumn}
          columnSort={columnSort}
          onColumnSortChange={(key, value) =>
            setColumnSort(prev => ({ ...prev, [key]: value }))
          }
          onOpen={setOpenProposal}
          siblingCounts={siblingCounts}
          onFocusEnquiry={focusEnquiry}
          selectedIds={selectedIds}
          lockedRecipientKey={lockedRecipientKey}
          recipientKey={recipientKey}
          onToggleSelected={toggleSelected}
        />
      ) : (
        <ListView
          proposals={filtered}
          onOpen={setOpenProposal}
          siblingCounts={siblingCounts}
          onFocusEnquiry={focusEnquiry}
        />
      )}

      {launcherOpen && (
        <NewProposalLauncher
          onClose={() => { setLauncherOpen(false); fetchProposals(); }}
        />
      )}

      {openProposal && (
        <ProposalDetailModal
          proposal={openProposal}
          supabase={supabase}
          onClose={() => setOpenProposal(null)}
          onChange={fetchProposals}
          onEditPricing={async () => {
            if (!openProposal.pricing_proposal_id) return;
            const { data } = await supabase
              .from('pricing_proposals')
              .select('*')
              .eq('id', openProposal.pricing_proposal_id)
              .single();
            if (data) {
              // Look up parent enquiry's platform context so platform
              // proposals open with the channel locked + scenario forced.
              let enquirySource: string | null = null;
              let enquiryPlatformChannel: string | null = null;
              let enquiryAgentId: string | null = null;
              if (openProposal.enquiry_id) {
                const { data: enq } = await supabase
                  .from('enquiries')
                  .select('source, platform_channel, is_agent, agent_id')
                  .eq('id', openProposal.enquiry_id)
                  .maybeSingle();
                if (enq) {
                  enquirySource = enq.source ?? null;
                  enquiryPlatformChannel = (enq as any).platform_channel ?? null;
                  enquiryAgentId = (enq as any).is_agent ? ((enq as any).agent_id ?? null) : null;
                }
              }
              // Stash the proposal id so we can reopen the detail modal
              // with the refreshed pricing after Save Pricing closes.
              setEditPricingFor({
                ...data,
                _propertyName: openProposal.property_name,
                _reopenProposalId: openProposal.id,
                _checkIn: openProposal.check_in,
                _checkOut: openProposal.check_out,
                _enquirySource: enquirySource,
                _enquiryPlatformChannel: enquiryPlatformChannel,
                _enquiryAgentId: enquiryAgentId,
              });
              setOpenProposal(null);
            }
          }}
          onSend={() => {
            setSendingProposal(toSendable(openProposal));
            setOpenProposal(null);
          }}
          onAccept={() => markOutcome(openProposal, 'accepted')}
          onDecline={() => markOutcome(openProposal, 'declined')}
          onOpenEnquiry={(enquiryId) => {
            setOpenProposal(null);
            focusEnquiry(enquiryId);
          }}
        />
      )}

      {batchSending && selectedProposals.length > 0 && (
        // Batch send for the multi-select picker. Same SendProposalDialog
        // — just fed an array of proposals all sharing one recipient.
        <SendProposalDialog
          proposals={selectedProposals.map(p => ({
            id: p.id,
            ref_code: p.ref_code,
            property_name: p.property_name,
            guest_name: p.guest_name,
            guest_email: p.guest_email,
            guest_phone: p.guest_phone,
            is_agent: p.is_agent,
          }))}
          supabase={supabase}
          onClose={() => setBatchSending(false)}
          onSent={async () => {
            setBatchSending(false);
            clearSelection();
            await fetchProposals();
          }}
        />
      )}

      {sendingProposal && (
        <SendProposalDialog
          proposals={[sendingProposal]}
          supabase={supabase}
          onClose={() => setSendingProposal(null)}
          onSent={() => { setSendingProposal(null); fetchProposals(); }}
          onBack={() => {
            // Reopen the detail modal the user came from. We stash the
            // full ProposalRow on the sendable as _row so Back doesn't
            // need a parallel state variable.
            const row = (sendingProposal as any)._row as ProposalRow | undefined;
            setSendingProposal(null);
            if (row) setOpenProposal(row);
          }}
        />
      )}

      {editPricingFor && (
        <PricingModal
          property={{ id: editPricingFor.property_id, property_name: editPricingFor._propertyName }}
          supabase={supabase}
          editPricingProposal={editPricingFor}
          onClose={() => setEditPricingFor(null)}
          onPricingSaved={async () => {
            const reopenId = editPricingFor?._reopenProposalId;
            setEditPricingFor(null);
            // Refetch so the reopened detail modal shows the new pricing.
            const refreshed = await fetchProposals();
            if (reopenId) {
              const next = refreshed.find(p => p.id === reopenId);
              if (next) setOpenProposal(next);
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Board view ─────────────────────────────────────────────────────────

function BoardView({
  byColumn, columnSort, onColumnSortChange, onOpen, siblingCounts, onFocusEnquiry,
  selectedIds, lockedRecipientKey, recipientKey, onToggleSelected,
}: {
  byColumn: Record<string, ProposalRow[]>;
  columnSort: Record<string, string>;
  onColumnSortChange: (key: string, value: string) => void;
  onOpen: (p: ProposalRow) => void;
  siblingCounts: Map<string, number>;
  onFocusEnquiry: (enquiryId: string) => void;
  selectedIds: Set<string>;
  lockedRecipientKey: string | null;
  recipientKey: (p: ProposalRow) => string;
  onToggleSelected: (p: ProposalRow) => void;
}) {
  return (
    <div className="ops-board">
      {COLUMNS.map(col => (
        <div key={col.key} className="ops-board-column">
          <div
            className="ops-board-column-header"
            style={{ borderTopColor: COLUMN_ACCENT[col.key] ?? 'var(--text-light)' }}
          >
            <div className="ops-board-column-header-top">
              <span className="ops-board-column-label">{col.label}</span>
              <span className="ops-board-column-count">{byColumn[col.key].length}</span>
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
          <div className="ops-board-column-body">
            {byColumn[col.key].length === 0 ? (
              <div className="ops-board-empty">{col.emptyMsg}</div>
            ) : (
              byColumn[col.key].map(p => {
                const isSelected = selectedIds.has(p.id);
                // Once one card is selected the recipient is locked —
                // any card with a different recipient greys out until
                // selection is cleared. Subtle visual cue rather than a
                // big banner explaining the rule.
                const isDisabled = lockedRecipientKey !== null
                  && recipientKey(p) !== lockedRecipientKey
                  && !isSelected;
                return (
                  <ProposalCard
                    key={p.id}
                    p={p}
                    onOpen={onOpen}
                    siblingCount={p.enquiry_id ? (siblingCounts.get(p.enquiry_id) ?? 1) : 1}
                    onFocusEnquiry={onFocusEnquiry}
                    isSelected={isSelected}
                    isDisabled={isDisabled}
                    onToggleSelected={onToggleSelected}
                  />
                );
              })
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProposalCard({
  p, onOpen, siblingCount, onFocusEnquiry,
  isSelected, isDisabled, onToggleSelected,
}: {
  p: ProposalRow;
  onOpen: (p: ProposalRow) => void;
  siblingCount: number;
  onFocusEnquiry: (enquiryId: string) => void;
  isSelected: boolean;
  isDisabled: boolean;
  onToggleSelected: (p: ProposalRow) => void;
}) {
  const days = daysSince(p.created_at);
  const daysCls = days >= 10 ? 'ops-board-card-days--hot'
    : days >= 5 ? 'ops-board-card-days--warn' : '';
  const guestName = titleCase(p.guest_name);
  const propertyName = titleCase(p.property_name);
  const hasSiblings = !!p.enquiry_id && siblingCount > 1;

  // Card body click → open detail. The checkbox owns its own click
  // (stopPropagation) so toggling selection never opens the modal.
  // Disabled cards are inert — they can't be selected because their
  // recipient doesn't match the one already locked in.
  return (
    <div
      className="ops-board-card"
      onClick={() => { if (!isDisabled) onOpen(p); }}
      style={{
        opacity: isDisabled ? 0.4 : 1,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        outline: isSelected ? '2px solid var(--info)' : undefined,
        outlineOffset: isSelected ? '1px' : undefined,
        position: 'relative',
      }}
    >
      {/* Always-on checkbox in the top-left. Small and unobtrusive when
          nothing is selected; visible affordance the moment a user wants
          to batch-send. */}
      <input
        type="checkbox"
        checked={isSelected}
        disabled={isDisabled}
        onChange={() => onToggleSelected(p)}
        onClick={(e) => e.stopPropagation()}
        title="Select for batch send"
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          cursor: isDisabled ? 'not-allowed' : 'pointer',
        }}
      />
      <div className="ops-board-card-head" style={{ paddingLeft: 22 }}>
        <span className="ops-board-card-client" title={guestName}>{guestName}</span>
        {hasSiblings && (
          // Sibling pill sits where the ref code used to (top-right) —
          // far more useful at a glance: "this is 1 of N in a deal".
          // Uses .ops-board-card-tag for visual consistency with Agent /
          // Viewed tags; the trailing arrow signals it's actionable
          // (click to filter the page to just this deal's siblings).
          <button
            type="button"
            className="ops-board-card-tag ops-board-card-tag--clickable"
            onClick={(e) => { e.stopPropagation(); onFocusEnquiry(p.enquiry_id!); }}
            title="Show only this deal's proposals"
          >
            📎 {siblingCount} in this deal →
          </button>
        )}
      </div>
      <div className="ops-board-card-property" title={propertyName}>🏠 {propertyName}</div>
      <div className="ops-board-card-meta">
        {p.check_in && p.check_out
          ? <span>{fmtDate(p.check_in)} to {fmtDate(p.check_out)}<NightCount checkIn={p.check_in} checkOut={p.check_out} /></span>
          : <span style={{ fontStyle: 'italic' }}>No dates</span>}
        <span style={{ flex: 1 }} />
        {days >= 1 && <span className={`ops-board-card-days ${daysCls}`}>{days}d</span>}
      </div>
      {p.decline_reason && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.6875rem', fontStyle: 'italic', marginTop: 4 }}>
          Reason: {p.decline_reason}
        </div>
      )}
    </div>
  );
}

// ─── List view ──────────────────────────────────────────────────────────

interface ListRow extends DataRow {
  id: string;
  ref_code: string;
  guest_name: string;
  guest_email: string | null;
  property_name: string;
  status: string;
  check_in: string | null;
  check_out: string | null;
  nights: number | null;
  created_at: string;
  proposal: ProposalRow;
}

function ListView({ proposals, onOpen, siblingCounts, onFocusEnquiry }: {
  proposals: ProposalRow[];
  onOpen: (p: ProposalRow) => void;
  siblingCounts: Map<string, number>;
  onFocusEnquiry: (enquiryId: string) => void;
}) {
  const rows: ListRow[] = proposals.map(p => ({
    id: p.id,
    ref_code: p.ref_code,
    guest_name: p.guest_name,
    guest_email: p.guest_email,
    property_name: p.property_name,
    status: p.status,
    check_in: p.check_in,
    check_out: p.check_out,
    nights: nightsBetween(p.check_in, p.check_out),
    created_at: p.created_at,
    proposal: p,
  }));

  const columns = [
    {
      key: 'guest_name', label: 'Client', sortable: true,
      render: (row: DataRow) => {
        const r = row as ListRow;
        const eid = r.proposal.enquiry_id;
        const sibCount = eid ? (siblingCounts.get(eid) ?? 1) : 1;
        return (
          <div className="list-client-text">
            <span className="list-client-name" title={titleCase(r.guest_name)}>{titleCase(r.guest_name)}</span>
            {r.guest_email && <span className="list-client-meta" title={r.guest_email}>{r.guest_email.toLowerCase()}</span>}
            {eid && sibCount > 1 && (
              <button
                type="button"
                className="ops-board-card-tag ops-board-card-tag--clickable"
                style={{ marginTop: 2, alignSelf: 'flex-start' }}
                onClick={(e) => { e.stopPropagation(); onFocusEnquiry(eid); }}
                title="Show only this deal's proposals"
              >
                📎 {sibCount} in this deal →
              </button>
            )}
          </div>
        );
      },
    },
    {
      key: 'ref_code', label: 'Ref', sortable: true, width: '110px',
      render: (row: DataRow) => <span className="list-ref">{(row as ListRow).ref_code}</span>,
    },
    {
      key: 'property_name', label: 'Property', sortable: true, hideOnMobile: true,
      render: (row: DataRow) => {
        const name = (row as ListRow).property_name;
        const formatted = name ? titleCase(name) : null;
        return formatted
          ? <span className="list-property" title={formatted}>{formatted}</span>
          : <span className="list-dates-empty">—</span>;
      },
    },
    {
      key: 'check_in', label: 'Dates', sortable: true,
      render: (row: DataRow) => {
        const r = row as ListRow;
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
        const n = (row as ListRow).nights;
        return n != null ? n : <span className="list-dates-empty">—</span>;
      },
    },
    {
      key: 'status', label: 'Status', sortable: true, align: 'center' as const,
      render: (row: DataRow) => {
        const r = row as ListRow;
        const col = columnFor(r.status);
        const label = COLUMNS.find(c => c.key === col)?.label ?? r.status;
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
        <span className="list-relative" title={fmtDateLong((row as ListRow).created_at)}>
          {fmtRelative((row as ListRow).created_at)}
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
            title="View proposal"
            onClick={() => onOpen((row as ListRow).proposal)}
          >
            👁
          </button>
          <button
            type="button"
            className="list-action-icon"
            title="Edit proposal"
            onClick={() => onOpen((row as ListRow).proposal)}
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
      loading={false}
      searchable={false}
      resultsBarContent={null}
      onRowClick={(row: DataRow) => onOpen((row as ListRow).proposal)}
    />
  );
}
