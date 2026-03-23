/* eslint-disable */
// @ts-nocheck
/**
 * ProposalGeneratorModal
 *
 * Flow:
 * 1. Shows enquiry details + auto-matched properties (by bedrooms/availability)
 * 2. User manually selects/deselects properties
 * 3. User clicks "Generate Proposals"
 * 4. Creates a proposal row per selected property
 * 5. Shows generated links with Send via WhatsApp / Email buttons
 */

import { useState, useEffect, useMemo } from 'react';

function generateRefCode() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `CTR-${date}-${rand}`;
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ProposalGeneratorModal({ enquiry, onClose, onDone, supabase, partnerId }) {
  const [properties, setProperties] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [generating, setGenerating] = useState(false);
  const [generatedProposals, setGeneratedProposals] = useState(null);
  const [sendingStatus, setSendingStatus] = useState({});
  const [copied, setCopied] = useState(null);

  // Load properties and bookings to check availability
  useEffect(() => {
    async function load() {
      setLoading(true);
      const [propRes, bookRes] = await Promise.all([
        supabase.from('partner_properties').select('id, property_name, bedrooms, bathrooms, sleeps, suburb, city, price_from, price_currency, hero_image_url, is_published')
          .eq('partner_id', partnerId).order('bedrooms', { ascending: false }),
        supabase.from('bookings').select('property_id, check_in, check_out, status')
          .eq('partner_id', partnerId).neq('status', 'cancelled'),
      ]);
      if (propRes.data) setProperties(propRes.data);
      if (bookRes.data) setBookings(bookRes.data);
      setLoading(false);
    }
    load();
  }, [supabase, partnerId]);

  // Check if a property is available for the enquiry dates
  function isAvailable(propertyId) {
    if (!enquiry.check_in || !enquiry.check_out) return true;
    return !bookings.some(b =>
      b.property_id === propertyId &&
      b.check_in < enquiry.check_out && b.check_out > enquiry.check_in
    );
  }

  // Auto-match: filter by bedrooms >= needed, available, published
  const matchedProperties = useMemo(() => {
    return properties.filter(p => {
      const bedsMatch = !enquiry.bedrooms_needed || (p.bedrooms && p.bedrooms >= enquiry.bedrooms_needed);
      const available = isAvailable(p.id);
      return bedsMatch && available && p.is_published;
    });
  }, [properties, bookings, enquiry]);

  const unmatchedProperties = useMemo(() => {
    return properties.filter(p => !matchedProperties.find(m => m.id === p.id));
  }, [properties, matchedProperties]);

  // Auto-select matched properties on first load
  useEffect(() => {
    if (!loading && matchedProperties.length > 0 && selectedIds.size === 0) {
      setSelectedIds(new Set(matchedProperties.map(p => p.id)));
    }
  }, [loading, matchedProperties]);

  function toggleProperty(id) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  }

  function selectAll() { setSelectedIds(new Set(properties.map(p => p.id))); }
  function selectNone() { setSelectedIds(new Set()); }
  function selectMatched() { setSelectedIds(new Set(matchedProperties.map(p => p.id))); }

  // Generate proposals
  async function handleGenerate() {
    if (selectedIds.size === 0) return;
    setGenerating(true);

    const proposals = [];
    for (const propId of selectedIds) {
      const refCode = generateRefCode();
      proposals.push({
        ref_code: refCode,
        partner_id: partnerId,
        enquiry_id: enquiry.id,
        property_id: propId,
        guest_name: enquiry.client_name,
        guest_email: enquiry.client_email || null,
        guest_phone: enquiry.client_phone || null,
        guest_nationality: enquiry.nationality || null,
        guests_total: enquiry.guests_total || 1,
        guests_adults: enquiry.guests_adults || null,
        guests_children: enquiry.guests_children || null,
        check_in: enquiry.check_in,
        check_out: enquiry.check_out,
        budget_min: enquiry.budget_min || null,
        budget_max: enquiry.budget_max || null,
        status: 'draft',
        notes: enquiry.notes || null,
      });
    }

    const { data, error } = await supabase.from('proposals').insert(proposals).select('*, partner_properties(property_name)');

    if (error) {
      alert('Failed to generate proposals: ' + error.message);
      setGenerating(false);
      return;
    }

    // Update enquiry status to reviewed
    await supabase.from('enquiries').update({ status: 'reviewed', updated_at: new Date().toISOString() }).eq('id', enquiry.id);

    setGeneratedProposals(data);
    setGenerating(false);
  }

  // Build proposal URL
  function getProposalUrl(refCode) {
    return `${window.location.origin}/proposal.html?ref=${refCode}`;
  }

  // Send via WhatsApp
  function sendWhatsApp(proposal) {
    const property = properties.find(p => p.id === proposal.property_id);
    const propName = property?.property_name || 'a property';
    const url = getProposalUrl(proposal.ref_code);
    const msg = encodeURIComponent(
      `Hi ${enquiry.client_name},\n\nThank you for your enquiry with CT Rentals.\n\nWe've put together a proposal for ${propName} for your stay from ${fmtDate(enquiry.check_in)} to ${fmtDate(enquiry.check_out)}.\n\nView your proposal here:\n${url}\n\nLet us know if you have any questions!`
    );
    let phone = (enquiry.client_phone || '').replace(/[^0-9]/g, '');
    // Convert local SA number (0xx) to international (27xx)
    if (phone.startsWith('0')) phone = '27' + phone.slice(1);
    // Strip leading + if present
    if (phone.startsWith('+')) phone = phone.slice(1);
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');

    // Mark as sent
    supabase.from('proposals').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', proposal.id);
    setSendingStatus(prev => ({ ...prev, [proposal.id]: 'sent' }));
  }

  // Send via Email
  function sendEmail(proposal) {
    const property = properties.find(p => p.id === proposal.property_id);
    const propName = property?.property_name || 'a property';
    const url = getProposalUrl(proposal.ref_code);
    const subject = encodeURIComponent(`CT Rentals — Property Proposal: ${propName}`);
    const body = encodeURIComponent(
      `Hi ${enquiry.client_name},\n\nThank you for your enquiry with CT Rentals.\n\nWe've put together a proposal for ${propName} for your stay from ${fmtDate(enquiry.check_in)} to ${fmtDate(enquiry.check_out)}.\n\nView your proposal here:\n${url}\n\nLet us know if you have any questions!\n\nBest regards,\nCT Rentals`
    );
    window.open(`mailto:${enquiry.client_email || ''}?subject=${subject}&body=${body}`, '_blank');

    supabase.from('proposals').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', proposal.id);
    setSendingStatus(prev => ({ ...prev, [proposal.id]: 'sent' }));
  }

  function copyLink(refCode, proposalId) {
    navigator.clipboard.writeText(getProposalUrl(refCode));
    setCopied(proposalId);
    setTimeout(() => setCopied(null), 2000);
  }

  // ══════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: '900px' }}>
        <div className="modal-header">
          <h2 className="modal-title">
            {generatedProposals ? 'Proposals Generated' : 'Generate Property Proposals'}
          </h2>
          <button className="modal-close" onClick={() => { if (generatedProposals) onDone(); onClose(); }}>&times;</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
          {/* Enquiry summary */}
          <div style={{ padding: '12px 16px', background: '#F9FAFB', borderRadius: '8px', marginBottom: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', fontSize: '0.8125rem' }}>
              <div><strong>Guest:</strong> {enquiry.client_name}</div>
              <div><strong>Dates:</strong> {fmtDate(enquiry.check_in)} – {fmtDate(enquiry.check_out)}</div>
              <div><strong>Guests:</strong> {enquiry.guests_total}</div>
              <div><strong>Bedrooms:</strong> {enquiry.bedrooms_needed}+</div>
              {enquiry.client_email && <div><strong>Email:</strong> {enquiry.client_email}</div>}
              {enquiry.client_phone && <div><strong>Phone:</strong> {enquiry.client_phone}</div>}
              {(enquiry.budget_min || enquiry.budget_max) && (
                <div><strong>Budget:</strong> R{enquiry.budget_min || '?'} – R{enquiry.budget_max || '?'}</div>
              )}
            </div>
          </div>

          {/* ── STEP 1: Property selection ── */}
          {!generatedProposals && (
            <>
              {loading ? (
                <div className="page-loader"><div className="spinner" /></div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <div>
                      <strong style={{ fontSize: '0.875rem' }}>Select Properties</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginLeft: '8px' }}>
                        {selectedIds.size} selected
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button className="btn btn-ghost" style={{ fontSize: '0.6875rem' }} onClick={selectMatched}>Auto-match ({matchedProperties.length})</button>
                      <button className="btn btn-ghost" style={{ fontSize: '0.6875rem' }} onClick={selectAll}>All</button>
                      <button className="btn btn-ghost" style={{ fontSize: '0.6875rem' }} onClick={selectNone}>None</button>
                    </div>
                  </div>

                  {/* Matched properties */}
                  {matchedProperties.length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{ fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--success)', marginBottom: '6px' }}>
                        Matching properties ({matchedProperties.length})
                      </div>
                      {matchedProperties.map(p => (
                        <PropertyRow key={p.id} property={p} selected={selectedIds.has(p.id)} onToggle={() => toggleProperty(p.id)} available={true} />
                      ))}
                    </div>
                  )}

                  {/* Other properties */}
                  {unmatchedProperties.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-light)', marginBottom: '6px' }}>
                        Other properties ({unmatchedProperties.length})
                      </div>
                      {unmatchedProperties.map(p => (
                        <PropertyRow key={p.id} property={p} selected={selectedIds.has(p.id)} onToggle={() => toggleProperty(p.id)} available={isAvailable(p.id)} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ── STEP 2: Generated proposals + send ── */}
          {generatedProposals && (
            <div>
              <div style={{ padding: '12px 16px', background: '#D1FAE5', borderRadius: '8px', marginBottom: '16px', fontSize: '0.8125rem', color: '#065F46' }}>
                {generatedProposals.length} proposal{generatedProposals.length !== 1 ? 's' : ''} generated for {enquiry.client_name}. Send them below.
              </div>

              {generatedProposals.map(proposal => {
                const property = properties.find(p => p.id === proposal.property_id);
                const status = sendingStatus[proposal.id];
                return (
                  <div key={proposal.id} className="proposal-link-card">
                    <div className="proposal-link-card-left">
                      {property?.hero_image_url && (
                        <img src={property.hero_image_url} alt="" className="proposal-link-thumb" />
                      )}
                      <div>
                        <div className="proposal-link-name">{property?.property_name || 'Property'}</div>
                        <div className="proposal-link-meta">
                          {property?.bedrooms ? `${property.bedrooms} bed` : ''}{property?.suburb ? ` · ${property.suburb}` : ''}
                          {property?.price_from ? ` · ${property.price_currency || 'ZAR'} ${Number(property.price_from).toLocaleString()} /wk` : ''}
                        </div>
                        <div className="proposal-link-ref">Ref: {proposal.ref_code}</div>
                      </div>
                    </div>
                    <div className="proposal-link-actions">
                      {status === 'sent' && (
                        <span style={{ fontSize: '0.6875rem', color: 'var(--success)', fontWeight: 600 }}>Sent ✓</span>
                      )}
                      <button className="btn btn-ghost" style={{ fontSize: '0.75rem' }} onClick={() => copyLink(proposal.ref_code, proposal.id)}>
                        {copied === proposal.id ? '✓ Copied' : '🔗 Copy Link'}
                      </button>
                      <a href={getProposalUrl(proposal.ref_code)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ fontSize: '0.75rem' }}>
                        👁 Preview
                      </a>
                      {enquiry.client_phone && (
                        <button className="btn btn-outline" style={{ fontSize: '0.75rem', color: '#25D366', borderColor: '#25D366' }} onClick={() => sendWhatsApp(proposal)}>
                          WhatsApp
                        </button>
                      )}
                      {enquiry.client_email && (
                        <button className="btn btn-outline" style={{ fontSize: '0.75rem' }} onClick={() => sendEmail(proposal)}>
                          Email
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {!generatedProposals ? (
            <>
              <div style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={handleGenerate} disabled={generating || selectedIds.size === 0}>
                {generating ? 'Generating...' : `Generate ${selectedIds.size} Proposal${selectedIds.size !== 1 ? 's' : ''}`}
              </button>
            </>
          ) : (
            <>
              <div style={{ flex: 1 }} />
              <button className="btn btn-primary" onClick={() => { onDone(); onClose(); }}>Done</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Property row component ──
function PropertyRow({ property, selected, onToggle, available }) {
  return (
    <div
      className={`prop-select-row ${selected ? 'prop-select-row--active' : ''} ${!available ? 'prop-select-row--unavailable' : ''}`}
      onClick={onToggle}
    >
      <input type="checkbox" checked={selected} onChange={onToggle} onClick={e => e.stopPropagation()} />
      {property.hero_image_url && <img src={property.hero_image_url} alt="" className="prop-select-thumb" />}
      <div className="prop-select-info">
        <span className="prop-select-name">{property.property_name}</span>
        <span className="prop-select-meta">
          {property.bedrooms ? `${property.bedrooms} bed` : ''}{property.suburb ? ` · ${property.suburb}` : ''}
          {property.price_from ? ` · ${property.price_currency || 'ZAR'} ${Number(property.price_from).toLocaleString()}` : ''}
        </span>
      </div>
      <div className="prop-select-tags">
        {!available && <span className="prop-select-tag prop-select-tag--booked">Booked</span>}
        {available && <span className="prop-select-tag prop-select-tag--free">Available</span>}
      </div>
    </div>
  );
}
