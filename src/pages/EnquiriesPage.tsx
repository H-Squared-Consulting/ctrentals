import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import DataTable from '../components/DataTable';
import type { DataRow } from '../components/DataTable';
import { StatusBadge } from '../components/DataTable';
import ProposalGeneratorModal from './ProposalGeneratorModal';
import { CT_RENTALS_PARTNER_ID } from './constants';

interface Enquiry extends DataRow {
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
  assigned_property_id: string | null;
  created_at: string;
}

interface Property {
  id: string;
  property_name: string;
  bedrooms: number | null;
  suburb: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  new: { label: 'New', bg: '#DBEAFE', color: '#1E40AF' },
  reviewed: { label: 'Reviewed', bg: '#E0E7FF', color: '#3730A3' },
  matched: { label: 'Matched', bg: '#FEF3C7', color: '#92400E' },
  booked: { label: 'Booked', bg: '#D1FAE5', color: '#065F46' },
  cancelled: { label: 'Cancelled', bg: '#FEE2E2', color: '#991B1B' },
};

const STATUS_OPTIONS = Object.entries(STATUS_CONFIG).map(([value, cfg]) => ({ value, label: cfg.label }));

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function EnquiriesPage() {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();
  const navigate = useNavigate();

  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEnquiry, setSelectedEnquiry] = useState<Enquiry | null>(null);
  const [proposalEnquiry, setProposalEnquiry] = useState<Enquiry | null>(null);

  useEffect(() => { setPageTitle('Enquiries'); }, [setPageTitle]);

  async function fetchData() {
    setLoading(true);
    const [enqRes, propRes] = await Promise.all([
      supabase.from('enquiries').select('*').eq('partner_id', CT_RENTALS_PARTNER_ID).order('created_at', { ascending: false }),
      supabase.from('partner_properties').select('id, property_name, bedrooms, suburb').eq('partner_id', CT_RENTALS_PARTNER_ID).order('property_name'),
    ]);
    if (enqRes.data) setEnquiries(enqRes.data as Enquiry[]);
    if (propRes.data) setProperties(propRes.data as Property[]);
    setLoading(false);
  }

  useEffect(() => { if (supabase) fetchData(); }, [supabase]);

  async function updateStatus(id: string, status: string) {
    const { error } = await supabase.from('enquiries').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    if (!error) {
      setEnquiries(prev => prev.map(e => (e.id === id ? { ...e, status } : e)));
      if (selectedEnquiry?.id === id) setSelectedEnquiry(prev => prev ? { ...prev, status } : null);
    }
  }

  async function assignProperty(enquiryId: string, propertyId: string) {
    const updates: Record<string, unknown> = {
      assigned_property_id: propertyId || null,
      updated_at: new Date().toISOString(),
    };
    // Auto-set status to matched when a property is assigned
    if (propertyId) updates.status = 'matched';

    const { error } = await supabase.from('enquiries').update(updates).eq('id', enquiryId);
    if (!error) {
      setEnquiries(prev => prev.map(e => (e.id === enquiryId ? { ...e, ...updates } as Enquiry : e)));
      if (selectedEnquiry?.id === enquiryId) {
        setSelectedEnquiry(prev => prev ? { ...prev, ...updates } as Enquiry : null);
      }
    }
  }

  function handleConvertToBooking(enquiry: Enquiry) {
    setSelectedEnquiry(null);
    navigate('/calendar', { state: { fromEnquiry: enquiry } });
  }

  const columns = [
    { key: 'client_name', label: 'Client', sortable: true },
    { key: 'client_email', label: 'Email', sortable: true, hideOnMobile: true },
    { key: 'check_in', label: 'Check In', sortable: true, render: (row: DataRow) => formatDate((row as Enquiry).check_in) },
    { key: 'check_out', label: 'Check Out', sortable: true, hideOnMobile: true, render: (row: DataRow) => formatDate((row as Enquiry).check_out) },
    { key: 'bedrooms_needed', label: 'Beds', align: 'center' as const, width: '60px', sortable: true },
    { key: 'guests_total', label: 'Guests', align: 'center' as const, width: '70px', hideOnMobile: true },
    {
      key: 'status', label: 'Status', align: 'center' as const, sortable: true,
      render: (row: DataRow) => <StatusBadge status={(row as Enquiry).status} config={STATUS_CONFIG} />,
    },
    { key: 'created_at', label: 'Created', sortable: true, hideOnMobile: true, render: (row: DataRow) => formatDate((row as Enquiry).created_at) },
  ];

  const newCount = enquiries.filter(e => e.status === 'new').length;
  const bookedCount = enquiries.filter(e => e.status === 'booked').length;

  return (
    <div>
      <DataTable
        columns={columns}
        data={enquiries}
        loading={loading}
        searchable={true}
        searchPlaceholder="Search enquiries..."
        searchKeys={['client_name', 'client_email', 'nationality']}
        defaultSort={{ key: 'created_at', direction: 'desc' }}
        summaryCards={[
          { value: enquiries.length, label: 'Total Enquiries', color: 'primary' },
          { value: newCount, label: 'New', color: 'info' },
          { value: bookedCount, label: 'Booked', color: 'success' },
        ]}
        headerActions={{ onSync: { label: '↻ Refresh', onClick: () => fetchData() } }}
        filters={[{ key: 'status', label: 'Status', options: STATUS_OPTIONS }]}
        onRowClick={(row: DataRow) => setSelectedEnquiry(row as Enquiry)}
        pageSize={25}
        emptyMessage="No enquiries yet."
      />

      {selectedEnquiry && (
        <div className="modal-overlay" onClick={() => setSelectedEnquiry(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Enquiry: {selectedEnquiry.client_name}</h2>
              <button className="modal-close" onClick={() => setSelectedEnquiry(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                <div><strong>Client:</strong> {selectedEnquiry.client_name}</div>
                <div><strong>Email:</strong> {selectedEnquiry.client_email || '-'}</div>
                <div><strong>Phone:</strong> {selectedEnquiry.client_phone || '-'}</div>
                <div><strong>Nationality:</strong> {selectedEnquiry.nationality || '-'}</div>
                <div><strong>Check In:</strong> {formatDate(selectedEnquiry.check_in)}</div>
                <div><strong>Check Out:</strong> {formatDate(selectedEnquiry.check_out)}</div>
                <div><strong>Bedrooms:</strong> {selectedEnquiry.bedrooms_needed}</div>
                <div><strong>Guests:</strong> {selectedEnquiry.guests_total}</div>
                <div><strong>Adults:</strong> {selectedEnquiry.guests_adults ?? '-'}</div>
                <div><strong>Children:</strong> {selectedEnquiry.guests_children ?? '-'}</div>
                <div><strong>Budget:</strong> {selectedEnquiry.budget_min || selectedEnquiry.budget_max ? `R${selectedEnquiry.budget_min ?? '?'} – R${selectedEnquiry.budget_max ?? '?'}` : '-'}</div>
              </div>

              {selectedEnquiry.notes && (
                <div style={{ padding: '0.75rem', background: '#f9fafb', borderRadius: '6px', marginBottom: '1rem' }}>
                  <strong>Notes:</strong><p style={{ margin: '0.25rem 0 0' }}>{selectedEnquiry.notes}</p>
                </div>
              )}

              {/* ── Assign Property ── */}
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1rem', marginBottom: '1rem' }}>
                <strong>Assign Property:</strong>
                <select
                  className="form-input"
                  style={{ marginTop: '0.5rem' }}
                  value={selectedEnquiry.assigned_property_id || ''}
                  onChange={(e) => assignProperty(selectedEnquiry.id, e.target.value)}
                >
                  <option value="">-- Not assigned --</option>
                  {properties.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.property_name}{p.bedrooms ? ` (${p.bedrooms} bed)` : ''}{p.suburb ? ` — ${p.suburb}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* ── Status ── */}
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1rem' }}>
                <strong>Status:</strong>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                  {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                    <button
                      key={key}
                      className={`btn ${selectedEnquiry.status === key ? 'btn-primary' : 'btn-outline'}`}
                      style={{ fontSize: '0.8125rem' }}
                      onClick={() => updateStatus(selectedEnquiry.id, key)}
                    >
                      {cfg.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              {selectedEnquiry.status !== 'booked' && selectedEnquiry.status !== 'cancelled' && (
                <>
                  <button
                    className="btn btn-primary"
                    onClick={() => { setProposalEnquiry(selectedEnquiry); setSelectedEnquiry(null); }}
                  >
                    Generate Proposals
                  </button>
                  <button
                    className="btn btn-outline"
                    onClick={() => handleConvertToBooking(selectedEnquiry)}
                  >
                    Convert to Booking
                  </button>
                </>
              )}
              <div style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={() => setSelectedEnquiry(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {proposalEnquiry && (
        <ProposalGeneratorModal
          enquiry={proposalEnquiry}
          onClose={() => setProposalEnquiry(null)}
          onDone={() => { setProposalEnquiry(null); fetchData(); }}
          supabase={supabase}
          partnerId={CT_RENTALS_PARTNER_ID}
        />
      )}
    </div>
  );
}
