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

  // ── Post-save success state ──
  if (savedEnquiry) {
    return (
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>
        <div className="enquiry-card" style={{ textAlign: 'center', padding: '40px 32px' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>✓</div>
          <h2 style={{ margin: '0 0 8px', fontSize: '1.5rem' }}>Enquiry saved</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0 0 24px' }}>
            <strong>{savedEnquiry.client_name}</strong> · {savedEnquiry.check_in} → {savedEnquiry.check_out}
            {savedEnquiry.guests_total ? ` · ${savedEnquiry.guests_total} guests` : ''}
          </p>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              onClick={() => setLauncherOpen(true)}
              style={{ fontSize: '0.875rem', padding: '10px 18px' }}
            >
              📝 Create Proposal for this Enquiry
            </button>
            <button className="btn btn-outline" onClick={startAnother} style={{ fontSize: '0.875rem' }}>
              + Add Another Enquiry
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/operations/enquiries')} style={{ fontSize: '0.875rem' }}>
              View All Enquiries
            </button>
          </div>

          <p style={{ marginTop: '20px', fontSize: '0.75rem', color: 'var(--text-light)' }}>
            "Create Proposal" opens the property picker → calculator → recipient details, all pre-filled with this enquiry's info.
          </p>
        </div>

        {launcherOpen && (
          <NewProposalLauncher
            enquiryPrefill={savedEnquiry}
            onClose={() => setLauncherOpen(false)}
          />
        )}
      </div>
    );
  }

  // ── Form ──
  return (
    <div style={{ maxWidth: '880px', margin: '0 auto' }}>
      <form onSubmit={handleSubmit} className="enquiry-card">
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

          <div className="enquiry-grid-4" style={{ marginTop: '12px' }}>
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

        <Section title="Context" subtitle="Optional — useful for matching the right property">
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

          <Field label="Notes" style={{ marginTop: '12px' }}>
            <textarea className="form-input" name="notes" rows={3} value={form.notes} onChange={handleChange} placeholder="Anything else worth knowing — special requests, source of lead, etc." />
          </Field>
        </Section>

        <div className="enquiry-actions">
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/operations/enquiries')}>Cancel</button>
          <div style={{ flex: 1 }} />
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save Enquiry'}
          </button>
        </div>
      </form>
    </div>
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
