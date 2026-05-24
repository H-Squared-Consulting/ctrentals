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
import NightCount from '../components/NightCount';
import { useToast } from '../components/ToastProvider';
import { notifyPipelineChanged } from '../lib/pipelineEvents';
import { linkOrCreateGuestForEnquiry } from '../lib/guestLinks';
import { CT_RENTALS_PARTNER_ID } from './constants';
import type { EnquiryPrefill } from '../components/CreateProposalModal';

const EMPTY_FORM = {
  client_name: '', client_email: '', client_phone: '',
  check_in: '', check_out: '',
  bedrooms_needed: '1', guests_total: '1', guests_adults: '1', guests_children: '0',
  nationality: '', budget_min: '', budget_max: '', notes: '',
};

interface AgentOption {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export function EnquiryForm() {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [savedEnquiry, setSavedEnquiry] = useState<EnquiryPrefill | null>(null);
  const [launcherOpen, setLauncherOpen] = useState(false);
  /** Set once the user creates at least one proposal from the launcher.
   *  Swaps the success screen from "Enquiry saved" → "Proposal created"
   *  so the next-step CTA reads "+ Another proposal for this enquiry"
   *  rather than "Create Proposal" (which would now be misleading). */
  const [proposalsCreatedCount, setProposalsCreatedCount] = useState(0);

  // ── Agent-vs-direct enquiry mode ──────────────────────────────────────
  // Off by default — most enquiries come from the guest directly. When ON,
  // the client_* fields auto-fill from the picked agent (read-only) and a
  // separate "Guest details (if known)" section appears. Guest fields may
  // be left blank — the agent often doesn't disclose the guest until a
  // booking is close. proposals raised from such enquiries use a "Valued
  // Guest" placeholder until the guest is later disclosed on the enquiry.
  const [isAgent, setIsAgent] = useState(false);
  const [agentId, setAgentId] = useState<string>('');
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [guestForm, setGuestForm] = useState({ guest_name: '', guest_email: '', guest_phone: '' });
  const [guestSectionOpen, setGuestSectionOpen] = useState(false);

  useEffect(() => { setPageTitle('New Enquiry'); }, [setPageTitle]);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    // Agents table isn't partner-scoped (single-tenant today) — match the
    // pattern used on AgentsPage. Show active agents only; inactive ones
    // are paused contacts the user explicitly doesn't want surfaced here.
    supabase
      .from('agents')
      .select('id, name, email, phone, is_active')
      .order('name')
      .then(({ data }: any) => {
        if (!cancelled && data) {
          // is_active missing = treat as active (legacy row tolerance).
          setAgents(data.filter((a: any) => a.is_active !== false));
        }
      });
    return () => { cancelled = true; };
  }, [supabase]);

  // When the user picks an agent, mirror that agent's contact into the
  // client_* fields (read-only displays). agents table is the source of
  // truth — edits live in Settings → Agents, not here.
  useEffect(() => {
    if (!isAgent || !agentId) return;
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;
    setForm(prev => ({
      ...prev,
      client_name: agent.name,
      client_email: agent.email || '',
      client_phone: agent.phone || '',
    }));
  }, [agentId, isAgent, agents]);

  // Switching back to "direct guest" clears agent state + any auto-filled
  // recipient fields so the user starts with a clean form for the guest.
  useEffect(() => {
    if (isAgent) return;
    setAgentId('');
    setGuestForm({ guest_name: '', guest_email: '', guest_phone: '' });
    setGuestSectionOpen(false);
  }, [isAgent]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (isAgent && !agentId) { toast.warning('Pick an agent'); return; }
    if (!form.client_name.trim()) { toast.warning('Recipient name is required'); return; }
    if (!form.check_in || !form.check_out) { toast.warning('Check-in and check-out are required'); return; }
    if (form.check_in >= form.check_out) { toast.warning('Check-out must be after check-in'); return; }

    setSaving(true);
    // ENQ-YYYYMMDD-NAM-XX where NAM = first three alphabet-only letters
    // of the recipient name (padded with X, 'GST' fallback) and XX = a
    // random 2-hex disambiguator (256 same-day same-name slots). Matches
    // the SQL backfill convention so old + new rows look alike. The DB's
    // UNIQUE index on ref_code is the final guard against the rare
    // collision; we don't retry on conflict because at this volume it's
    // not worth the code.
    const refCode = (() => {
      const d = new Date();
      const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      const clean = (form.client_name || 'GST').replace(/[^A-Za-z]/g, '').toUpperCase();
      const name = (clean.slice(0, 3) || 'GST').padEnd(3, 'X');
      const tail = Math.floor(Math.random() * 0xff).toString(16).toUpperCase().padStart(2, '0');
      return `ENQ-${day}-${name}-${tail}`;
    })();
    const clientName = form.client_name.trim();
    const clientEmail = form.client_email.trim() || null;
    const clientPhone = form.client_phone.trim() || null;
    // For agent enquiries, guest_* is only populated when the user
    // disclosed details in the "Guest details (if known)" sub-section. If
    // empty, all three stay null and a "Valued Guest" placeholder takes
    // over when a proposal is raised — see CreateProposalModal.
    const disclosedGuestName  = isAgent ? (guestForm.guest_name.trim()  || null) : clientName;
    const disclosedGuestEmail = isAgent ? (guestForm.guest_email.trim() || null) : clientEmail;
    const disclosedGuestPhone = isAgent ? (guestForm.guest_phone.trim() || null) : clientPhone;
    const { data, error } = await supabase
      .from('enquiries')
      .insert({
        partner_id: CT_RENTALS_PARTNER_ID,
        ref_code: refCode,
        is_agent: isAgent,
        agent_id: isAgent ? agentId : null,
        client_name: clientName,
        client_email: clientEmail,
        client_phone: clientPhone,
        // Direct: mirror client_* → guest_* (recipient is the guest).
        // Agent: guest_* only if user disclosed; otherwise null + later
        // disclosure on the enquiry detail modal will cascade to proposals.
        guest_name: disclosedGuestName,
        guest_email: disclosedGuestEmail,
        guest_phone: disclosedGuestPhone,
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
      .select('id, ref_code, client_name, client_email, client_phone, check_in, check_out, guests_total, notes, is_agent, agent_id, guest_name, guest_email, guest_phone')
      .single();

    setSaving(false);

    if (error) {
      toast.error('Failed to save: ' + error.message);
      return;
    }
    // Auto-link / create the CRM guests row for direct enquiries (always
    // — they have guest details up-front) and for agent enquiries when
    // the user disclosed the guest in the optional sub-section. Silent
    // failure: don't block the enquiry save flow on a CRM hiccup.
    if (data?.id && (disclosedGuestName || disclosedGuestEmail)) {
      try {
        await linkOrCreateGuestForEnquiry(supabase, {
          enquiryId: data.id,
          partnerId: CT_RENTALS_PARTNER_ID,
          guestName: disclosedGuestName,
          guestEmail: disclosedGuestEmail,
          guestPhone: disclosedGuestPhone,
        });
      } catch (err) {
        console.error('Guest CRM link failed (non-blocking):', err);
      }
    }

    notifyPipelineChanged();
    toast.success('Enquiry saved');
    setSavedEnquiry(data as EnquiryPrefill);
  }

  function startAnother() {
    setSavedEnquiry(null);
    setProposalsCreatedCount(0);
    setForm(EMPTY_FORM);
    setIsAgent(false);
    setAgentId('');
    setGuestForm({ guest_name: '', guest_email: '', guest_phone: '' });
    setGuestSectionOpen(false);
  }

  const close = () => navigate('/operations/enquiries');

  // ── Post-save success state ──
  if (savedEnquiry) {
    const hasProposals = proposalsCreatedCount > 0;
    return (
      <>
        <ActionModal
          title={hasProposals
            ? `${proposalsCreatedCount} proposal${proposalsCreatedCount === 1 ? '' : 's'} created`
            : 'Enquiry saved'}
          subtitle={
            <>
              <strong>{savedEnquiry.client_name}</strong> · {savedEnquiry.check_in} to {savedEnquiry.check_out}<NightCount checkIn={savedEnquiry.check_in} checkOut={savedEnquiry.check_out} />
              {savedEnquiry.guests_total ? ` · ${savedEnquiry.guests_total} guests` : ''}
            </>
          }
          width={620}
          hideCancel
          primaryAction={
            <button className="btn btn-primary" onClick={() => setLauncherOpen(true)}>
              {hasProposals ? '+ Another proposal for this enquiry' : '📝 Create Proposal'}
            </button>
          }
          secondaryActions={
            <>
              <button className="btn btn-ghost" onClick={startAnother}>+ New enquiry</button>
              <button className="btn btn-ghost" onClick={close}>Done</button>
            </>
          }
          onClose={close}
        >
          <div style={{ textAlign: 'center', padding: '20px 8px' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 8, color: 'var(--success)' }}>✓</div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
              {hasProposals
                ? 'Proposal saved against this enquiry. Raise another for the same client, start a new enquiry, or click Done to leave.'
                : 'The enquiry is saved. Create a proposal now, or come back later from the Enquiries board.'}
            </p>
          </div>
        </ActionModal>

        {launcherOpen && (
          <NewProposalLauncher
            enquiryPrefill={savedEnquiry}
            onClose={() => setLauncherOpen(false)}
            onCreated={() => setProposalsCreatedCount(c => c + 1)}
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
        <Section title="Enquiry from" subtitle="Direct from a guest, or an agent enquiring on behalf?">
          <div style={{ display: 'flex', gap: 8 }}>
            <label
              className={`btn ${!isAgent ? 'btn-primary' : 'btn-outline'}`}
              style={{ cursor: 'pointer', fontWeight: 500 }}
            >
              <input
                type="radio"
                name="enquiry_from"
                checked={!isAgent}
                onChange={() => setIsAgent(false)}
                style={{ display: 'none' }}
              />
              👤 Direct guest
            </label>
            <label
              className={`btn ${isAgent ? 'btn-primary' : 'btn-outline'}`}
              style={{ cursor: 'pointer', fontWeight: 500 }}
            >
              <input
                type="radio"
                name="enquiry_from"
                checked={isAgent}
                onChange={() => setIsAgent(true)}
                style={{ display: 'none' }}
              />
              🤝 An agent (on behalf of a guest)
            </label>
          </div>
        </Section>

        {isAgent ? (
          <>
            <Section title="Agent (recipient)" subtitle="Who we communicate with — manage their details in Settings → Agents">
              <Field label="Agent *">
                <select
                  className="form-input"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  required
                >
                  <option value="">— Pick an agent —</option>
                  {agents.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name}{a.email ? ` · ${a.email}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              {agentId && (
                // Mirror of the picked agent's contact, read-only. Source
                // of truth lives on the agents row.
                <div className="enquiry-grid-3" style={{ marginTop: 12 }}>
                  <Field label="Name">
                    <input className="form-input" value={form.client_name} disabled readOnly />
                  </Field>
                  <Field label="Email">
                    <input className="form-input" value={form.client_email} disabled readOnly />
                  </Field>
                  <Field label="Phone">
                    <input className="form-input" value={form.client_phone} disabled readOnly />
                  </Field>
                </div>
              )}
            </Section>

            <Section
              title="Guest details (if known)"
              subtitle="Leave blank if the agent hasn't shared the guest yet — you can add them later"
            >
              {guestSectionOpen ? (
                <div className="enquiry-grid-3">
                  <Field label="Guest name">
                    <input
                      className="form-input"
                      value={guestForm.guest_name}
                      onChange={(e) => setGuestForm(p => ({ ...p, guest_name: e.target.value }))}
                      placeholder="e.g. Sarah Whitmore"
                    />
                  </Field>
                  <Field label="Guest email">
                    <input
                      className="form-input"
                      type="email"
                      value={guestForm.guest_email}
                      onChange={(e) => setGuestForm(p => ({ ...p, guest_email: e.target.value }))}
                      placeholder="guest@example.com"
                    />
                  </Field>
                  <Field label="Guest phone">
                    <input
                      className="form-input"
                      value={guestForm.guest_phone}
                      onChange={(e) => setGuestForm(p => ({ ...p, guest_phone: e.target.value }))}
                      placeholder="+27 …"
                    />
                  </Field>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setGuestSectionOpen(true)}
                  style={{ fontSize: '0.8125rem' }}
                >
                  + Add guest details
                </button>
              )}
            </Section>
          </>
        ) : (
          <Section title="Guest" subtitle="Who's enquiring">
            <div className="enquiry-grid-3">
              <Field label="Guest name *">
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
        )}

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
