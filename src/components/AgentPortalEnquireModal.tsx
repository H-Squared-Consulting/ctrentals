/**
 * AgentPortalEnquireModal -- public-facing enquiry submission modal.
 *
 * Mirrors the manual agent-enquiry flow in src/pages/EnquiryForm.tsx:
 * the agent is the recipient (their token authenticates the call), so
 * the form only asks for the *stay* details up-front. Guest details
 * live in an optional "Guest details (if known)" section because the
 * agent often hasn't been given the guest yet — those fields land as
 * NULL guest_* on the enquiry and can be filled in later from the
 * Pipeline. The property is pre-filled / locked.
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
  subject: '',
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
  const [guestSectionOpen, setGuestSectionOpen] = useState(false);

  function setField<K extends keyof typeof EMPTY_FORM>(key: K, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!form.subject.trim())            { toast.warning('Subject is required — a short summary of the trip'); return; }
    if (!form.checkIn || !form.checkOut) { toast.warning('Check-in and check-out dates are required'); return; }
    if (form.checkIn >= form.checkOut)   { toast.warning('Check-out must be after check-in'); return; }

    setSubmitting(true);
    try {
      const result = await submitAgentEnquiry({
        token,
        propertyId: property.id,
        subject: form.subject.trim(),
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
          <label className="form-label">Subject *</label>
          <input
            className="form-input"
            value={form.subject}
            onChange={(e) => setField('subject', e.target.value)}
            placeholder="A short summary of the trip"
            maxLength={120}
            autoFocus
            required
          />
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
            e.g. “Family of 6 for Easter” or “Couple weekend in Boulderwood”. Helps the Southern Escapes team spot your enquiry quickly.
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

        {/* Guest details — collapsible, fully optional. Mirrors the
            "Guest details (if known)" sub-section on /enquiry/new for
            agent enquiries. Leave blank if the guest hasn't been
            disclosed yet; you can add them later from the Pipeline. */}
        <div style={{
          marginTop: 'var(--s-3)',
          paddingTop: 'var(--s-3)',
          borderTop: '1px solid var(--border-light)',
        }}>
          <div style={{
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: 'var(--text)',
            marginBottom: 4,
          }}>
            Guest details (if known)
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 'var(--s-2)' }}>
            Optional — leave blank if you can't share the guest yet.
          </div>
          {guestSectionOpen ? (
            <>
              <div className="form-group" style={{ marginBottom: 'var(--s-3)' }}>
                <label className="form-label">Guest name</label>
                <input
                  className="form-input"
                  value={form.guestName}
                  onChange={(e) => setField('guestName', e.target.value)}
                  placeholder="e.g. Sarah Whitmore"
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-3)' }}>
                <div className="form-group">
                  <label className="form-label">Guest email</label>
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
                    placeholder="+27 …"
                  />
                </div>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: '0.8125rem' }}
              onClick={() => setGuestSectionOpen(true)}
            >
              + Add guest details
            </button>
          )}
        </div>
      </ActionModal>
    </form>
  );
}
