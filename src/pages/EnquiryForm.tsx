/**
 * EnquiryForm -- /enquiry/new
 *
 * Captures an incoming guest enquiry. After save, surfaces a "Create
 * Proposal" CTA that hands the enquiry off to the proposal-builder flow
 * (property picker → calculator → recipient details), with all the
 * enquiry's data pre-filled and the saved proposal linked back via
 * proposals.enquiry_id.
 */

import { useState, FormEvent, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import ActionModal from '../components/ActionModal';
import DateInput from '../components/DateInput';
import NumericMultiSelect from '../components/NumericMultiSelect';
import NewProposalLauncher from '../components/NewProposalLauncher';
import NightCount from '../components/NightCount';
import { useToast } from '../components/ToastProvider';
import { notifyPipelineChanged } from '../lib/pipelineEvents';
import { linkOrCreateGuestForEnquiry } from '../lib/guestLinks';
import { buildAgentSnapshot } from '../lib/buildAgentSnapshot';
import { syncEnquiryFromProposal } from '../lib/statusSync';
import { nextDirectEnquiryRefCode } from '../lib/refCodes';
import { initialsForEmail } from '../lib/userInitials';
import { CT_RENTALS_PARTNER_ID } from './constants';
import type { EnquiryPrefill } from '../components/CreateProposalModal';

interface PropertyLite {
  id: string;
  property_name: string;
  suburb: string | null;
  bedrooms: number | null;
}

const EMPTY_FORM = {
  subject: '',
  source_url: '',
  client_name: '', client_email: '', client_phone: '',
  check_in: '', check_out: '',
  // Bedrooms is multi-select (4 OR 5 OR 6 is a common ask).
  // Total guests is single-value because a guest count is a
  // hard number (a party of 8 is a party of 8). Property match
  // filters bedrooms via .in(options) and guests via .eq().
  bedrooms_options: [] as number[],
  guests_total: '2',
  guests_adults: '1', guests_children: '0',
  nationality: '', budget_min: '', budget_max: '', notes: '',
};

interface AgentOption {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export function EnquiryForm() {
  const { supabase, user } = useAuth();
  const { setPageTitle } = useLayout();
  const navigate = useNavigate();
  const location = useLocation();
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
  /** Three-way enquiry origin selector. Starts UNSET so the form
   *  reveals progressively — pick where the enquiry came from
   *  before anything else shows. Once a choice is made the other
   *  two pill buttons hide so the form reads as a single linear
   *  question; a small "Change" link resets the selection. */
  const [enquirySource, setEnquirySource] = useState<'direct' | 'agent' | 'platform' | null>(null);
  const isAgent = enquirySource === 'agent';
  const isPlatform = enquirySource === 'platform';
  const hasSource = enquirySource !== null;
  const [agentId, setAgentId] = useState<string>('');
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [guestForm, setGuestForm] = useState({ guest_name: '', guest_email: '', guest_phone: '' });
  /** Identifier toggle for agent enquiries. The card needs SOMETHING
   *  distinctive on the kanban; the agent's own name is the same
   *  across all their enquiries so it can't be the headline. Two
   *  valid sources, user picks which to fill (or both — guest name
   *  wins on the card). Defaults to 'guest' because that's what the
   *  ladies want most of the time. */
  const [identifierMode, setIdentifierMode] = useState<'guest' | 'subject'>('guest');
  /** When the user fills the primary identifier they can optionally
   *  expand the other field too — guest name AND a separate subject
   *  is a valid bonus state. Card title still prefers guest name. */
  const [identifierBothOpen, setIdentifierBothOpen] = useState(false);

  // Agent enquiries often arrive scoped to specific houses (the agent
  // emails "can you quote X, Y, Z for these dates?"). Ladies pick those
  // here; on save we auto-create one drafting proposal per house using
  // the same pricing engine + defaults as the manual flow, then the
  // success screen jumps straight to Review proposals. Empty selection
  // falls through to today's "save enquiry then + Create Proposal".
  const [properties, setProperties] = useState<PropertyLite[]>([]);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<Set<string>>(new Set());
  const [propertySearch, setPropertySearch] = useState('');

  useEffect(() => { setPageTitle('New Enquiry'); }, [setPageTitle]);

  // Rehydrate form when the user clicks Back on the match page —
  // /enquiry/new/match navigates here with location.state.enquiry
  // populated so we restore exactly what they typed in step 1.
  // Runs once on mount; subsequent navigations don't re-trigger.
  useEffect(() => {
    const carry = (location.state as { enquiry?: any } | null)?.enquiry;
    if (!carry) return;
    setForm(prev => ({
      ...prev,
      subject: carry.subject || '',
      client_name: carry.client_name || '',
      client_email: carry.client_email || '',
      client_phone: carry.client_phone || '',
      check_in: carry.check_in || '',
      check_out: carry.check_out || '',
      bedrooms_options: Array.isArray(carry.bedrooms_options) && carry.bedrooms_options.length > 0
        ? carry.bedrooms_options
        : (carry.bedrooms_needed != null ? [Number(carry.bedrooms_needed)] : []),
      guests_total: carry.guests_total != null ? String(carry.guests_total) : '2',
      guests_adults: carry.guests_adults != null ? String(carry.guests_adults) : '1',
      guests_children: carry.guests_children != null ? String(carry.guests_children) : '0',
      nationality: carry.nationality || '',
      budget_min: carry.budget_min != null ? String(carry.budget_min) : '',
      budget_max: carry.budget_max != null ? String(carry.budget_max) : '',
      notes: carry.notes || '',
      source_url: carry.source_url || '',
    }));
    // Match page only handles direct enquiries, so the Back action
    // always lands us back in 'direct' mode (if you came from agent
    // or platform you never went via match in the first place).
    setEnquirySource('direct');
    // Drop location.state so a refresh doesn't keep re-applying it.
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setIdentifierMode('guest');
    setIdentifierBothOpen(false);
    setSelectedPropertyIds(new Set());
    setPropertySearch('');
  }, [isAgent]);

  // Clear the platform URL when leaving platform mode so the value
  // doesn't accidentally get persisted on a direct or agent save.
  useEffect(() => {
    if (isPlatform) return;
    setForm(prev => ({ ...prev, source_url: '' }));
  }, [isPlatform]);

  // Lazy-load active properties the first time the user flips into
  // agent mode (the picker only shows there). Cached for the lifetime
  // of the form so toggling agent off/on doesn't refetch.
  useEffect(() => {
    if (!supabase || !isAgent || properties.length > 0) return;
    let cancelled = false;
    supabase
      .from('partner_properties')
      .select('id, property_name, suburb, bedrooms')
      .eq('partner_id', CT_RENTALS_PARTNER_ID)
      .eq('is_published', true)
      .order('property_name')
      .then(({ data }: any) => { if (!cancelled && data) setProperties(data); });
    return () => { cancelled = true; };
  }, [supabase, isAgent, properties.length]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  /** "Save enquiry" path for DIRECT enquiries — persists the row
   *  without going through the property match step. Lands the deal
   *  in Arrived (no proposals attached yet). Used when the user
   *  wants to capture an enquiry now and quote later. */
  async function handleDirectSaveOnly() {
    if (saving) return;
    // Quick-entry mode: name is the only hard requirement. Everything
    // else (dates, beds, guests) is captured-when-known so the team
    // can spit out a placeholder card from a phone call and fill the
    // rest in from the kanban later. Dates still get a sanity check
    // ONLY when both have been entered.
    if (!form.client_name.trim()) { toast.warning('Guest name is required'); return; }
    if (form.check_in && form.check_out && form.check_in >= form.check_out) {
      toast.warning('Check-out must be after check-in');
      return;
    }
    setSaving(true);
    try {
      const refCode = await nextDirectEnquiryRefCode(supabase);
      const { data: enq, error: enqErr } = await supabase
        .from('enquiries')
        .insert({
          partner_id: CT_RENTALS_PARTNER_ID,
          ref_code: refCode,
          is_agent: false,
          agent_id: null,
          subject: null,
          client_name: form.client_name.trim(),
          client_email: form.client_email.trim() || null,
          client_phone: form.client_phone.trim() || null,
          guest_name: form.client_name.trim(),
          guest_email: form.client_email.trim() || null,
          guest_phone: form.client_phone.trim() || null,
          check_in: form.check_in || null,
          check_out: form.check_out || null,
          // bedrooms_needed stays populated with the min of the
          // multi-select so legacy readers + the kanban card keep
          // working. The .in() filter on the property match step
          // uses bedrooms_options. guests_total is single-value.
          bedrooms_needed: form.bedrooms_options.length > 0 ? Math.min(...form.bedrooms_options) : null,
          guests_total:    form.guests_total ? Number(form.guests_total) : null,
          bedrooms_options: form.bedrooms_options.length > 0 ? form.bedrooms_options : null,
          guests_options:   null,
          guests_adults: form.guests_adults ? Number(form.guests_adults) : null,
          guests_children: form.guests_children ? Number(form.guests_children) : null,
          nationality: form.nationality.trim() || null,
          budget_min: form.budget_min ? Number(form.budget_min) : null,
          budget_max: form.budget_max ? Number(form.budget_max) : null,
          notes: form.notes.trim() || null,
          source: null,
          source_url: null,
          created_by_initials: initialsForEmail(user?.email),
        })
        .select('id, ref_code')
        .single();
      if (enqErr) throw enqErr;
      // CRM auto-link (best-effort).
      if (form.client_name || form.client_email) {
        try {
          await linkOrCreateGuestForEnquiry(supabase, {
            enquiryId: enq.id,
            partnerId: CT_RENTALS_PARTNER_ID,
            guestName: form.client_name.trim(),
            guestEmail: form.client_email.trim() || null,
            guestPhone: form.client_phone.trim() || null,
          });
        } catch (err) { console.error('Guest CRM link failed (non-blocking):', err); }
      }
      notifyPipelineChanged();
      toast.success(`Enquiry ${enq.ref_code} saved`);
      navigate(`/operations/enquiries?deal=${encodeURIComponent(enq.id)}&highlight=1`);
    } catch (err: any) {
      console.error('handleDirectSaveOnly failed:', err);
      toast.error('Failed to save: ' + (err?.message || String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    // Agent enquiries need ONE of: guest name OR subject. Both is a
    // valid bonus (guest name wins on the card). Direct enquiries
    // skip this — the recipient IS the guest, so client_name below
    // already covers the headline.
    if (!hasSource) { toast.warning('Pick where the enquiry came from'); return; }
    if (isAgent && !form.subject.trim() && !guestForm.guest_name.trim()) {
      toast.warning('Add either a guest name or a subject — we need something distinctive to label this enquiry on the board');
      return;
    }
    if (isAgent && !agentId) { toast.warning('Pick an agent'); return; }
    if (isPlatform && !form.source_url.trim()) {
      toast.warning('Add the conversation URL from the platform');
      return;
    }
    if (!form.client_name.trim()) { toast.warning('Recipient name is required'); return; }
    if (!form.check_in || !form.check_out) { toast.warning('Check-in and check-out are required'); return; }
    if (form.check_in >= form.check_out) { toast.warning('Check-out must be after check-in'); return; }
    if (form.bedrooms_options.length === 0) { toast.warning('Pick at least one bedroom count'); return; }
    if (!form.guests_total || Number(form.guests_total) < 1) { toast.warning('Pick the guest count'); return; }

    // Direct enquiry — navigate to step 2 (the property match page)
    // with the form data in location.state. The match page is the
    // one that actually persists the enquiry + proposals atomically.
    if (!isAgent && !isPlatform) {
      navigate('/enquiry/new/match', {
        state: {
          enquiry: {
            subject: form.subject.trim() || null,
            client_name: form.client_name.trim(),
            client_email: form.client_email.trim() || null,
            client_phone: form.client_phone.trim() || null,
            check_in: form.check_in,
            check_out: form.check_out,
            bedrooms_needed: Math.min(...form.bedrooms_options),
            guests_total: Number(form.guests_total) || 1,
            bedrooms_options: form.bedrooms_options,
            guests_options: null,
            guests_adults: form.guests_adults ? Number(form.guests_adults) : null,
            guests_children: form.guests_children ? Number(form.guests_children) : null,
            nationality: form.nationality.trim() || null,
            budget_min: form.budget_min ? Number(form.budget_min) : null,
            budget_max: form.budget_max ? Number(form.budget_max) : null,
            notes: form.notes.trim() || null,
            source: null,
            source_url: null,
          },
        },
      });
      return;
    }

    setSaving(true);
    // Ref code generation, by stream:
    //   Direct   → D001, D002, … (sequential, padded to 3)
    //   Agent    → legacy ENQ-YYYYMMDD-NAM-XX (will migrate next)
    //   Platform → legacy ENQ-YYYYMMDD-NAM-XX (will migrate next)
    const legacyEnqRefCode = () => {
      const d = new Date();
      const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      const clean = (form.client_name || 'GST').replace(/[^A-Za-z]/g, '').toUpperCase();
      const name = (clean.slice(0, 3) || 'GST').padEnd(3, 'X');
      const tail = Math.floor(Math.random() * 0xff).toString(16).toUpperCase().padStart(2, '0');
      return `ENQ-${day}-${name}-${tail}`;
    };
    const refCode = (!isAgent && !isPlatform)
      ? await nextDirectEnquiryRefCode(supabase)
      : legacyEnqRefCode();
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
        subject: isAgent ? (form.subject.trim() || null) : null,
        is_agent: isAgent,
        agent_id: isAgent ? agentId : null,
        // Platform enquiries get tagged so the kanban's Platform lens
        // can filter them out and so the deal modal can render the
        // back-link to the conversation thread. Direct enquiries
        // leave both fields null (legacy default).
        source: isPlatform ? 'platform' : null,
        source_url: isPlatform ? (form.source_url.trim() || null) : null,
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
        bedrooms_needed: form.bedrooms_options.length > 0 ? Math.min(...form.bedrooms_options) : 1,
        guests_total:    Number(form.guests_total) || 1,
        bedrooms_options: form.bedrooms_options.length > 0 ? form.bedrooms_options : null,
        guests_options:   null,
        guests_adults: Number(form.guests_adults) || null,
        guests_children: Number(form.guests_children) || null,
        nationality: form.nationality.trim() || null,
        budget_min: form.budget_min ? Number(form.budget_min) : null,
        budget_max: form.budget_max ? Number(form.budget_max) : null,
        notes: form.notes.trim() || null,
        created_by_initials: initialsForEmail(user?.email),
      })
      .select('id, ref_code, subject, client_name, client_email, client_phone, check_in, check_out, guests_total, notes, is_agent, agent_id, guest_name, guest_email, guest_phone')
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

    // Agent enquiry with specific properties selected → auto-create one
    // drafting proposal per property using the same engine + defaults
    // the manual flow lands on. Best-effort: failures are toasted but
    // don't roll back the saved enquiry. The success screen swaps to
    // the "proposals created" variant if any landed.
    let autoProposalCount = 0;
    if (isAgent && agentId && data?.id && selectedPropertyIds.size > 0) {
      const propertyIds = [...selectedPropertyIds];
      const results = await Promise.all(propertyIds.map(async (pid) => {
        try {
          const snap = await buildAgentSnapshot(supabase, {
            propertyId: pid,
            agentId,
            checkIn: form.check_in || null,
          });
          if (!snap) return { ok: false, pid, reason: 'no-baseline' };
          const b = snap.breakdown;
          const pricingPayload = {
            property_id: snap.propertyId,
            scenario_type: snap.scenarioType,
            agent_id: snap.agentId,
            agents: snap.agents,
            channel_profile_id: snap.channelId,
            baseline_used: snap.baseline,
            baseline_mode: 'daily' as const,
            commission_pct: snap.totalMarginPct,
            reduced_baseline: null,
            reduced_commission_pct: null,
            season_tag: snap.seasonTag,
            season_multiplier: snap.seasonMultiplier,
            calc_method: 'margin' as const,
            owner_net: b.ownerNet,
            company_take: b.ctrTake,
            client_price_excl_vat: b.clientPriceExclVat,
            vat_enabled: false,
            vat_rate_pct: 0,
            vat_amount: 0,
            client_price_incl_vat: b.clientPriceExclVat,
            status: 'draft' as const,
            expiry_date: null,
            notes: null,
          };
          const pricingRes = await supabase.from('pricing_proposals').insert(pricingPayload).select('id').single();
          if (pricingRes.error) throw pricingRes.error;
          // Per-proposal ref_code, same format as the manual flow.
          const d = new Date();
          const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
          const tail = Math.floor(Math.random() * 0xff).toString(16).toUpperCase().padStart(2, '0');
          const propRefCode = `PROP-${day}-${tail}`;
          const proposalPayload = {
            ref_code: propRefCode,
            partner_id: CT_RENTALS_PARTNER_ID,
            enquiry_id: data.id,
            property_id: pid,
            pricing_proposal_id: pricingRes.data.id,
            guest_id: null,
            guest_name: disclosedGuestName || 'Valued Guest',
            guest_email: disclosedGuestEmail,
            guest_phone: disclosedGuestPhone,
            guests_total: Number(form.guests_total) || null,
            check_in: form.check_in || null,
            check_out: form.check_out || null,
            status: 'drafting' as const,
            is_agent: true,
            notes: null,
          };
          const propRes = await supabase.from('proposals').insert(proposalPayload).select('id').single();
          if (propRes.error) throw propRes.error;
          await syncEnquiryFromProposal(supabase, propRes.data.id, 'drafting');
          return { ok: true, pid };
        } catch (err: any) {
          console.error('auto-proposal failed for', pid, err);
          return { ok: false, pid, reason: err?.message || String(err) };
        }
      }));
      autoProposalCount = results.filter(r => r.ok).length;
      const failed = results.filter(r => !r.ok);
      if (failed.length > 0) {
        toast.warning(`${autoProposalCount} of ${propertyIds.length} draft proposals created; ${failed.length} failed (check console)`);
      }
    }

    notifyPipelineChanged();
    toast.success('Enquiry saved');
    setSavedEnquiry(data as EnquiryPrefill);
    if (autoProposalCount > 0) setProposalsCreatedCount(autoProposalCount);
  }

  function startAnother() {
    setSavedEnquiry(null);
    setProposalsCreatedCount(0);
    setForm(EMPTY_FORM);
    setEnquirySource('direct');
    setAgentId('');
    setGuestForm({ guest_name: '', guest_email: '', guest_phone: '' });
    setIdentifierMode('guest');
    setIdentifierBothOpen(false);
    setSelectedPropertyIds(new Set());
    setPropertySearch('');
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
            hasProposals ? (
              // When auto-created proposals exist, the obvious next step
              // is reviewing them, not raising another. Jumps to the
              // Proposals page filtered to this enquiry via ?enquiry=.
              <button
                className="btn btn-primary"
                onClick={() => navigate(`/operations/enquiries?deal=${encodeURIComponent(savedEnquiry.id)}`)}
              >
                📋 Review proposals
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => setLauncherOpen(true)}>
                📝 Create Proposal
              </button>
            )
          }
          secondaryActions={
            <>
              {hasProposals && (
                <button className="btn btn-ghost" onClick={() => setLauncherOpen(true)}>
                  + Another proposal for this enquiry
                </button>
              )}
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
          // Direct enquiries are the quick-entry path — the team
          // often takes a phone call and just needs to drop a name
          // into the system to remember to follow up. We show
          // "Save / close" the moment a name exists (the only true
          // requirement) so the button is never hidden during data
          // entry. "Continue to proposals" stays gated on the full
          // set because the match step needs dates + beds to filter
          // properties. Agent / platform paths keep their single
          // gated Save (they have stricter required fields anyway).
          (() => {
            if (!hasSource) return null;

            if (enquirySource === 'direct') {
              const hasName = form.client_name.trim().length > 0;
              if (!hasName) return null;
              const canContinue =
                !!form.check_in &&
                !!form.check_out &&
                form.check_in < form.check_out &&
                form.bedrooms_options.length > 0 &&
                !!form.guests_total;
              return (
                <div style={{ display: 'inline-flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleDirectSaveOnly}
                    disabled={saving}
                    title="Save the enquiry now and close — only the guest name is required; fill the rest in from the kanban later"
                  >
                    {saving ? 'Saving…' : '💾 Save / close'}
                  </button>
                  <button
                    type="submit"
                    form="enquiry-form"
                    className="btn btn-primary"
                    disabled={saving || !canContinue}
                    title={canContinue
                      ? 'Continue to pick matching properties + price them'
                      : 'Add dates, bedrooms and guests to continue to the property picker'}
                  >
                    {saving ? 'Saving…' : 'Continue to proposals →'}
                  </button>
                </div>
              );
            }

            // Agent / platform — keep the existing gating.
            if (isAgent) {
              if (!agentId) return null;
              if (!form.subject.trim() && !guestForm.guest_name.trim()) return null;
            }
            if (isPlatform && !form.source_url.trim()) return null;
            if (!form.client_name.trim()) return null;
            if (!form.check_in || !form.check_out) return null;
            if (form.check_in >= form.check_out) return null;
            return (
              <button type="submit" form="enquiry-form" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save enquiry'}
              </button>
            );
          })()
        }
        onClose={close}
      >
        <Section title="Enquiry from" subtitle="Where did this enquiry come in?">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {([
              { key: 'direct',   label: '👤 Direct guest' },
              { key: 'agent',    label: '🤝 An agent (on behalf of a guest)' },
              { key: 'platform', label: '🔗 Platform (Airbnb / Booking / etc)' },
            ] as const)
              // Progressive disclosure: show ALL three options when
              // nothing's been picked yet. Once the user commits,
              // hide the unchosen options so the form reads as a
              // single linear question. A small "Change" link
              // resets the selection if they pick wrong.
              .filter(opt => !hasSource || enquirySource === opt.key)
              .map(opt => (
                <label
                  key={opt.key}
                  className={`btn ${enquirySource === opt.key ? 'btn-primary' : 'btn-outline'}`}
                  style={{ cursor: 'pointer', fontWeight: 500 }}
                >
                  <input
                    type="radio"
                    name="enquiry_from"
                    checked={enquirySource === opt.key}
                    onChange={() => setEnquirySource(opt.key)}
                    style={{ display: 'none' }}
                  />
                  {opt.label}
                </label>
              ))}
            {hasSource && (
              <button
                type="button"
                onClick={() => setEnquirySource(null)}
                style={{
                  background: 'none', border: 'none',
                  fontSize: '0.75rem', color: 'var(--text-secondary)',
                  cursor: 'pointer', textDecoration: 'underline',
                  padding: '4px 8px',
                }}
                title="Switch to a different source"
              >
                Change
              </button>
            )}
          </div>
        </Section>

        {/* Everything below is gated behind the source pick — the
            form reveals progressively so the user does one thing at
            a time. */}
        {hasSource && (<>
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
              title="Properties the agent is enquiring about"
              subtitle="Tick one or more — a draft proposal is auto-created for each on save. Leave empty if the agent is asking about availability generally."
            >
              <PropertyMultiPicker
                properties={properties}
                selected={selectedPropertyIds}
                onChange={setSelectedPropertyIds}
                search={propertySearch}
                onSearchChange={setPropertySearch}
              />
            </Section>

            <Section
              title="Identify this enquiry *"
              subtitle="Pick how you want to label this on the board. Guest name wins on the card if both are filled. At least one is required."
            >
              {/* Mode toggle — same .view-toggle pattern as the other
                  pill switches in the app so the choice reads as a
                  single primary control. */}
              <div className="view-toggle" style={{ marginBottom: 12 }}>
                <button
                  type="button"
                  className={`view-toggle-btn ${identifierMode === 'guest' ? 'active' : ''}`}
                  onClick={() => setIdentifierMode('guest')}
                >
                  👤 Guest details
                </button>
                <button
                  type="button"
                  className={`view-toggle-btn ${identifierMode === 'subject' ? 'active' : ''}`}
                  onClick={() => setIdentifierMode('subject')}
                >
                  ✏ Subject
                </button>
              </div>

              {identifierMode === 'guest' ? (
                <>
                  <div className="enquiry-grid-3">
                    <Field label="Guest name *">
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
                  {identifierBothOpen ? (
                    <div className="form-group" style={{ marginTop: 12 }}>
                      <label className="form-label">Subject (bonus)</label>
                      <input
                        className="form-input"
                        name="subject"
                        value={form.subject}
                        onChange={handleChange}
                        placeholder="A short summary of the trip"
                        maxLength={120}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setIdentifierBothOpen(true)}
                      style={{ fontSize: '0.8125rem', marginTop: 8 }}
                    >
                      + Also add a subject
                    </button>
                  )}
                </>
              ) : (
                <>
                  <input
                    className="form-input"
                    name="subject"
                    value={form.subject}
                    onChange={handleChange}
                    placeholder="A short summary of the trip (e.g. Family of 6, Easter)"
                    maxLength={120}
                    required
                  />
                  {identifierBothOpen ? (
                    <div className="enquiry-grid-3" style={{ marginTop: 12 }}>
                      <Field label="Guest name (bonus)">
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
                      onClick={() => setIdentifierBothOpen(true)}
                      style={{ fontSize: '0.8125rem', marginTop: 8 }}
                    >
                      + Also add guest details
                    </button>
                  )}
                </>
              )}
            </Section>
          </>
        ) : (
          // Direct OR Platform — same guest fields. Platform adds a
          // single extra Section for the conversation-thread URL
          // above the Guest block so the back-link is the first
          // thing the user fills in (it's why they're tagging this
          // as a platform enquiry in the first place).
          <>
            {isPlatform && (
              <Section
                title="Platform"
                subtitle="Paste the link to the message thread on Airbnb, Booking, VRBO, etc. We render it as a one-click back-link on the deal."
              >
                <Field label="Conversation URL *">
                  <input
                    className="form-input"
                    type="url"
                    name="source_url"
                    value={form.source_url}
                    onChange={handleChange}
                    placeholder="https://www.airbnb.com/messaging/..."
                    required
                  />
                </Field>
              </Section>
            )}
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
          </>
        )}

        <Section title="Stay" subtitle="Dates and guest count">
          <div className="enquiry-grid-2">
            <Field label="Check-in *">
              {/* Native browser date picker — same pattern used on
                  BookingModal + the deal modal. Opens a calendar so
                  the user doesn't have to type the date by hand. */}
              <input
                type="date"
                className="form-input"
                name="check_in"
                value={form.check_in}
                onChange={handleChange}
                required
              />
            </Field>
            <Field label={
              <>
                Check-out *
                {/* Inline night count — appears the moment both dates
                    are valid so the user doesn't have to count nights
                    in their head before saving the enquiry. */}
                <NightCount checkIn={form.check_in} checkOut={form.check_out} />
              </>
            }>
              <input
                type="date"
                className="form-input"
                name="check_out"
                value={form.check_out}
                onChange={handleChange}
                required
              />
            </Field>
          </div>

          {/* Fixed-range selects so the value is constrained — keeps
              the property match step's filter tight and prevents
              typos like "55 guests" leaking through. */}
          <div className="enquiry-grid-2" style={{ marginTop: 12 }}>
            <Field label="Bedrooms *">
              <NumericMultiSelect
                max={10}
                value={form.bedrooms_options}
                onChange={(next) => setForm(prev => ({ ...prev, bedrooms_options: next }))}
                placeholder="Pick bedrooms…"
                singular="bedroom"
                plural="bedrooms"
              />
            </Field>
            <Field label="Total guests *">
              {/* Single-value — guests is a hard count, not a
                  range. Property match filters with .eq(guests). */}
              <select className="form-input" name="guests_total" value={form.guests_total} onChange={handleChange} required>
                {Array.from({ length: 20 }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="enquiry-grid-2" style={{ marginTop: 12 }}>
            <Field label="Adults">
              <select className="form-input" name="guests_adults" value={form.guests_adults} onChange={handleChange}>
                {Array.from({ length: 21 }, (_, i) => i).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </Field>
            <Field label="Children">
              <select className="form-input" name="guests_children" value={form.guests_children} onChange={handleChange}>
                {Array.from({ length: 11 }, (_, i) => i).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
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
        </>)}
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

/** @deprecated — moved to ../components/NumericMultiSelect.
 *  Kept temporarily so any stray references still compile. */
function ChipMultiSelect({ max, min = 1, value, onChange, placeholder = 'Pick one or more…', singular, plural }: {
  max: number;
  min?: number;
  value: number[];
  onChange: (next: number[]) => void;
  placeholder?: string;
  singular?: string;
  plural?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  function toggle(n: number) {
    const set = new Set(value);
    if (set.has(n)) set.delete(n); else set.add(n);
    onChange([...set].sort((a, b) => a - b));
  }
  const options = Array.from({ length: max - min + 1 }, (_, i) => i + min);
  const summary = value.length === 0
    ? placeholder
    : `${value.join(', ')}${singular ? ` ${value.length === 1 ? singular : (plural || singular + 's')}` : ''}`;
  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="form-input"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          background: 'var(--surface)',
        }}
        aria-expanded={open}
      >
        <span style={{
          flex: 1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: value.length === 0 ? 'var(--text-light)' : 'var(--text)',
        }}>
          {summary}
        </span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          right: 0,
          zIndex: 20,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          boxShadow: 'var(--shadow-md, 0 4px 16px rgba(0,0,0,0.1))',
          padding: 8,
          maxHeight: 280,
          overflowY: 'auto',
        }}>
          {options.map(n => {
            const selected = value.includes(n);
            return (
              <label
                key={n}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '6px 8px',
                  cursor: 'pointer',
                  background: selected ? 'var(--bg)' : 'transparent',
                  borderRadius: 4,
                }}
              >
                <input type="checkbox" checked={selected} onChange={() => toggle(n)} />
                <span style={{ fontSize: '0.875rem' }}>{n}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, children, style }: { label: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="form-group" style={style}>
      <label className="form-label">{label}</label>
      {children}
    </div>
  );
}

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

/** Multi-select for active properties — collapsed by default into a
 *  trigger button that summarises the current selection. Click to
 *  open, type to search, click again (or anywhere outside) to close.
 *  Keeps the form compact while still allowing the search-and-tick
 *  flow the user expects. */
function PropertyMultiPicker({
  properties,
  selected,
  onChange,
  search,
  onSearchChange,
}: {
  properties: PropertyLite[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  search: string;
  onSearchChange: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Close on outside click so the picker dismisses when the user
  // moves on. Doesn't fire on internal clicks (label, search box).
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = terms.length === 0
    ? properties
    : properties.filter(p => {
        const hay = [p.property_name, p.suburb].filter(Boolean).join(' ').toLowerCase();
        return terms.every(t => hay.includes(t));
      });
  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  }
  // Trigger label: "Pick properties…" when nothing selected, else a
  // short summary ("3 selected · 104 Zwaanswyk, 12 Bordeaux, +1").
  const selectedProps = properties.filter(p => selected.has(p.id));
  const triggerLabel = selectedProps.length === 0
    ? 'Pick properties…'
    : (() => {
        const names = selectedProps.slice(0, 2).map(p => titleCase(p.property_name)).join(', ');
        const extra = selectedProps.length > 2 ? `, +${selectedProps.length - 2}` : '';
        return `${selectedProps.length} selected · ${names}${extra}`;
      })();

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="form-input"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          background: 'var(--surface)',
        }}
        aria-expanded={open}
      >
        <span style={{
          flex: 1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: selectedProps.length === 0 ? 'var(--text-light)' : 'var(--text)',
        }}>
          {triggerLabel}
        </span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          right: 0,
          zIndex: 20,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          boxShadow: 'var(--shadow-md, 0 4px 16px rgba(0,0,0,0.1))',
          padding: 8,
        }}>
          <input
            type="search"
            className="form-input"
            placeholder="Search properties by name or suburb…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{ marginBottom: 6 }}
            autoFocus
          />
          <div style={{
            maxHeight: 220,
            overflowY: 'auto',
            border: '1px solid var(--border-light)',
            borderRadius: 'var(--radius-sm)',
          }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 12, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>No properties match.</div>
            ) : filtered.map(p => {
              const isSel = selected.has(p.id);
              return (
                <label
                  key={p.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--border-light)',
                    cursor: 'pointer',
                    background: isSel ? 'var(--bg)' : 'transparent',
                  }}
                >
                  <input type="checkbox" checked={isSel} onChange={() => toggle(p.id)} />
                  <span style={{ fontSize: '0.875rem', flex: 1 }}>
                    {titleCase(p.property_name)}
                    {p.suburb && <span style={{ color: 'var(--text-secondary)' }}> · {titleCase(p.suburb)}</span>}
                    {p.bedrooms ? <span style={{ color: 'var(--text-secondary)' }}> · {p.bedrooms} bed</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {selected.size > 0 && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 6 }}>
          {selected.size} selected — a drafting proposal will be created for each on save.
        </div>
      )}
    </div>
  );
}
