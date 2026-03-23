/* eslint-disable */
// @ts-nocheck
/**
 * BookingModal -- Create / edit a booking
 */

import { useState } from 'react';
import DateInput from '../components/DateInput';
import { BOOKING_STATUS_OPTIONS, PLATFORM_OPTIONS } from './constants';

export default function BookingModal({ booking, properties, onClose, onSave, supabase, user, partnerId }) {
  const isNew = !booking.id;
  const isFromEnquiry = !!booking._fromEnquiry;

  const [form, setForm] = useState({
    property_id: booking.property_id || '',
    guest_name: booking.guest_name || '',
    guest_email: booking.guest_email || '',
    guest_phone: booking.guest_phone || '',
    guest_nationality: booking.guest_nationality || '',
    guests_total: booking.guests_total ?? 1,
    guests_adults: booking.guests_adults ?? '',
    guests_children: booking.guests_children ?? '',
    check_in: booking.check_in || '',
    check_out: booking.check_out || '',
    platform: booking.platform || '',
    manager: booking.manager || '',
    total_amount: booking.total_amount ?? '',
    balance_due: booking.balance_due ?? '',
    currency: booking.currency || 'ZAR',
    house_contact: booking.house_contact || '',
    extras: booking.extras || '',
    notes: booking.notes || '',
    status: booking.status || 'confirmed',
  });

  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSave() {
    if (!form.guest_name.trim()) { alert('Guest name is required'); return; }
    if (!form.property_id) { alert('Please select a property'); return; }
    if (!form.check_in || !form.check_out) { alert('Check-in and check-out dates are required'); return; }
    if (form.check_out <= form.check_in) { alert('Check-out must be after check-in'); return; }

    setSaving(true);
    try {
      const payload = {
        partner_id: partnerId,
        property_id: form.property_id,
        enquiry_id: booking.enquiry_id || null,
        guest_name: form.guest_name.trim(),
        guest_email: form.guest_email.trim() || null,
        guest_phone: form.guest_phone.trim() || null,
        guest_nationality: form.guest_nationality.trim() || null,
        guests_total: Number(form.guests_total) || 1,
        guests_adults: form.guests_adults !== '' ? Number(form.guests_adults) : null,
        guests_children: form.guests_children !== '' ? Number(form.guests_children) : null,
        check_in: form.check_in,
        check_out: form.check_out,
        platform: form.platform || null,
        manager: form.manager.trim() || null,
        total_amount: form.total_amount !== '' ? Number(form.total_amount) : null,
        balance_due: form.balance_due !== '' ? Number(form.balance_due) : null,
        currency: form.currency || 'ZAR',
        house_contact: form.house_contact.trim() || null,
        extras: form.extras.trim() || null,
        notes: form.notes.trim() || null,
        status: form.status,
        updated_at: new Date().toISOString(),
      };

      if (isNew) {
        payload.created_by = user?.id || null;
        const { error } = await supabase.from('bookings').insert(payload);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('bookings').update(payload).eq('id', booking.id);
        if (error) throw error;
      }

      // Pass enquiry_id back so the parent can update enquiry status
      if (onSave) await onSave(isFromEnquiry ? booking.enquiry_id : undefined);
    } catch (err) {
      console.error('Error saving booking:', err);
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const { error } = await supabase.from('bookings').delete().eq('id', booking.id);
      if (error) throw error;
      if (onSave) await onSave();
    } catch (err) {
      console.error('Error deleting booking:', err);
      alert('Failed to delete: ' + err.message);
    } finally {
      setDeleting(false);
    }
  }

  const SectionHeading = ({ children }) => (
    <h3 style={{ margin: '1.5rem 0 0.75rem', fontSize: '0.875rem', fontWeight: 600, textTransform: 'uppercase', color: '#6B7280', letterSpacing: '0.05em' }}>
      {children}
    </h3>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            {isNew ? (isFromEnquiry ? 'Convert Enquiry to Booking' : 'New Booking') : 'Edit Booking'}
          </h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {isFromEnquiry && (
            <div style={{ padding: '0.75rem', background: '#DBEAFE', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.8125rem', color: '#1E40AF' }}>
              Converting from enquiry. Guest details have been pre-filled. Select a property and confirm.
            </div>
          )}

          <SectionHeading>Property & Dates</SectionHeading>
          <div className="form-group">
            <label className="form-label">Property *</label>
            <select className="form-input" value={form.property_id} onChange={(e) => setForm({ ...form, property_id: e.target.value })}>
              <option value="">-- Select property --</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>{p.property_name}{p.bedrooms ? ` (${p.bedrooms} bed)` : ''}{p.suburb ? ` — ${p.suburb}` : ''}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Check In *</label>
              <DateInput className="form-input" value={form.check_in} onChange={(v) => setForm({ ...form, check_in: v })} placeholder="e.g. 27 Mar 2026" />
            </div>
            <div className="form-group">
              <label className="form-label">Check Out *</label>
              <DateInput className="form-input" value={form.check_out} onChange={(v) => setForm({ ...form, check_out: v })} placeholder="e.g. 3 Apr 2026" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {BOOKING_STATUS_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Platform</label>
              <select className="form-input" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                <option value="">-- Select --</option>
                {PLATFORM_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
            </div>
          </div>

          <SectionHeading>Guest Details</SectionHeading>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Guest Name *</label>
              <input type="text" className="form-input" value={form.guest_name} onChange={(e) => setForm({ ...form, guest_name: e.target.value })} placeholder="Full name" />
            </div>
            <div className="form-group">
              <label className="form-label">Nationality</label>
              <input type="text" className="form-input" value={form.guest_nationality} onChange={(e) => setForm({ ...form, guest_nationality: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input type="email" className="form-input" value={form.guest_email} onChange={(e) => setForm({ ...form, guest_email: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input type="tel" className="form-input" value={form.guest_phone} onChange={(e) => setForm({ ...form, guest_phone: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Total Guests</label>
              <input type="number" className="form-input" value={form.guests_total} onChange={(e) => setForm({ ...form, guests_total: e.target.value })} min={1} />
            </div>
            <div className="form-group">
              <label className="form-label">Adults</label>
              <input type="number" className="form-input" value={form.guests_adults} onChange={(e) => setForm({ ...form, guests_adults: e.target.value })} min={0} />
            </div>
            <div className="form-group">
              <label className="form-label">Children</label>
              <input type="number" className="form-input" value={form.guests_children} onChange={(e) => setForm({ ...form, guests_children: e.target.value })} min={0} />
            </div>
          </div>

          <SectionHeading>Financial</SectionHeading>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Total Amount</label>
              <input type="number" className="form-input" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} min={0} step="0.01" />
            </div>
            <div className="form-group">
              <label className="form-label">Balance Due</label>
              <input type="number" className="form-input" value={form.balance_due} onChange={(e) => setForm({ ...form, balance_due: e.target.value })} min={0} step="0.01" />
            </div>
            <div className="form-group">
              <label className="form-label">Currency</label>
              <select className="form-input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                <option value="ZAR">ZAR</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option>
              </select>
            </div>
          </div>

          <SectionHeading>Admin</SectionHeading>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Manager</label>
              <input type="text" className="form-input" value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} placeholder="Who manages this booking" />
            </div>
            <div className="form-group">
              <label className="form-label">House Contact</label>
              <input type="text" className="form-input" value={form.house_contact} onChange={(e) => setForm({ ...form, house_contact: e.target.value })} placeholder="Property contact person" />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Extras</label>
            <input type="text" className="form-input" value={form.extras} onChange={(e) => setForm({ ...form, extras: e.target.value })} placeholder="e.g., cot, bath, linen" />
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Internal notes..." />
          </div>
        </div>

        <div className="modal-footer">
          {!isNew && !showDeleteConfirm && (
            <button className="btn btn-outline" style={{ color: '#dc2626' }} onClick={() => setShowDeleteConfirm(true)}>Delete</button>
          )}
          {!isNew && showDeleteConfirm && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#dc2626', fontSize: '0.875rem' }}>Delete this booking?</span>
              <button className="btn btn-outline" style={{ color: '#dc2626' }} onClick={handleDelete} disabled={deleting}>{deleting ? 'Deleting...' : 'Confirm'}</button>
              <button className="btn btn-ghost" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
            </div>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : isFromEnquiry ? 'Create Booking' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
