/**
 * EnquiryForm -- /enquiry/new
 *
 * Captures an incoming guest enquiry. After save, surfaces a "Create
 * Proposal" CTA that hands the enquiry off to the proposal-builder flow
 * (property picker → calculator → recipient details), with all the
 * enquiry's data pre-filled and the saved proposal linked back via
 * proposals.enquiry_id.
 */

import { useState, FormEvent, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import ActionModal from '../components/ActionModal';
import DateInput from '../components/DateInput';
import NewProposalLauncher from '../components/NewProposalLauncher';
import { useToast } from '../components/ToastProvider';
import { notifyPipelineChanged } from '../lib/pipelineEvents';
import { CT_RENTALS_PARTNER_ID } from './constants';
import type { EnquiryPrefill } from '../components/CreateProposalModal';

const EMPTY_FORM = {
  client_name: '', client_email: '', client_phone: '',
  check_in: '', check_out: '',
  bedrooms_needed: '1', guests_total: '1', guests_adults: '1', guests_children: '0',
  nationality: '', budget_min: '', budget_max: '', notes: '',
};

export function EnquiryForm() {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [savedEnquiry, setSavedEnquiry] = useState<EnquiryPrefill | null>(null);
  const [launcherOpen, setLauncherOpen] = useState(false);

  useEffect(() => { setPageTitle('New Enquiry'); }, [setPageTitle]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!form.client_name.trim()) { toast.warning('Client name is required'); return; }
    if (!form.check_in || !form.check_out) { toast.warning('Check-in and check-out are required'); return; }
    if (form.check_in >= form.check_out) { toast.warning('Check-out must be after check-in'); return; }

    setSaving(true);
    const { data, error } = await supabase
      .from('enquiries')
      .insert({
        partner_id: CT_RENTALS_PARTNER_ID,
        client_name: form.client_name.trim(),
        client_email: form.client_email.trim() || null,
        client_phone: form.client_phone.trim() || null,
        check_in: form.check_in,
        check_out: form.check_out,
        bedrooms_needed: Number(form.bedrooms_needed) || 1,
        guests_total: Number(form.guests_total) || 1,
        guests_adults: Number(form.guests_adults) || null,
        guests_children: Number(form.guests_children) || null,
        nationality: form.nationality.trim() || null,
        budget_min: form.budget_min ? Number(form.budget_min) : null,
        budget_max: form.budget_max ? Number(form.budget_max) : null,
        notes: form.notes.trim() || null,
      })
      .select('id, client_name, client_email, client_phone, check_in, check_out, guests_total, notes')
      .single();

    setSaving(false);

    if (error) {
      toast.error('Failed to save: ' + error.message);
      return;
    }
    notifyPipelineChanged();
    toast.success('Enquiry saved');
    setSavedEnquiry(data as EnquiryPrefill);
  }

  function startAnother() {
    setSavedEnquiry(null);
    setForm(EMPTY_FORM);
  }

  const close = () => navigate('/operations/enquiries');

  // ── Post-save success state ──
  if (savedEnquiry) {
    return (
      <>
        <ActionModal
          title="Enquiry saved"
          subtitle={
            <>
              <strong>{savedEnquiry.client_name}</strong> · {savedEnquiry.check_in} to {savedEnquiry.check_out}
              {savedEnquiry.guests_total ? ` · ${savedEnquiry.guests_total} guests` : ''}
            </>
          }
          width={620}
          hideCancel
          primaryAction={
            <button className="btn btn-primary" onClick={() => setLauncherOpen(true)}>
              📝 Create Proposal
            </button>
          }
          secondaryActions={
            <>
              <button className="btn btn-ghost" onClick={startAnother}>+ Add another</button>
              <button className="btn btn-ghost" onClick={close}>View all</button>
            </>
          }
          onClose={close}
        >
          <div style={{ textAlign: 'center', padding: '20px 8px' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 8, color: 'var(--success)' }}>✓</div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
              The enquiry is saved. Open the next step below, or come back later from the Enquiries board.
            </p>
          </div>
        </ActionModal>

        {launcherOpen && (
          <NewProposalLauncher
            enquiryPrefill={savedEnquiry}
            onClose={() => setLauncherOpen(false)}
          />
        )}
      </>
    );
  }

  // ── Form ──
  return (
    <form id="enquiry-form" onSubmit={handleSubmit}>
      <ActionModal
        title="New enquiry"
        subtitle="Capture an incoming guest enquiry"
        width={760}
        primaryAction={
          <button type="submit" form="enquiry-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save enquiry'}
          </button>
        }
        onClose={close}
      >
        <Section title="Client" subtitle="Who's making the enquiry">
          <div className="enquiry-grid-3">
            <Field label="Client name *">
              <input className="form-input" name="client_name" value={form.client_name} onChange={handleChange} placeholder="e.g. Hayley Harrod" required />
            </Field>
            <Field label="Email">
              <input className="form-input" name="client_email" type="email" value={form.client_email} onChange={handleChange} placeholder="guest@example.com" />
            </Field>
            <Field label="Phone">
              <input className="form-input" name="client_phone" value={form.client_phone} onChange={handleChange} placeholder="+27 …" />
            </Field>
          </div>
        </Section>

        <Section title="Stay" subtitle="Dates and guest count">
          <div className="enquiry-grid-2">
            <Field label="Check-in *">
              <DateInput className="form-input" value={form.check_in} onChange={(v) => setForm(prev => ({ ...prev, check_in: v }))} placeholder="e.g. 27 Mar 2026" />
            </Field>
            <Field label="Check-out *">
              <DateInput className="form-input" value={form.check_out} onChange={(v) => setForm(prev => ({ ...prev, check_out: v }))} placeholder="e.g. 3 Apr 2026" />
            </Field>
          </div>

          <div className="enquiry-grid-4" style={{ marginTop: 12 }}>
            <Field label="Bedrooms *">
              <input className="form-input" name="bedrooms_needed" type="number" min="1" value={form.bedrooms_needed} onChange={handleChange} required />
            </Field>
            <Field label="Total guests *">
              <input className="form-input" name="guests_total" type="number" min="1" value={form.guests_total} onChange={handleChange} required />
            </Field>
            <Field label="Adults">
              <input className="form-input" name="guests_adults" type="number" min="0" value={form.guests_adults} onChange={handleChange} />
            </Field>
            <Field label="Children">
              <input className="form-input" name="guests_children" type="number" min="0" value={form.guests_children} onChange={handleChange} />
            </Field>
          </div>
        </Section>

        <Section title="Context" subtitle="Optional. Useful for matching the right property">
          <div className="enquiry-grid-3">
            <Field label="Nationality">
              <input className="form-input" name="nationality" value={form.nationality} onChange={handleChange} placeholder="e.g. UK" />
            </Field>
            <Field label="Budget min (ZAR)">
              <input className="form-input" name="budget_min" type="number" min="0" value={form.budget_min} onChange={handleChange} placeholder="—" />
            </Field>
            <Field label="Budget max (ZAR)">
              <input className="form-input" name="budget_max" type="number" min="0" value={form.budget_max} onChange={handleChange} placeholder="—" />
            </Field>
          </div>

          <Field label="Notes" style={{ marginTop: 12 }}>
            <textarea className="form-input" name="notes" rows={3} value={form.notes} onChange={handleChange} placeholder="Anything else worth knowing. Special requests, source of lead, etc." />
          </Field>
        </Section>
      </ActionModal>
    </form>
  );
}

// ── Small layout helpers (kept local; not worth a separate file) ──

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="enquiry-section">
      <div className="enquiry-section-head">
        <h3 className="enquiry-section-title">{title}</h3>
        {subtitle && <span className="enquiry-section-sub">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="form-group" style={style}>
      <label className="form-label">{label}</label>
      {children}
    </div>
  );
}
