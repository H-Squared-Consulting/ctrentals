/**
 * AgentPortalEnquireModal -- public-facing enquiry submission modal.
 *
 * Accepts 1..N properties — the agent ticks the houses they want
 * quoted on the Properties tab, then submits one enquiry covering all
 * of them. Server-side this creates ONE enquiry row tagged with
 * source='agent_portal' and the picked IDs in
 * enquiries.requested_property_ids; no proposals are auto-created
 * (the team triages every agent enquiry in Arrived first, then opens
 * the match modal pre-checked via the deal modal's "Generate
 * proposals" CTA).
 *
 * The agent is the recipient (their token authenticates the call), so
 * the form only asks for the *stay* details up-front. Guest details
 * are collapsible because the agent often hasn't been given the guest
 * yet — those fields land as NULL guest_* on the enquiry and can be
 * filled in later from the Pipeline.
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
  agentReference: '',
  /** '' = nothing picked yet — forces the agent to make a conscious
   *  choice on every submission rather than silently defaulting. */
  assignTo: '' as '' | 'NT' | 'HH',
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
  properties,
  onClose,
  onSubmitted,
}: {
  token: string;
  /** One or more properties the agent ticked. Order = display order
   *  on the chip list. */
  properties: AgentProperty[];
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
    if (properties.length === 0)         { toast.warning('Pick at least one property first'); return; }
    if (!form.agentReference.trim())     { toast.warning('Add a short reference so you can find this enquiry later'); return; }
    if (!form.assignTo)                  { toast.warning('Pick who at Southern Escapes should handle this enquiry'); return; }
    if (!form.checkIn || !form.checkOut) { toast.warning('Check-in and check-out dates are required'); return; }
    if (form.checkIn >= form.checkOut)   { toast.warning('Check-out must be after check-in'); return; }

    setSubmitting(true);
    try {
      const result = await submitAgentEnquiry({
        token,
        propertyIds: properties.map(p => p.id),
        agentReference: form.agentReference.trim(),
        assignTo: form.assignTo as 'NT' | 'HH',
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
      toast.success(
        properties.length === 1
          ? 'Enquiry sent. The Southern Escapes team will be in touch shortly.'
          : `Enquiry sent for ${properties.length} properties. The Southern Escapes team will be in touch shortly.`,
      );
      await onSubmitted();
    } finally {
      setSubmitting(false);
    }
  }

  const title = properties.length === 1
    ? `Enquire about ${titleCase(properties[0].name)}`
    : `Enquire about ${properties.length} properties`;
  const subtitle = properties.length === 1
    ? titleCase(properties[0].suburb)
    : 'Send one enquiry covering all the ticked properties';

  return (
    <form id="agent-enquire-form" onSubmit={submit}>
      <ActionModal
        title={title}
        subtitle={subtitle}
        width={620}
        primaryAction={
          <button type="submit" form="agent-enquire-form" className="btn btn-primary" disabled={submitting}>
            {submitting
              ? 'Sending…'
              : properties.length === 1
                ? 'Send enquiry'
                : `Send enquiry for ${properties.length} properties`}
          </button>
        }
        onClose={onClose}
      >
        {/* Read-only chip list of the ticked properties. Mirrors the
            "you're about to enquire about these N" recap the agent
            saw on the grid before opening this modal — no surprises
            on what's actually being sent. */}
        {properties.length > 1 && (
          <div style={{
            marginBottom: 'var(--s-4)',
            padding: 'var(--s-3)',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
          }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>
              Properties on this enquiry
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {properties.map(p => (
                <span
                  key={p.id}
                  style={{
                    fontSize: '0.8125rem',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 999,
                    padding: '2px 10px',
                    color: 'var(--text)',
                    fontWeight: 500,
                  }}
                >
                  {titleCase(p.name)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Agent's own reference label — required, free text, shown
            back as the row title on the "My Enquiries" tab so the
            agent can recognise this submission later. Separate from
            the AHH/N code the team uses internally. */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--s-3)', marginBottom: 'var(--s-3)' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Subject *</label>
            <input
              className="form-input"
              value={form.agentReference}
              onChange={(e) => setField('agentReference', e.target.value)}
              placeholder="e.g. Sarah & Mark, Easter trip"
              maxLength={120}
              required
              autoFocus
            />
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
              For your own reference — appears on your My Enquiries list.
            </div>
          </div>
          {/* Assign to — required, no default. Maps to NT / HH on the
              enquiry's created_by_initials so the kanban "users"
              filter on the team side treats portal enquiries the
              same way as internal creations. */}
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Assign to *</label>
            <select
              className="form-input"
              value={form.assignTo}
              onChange={(e) => setForm(prev => ({ ...prev, assignTo: e.target.value as '' | 'NT' | 'HH' }))}
              required
            >
              <option value="" disabled>— Pick —</option>
              <option value="NT">Nicki Trent</option>
              <option value="HH">Hayley Harrod</option>
            </select>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
              Who you'd like to handle this.
            </div>
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
