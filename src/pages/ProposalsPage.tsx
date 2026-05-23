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
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import DataTable from '../components/DataTable';
import type { DataRow } from '../components/DataTable';
import NewProposalLauncher from '../components/NewProposalLauncher';
import ProposalDetailModal, { type ProposalForDetail } from '../components/ProposalDetailModal';
import PricingModal from './PricingModal';
import { CT_RENTALS_PARTNER_ID } from './constants';

interface ProposalRow extends ProposalForDetail {
  property_name: string;
  decline_reason: string | null;
}

const COLUMNS = [
  { key: 'drafting', label: 'Drafting', description: 'Being written',          emptyMsg: 'No drafts' },
  { key: 'ready',    label: 'Ready',    description: 'Awaiting send',          emptyMsg: 'Nothing ready' },
  { key: 'sent',     label: 'Sent',     description: 'Out with the client',    emptyMsg: 'Nothing awaiting response' },
  { key: 'accepted', label: 'Accepted', description: 'Client said yes',        emptyMsg: 'No acceptances yet' },
  { key: 'declined', label: 'Declined', description: 'Closed without booking', emptyMsg: 'No declines' },
] as const;

const COLUMN_ACCENT: Record<string, string> = {
  drafting: 'var(--text-secondary)',
  ready:    'var(--warning)',
  sent:     'var(--info)',
  accepted: 'var(--success)',
  declined: 'var(--text-light)',
};

/** Map any proposal status (legacy or new) to one of the five columns. */
function columnFor(status: string): string {
  switch (status) {
    case 'draft':
    case 'drafting':
      return 'drafting';
    case 'ready':
      return 'ready';
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

function fmtDateLong(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ProposalsPage() {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [search, setSearch] = useState('');
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [openProposal, setOpenProposal] = useState<ProposalRow | null>(null);
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

  async function fetchProposals() {
    if (!supabase) return;
    setLoading(true);
    // decline_reason is added by the workflow_rebuild migration. Until that
    // runs in Supabase, omit it from the select so we don't get a column
    // error. The field is read defensively below via ?? null.
    const { data, error } = await supabase
      .from('proposals')
      .select(`
        id, ref_code, property_id, status, is_agent,
        guest_name, guest_email, guest_phone, check_in, check_out,
        guests_total, notes, pricing_proposal_id,
        created_at, sent_at, viewed_at, accepted_at,
        partner_properties(property_name),
        pricing_proposals(client_price_excl_vat, scenario_type, season_tag, owner_net, company_take, agents)
      `)
      .eq('partner_id', CT_RENTALS_PARTNER_ID)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Proposals fetch failed:', error);
      setProposals([]);
      setLoading(false);
      return;
    }
    setProposals((data || []).map((p: any) => ({
      id: p.id,
      ref_code: p.ref_code,
      property_id: p.property_id,
      property_name: p.partner_properties?.property_name || '—',
      pricing_proposal_id: p.pricing_proposal_id ?? null,
      status: p.status,
      is_agent: !!p.is_agent,
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
    })));
    setLoading(false);
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

    return result;
  }, [proposals, search, statusFilter, propertyFilter]);

  const byColumn = useMemo(() => {
    const map: Record<string, ProposalRow[]> = {
      drafting: [], ready: [], sent: [], accepted: [], declined: [],
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
        if (col.key === 'drafting' || col.key === 'ready') list.sort(byOldest);
        else if (col.key === 'sent')                       list.sort(byCheckIn);
        else                                                list.sort(byNewest);
      }
    }
    return map;
  }, [filtered, columnSort]);

  return (
    <div>
      {/* Toolbar — shared shape with Enquiries page. */}
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
            <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
              {filtered.length} of {proposals.length}
            </span>
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
        />
      ) : (
        <ListView proposals={filtered} onOpen={setOpenProposal} />
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
              setEditPricingFor({ ...data, _propertyName: openProposal.property_name });
              setOpenProposal(null);
            }
          }}
        />
      )}

      {editPricingFor && (
        <PricingModal
          property={{ id: editPricingFor.property_id, property_name: editPricingFor._propertyName }}
          supabase={supabase}
          editPricingProposal={editPricingFor}
          onClose={() => setEditPricingFor(null)}
          onPricingSaved={() => { setEditPricingFor(null); fetchProposals(); }}
        />
      )}
    </div>
  );
}

// ─── Board view ─────────────────────────────────────────────────────────

function BoardView({
  byColumn, columnSort, onColumnSortChange, onOpen,
}: {
  byColumn: Record<string, ProposalRow[]>;
  columnSort: Record<string, string>;
  onColumnSortChange: (key: string, value: string) => void;
  onOpen: (p: ProposalRow) => void;
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
              byColumn[col.key].map(p => <ProposalCard key={p.id} p={p} onOpen={onOpen} />)
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProposalCard({ p, onOpen }: { p: ProposalRow; onOpen: (p: ProposalRow) => void }) {
  const days = daysSince(p.created_at);
  const daysCls = days >= 10 ? 'ops-board-card-days--hot'
    : days >= 5 ? 'ops-board-card-days--warn' : '';
  const guestName = titleCase(p.guest_name);
  const propertyName = titleCase(p.property_name);
  return (
    <div className="ops-board-card" onClick={() => onOpen(p)}>
      <div className="ops-board-card-head">
        <span className="ops-board-card-client" title={guestName}>{guestName}</span>
        <span className="ops-board-card-ref">{p.ref_code}</span>
      </div>
      <div className="ops-board-card-property" title={propertyName}>{propertyName}</div>
      <div className="ops-board-card-meta">
        {p.check_in && p.check_out
          ? <span>{fmtDate(p.check_in)} to {fmtDate(p.check_out)}</span>
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

function ListView({ proposals, onOpen }: { proposals: ProposalRow[]; onOpen: (p: ProposalRow) => void }) {
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
        return (
          <div className="list-client-text">
            <span className="list-client-name" title={titleCase(r.guest_name)}>{titleCase(r.guest_name)}</span>
            {r.guest_email && <span className="list-client-meta" title={r.guest_email}>{r.guest_email.toLowerCase()}</span>}
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
