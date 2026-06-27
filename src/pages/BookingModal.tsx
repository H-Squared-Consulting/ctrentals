/**
 * BookingModal -- Create / view / edit a booking.
 *
 * Standard Tier A modal built on <DetailModal>. View mode by default
 * (fields locked); ✏ Edit flips to edit mode. Status transitions
 * (Mark Checked In / Mark Checked Out / Mark Cancelled) live as
 * outcome buttons in the footer and work in both modes, same pattern
 * as the Deal modal's Mark Booked / Mark Lost.
 *
 * Replaces the legacy inline status-flip popover that used to live on
 * BookingCalendarPage — all status changes now route through here.
 */

/* eslint-disable */
// @ts-nocheck

import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../components/ToastProvider';
import DetailModal, { DetailModalSection } from '../components/DetailModal';
import NightCount from '../components/NightCount';
import { BOOKING_STATUS_OPTIONS, PLATFORM_OPTIONS, CT_RENTALS_PARTNER_ID } from './constants';
import { findBookingConflict, describeConflict } from '../lib/bookingConflicts';
import { resolveOwnerForProperty } from '../lib/bookingParticipants';
import BookingManagementSection from '../components/BookingManagementSection';
import { nightsBetween } from '../lib/nights';
import { fmtRand } from '../lib/pricingEngine';
import { useNavigate } from 'react-router-dom';

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

/** Map a booking status (pre- or post-migration) to a status-pill variant. */
function statusPillKey(status: string): string {
  switch (status) {
    case 'tentative':   return 'ready';      // amber
    case 'confirmed':   return 'sent';       // blue
    case 'in_stay':
    case 'checked_in':  return 'interested'; // green
    case 'completed':
    case 'checked_out': return 'won';        // dark green
    case 'cancelled':   return 'declined';   // grey
    default:            return 'drafting';
  }
}

/** Human-readable label for the current status. */
function statusLabel(status: string): string {
  const opt = BOOKING_STATUS_OPTIONS.find((o: any) => o.value === status);
  return opt?.label || titleCase(status);
}

/** Accent strip colour for the modal top-edge. */
function statusAccent(status: string): string {
  switch (status) {
    case 'tentative':   return 'var(--warning)';
    case 'confirmed':   return 'var(--info)';
    case 'in_stay':
    case 'checked_in':  return 'var(--success)';
    case 'completed':
    case 'checked_out': return 'var(--color-primary)';
    case 'cancelled':   return 'var(--text-light)';
    default:            return 'var(--text-light)';
  }
}

export default function BookingModal({
  booking, properties, onClose, onSave, supabase, user, partnerId, initialMode, isBlocked, onToggleBlocked, onPropertyIdChange, defaultView, commsFilter,
}: {
  booking: any;
  properties: any[];
  onClose: () => void;
  onSave: (enquiryId?: string) => void | Promise<void>;
  supabase: any;
  user: any;
  partnerId: string;
  initialMode?: 'view' | 'edit';
  isBlocked?: boolean;
  onToggleBlocked?: () => void;
  /** Fired when the user changes the property dropdown so the
   *  Calendar view behind can re-anchor live. */
  onPropertyIdChange?: (propertyId: string) => void;
  /** Which tab to open on. 'details' (default) shows the booking form;
   *  'comms' opens straight on the Communications tab (the management
   *  email queue). The dashboard actions list passes 'comms' so a click
   *  lands the user where they draft. */
  defaultView?: 'details' | 'comms';
  /** Which comms subset to show first when on the Communications tab.
   *  Passed straight to BookingManagementSection; defaults to 'due'. */
  commsFilter?: 'due' | 'all';
}) {
  const toast = useToast();
  const isNew = !booking.id;
  const isFromEnquiry = !!booking._fromEnquiry;

  const initialForm = useMemo(() => ({
    property_id: booking.property_id || '',
    guest_id: booking.guest_id || '',
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
    special_requests: booking.special_requests || '',
    notes: booking.notes || '',
    status: booking.status || 'confirmed',
    // 'booking' (real reservation) or 'block' (owner stay, maintenance,
    // hold). Picked at creation time; a block has no guest, no payment
    // and no platform — just property + dates + a short reason label.
    kind: (booking as any).kind || 'booking',
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [booking.id]);

  const [form, setForm] = useState(initialForm);
  const [mode, setMode] = useState<'view' | 'edit'>(initialMode || (isNew ? 'edit' : 'view'));
  // Details vs Communications tab. Only a saved real booking has comms;
  // the toggle/guards below fall back to details whenever comms isn't
  // available, so a stray defaultView='comms' can never strand the user.
  const [view, setView] = useState<'details' | 'comms'>(defaultView === 'comms' ? 'comms' : 'details');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Guests for the picker. Loaded once on mount.
  const [guestOptions, setGuestOptions] = useState<any[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('guests')
        .select('id, name, email, phone, country')
        .eq('partner_id', partnerId || CT_RENTALS_PARTNER_ID)
        .order('name');
      if (!cancelled && data) setGuestOptions(data);
    })();
    return () => { cancelled = true; };
  }, [supabase, partnerId]);

  // Source proposal — for bookings that came through the platform (an accepted
  // proposal created the booking), surface where the pricing came from so it's
  // traceable. Read-only; skipped for new bookings and imports (no enquiry_id).
  const navigate = useNavigate();
  const [sourceProposal, setSourceProposal] = useState<any | null>(null);
  useEffect(() => {
    if (isNew || !booking.enquiry_id) { setSourceProposal(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('proposals')
        .select('id, ref_code, status, accepted_at, pricing_proposal_id, pricing_proposals(client_price_excl_vat)')
        .eq('enquiry_id', booking.enquiry_id)
        .in('status', ['accepted', 'booked'])
        .order('accepted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setSourceProposal(data || null);
    })();
    return () => { cancelled = true; };
  }, [supabase, isNew, booking.enquiry_id]);

  // Resolve the property's primary owner so the modal SHOWS who owner emails
  // go to — the same source the email engine uses (resolveOwnerForProperty).
  // Re-runs when the property changes. Read-only here; owners are managed on
  // the property itself (Properties → owners).
  const [bookingOwner, setBookingOwner] = useState<any | null>(null);
  const [ownerLoading, setOwnerLoading] = useState(false);
  useEffect(() => {
    if (form.kind === 'block' || !form.property_id) { setBookingOwner(null); return; }
    let cancelled = false;
    setOwnerLoading(true);
    (async () => {
      try {
        const o = await resolveOwnerForProperty(supabase, form.property_id);
        if (!cancelled) setBookingOwner(o);
      } catch {
        if (!cancelled) setBookingOwner(null);
      } finally {
        if (!cancelled) setOwnerLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, form.property_id, form.kind]);

  // New bookings opened from a gap click come pre-filled with property +
  // dates, so form === initialForm at mount and Save would stay disabled
  // until the user typed something. Treat new as always dirty.
  const isDirty = isNew || JSON.stringify(form) !== JSON.stringify(initialForm);
  const isCancelled = form.status === 'cancelled';

  function pickGuest(id: string) {
    if (!id) { setForm(f => ({ ...f, guest_id: '' })); return; }
    const g = guestOptions.find((x: any) => x.id === id);
    if (!g) return;
    setForm(f => ({
      ...f,
      guest_id: g.id,
      guest_name: g.name || f.guest_name,
      guest_email: g.email || f.guest_email,
      guest_phone: g.phone || f.guest_phone,
      guest_nationality: g.country || f.guest_nationality,
    }));
  }

  async function save() {
    const isBlock = form.kind === 'block';
    if (!form.property_id) { toast.error('Please select a property'); return; }
    if (!form.check_in || !form.check_out) { toast.error('Check-in and check-out dates are required'); return; }
    if (form.check_out <= form.check_in) { toast.error('Check-out must be after check-in'); return; }
    if (!isBlock && !form.guest_name.trim()) { toast.error('Guest name is required'); return; }
    if (isBlock && !form.guest_name.trim()) { toast.error('A short reason is required (e.g. Owner stay, Maintenance)'); return; }

    setSaving(true);
    try {
      // Block double-booking the same property. Cancelled bookings vacate
      // their dates so we skip the check when the user is *saving* a
      // cancellation — the new state won't occupy the calendar anyway.
      if (form.status !== 'cancelled') {
        const conflict = await findBookingConflict({
          supabase,
          partnerId,
          propertyId: form.property_id,
          checkIn: form.check_in,
          checkOut: form.check_out,
          excludeId: booking.id,
        });
        if (conflict) {
          toast.error(`Dates clash with ${describeConflict(conflict)}`);
          setSaving(false);
          return;
        }
      }

      // For blocks: strip guest / payment / platform fields. The reason
      // label lives in guest_name (re-purposed) so the calendar bar still
      // has something to render. Status stays 'confirmed' so the block
      // shows on the calendar — the kind column drives the bar style.
      const payload: any = {
        partner_id: partnerId,
        property_id: form.property_id,
        enquiry_id: booking.enquiry_id || null,
        kind: form.kind,
        guest_id: isBlock ? null : (form.guest_id || null),
        guest_name: form.guest_name.trim(),
        guest_email: isBlock ? null : (form.guest_email.trim() || null),
        guest_phone: isBlock ? null : (form.guest_phone.trim() || null),
        guest_nationality: isBlock ? null : (form.guest_nationality.trim() || null),
        // 1 for blocks too — the column is likely NOT NULL with default 1
        // and the value is irrelevant for a block (no guests staying).
        guests_total: isBlock ? 1 : (Number(form.guests_total) || 1),
        guests_adults: isBlock ? null : (form.guests_adults !== '' ? Number(form.guests_adults) : null),
        guests_children: isBlock ? null : (form.guests_children !== '' ? Number(form.guests_children) : null),
        check_in: form.check_in,
        check_out: form.check_out,
        platform: isBlock ? null : (form.platform || null),
        manager: form.manager.trim() || null,
        total_amount: isBlock ? null : (form.total_amount !== '' ? Number(form.total_amount) : null),
        balance_due: isBlock ? null : (form.balance_due !== '' ? Number(form.balance_due) : null),
        currency: form.currency || 'ZAR',
        house_contact: form.house_contact.trim() || null,
        extras: isBlock ? null : (form.extras.trim() || null),
        special_requests: isBlock ? null : (form.special_requests.trim() || null),
        notes: form.notes.trim() || null,
        status: form.status,
        updated_at: new Date().toISOString(),
      };

      if (isNew) {
        payload.created_by = user?.id || null;
        // Genuine in-app confirmation of a real booking (not a block) — enables
        // the confirmation/welcome management emails. Imports leave this null.
        if (!isBlock) payload.confirmed_at = new Date().toISOString();
        const { error } = await supabase.from('bookings').insert(payload);
        if (error) throw error;
        toast.success('Booking created');
      } else {
        const { error } = await supabase.from('bookings').update(payload).eq('id', booking.id);
        if (error) throw error;
        toast.success('Booking updated');
        setMode('view');
      }

      if (onSave) await onSave(isFromEnquiry ? booking.enquiry_id : undefined);
    } catch (err: any) {
      console.error('Error saving booking:', err);
      toast.error('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  /** Flip the booking status without going through the full save flow.
   *  Persists immediately so the user sees the column / pill update. */
  async function flipStatus(next: string) {
    if (!booking.id) {
      // For new bookings, just update the form — actual save happens on Save.
      setForm(f => ({ ...f, status: next }));
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ status: next, updated_at: new Date().toISOString() })
        .eq('id', booking.id);
      if (error) throw error;
      setForm(f => ({ ...f, status: next }));
      toast.success(`Booking marked ${statusLabel(next)}`);
      if (onSave) await onSave();
    } catch (err: any) {
      toast.error('Failed to update: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this booking? This cannot be undone.')) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from('bookings').delete().eq('id', booking.id);
      if (error) throw error;
      toast.success('Booking deleted');
      if (onSave) await onSave();
    } catch (err: any) {
      console.error('Error deleting booking:', err);
      toast.error('Failed to delete: ' + err.message);
    } finally {
      setDeleting(false);
    }
  }

  const propertyName = properties.find(p => p.id === form.property_id)?.property_name || '';
  const propertySlug = properties.find(p => p.id === form.property_id)?.slug || '';
  const title = isNew
    ? (isFromEnquiry ? 'Convert enquiry to booking' : 'New booking')
    : titleCase(form.guest_name) || 'Booking';

  const subtitle = isNew ? (
    isFromEnquiry ? 'Guest details pre-filled from the enquiry' : 'Direct booking'
  ) : (
    <>
      <span className={`ops-status-pill ops-status-pill--${statusPillKey(form.status)}`}>
        <span className="ops-status-pill-dot" />
        {statusLabel(form.status)}
      </span>
      {propertyName && <span>· {titleCase(propertyName)}</span>}
      {propertySlug && <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--color-primary)' }}>{propertySlug}</span>}
      {form.check_in && form.check_out && (
        <span>· {form.check_in} to {form.check_out}<NightCount checkIn={form.check_in} checkOut={form.check_out} /></span>
      )}
    </>
  );

  // Footer outcome buttons depend on current status.
  // Treat both pre-migration (checked_in / checked_out / tentative) and
  // post-migration (in_stay / completed) values as equivalent.
  const isStayed = form.status === 'in_stay' || form.status === 'checked_in';
  const isFinished = form.status === 'completed' || form.status === 'checked_out';
  const canCheckIn = !isStayed && !isFinished && !isCancelled && !isNew;
  const canCheckOut = isStayed && !isCancelled && !isNew;
  const canCancel = !isCancelled && !isFinished && !isNew;
  const canReopen = (isCancelled || isFinished) && !isNew;

  const footerActions = isNew ? null : (
    <>
      {/* Mark as Block / Mark as Booking toggle removed — kind is set at
          creation time. To convert, delete this entry and create a new
          one with the right type. */}
      {canCheckIn && (
        <button
          className="btn btn-outline-success"
          onClick={() => flipStatus('in_stay')}
          disabled={saving}
          title="Guest has checked in"
        >
          🔑 Mark Checked In
        </button>
      )}
      {canCheckOut && (
        <button
          className="btn btn-outline-success"
          onClick={() => flipStatus('completed')}
          disabled={saving}
          title="Guest has checked out"
        >
          ✓ Mark Checked Out
        </button>
      )}
      {canCancel && (
        <button
          className="btn btn-outline-danger"
          onClick={() => flipStatus('cancelled')}
          disabled={saving}
          title="Cancel this booking"
        >
          ✕ Cancel booking
        </button>
      )}
      {canReopen && (
        <button
          className="btn btn-ghost"
          onClick={() => flipStatus('confirmed')}
          disabled={saving}
          title="Reopen this booking"
        >
          ↺ Reopen
        </button>
      )}
      <button
        className="btn btn-outline-danger"
        onClick={handleDelete}
        disabled={deleting}
      >
        {deleting ? 'Deleting…' : 'Delete'}
      </button>
    </>
  );

  const fieldsDisabled = mode === 'view';

  // Communications tab is offered only for a saved, real, live booking
  // (same gate the management checklist always used). Blocks, new and
  // tentative/cancelled bookings show details only, with no tab bar.
  const commsAvailable = !isNew && form.kind === 'booking'
    && form.status !== 'tentative' && form.status !== 'cancelled';
  const detailsVisible = !commsAvailable || view === 'details';
  const commsVisible = commsAvailable && view === 'comms';

  return (
    <DetailModal
      title={title}
      subtitle={subtitle}
      accentColour={statusAccent(form.status)}
      mode={mode}
      onModeChange={setMode}
      canEdit={!isCancelled}
      isDirty={isDirty}
      onSave={save}
      onCancel={() => { setForm(initialForm); setMode('view'); }}
      footerActions={footerActions}
      footerHint={
        mode === 'edit'
          ? <>Editing booking details. <strong>Save</strong> to keep changes.</>
          : <>Click <strong>Edit</strong> to change booking details. Status buttons work in either mode.</>
      }
      onClose={onClose}
    >
      {commsAvailable && (
        <div className="view-toggle" style={{ marginBottom: 16 }}>
          <button
            type="button"
            className={`view-toggle-btn${view === 'details' ? ' active' : ''}`}
            onClick={() => setView('details')}
          >
            Details
          </button>
          <button
            type="button"
            className={`view-toggle-btn${view === 'comms' ? ' active' : ''}`}
            onClick={() => setView('comms')}
          >
            ✉ Communications
          </button>
        </div>
      )}

      {detailsVisible && (<>
      {isFromEnquiry && (
        <div className="detail-modal-banner detail-modal-banner--success">
          Converting from enquiry. Guest details have been pre-filled. Select a property and confirm dates.
        </div>
      )}

      <DetailModalSection heading="Stay & property">
        <fieldset disabled={fieldsDisabled} className="form-fieldset-reset">
          <div className="form-group">
            <label className="form-label">Property *</label>
            <select
              className="form-input"
              value={form.property_id}
              onChange={(e) => {
                setForm({ ...form, property_id: e.target.value });
                onPropertyIdChange?.(e.target.value);
              }}
            >
              <option value="">Select a property…</option>
              {properties.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {titleCase(p.property_name)}{p.bedrooms ? ` (${p.bedrooms} bed)` : ''}{p.suburb ? ` · ${titleCase(p.suburb)}` : ''}
                </option>
              ))}
            </select>
          </div>
          {form.kind === 'booking' && form.property_id && (
            <div className="form-group">
              <label className="form-label">Owner · receives owner emails</label>
              <div style={{
                padding: '8px 10px', background: 'var(--bg)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                fontSize: '0.8125rem',
              }}>
                {ownerLoading ? (
                  <span style={{ color: 'var(--text-secondary)' }}>Resolving owner…</span>
                ) : bookingOwner ? (
                  <>
                    <span style={{ fontWeight: 600 }}>{titleCase(bookingOwner.name) || '—'}</span>
                    {bookingOwner.email && (
                      <span style={{ color: 'var(--text-secondary)' }}> · {bookingOwner.email.toLowerCase()}</span>
                    )}
                    <span style={{ color: 'var(--text-light)' }}> · primary owner of this property</span>
                  </>
                ) : (
                  <span style={{ color: 'var(--warning)', fontWeight: 600 }}>
                    No owner linked to this property — owner emails will have no recipient. Add one in Properties → owners.
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Check in *</label>
              <input
                type="date"
                className="form-input"
                value={form.check_in}
                onChange={(e) => setForm({ ...form, check_in: e.target.value })}
                onClick={(e) => { try { (e.currentTarget as any).showPicker?.(); } catch {} }}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Check out *</label>
              <input
                type="date"
                className="form-input"
                value={form.check_out}
                onChange={(e) => setForm({ ...form, check_out: e.target.value })}
                onClick={(e) => { try { (e.currentTarget as any).showPicker?.(); } catch {} }}
                min={form.check_in || undefined}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select
                className="form-input"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {BOOKING_STATUS_OPTIONS.map((o: any) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Platform</label>
              <select
                className="form-input"
                value={form.platform}
                onChange={(e) => setForm({ ...form, platform: e.target.value })}
              >
                <option value="">Direct / unspecified</option>
                {PLATFORM_OPTIONS.map((o: any) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>
      </DetailModalSection>

      {form.kind === 'block' && (
        <DetailModalSection heading="Reason">
          <fieldset disabled={fieldsDisabled} className="form-fieldset-reset">
            <div className="form-group">
              <label className="form-label">Block reason *</label>
              <input
                className="form-input"
                value={form.guest_name}
                onChange={(e) => setForm(f => ({ ...f, guest_name: e.target.value }))}
                placeholder="e.g. Owner stay, Maintenance, Hold"
              />
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-light)', marginTop: 4 }}>
                Short label shown on the calendar bar so the team knows why these dates are held.
              </div>
            </div>
          </fieldset>
        </DetailModalSection>
      )}

      {form.kind === 'booking' && (
      <DetailModalSection heading="Guest">
        <fieldset disabled={fieldsDisabled} className="form-fieldset-reset">
          <div className="form-group">
            <label className="form-label">Linked CRM guest</label>
            <select className="form-input" value={form.guest_id} onChange={(e) => pickGuest(e.target.value)}>
              <option value="">— Not linked / one-off guest —</option>
              {guestOptions.map((g: any) => (
                <option key={g.id} value={g.id}>
                  {titleCase(g.name)}{g.email ? ` · ${g.email.toLowerCase()}` : ''}
                </option>
              ))}
            </select>
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-light)', marginTop: 4 }}>
              Link a CRM guest so this stay shows up in their record. Leave unlinked for walk-ins.
            </div>
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Guest name *</label>
              <input
                type="text"
                className="form-input"
                value={form.guest_name}
                onChange={(e) => setForm({ ...form, guest_name: e.target.value, guest_id: '' })}
                placeholder="Full name"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Nationality</label>
              <input
                type="text"
                className="form-input"
                value={form.guest_nationality}
                onChange={(e) => setForm({ ...form, guest_nationality: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-input"
                value={form.guest_email}
                onChange={(e) => setForm({ ...form, guest_email: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input
                type="tel"
                className="form-input"
                value={form.guest_phone}
                onChange={(e) => setForm({ ...form, guest_phone: e.target.value })}
              />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px 14px' }}>
            <div className="form-group">
              <label className="form-label">Total guests</label>
              <input
                type="number"
                className="form-input"
                value={form.guests_total}
                onChange={(e) => setForm({ ...form, guests_total: e.target.value })}
                min={1}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Adults</label>
              <input
                type="number"
                className="form-input"
                value={form.guests_adults}
                onChange={(e) => setForm({ ...form, guests_adults: e.target.value })}
                min={0}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Children</label>
              <input
                type="number"
                className="form-input"
                value={form.guests_children}
                onChange={(e) => setForm({ ...form, guests_children: e.target.value })}
                min={0}
              />
            </div>
          </div>
        </fieldset>
      </DetailModalSection>
      )}

      {form.kind === 'booking' && (
      <DetailModalSection heading="Financial">
        <fieldset disabled={fieldsDisabled} className="form-fieldset-reset">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px 14px' }}>
            <div className="form-group">
              <label className="form-label">Daily rate</label>
              <input
                type="number"
                className="form-input"
                value={form.total_amount}
                onChange={(e) => setForm({ ...form, total_amount: e.target.value })}
                min={0}
                step="0.01"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Total</label>
              <div className="form-input" style={{ background: 'var(--bg)', display: 'flex', alignItems: 'center', fontWeight: 600 }}>
                {(() => {
                  const n = nightsBetween(form.check_in, form.check_out);
                  const r = form.total_amount !== '' ? Number(form.total_amount) : null;
                  if (r == null || !Number.isFinite(r) || !n || n <= 0) return '—';
                  return `${fmtRand(r * n)} · ${n} night${n === 1 ? '' : 's'} × ${fmtRand(r)}`;
                })()}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Currency</label>
              <select
                className="form-input"
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              >
                <option value="ZAR">ZAR</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
          </div>
        </fieldset>
        {/* Pricing source — for platform bookings (created from an accepted
            proposal) show where the rate came from, with a link to the deal.
            Outside the fieldset so the link works in view mode too. */}
        {!isNew && (
          booking.enquiry_id ? (
            sourceProposal ? (
              <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text)' }}>
                  Pricing from proposal{' '}
                  <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--color-primary)' }}>{sourceProposal.ref_code}</span>
                  {(() => {
                    const pp = Array.isArray(sourceProposal.pricing_proposals) ? sourceProposal.pricing_proposals[0] : sourceProposal.pricing_proposals;
                    const cp = pp?.client_price_excl_vat;
                    return cp != null ? <> · {fmtRand(Number(cp))}/night</> : null;
                  })()}
                  {sourceProposal.accepted_at && <> · accepted {new Date(sourceProposal.accepted_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}</>}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ flexShrink: 0 }}
                  onClick={() => navigate('/operations/enquiries?deal=' + encodeURIComponent(booking.enquiry_id))}
                >
                  View proposal →
                </button>
              </div>
            ) : (
              <div style={{ marginTop: 10, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Linked to an enquiry — accepted proposal not found.
              </div>
            )
          ) : (
            <div style={{ marginTop: 10, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Manually entered — no linked proposal.
            </div>
          )
        )}
      </DetailModalSection>
      )}

      <DetailModalSection heading="Admin">
        <fieldset disabled={fieldsDisabled} className="form-fieldset-reset">
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Manager</label>
              <input
                type="text"
                className="form-input"
                value={form.manager}
                onChange={(e) => setForm({ ...form, manager: e.target.value })}
                placeholder="Who manages this booking"
              />
            </div>
            <div className="form-group">
              <label className="form-label">House contact</label>
              <input
                type="text"
                className="form-input"
                value={form.house_contact}
                onChange={(e) => setForm({ ...form, house_contact: e.target.value })}
                placeholder="Property contact person"
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Extras</label>
            <input
              type="text"
              className="form-input"
              value={form.extras}
              onChange={(e) => setForm({ ...form, extras: e.target.value })}
              placeholder="e.g. cot, bath, linen"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Special requests</label>
            <textarea
              className="form-input"
              rows={2}
              value={form.special_requests}
              onChange={(e) => setForm({ ...form, special_requests: e.target.value })}
              placeholder="Guest's special requests — shown in owner emails (left blank, the line is omitted)"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea
              className="form-input"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Internal notes…"
            />
          </div>
        </fieldset>
      </DetailModalSection>
      </>)}

      {commsVisible && (
        <BookingManagementSection
          booking={booking}
          property={properties.find(p => p.id === form.property_id)}
          supabase={supabase}
          user={user}
          initialFilter={commsFilter ?? 'due'}
        />
      )}
    </DetailModal>
  );
}
