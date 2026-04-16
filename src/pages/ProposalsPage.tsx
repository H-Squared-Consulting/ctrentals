import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import DataTable from '../components/DataTable';
import type { DataRow } from '../components/DataTable';
import { StatusBadge } from '../components/DataTable';
import { CT_RENTALS_PARTNER_ID } from './constants';

interface Proposal extends DataRow {
  id: string;
  ref_code: string;
  enquiry_id: string;
  property_id: string;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  check_in: string;
  check_out: string;
  status: string;
  is_agent: boolean;
  sent_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
  created_at: string;
  property_name?: string;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  draft: { label: 'Draft', bg: '#F3F4F6', color: '#6B7280' },
  sent: { label: 'Sent', bg: '#DBEAFE', color: '#1E40AF' },
  viewed: { label: 'Viewed', bg: '#E0E7FF', color: '#3730A3' },
  interested: { label: 'Interested', bg: '#D1FAE5', color: '#065F46' },
  expired: { label: 'Expired', bg: '#FEE2E2', color: '#991B1B' },
};

const STATUS_OPTIONS = Object.entries(STATUS_CONFIG).map(([value, cfg]) => ({ value, label: cfg.label }));

function fmtDate(d: string | null) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(d: string | null) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function getProposalUrl(refCode: string) {
  return `${window.location.origin}/proposal.html?ref=${refCode}`;
}

export default function ProposalsPage({ embedded }: { embedded?: boolean } = {}) {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => { if (!embedded) setPageTitle('Proposals'); }, [setPageTitle, embedded]);

  async function fetchProposals() {
    setLoading(true);
    const { data, error } = await supabase
      .from('proposals')
      .select('*, partner_properties(property_name)')
      .eq('partner_id', CT_RENTALS_PARTNER_ID)
      .order('created_at', { ascending: false });

    if (!error && data) {
      // Flatten the property name join
      const mapped = data.map((p: Record<string, unknown>) => ({
        ...p,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        property_name: (p.partner_properties as any)?.property_name || '-',
      })) as Proposal[];
      setProposals(mapped);
    }
    setLoading(false);
  }

  useEffect(() => { if (supabase) fetchProposals(); }, [supabase]);

  function copyLink(refCode: string) {
    navigator.clipboard.writeText(getProposalUrl(refCode));
    setCopied(refCode);
    setTimeout(() => setCopied(null), 2000);
  }

  function sendWhatsApp(proposal: Proposal) {
    const url = getProposalUrl(proposal.ref_code);
    const msg = encodeURIComponent(
      `Hi ${proposal.guest_name},\n\nHere is your property proposal from CT Rentals:\n${url}\n\nLet us know if you have any questions!`
    );
    let phone = (proposal.guest_phone || '').replace(/[^0-9]/g, '');
    if (phone.startsWith('0')) phone = '27' + phone.slice(1);
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');

    supabase.from('proposals').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', proposal.id);
    fetchProposals();
  }

  function sendEmail(proposal: Proposal) {
    const url = getProposalUrl(proposal.ref_code);
    const subject = encodeURIComponent(`CT Rentals — Property Proposal: ${proposal.property_name}`);
    const body = encodeURIComponent(
      `Hi ${proposal.guest_name},\n\nHere is your property proposal from CT Rentals:\n${url}\n\nLet us know if you have any questions!\n\nBest regards,\nCT Rentals`
    );
    window.open(`mailto:${proposal.guest_email || ''}?subject=${subject}&body=${body}`, '_blank');

    supabase.from('proposals').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', proposal.id);
    fetchProposals();
  }

  const columns = [
    {
      key: 'status', label: 'Status', align: 'center' as const, sortable: true, width: '100px',
      render: (row: DataRow) => <StatusBadge status={(row as Proposal).status} config={STATUS_CONFIG} />,
    },
    {
      key: 'guest_name', label: 'Recipient', sortable: true,
      render: (row: DataRow) => {
        const p = row as Proposal;
        return <span>{p.guest_name}{p.is_agent ? <span className="status-badge" style={{ background: '#E0E7FF', color: '#3730A3', marginLeft: '6px', fontSize: '0.5625rem' }}>Agent</span> : ''}</span>;
      },
    },
    { key: 'property_name', label: 'Property', sortable: true },
    {
      key: 'check_in', label: 'Dates', sortable: true, hideOnMobile: true,
      render: (row: DataRow) => {
        const p = row as Proposal;
        return `${fmtDate(p.check_in)} – ${fmtDate(p.check_out)}`;
      },
    },
    {
      key: 'ref_code', label: 'Ref', hideOnMobile: true, width: '160px',
      render: (row: DataRow) => <span style={{ fontFamily: 'monospace', fontSize: '0.6875rem', color: 'var(--text-light)' }}>{(row as Proposal).ref_code}</span>,
    },
    {
      key: 'sent_at', label: 'Sent', sortable: true, hideOnMobile: true, width: '110px',
      render: (row: DataRow) => {
        const p = row as Proposal;
        return p.sent_at ? <span style={{ color: 'var(--success)', fontSize: '0.75rem' }}>{fmtDateTime(p.sent_at)}</span> : <span className="text-light">-</span>;
      },
    },
    {
      key: 'viewed_at', label: 'Viewed', sortable: true, hideOnMobile: true, width: '110px',
      render: (row: DataRow) => {
        const p = row as Proposal;
        return p.viewed_at ? <span style={{ color: 'var(--info)', fontSize: '0.75rem' }}>{fmtDateTime(p.viewed_at)}</span> : <span className="text-light">-</span>;
      },
    },
    {
      key: 'created_at', label: 'Created', sortable: true, hideOnMobile: true, width: '100px',
      render: (row: DataRow) => <span style={{ fontSize: '0.75rem' }}>{fmtDate((row as Proposal).created_at)}</span>,
    },
  ];

  const draftCount = proposals.filter(p => p.status === 'draft').length;
  const sentCount = proposals.filter(p => p.status === 'sent').length;
  const viewedCount = proposals.filter(p => p.status === 'viewed' || p.viewed_at).length;
  const interestedCount = proposals.filter(p => p.status === 'interested').length;

  return (
    <div>
      <DataTable
        columns={columns}
        data={proposals}
        loading={loading}
        searchable={true}
        searchPlaceholder="Search by guest, property, ref..."
        searchKeys={['guest_name', 'property_name', 'ref_code', 'guest_email']}
        defaultSort={{ key: 'created_at', direction: 'desc' }}
        summaryCards={[
          { value: proposals.length, label: 'Total Proposals', color: 'primary' },
          { value: sentCount, label: 'Sent', color: 'info' },
          { value: viewedCount, label: 'Viewed', color: 'warning' },
          { value: interestedCount, label: 'Interested', color: 'success' },
        ]}
        headerActions={{ onSync: { label: '↻ Refresh', onClick: () => fetchProposals() } }}
        filters={[{ key: 'status', label: 'Status', options: STATUS_OPTIONS }]}
        onRowClick={(row: DataRow) => setSelectedProposal(row as Proposal)}
        actions={(row: DataRow) => {
          const p = row as Proposal;
          return (
            <div style={{ display: 'flex', gap: '2px' }}>
              <span className="action-icon" title="Copy link" onClick={(e: React.MouseEvent) => { e.stopPropagation(); copyLink(p.ref_code); }}>
                {copied === p.ref_code ? '✓' : '🔗'}
              </span>
              <a className="action-icon" href={getProposalUrl(p.ref_code)} target="_blank" rel="noopener noreferrer" title="Preview" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                👁
              </a>
            </div>
          );
        }}
        pageSize={25}
        emptyMessage="No proposals generated yet. Go to Enquiries to create proposals."
      />

      {selectedProposal && (
        <div className="modal-overlay" onClick={() => setSelectedProposal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Proposal: {selectedProposal.ref_code}</h2>
              <button className="modal-close" onClick={() => setSelectedProposal(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                <div><strong>Guest:</strong> {selectedProposal.guest_name}</div>
                <div><strong>Property:</strong> {selectedProposal.property_name}</div>
                <div><strong>Email:</strong> {selectedProposal.guest_email || '-'}</div>
                <div><strong>Phone:</strong> {selectedProposal.guest_phone || '-'}</div>
                <div><strong>Check In:</strong> {fmtDate(selectedProposal.check_in)}</div>
                <div><strong>Check Out:</strong> {fmtDate(selectedProposal.check_out)}</div>
                <div><strong>Status:</strong> <StatusBadge status={selectedProposal.status} config={STATUS_CONFIG} /></div>
                <div><strong>Ref:</strong> <span style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>{selectedProposal.ref_code}</span></div>
              </div>

              <div style={{ padding: '12px', background: '#F9FAFB', borderRadius: '6px', marginBottom: '1rem' }}>
                <strong style={{ fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>Timeline</strong>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '8px', fontSize: '0.8125rem' }}>
                  <div>Created: {fmtDateTime(selectedProposal.created_at)}</div>
                  <div>Sent: {selectedProposal.sent_at ? fmtDateTime(selectedProposal.sent_at) : <span className="text-light">Not yet</span>}</div>
                  <div>Viewed: {selectedProposal.viewed_at ? fmtDateTime(selectedProposal.viewed_at) : <span className="text-light">Not yet</span>}</div>
                  <div>Interest: {selectedProposal.accepted_at ? fmtDateTime(selectedProposal.accepted_at) : <span className="text-light">Not yet</span>}</div>
                </div>
              </div>

              {/* Proposal link */}
              <div style={{ padding: '12px', background: 'var(--color-primary-bg)', borderRadius: '6px', marginBottom: '1rem' }}>
                <strong style={{ fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-primary)' }}>Proposal Link</strong>
                <div style={{ marginTop: '6px', fontSize: '0.8125rem', wordBreak: 'break-all', fontFamily: 'monospace', color: 'var(--text-mid)' }}>
                  {getProposalUrl(selectedProposal.ref_code)}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => copyLink(selectedProposal.ref_code)}>
                {copied === selectedProposal.ref_code ? '✓ Copied' : '🔗 Copy Link'}
              </button>
              <a className="btn btn-ghost" href={getProposalUrl(selectedProposal.ref_code)} target="_blank" rel="noopener noreferrer">
                👁 Preview
              </a>
              {selectedProposal.guest_phone && (
                <button className="btn btn-outline" style={{ color: '#25D366', borderColor: '#25D366' }} onClick={() => { sendWhatsApp(selectedProposal); setSelectedProposal(null); }}>
                  WhatsApp
                </button>
              )}
              {selectedProposal.guest_email && (
                <button className="btn btn-outline" onClick={() => { sendEmail(selectedProposal); setSelectedProposal(null); }}>
                  Email
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={() => setSelectedProposal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
