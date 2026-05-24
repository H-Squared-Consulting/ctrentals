/**
 * AgentPortalEnquireModal -- public-facing enquiry submission modal.
 *
 * Triggered by the + Enquire button on each property card in the
 * agent portal. The property is pre-filled (locked) so the agent
 * cannot mis-tag the enquiry. On submit, calls the agent-portal-enquire
 * edge function with the token + payload; success lands in Hayley's
 * Pipeline tagged with the agent's ID and source='agent_portal'.
 *
 * Uses the shared <ActionModal> shell + form classes from the design
 * system. No new CSS prefixes introduced.
 */

import { useState } from 'react';
import { useToast } from './ToastProvider';
import ActionModal from './ActionModal';
import DateInput from './DateInput';
import { submitAgentEnquiry, type AgentProperty } from '../lib/agentPortal';

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

const EMPTY_FORM = {
  guestName: '',
  guestEmail: '',
  guestPhone: '',
  checkIn: '',
  checkOut: '',
  adults: '2',
  children: '0',
  notes: '',
};

export default function AgentPortalEnquireModal({
  token,
  property,
  onClose,
  onSubmitted,
}: {
  token: string;
  property: AgentProperty;
  onClose: () => void;
  onSubmitted: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  function setField<K extends keyof typeof EMPTY_FORM>(key: K, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!form.guestName.trim())  { toast.warning('Guest name is required'); return; }
    if (!form.guestEmail.trim()) { toast.warning('Guest email is required'); return; }
    if (!form.checkIn || !form.checkOut) { toast.warning('Check-in and check-out dates are required'); return; }
    if (form.checkIn >= form.checkOut)   { toast.warning('Check-out must be after check-in'); return; }

    setSubmitting(true);
    try {
      const result = await submitAgentEnquiry({
        token,
        propertyId: property.id,
        guestName: form.guestName.trim(),
        guestEmail: form.guestEmail.trim(),
        guestPhone: form.guestPhone.trim(),
        checkIn: form.checkIn,
        checkOut: form.checkOut,
        guestsAdults: Number(form.adults) || 0,
        guestsChildren: Number(form.children) || 0,
        notes: form.notes.trim(),
      });
      if (!result.ok) {
        toast.error('Could not submit enquiry: ' + (result.reason || 'unknown error'));
        return;
      }
      toast.success('Enquiry sent. The Southern Escapes team will be in touch shortly.');
      await onSubmitted();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form id="agent-enquire-form" onSubmit={submit}>
      <ActionModal
        title={`Enquire about ${titleCase(property.name)}`}
        subtitle={titleCase(property.suburb)}
        width={620}
        primaryAction={
          <button type="submit" form="agent-enquire-form" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send enquiry'}
          </button>
        }
        onClose={onClose}
      >
        <div className="form-group" style={{ marginBottom: 'var(--s-3)' }}>
          <label className="form-label">Guest name *</label>
          <input
            className="form-input"
            value={form.guestName}
            onChange={(e) => setField('guestName', e.target.value)}
            placeholder="The guest's full name"
            autoFocus
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-3)' }}>
          <div className="form-group">
            <label className="form-label">Guest email *</label>
            <input
              className="form-input"
              type="email"
              value={form.guestEmail}
              onChange={(e) => setField('guestEmail', e.target.value)}
              placeholder="guest@example.com"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Guest phone</label>
            <input
              className="form-input"
              value={form.guestPhone}
              onChange={(e) => setField('guestPhone', e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-3)' }}>
          <div className="form-group">
            <label className="form-label">Check-in *</label>
            <DateInput
              className="form-input"
              value={form.checkIn}
              onChange={(v) => setField('checkIn', v)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Check-out *</label>
            <DateInput
              className="form-input"
              value={form.checkOut}
              onChange={(v) => setField('checkOut', v)}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-3)' }}>
          <div className="form-group">
            <label className="form-label">Adults</label>
            <input
              className="form-input"
              type="number"
              min={0}
              value={form.adults}
              onChange={(e) => setField('adults', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Children</label>
            <input
              className="form-input"
              type="number"
              min={0}
              value={form.children}
              onChange={(e) => setField('children', e.target.value)}
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea
            className="form-input"
            rows={3}
            value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
            placeholder="Anything we should know — special occasions, dietary needs, accessibility, expected arrival time, etc."
          />
        </div>
      </ActionModal>
    </form>
  );
}
