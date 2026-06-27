/**
 * BookingFormPage -- the public self-serve form at /f/:token.
 *
 * Token-gated, no admin chrome, renders on any host. The recipient (guest or
 * agent, decided by the token's form_type) fills the relevant fields and the
 * answers write into booking_details via the booking-form-submit edge function.
 * Mirrors the agent-portal flow: token IS the auth, the public client never
 * touches the DB directly.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import {
  getBookingForm,
  submitBookingForm,
  type BookingFormBundle,
  type BookingFormType,
} from '../lib/bookingForm';

function fmtDate(d: string | null): string {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return d; }
}

export default function BookingFormPage() {
  const { token = '' } = useParams();
  const [loading, setLoading] = useState(true);
  const [bundle, setBundle] = useState<BookingFormBundle | null>(null);
  const [fields, setFields] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const b = await getBookingForm(token);
      if (cancelled) return;
      setBundle(b);
      // Prefill from any prior submission.
      if (b?.submission) {
        const seed: Record<string, any> = {};
        for (const [k, v] of Object.entries(b.submission)) {
          if (v !== null && v !== undefined) seed[k] = v;
        }
        setFields(seed);
        setDone(!!b.submittedAt);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token]);

  function set(key: string, value: any) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!bundle) return;
    setSubmitting(true);
    setError(null);
    const res = await submitBookingForm({ token, formType: bundle.formType, fields });
    setSubmitting(false);
    if (res.ok) { setDone(true); window.scrollTo(0, 0); }
    else setError('Something went wrong submitting your details. Please try again.');
  }

  if (loading) {
    return <Shell><p style={{ color: 'var(--text-secondary)' }}>Loading…</p></Shell>;
  }
  if (!bundle) {
    return (
      <Shell>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 8px' }}>Link not valid</h1>
        <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
          This form link has expired or been turned off. Please ask your contact at Southern Escapes for a fresh link.
        </p>
      </Shell>
    );
  }

  const { booking, formType } = bundle;
  const ctxLine = [
    booking.propertyName,
    booking.checkIn && booking.checkOut ? `${fmtDate(booking.checkIn)} → ${fmtDate(booking.checkOut)}` : '',
  ].filter(Boolean).join('  ·  ');

  if (done) {
    return (
      <Shell>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem' }}>✓</div>
          <h1 style={{ fontSize: '1.25rem', margin: '8px 0' }}>Thank you!</h1>
          <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
            Your details have been sent through. {ctxLine && <><br />{ctxLine}</>}
          </p>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginTop: 16 }}
            onClick={() => setDone(false)}
          >
            Edit my answers
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 4px' }}>
        {formType === 'agent' ? 'Booking details' : 'A few details for your stay'}
      </h1>
      {ctxLine && <p style={{ color: 'var(--text-secondary)', margin: '0 0 18px', fontSize: '0.875rem' }}>{ctxLine}</p>}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {formType === 'guest'
          ? <GuestFields fields={fields} set={set} />
          : <AgentFields fields={fields} set={set} />}

        {error && (
          <div style={{ color: 'var(--error)', fontSize: '0.8125rem', fontWeight: 600 }}>{error}</div>
        )}
        <button type="submit" className="btn btn-primary" disabled={submitting} style={{ marginTop: 4 }}>
          {submitting ? 'Sending…' : 'Send my details'}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)', display: 'flex',
      justifyContent: 'center', alignItems: 'flex-start', padding: '32px 16px',
    }}>
      <div style={{
        width: '100%', maxWidth: 560, background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow)', padding: '24px 22px',
      }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      {children}
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function GuestFields({ fields, set }: { fields: Record<string, any>; set: (k: string, v: any) => void }) {
  return (
    <>
      <Field label="Flight details">
        <textarea className="form-input" rows={2} value={fields.guest_flight_details || ''}
          onChange={(e) => set('guest_flight_details', e.target.value)} placeholder="Airline, flight no., arrival time…" />
      </Field>
      <div className="form-grid-2">
        <Field label="Preferred check-in time">
          <input type="time" className="form-input" value={fields.guest_check_in_time || ''}
            onChange={(e) => set('guest_check_in_time', e.target.value)} />
        </Field>
        <Field label="Preferred check-out time">
          <input type="time" className="form-input" value={fields.guest_check_out_time || ''}
            onChange={(e) => set('guest_check_out_time', e.target.value)} />
        </Field>
      </div>
      <Check label="I'd like weekend / public-holiday housekeeping"
        checked={fields.guest_weekend_housekeeping} onChange={(v) => set('guest_weekend_housekeeping', v)} />
      <Field label="Staff requirements">
        <textarea className="form-input" rows={2} value={fields.guest_staff_requirements || ''}
          onChange={(e) => set('guest_staff_requirements', e.target.value)} placeholder="Any extra staff or services you'd like" />
      </Field>
      <Check label="We need a cot" checked={fields.guest_baby_cot} onChange={(v) => set('guest_baby_cot', v)} />
      <Check label="We need a high-chair" checked={fields.guest_baby_high_chair} onChange={(v) => set('guest_baby_high_chair', v)} />
    </>
  );
}

function AgentFields({ fields, set }: { fields: Record<string, any>; set: (k: string, v: any) => void }) {
  return (
    <>
      <div className="form-grid-2">
        <Field label="Check-in date">
          <input type="date" className="form-input" value={fields.agent_check_in || ''}
            onChange={(e) => set('agent_check_in', e.target.value)} />
        </Field>
        <Field label="Check-out date">
          <input type="date" className="form-input" value={fields.agent_check_out || ''}
            onChange={(e) => set('agent_check_out', e.target.value)} />
        </Field>
      </div>
      <Field label="House">
        <input type="text" className="form-input" value={fields.agent_house || ''}
          onChange={(e) => set('agent_house', e.target.value)} />
      </Field>
      <div className="form-grid-2">
        <Field label="Guest name">
          <input type="text" className="form-input" value={fields.agent_guest_name || ''}
            onChange={(e) => set('agent_guest_name', e.target.value)} />
        </Field>
        <Field label="No. of guests">
          <input type="number" min={0} className="form-input" value={fields.agent_guests_count ?? ''}
            onChange={(e) => set('agent_guests_count', e.target.value)} />
        </Field>
      </div>
      <Field label="Contact number">
        <input type="tel" className="form-input" value={fields.agent_contact_number || ''}
          onChange={(e) => set('agent_contact_number', e.target.value)} />
      </Field>
      <Field label="Flight details">
        <textarea className="form-input" rows={2} value={fields.agent_flight_details || ''}
          onChange={(e) => set('agent_flight_details', e.target.value)} />
      </Field>
      <div className="form-grid-2">
        <Field label="Check-in time">
          <input type="time" className="form-input" value={fields.agent_check_in_time || ''}
            onChange={(e) => set('agent_check_in_time', e.target.value)} />
        </Field>
        <Field label="Check-out time">
          <input type="time" className="form-input" value={fields.agent_check_out_time || ''}
            onChange={(e) => set('agent_check_out_time', e.target.value)} />
        </Field>
      </div>
      <Field label="Staff requirements">
        <textarea className="form-input" rows={2} value={fields.agent_staff_requirements || ''}
          onChange={(e) => set('agent_staff_requirements', e.target.value)} />
      </Field>
      <Field label="Rates">
        <input type="text" className="form-input" value={fields.agent_rates || ''}
          onChange={(e) => set('agent_rates', e.target.value)} />
      </Field>
      <Field label="Payment terms">
        <textarea className="form-input" rows={2} value={fields.agent_payment_terms || ''}
          onChange={(e) => set('agent_payment_terms', e.target.value)} />
      </Field>
      <Field label="Other requests">
        <textarea className="form-input" rows={2} value={fields.agent_other_requests || ''}
          onChange={(e) => set('agent_other_requests', e.target.value)} />
      </Field>
      <Check label="The guest has signed an indemnity form"
        checked={fields.agent_indemnity_signed} onChange={(v) => set('agent_indemnity_signed', v)} />
      <Field label="Breakages deposit you are holding (R)">
        <input type="number" min={0} step="0.01" className="form-input" value={fields.agent_breakages_deposit ?? ''}
          onChange={(e) => set('agent_breakages_deposit', e.target.value)} />
      </Field>
    </>
  );
}
