/**
 * BlockModal — focused "Block off a property" surface.
 *
 * Distinct from BookingModal: that one is the full booking editor
 * with guest details, payment, platform, etc; this one is the
 * short five-field flow for taking a property off the market
 * (owner stay, maintenance, renovation, cleaning, other). Same
 * Tier A shell (<DetailModal>) so the visual language matches.
 *
 * Persists to the same bookings table with kind='block':
 *   - property_id, check_in, check_out, notes  → stored as-is
 *   - reason (categorical)                     → bookings.block_reason
 *   - reason label (display)                   → bookings.guest_name
 *     (so the existing calendar bar renderer has a label to show
 *      without having to special-case block rows)
 */

/* eslint-disable */
// @ts-nocheck

import { useMemo, useState } from 'react';
import { useToast } from '../components/ToastProvider';
import DetailModal, { DetailModalSection } from '../components/DetailModal';
import NightCount from '../components/NightCount';
import { findBookingConflict, describeConflict } from '../lib/bookingConflicts';

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

/** Reason taxonomy. Stored as bookings.block_reason (a snake-cased
 *  enum) so analytics later can bucket properly; the label is what
 *  the user picks + what gets mirrored into bookings.guest_name
 *  for the calendar bar's title text. */
const REASON_OPTIONS: { value: string; label: string }[] = [
  { value: 'owner_stay',  label: 'Owner stay'  },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'renovation',  label: 'Renovation'  },
  { value: 'cleaning',    label: 'Cleaning'    },
  { value: 'other',       label: 'Other'       },
];

function labelForReason(value: string): string {
  return REASON_OPTIONS.find(o => o.value === value)?.label || titleCase(value);
}

interface Props {
  /** Pre-fill values when the user clicked a gap on the calendar
   *  (property_id + tentative check_in/check_out). New blocks
   *  start empty otherwise. Edit mode for an existing block row
   *  pre-fills everything from the row. */
  block: {
    id?: string;
    property_id?: string;
    check_in?: string;
    check_out?: string;
    block_reason?: string | null;
    notes?: string | null;
    guest_name?: string | null;
  };
  properties: any[];
  onClose: () => void;
  onSave: () => void | Promise<void>;
  supabase: any;
  user: any;
  partnerId: string;
  initialMode?: 'view' | 'edit';
}

export default function BlockModal({
  block, properties, onClose, onSave, supabase, user, partnerId, initialMode,
}: Props) {
  const toast = useToast();
  const isNew = !block.id;

  const initialForm = useMemo(() => ({
    property_id: block.property_id || '',
    check_in:    block.check_in    || '',
    check_out:   block.check_out   || '',
    reason:      block.block_reason || 'owner_stay',
    notes:       block.notes       || '',
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [block.id]);

  const [form, setForm] = useState(initialForm);
  const [mode, setMode] = useState<'view' | 'edit'>(initialMode || (isNew ? 'edit' : 'view'));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // New blocks come pre-filled from the gap picker (property + dates) so
  // form === initialForm at mount, which would leave Save disabled until
  // the user touched something irrelevant like Notes. Treat "new" as
  // always dirty so the user can save the gap as-is.
  const isDirty = isNew || JSON.stringify(form) !== JSON.stringify(initialForm);
  const propertyName = properties.find((p: any) => p.id === form.property_id)?.property_name || '';
  const propertySlug = properties.find((p: any) => p.id === form.property_id)?.slug || '';

  async function save() {
    if (!form.property_id)            { toast.error('Pick a property'); return; }
    if (!form.check_in || !form.check_out) { toast.error('Start and end dates are required'); return; }
    if (form.check_out <= form.check_in)   { toast.error('End date must be after start'); return; }
    if (!form.reason)                 { toast.error('Pick a reason'); return; }

    setSaving(true);
    try {
      // Refuse to create a block that overlaps an existing booking or
      // block on the same property — the calendar treats both kinds as
      // "occupied", so silently double-booking would let the dashboard
      // lie about availability.
      const conflict = await findBookingConflict({
        supabase,
        partnerId,
        propertyId: form.property_id,
        checkIn: form.check_in,
        checkOut: form.check_out,
        excludeId: block.id,
      });
      if (conflict) {
        toast.error(`Dates clash with ${describeConflict(conflict)}`);
        setSaving(false);
        return;
      }

      // bookings rows with kind='block' reuse the schema — guest /
      // payment / platform columns are null. We mirror the reason
      // label into guest_name so the calendar bar's existing label
      // logic ("Block · ${guest_name || 'Guest'}") has something to
      // print without needing block-specific rendering everywhere.
      const reasonLabel = labelForReason(form.reason);
      const payload: any = {
        partner_id:     partnerId,
        property_id:    form.property_id,
        kind:           'block',
        guest_id:       null,
        guest_name:     reasonLabel,
        guest_email:    null,
        guest_phone:    null,
        guest_nationality: null,
        guests_total:   1,        // column is NOT NULL with default 1 — irrelevant for a block
        guests_adults:  null,
        guests_children: null,
        check_in:       form.check_in,
        check_out:      form.check_out,
        platform:       null,
        manager:        null,
        total_amount:   null,
        balance_due:    null,
        currency:       'ZAR',
        house_contact:  null,
        extras:         null,
        notes:          form.notes.trim() || null,
        status:         'confirmed', // block needs a non-cancelled status to occupy the calendar
        block_reason:   form.reason,
        updated_at:     new Date().toISOString(),
      };

      if (isNew) {
        payload.created_by = user?.id || null;
        const { error } = await supabase.from('bookings').insert(payload);
        if (error) throw error;
        toast.success('Block created');
      } else {
        const { error } = await supabase.from('bookings').update(payload).eq('id', block.id);
        if (error) throw error;
        toast.success('Block updated');
        setMode('view');
      }
      if (onSave) await onSave();
    } catch (err: any) {
      console.error('Error saving block:', err);
      toast.error('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this block? This cannot be undone.')) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from('bookings').delete().eq('id', block.id);
      if (error) throw error;
      toast.success('Block deleted');
      if (onSave) await onSave();
    } catch (err: any) {
      console.error('Error deleting block:', err);
      toast.error('Failed to delete: ' + err.message);
    } finally {
      setDeleting(false);
    }
  }

  const title = isNew
    ? 'Block property'
    : `${labelForReason(form.reason)} · block`;
  const subtitle = isNew ? (
    <span style={{ color: 'var(--text-secondary)' }}>Take this property off the market for a date range.</span>
  ) : (
    <>
      <span className="ops-status-pill ops-status-pill--declined">
        <span className="ops-status-pill-dot" />
        Blocked
      </span>
      {propertyName && <span> · {titleCase(propertyName)}</span>}
      {propertySlug && <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--color-primary)' }}> {propertySlug}</span>}
      {form.check_in && form.check_out && (
        <span> · {form.check_in} to {form.check_out}<NightCount checkIn={form.check_in} checkOut={form.check_out} /></span>
      )}
    </>
  );

  const fieldsDisabled = mode === 'view';

  const footerActions = !isNew ? (
    <button
      className="btn btn-outline-danger"
      onClick={handleDelete}
      disabled={deleting}
    >
      {deleting ? 'Deleting…' : 'Delete'}
    </button>
  ) : null;

  return (
    <DetailModal
      title={title}
      subtitle={subtitle}
      accentColour="var(--text-light)"
      mode={mode}
      onModeChange={setMode}
      isDirty={isDirty}
      onSave={save}
      onCancel={() => { setForm(initialForm); setMode('view'); }}
      footerActions={footerActions}
      // Existing blocks are intentionally not editable — there's no
      // meaningful field to change (dates/property/reason are all
      // pinned by the block's purpose). Delete + recreate is the
      // intended workflow, so the header Edit button is suppressed
      // and the only action is the Delete button in the footer.
      canEdit={isNew}
      footerHint={mode === 'edit'
        ? <>Filling in block details. <strong>Save</strong> to confirm.</>
        : <>To change a block, <strong>delete</strong> it and create a new one.</>}
      onClose={onClose}
    >
      <DetailModalSection heading="Block details">
        <fieldset disabled={fieldsDisabled} className="form-fieldset-reset">
          <div className="form-group">
            <label className="form-label">Property *</label>
            <select
              className="form-input"
              value={form.property_id}
              onChange={(e) => setForm({ ...form, property_id: e.target.value })}
              disabled={!isNew || fieldsDisabled}
              title={!isNew ? 'Property is fixed once the block is created — delete and recreate to move it.' : undefined}
            >
              <option value="">Select a property…</option>
              {properties.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {titleCase(p.property_name)}{p.bedrooms ? ` (${p.bedrooms} bed)` : ''}{p.suburb ? ` · ${titleCase(p.suburb)}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Block start *</label>
              {/* Native browser date picker — calendar-only, no free text.
                  onClick triggers showPicker() so a click anywhere on the
                  field opens the calendar (not just the small icon). */}
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
              <label className="form-label">
                Block end *
                <NightCount checkIn={form.check_in} checkOut={form.check_out} />
              </label>
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
              <label className="form-label">Reason *</label>
              <select
                className="form-input"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              >
                {REASON_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea
              className="form-input"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Optional — context the next person looking at this block needs to know."
            />
          </div>
        </fieldset>
      </DetailModalSection>
    </DetailModal>
  );
}
