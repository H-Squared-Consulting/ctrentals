/**
 * EnquiryForm -- /enquiry/new
 *
 * Captures an incoming guest enquiry. After save, surfaces a "Create
 * Proposal" CTA that hands the enquiry off to the proposal-builder flow
 * (property picker → calculator → recipient details), with all the
 * enquiry's data pre-filled and the saved proposal linked back via
 * proposals.enquiry_id.
 */

import { useState, FormEvent, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import ActionModal from '../components/ActionModal';
import DateInput from '../components/DateInput';
import NumericMultiSelect from '../components/NumericMultiSelect';
import NewProposalLauncher from '../components/NewProposalLauncher';
import NightCount from '../components/NightCount';
import PriceBucketFilter from '../components/PriceBucketFilter';
import type { TierKey } from '../lib/priceTiers';
import { useToast } from '../components/ToastProvider';
import { useModalStack } from '../contexts/ModalStackContext';
import { notifyPipelineChanged } from '../lib/pipelineEvents';
import { linkOrCreateGuestForEnquiry } from '../lib/guestLinks';
import { nextDirectEnquiryRefCode, nextAgentEnquiryRefCode, nextPlatformEnquiryRefCode, type PlatformChannel } from '../lib/refCodes';
import { initialsForEmail } from '../lib/userInitials';
import { CT_RENTALS_PARTNER_ID } from './constants';
import type { EnquiryPrefill } from '../components/CreateProposalModal';

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
  nationality: '', budget_tiers: [] as TierKey[], notes: '',
};

interface AgentOption {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  ref_code: string | null;
}

export function EnquiryForm() {
  const { supabase, user } = useAuth();
  const { setPageTitle } = useLayout();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  // Register in the global modal stack so the search panel docks
  // to the side (rather than fighting for the center) if the user
  // opens it while filling out an enquiry.
  const modalStack = useModalStack();
  useEffect(() => {
    if (!modalStack) return;
    modalStack.setEnquiryOpen(true);
    return () => modalStack.setEnquiryOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isFaded = !!modalStack?.searchOpen && modalStack?.focused === 'search';
  const focusSelf = () => modalStack?.focus('enquiry');

  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [savedEnquiry, setSavedEnquiry] = useState<EnquiryPrefill | null>(null);
  const [launcherOpen, setLauncherOpen] = useState(false);
  /** Property the conversation is about, for platform enquiries.
   *  Required to save — drives the auto-attached draft proposal and
   *  the inline Airbnb listing link. Null on Direct + Agent (those
   *  pick properties on the match step instead). */
  const [platformPropertyId, setPlatformPropertyId] = useState<string | null>(null);
  /** Optional pre-pick for Direct + Agent paths: when the enquiry
   *  has come in naming a specific house (agent intro, repeat
   *  guest, Airbnb DM forwarded by phone), capturing it here pre-
   *  ticks the match modal AND stamps requested_property_ids on
   *  the enquiry so the deal modal surfaces it. Always optional —
   *  enquiries without a pre-pick still walk through the full
   *  search on the match step. */
  const [directPropertyId, setDirectPropertyId] = useState<string | null>(null);
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
  /** Which platform — Airbnb or VRBO — when the source is 'platform'.
   *  Drives ref-code stream (A### vs V###) and the deal-card affordance.
   *  Required before the form can save. Cleared when the source picker
   *  changes away from platform. */
  const [platformChannel, setPlatformChannel] = useState<PlatformChannel | null>(null);
  const [guestForm, setGuestForm] = useState({ guest_name: '', guest_email: '', guest_phone: '' });
  /** Auto-generated agent-enquiry identifier in the form
   *  `{agent.ref_code}/N`. Populated the moment an agent is picked
   *  and used as the enquiry's subject on insert so the kanban
   *  card always has SOMETHING distinctive (e.g. AHH/3) even when
   *  the guest hasn't been disclosed yet. Read-only to the user. */
  const [agentEnquiryRefCode, setAgentEnquiryRefCode] = useState<string>('');
  /** Guest details for agent enquiries are collapsed by default —
   *  the agent norm is "guest not disclosed yet" and we don't want
   *  to push that empty-state section in the user's face. Click the
   *  "+ Add guest details (optional)" CTA to expand it. */
  const [agentGuestOpen, setAgentGuestOpen] = useState(false);

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
      budget_tiers: Array.isArray(carry.budget_tiers) ? (carry.budget_tiers as TierKey[]) : [],
      notes: carry.notes || '',
      source_url: carry.source_url || '',
    }));
    // Restore the source the user originally picked so Back from
    // the match page lands them in the exact mode they came from
    // (direct / agent / platform). Source is inferred from the
    // carried payload: source='platform' → platform, is_agent →
    // agent, else direct.
    if (carry.source === 'platform') {
      setEnquirySource('platform');
      if (carry.platform_channel === 'airbnb' || carry.platform_channel === 'vrbo') {
        setPlatformChannel(carry.platform_channel);
      }
    } else if (carry.is_agent) {
      setEnquirySource('agent');
      if (carry.agent_id) setAgentId(carry.agent_id);
    } else {
      setEnquirySource('direct');
    }
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
      .select('id, name, email, phone, is_active, ref_code')
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
    setAgentEnquiryRefCode('');
    setAgentGuestOpen(false);
  }, [isAgent]);

  // Auto-generate the enquiry identifier (`{agentRefCode}/N`) the
  // moment the agent picker resolves to a real agent with a code.
  // Clears when the user changes their mind so the next pick gets a
  // fresh number. Falls back to a placeholder if the agent has no
  // ref_code (shouldn't happen post-backfill, but keep the form
  // working rather than crashing).
  useEffect(() => {
    if (!isAgent || !agentId || !supabase) {
      setAgentEnquiryRefCode('');
      return;
    }
    const agent = agents.find(a => a.id === agentId);
    if (!agent?.ref_code) {
      setAgentEnquiryRefCode('');
      return;
    }
    let cancelled = false;
    nextAgentEnquiryRefCode(supabase, agentId, agent.ref_code)
      .then(code => { if (!cancelled) setAgentEnquiryRefCode(code); })
      .catch(err => { console.error('Failed to compute agent enquiry ref code:', err); });
    return () => { cancelled = true; };
  }, [supabase, isAgent, agentId, agents]);

  // Clear the platform URL + sub-channel when leaving platform mode so
  // the value doesn't accidentally get persisted on a direct or agent
  // save (and so the next time we enter platform mode the user has to
  // re-pick Airbnb / VRBO consciously).
  useEffect(() => {
    if (isPlatform) return;
    setForm(prev => ({ ...prev, source_url: '' }));
    setPlatformChannel(null);
  }, [isPlatform]);

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
          budget_tiers: form.budget_tiers.length > 0 ? form.budget_tiers : null,
          notes: form.notes.trim() || null,
          source: null,
          source_url: null,
          requested_property_ids: directPropertyId ? [directPropertyId] : null,
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

  /** "Save / close" path for PLATFORM enquiries — persists the row
   *  with the A### / V### ref code and source='platform' without
   *  going through the property match step. Mirrors Direct/Agent
   *  Quick Save so the team has parity across all three sources. */
  async function handlePlatformSaveOnly() {
    if (saving) return;
    if (!platformChannel) { toast.warning('Pick the platform — Airbnb or VRBO'); return; }
    if (!form.source_url.trim()) { toast.warning('Add the conversation URL from the platform'); return; }
    if (!form.client_name.trim()) { toast.warning('Guest name is required'); return; }
    if (!platformPropertyId) { toast.warning('Pick the property the conversation is about'); return; }
    if (form.check_in && form.check_out && form.check_in >= form.check_out) {
      toast.warning('Check-out must be after check-in');
      return;
    }
    setSaving(true);
    try {
      const refCode = await nextPlatformEnquiryRefCode(supabase, platformChannel);
      const clientName = form.client_name.trim();
      const clientEmail = form.client_email.trim() || null;
      const clientPhone = form.client_phone.trim() || null;
      const { data: enq, error: enqErr } = await supabase
        .from('enquiries')
        .insert({
          partner_id: CT_RENTALS_PARTNER_ID,
          ref_code: refCode,
          is_agent: false,
          agent_id: null,
          subject: null,
          source: 'platform',
          source_url: form.source_url.trim() || null,
          platform_channel: platformChannel,
          // Stamp the picked property as the multi-property allow-list
          // too so the deal modal's "Generate proposals for these →"
          // CTA pre-ticks it if the team ever clicks it (matches the
          // agent-portal pattern).
          requested_property_ids: [platformPropertyId],
          client_name: clientName,
          client_email: clientEmail,
          client_phone: clientPhone,
          guest_name: clientName,
          guest_email: clientEmail,
          guest_phone: clientPhone,
          check_in: form.check_in || null,
          check_out: form.check_out || null,
          // deal_status stays 'new' so the deal lands in Arrived for
          // triage even though a draft proposal is attached. Mirrors
          // the agent-portal flow where requested_property_ids are
          // pre-attached but the deal still needs human eyes first.
          deal_status: 'new',
          bedrooms_needed: form.bedrooms_options.length > 0 ? Math.min(...form.bedrooms_options) : null,
          guests_total:    form.guests_total ? Number(form.guests_total) : null,
          bedrooms_options: form.bedrooms_options.length > 0 ? form.bedrooms_options : null,
          guests_options:   null,
          guests_adults: form.guests_adults ? Number(form.guests_adults) : null,
          guests_children: form.guests_children ? Number(form.guests_children) : null,
          nationality: form.nationality.trim() || null,
          budget_tiers: form.budget_tiers.length > 0 ? form.budget_tiers : null,
          notes: form.notes.trim() || null,
          created_by_initials: initialsForEmail(user?.email),
        })
        .select('id, ref_code')
        .single();
      if (enqErr) throw enqErr;
      if (clientName || clientEmail) {
        try {
          await linkOrCreateGuestForEnquiry(supabase, {
            enquiryId: enq.id,
            partnerId: CT_RENTALS_PARTNER_ID,
            guestName: clientName,
            guestEmail: clientEmail,
            guestPhone: clientPhone,
          });
        } catch (err) { console.error('Guest CRM link failed (non-blocking):', err); }
      }

      // No proposal is auto-inserted — same pattern as the agent
      // portal. requested_property_ids tags the picked property so
      // the deal modal surfaces a "Generate proposal for this
      // property →" CTA, and the team can review the enquiry in
      // Arrived before committing to a quote. Once they click that
      // CTA, the deal moves to Quoting through the normal match flow.

      notifyPipelineChanged();
      toast.success(`Enquiry ${enq.ref_code} saved`);
      navigate(`/operations/enquiries?deal=${encodeURIComponent(enq.id)}&highlight=1`);
    } catch (err: any) {
      console.error('handlePlatformSaveOnly failed:', err);
      toast.error('Failed to save: ' + (err?.message || String(err)));
    } finally {
      setSaving(false);
    }
  }

  /** "Save enquiry" path for AGENT enquiries — persists the row
   *  without going through the property match step. Mirrors
   *  handleDirectSaveOnly so the agent flow's "Save / close" CTA
   *  behaves identically to direct (lands the deal in Arrived with
   *  no proposals attached). The auto-generated AHH/N code is the
   *  ref_code AND the subject — guest details are optional. */
  async function handleAgentSaveOnly() {
    if (saving) return;
    if (!agentId) { toast.warning('Pick an agent'); return; }
    if (!agentEnquiryRefCode) {
      toast.warning('Hold on — still generating the enquiry code');
      return;
    }
    // Dates sanity-check only when both filled (quick-entry like direct).
    if (form.check_in && form.check_out && form.check_in >= form.check_out) {
      toast.warning('Check-out must be after check-in');
      return;
    }
    setSaving(true);
    try {
      const disclosedGuestName  = guestForm.guest_name.trim()  || null;
      const disclosedGuestEmail = guestForm.guest_email.trim() || null;
      const disclosedGuestPhone = guestForm.guest_phone.trim() || null;
      const { data: enq, error: enqErr } = await supabase
        .from('enquiries')
        .insert({
          partner_id: CT_RENTALS_PARTNER_ID,
          // For agent enquiries the AHH/N code serves as both the
          // tracking ref_code AND the kanban-card subject. Unique
          // by construction (per-agent suffix counter).
          ref_code: agentEnquiryRefCode,
          subject: agentEnquiryRefCode,
          is_agent: true,
          agent_id: agentId,
          client_name: form.client_name.trim(),
          client_email: form.client_email.trim() || null,
          client_phone: form.client_phone.trim() || null,
          guest_name: disclosedGuestName,
          guest_email: disclosedGuestEmail,
          guest_phone: disclosedGuestPhone,
          check_in: form.check_in || null,
          check_out: form.check_out || null,
          bedrooms_needed: form.bedrooms_options.length > 0 ? Math.min(...form.bedrooms_options) : null,
          guests_total:    form.guests_total ? Number(form.guests_total) : null,
          bedrooms_options: form.bedrooms_options.length > 0 ? form.bedrooms_options : null,
          guests_options:   null,
          guests_adults: form.guests_adults ? Number(form.guests_adults) : null,
          guests_children: form.guests_children ? Number(form.guests_children) : null,
          nationality: form.nationality.trim() || null,
          budget_tiers: form.budget_tiers.length > 0 ? form.budget_tiers : null,
          notes: form.notes.trim() || null,
          source: null,
          source_url: null,
          requested_property_ids: directPropertyId ? [directPropertyId] : null,
          created_by_initials: initialsForEmail(user?.email),
        })
        .select('id, ref_code')
        .single();
      if (enqErr) throw enqErr;
      if (disclosedGuestName || disclosedGuestEmail) {
        try {
          await linkOrCreateGuestForEnquiry(supabase, {
            enquiryId: enq.id,
            partnerId: CT_RENTALS_PARTNER_ID,
            guestName: disclosedGuestName,
            guestEmail: disclosedGuestEmail,
            guestPhone: disclosedGuestPhone,
          });
        } catch (err) { console.error('Guest CRM link failed (non-blocking):', err); }
      }
      notifyPipelineChanged();
      toast.success(`Enquiry ${enq.ref_code} saved`);
      navigate(`/operations/enquiries?deal=${encodeURIComponent(enq.id)}&highlight=1`);
    } catch (err: any) {
      console.error('handleAgentSaveOnly failed:', err);
      toast.error('Failed to save: ' + (err?.message || String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!hasSource) { toast.warning('Pick where the enquiry came from'); return; }
    if (isAgent && !agentId) { toast.warning('Pick an agent'); return; }
    if (isAgent && !agentEnquiryRefCode) {
      toast.warning('Hold on — still generating the enquiry code');
      return;
    }
    if (isPlatform && !platformChannel) {
      toast.warning('Pick the platform — Airbnb or VRBO');
      return;
    }
    if (isPlatform && !form.source_url.trim()) {
      toast.warning('Add the conversation URL from the platform');
      return;
    }
    if (!form.client_name.trim()) { toast.warning('Recipient name is required'); return; }
    if (!form.check_in || !form.check_out) { toast.warning('Check-in and check-out are required'); return; }
    if (form.check_in >= form.check_out) { toast.warning('Check-out must be after check-in'); return; }
    if (form.bedrooms_options.length === 0) { toast.warning('Pick at least one bedroom count'); return; }
    if (!form.guests_total || Number(form.guests_total) < 1) { toast.warning('Pick the guest count'); return; }

    // All three sources now route through step 2 (property match page).
    // location.state carries everything the match page needs to insert
    // the enquiry + linked proposals atomically. Platform pre-supplies
    // its A### / V### ref_code here so the match page doesn't have to
    // re-derive the sub-channel from the URL.
    const disclosedGuestName  = isAgent ? (guestForm.guest_name.trim()  || null) : form.client_name.trim();
    const disclosedGuestEmail = isAgent ? (guestForm.guest_email.trim() || null) : (form.client_email.trim() || null);
    const disclosedGuestPhone = isAgent ? (guestForm.guest_phone.trim() || null) : (form.client_phone.trim() || null);
    const platformRefCode = isPlatform && platformChannel
      ? await nextPlatformEnquiryRefCode(supabase, platformChannel)
      : null;
    navigate('/enquiry/new/match', {
      state: {
        // Pre-pick from the optional "Specific property" field on the
        // direct form so the match modal opens with that row already
        // ticked. Match modal still shows the full list — the team
        // can add other quote candidates if they want to send a
        // shortlist on top of the guest's named choice.
        initiallySelected: !isPlatform && directPropertyId ? [directPropertyId] : null,
        enquiry: {
          // Pre-supplied codes:
          //   Agent    — AHH/N (computed earlier)
          //   Platform — A### / V### (computed just above)
          //   Direct   — null; match page generates D### on insert
          ref_code: isAgent ? agentEnquiryRefCode : platformRefCode,
          subject: isAgent ? agentEnquiryRefCode : (form.subject.trim() || null),
          is_agent: isAgent,
          agent_id: isAgent ? agentId : null,
          client_name: form.client_name.trim(),
          client_email: form.client_email.trim() || null,
          client_phone: form.client_phone.trim() || null,
          guest_name: disclosedGuestName,
          guest_email: disclosedGuestEmail,
          guest_phone: disclosedGuestPhone,
          check_in: form.check_in,
          check_out: form.check_out,
          bedrooms_needed: Math.min(...form.bedrooms_options),
          guests_total: Number(form.guests_total) || 1,
          bedrooms_options: form.bedrooms_options,
          guests_options: null,
          guests_adults: form.guests_adults ? Number(form.guests_adults) : null,
          guests_children: form.guests_children ? Number(form.guests_children) : null,
          nationality: form.nationality.trim() || null,
          budget_tiers: form.budget_tiers.length > 0 ? form.budget_tiers : null,
          notes: form.notes.trim() || null,
          source: isPlatform ? 'platform' : null,
          source_url: isPlatform ? (form.source_url.trim() || null) : null,
          platform_channel: isPlatform ? platformChannel : null,
        },
      },
    });
  }

  function startAnother() {
    setSavedEnquiry(null);
    setProposalsCreatedCount(0);
    setForm(EMPTY_FORM);
    setEnquirySource('direct');
    setAgentId('');
    setGuestForm({ guest_name: '', guest_email: '', guest_phone: '' });
    setAgentEnquiryRefCode('');
    setAgentGuestOpen(false);
    setPlatformChannel(null);
    setPlatformPropertyId(null);
    setDirectPropertyId(null);
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
          faded={isFaded}
          onActivate={focusSelf}
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
        faded={isFaded}
        onActivate={focusSelf}
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

            // Agent — mirror direct: two buttons (quick save / close
            // and continue to proposals). Save / close only needs an
            // agent picked; Continue gates on the full proposal-ready
            // set so the match page has what it needs.
            if (isAgent) {
              if (!agentId || !agentEnquiryRefCode) return null;
              const canContinue =
                !!form.client_name.trim() &&
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
                    onClick={handleAgentSaveOnly}
                    disabled={saving}
                    title="Save the enquiry now and close — fill the rest in from the kanban later"
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

            // Platform — single Save / close path. The team picks the
            // property the conversation is about right on the form, so
            // there's no separate "continue to property match" step the
            // way Direct + Agent have. Save creates the enquiry + an
            // auto-attached draft proposal for the picked property and
            // drops the deal into Arrived for triage.
            if (isPlatform) {
              if (!platformChannel) return null;
              if (!form.source_url.trim()) return null;
              if (!form.client_name.trim()) return null;
              return (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handlePlatformSaveOnly()}
                  disabled={saving || !platformPropertyId}
                  title={platformPropertyId
                    ? 'Save the enquiry, generate a draft proposal for the picked property, and drop into Arrived'
                    : 'Pick the property this Airbnb conversation is about to enable save'}
                >
                  {saving ? 'Saving…' : '💾 Save / close'}
                </button>
              );
            }

            return null;
          })()
        }
        onClose={close}
      >
        <Section title="Enquiry from" subtitle="Where did this enquiry come in?">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {([
              { key: 'direct',   label: '👤 Direct guest' },
              { key: 'agent',    label: '🤝 An agent (on behalf of a guest)' },
              { key: 'platform', label: '🔗 Platform (Airbnb or VRBO)' },
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
                      {a.ref_code ? `${a.ref_code} · ` : ''}{a.name}{a.email ? ` · ${a.email}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            </Section>

            {/* Gate the entire rest of the form on an agent being
                picked — until then the form is just the source pick
                and the agent dropdown so the user does ONE thing at
                a time. */}
            {agentId && (<>
              {/* Mirror of the picked agent's contact + the auto-
                  generated enquiry code. Both read-only. The code
                  doubles as the card label until guest details are
                  disclosed below. */}
              <Section title="Enquiry code" subtitle="Auto-generated · used as the card label until guest details are added">
                <div className="enquiry-grid-2">
                  <Field label="Code">
                    <input
                      className="form-input"
                      value={agentEnquiryRefCode || 'Generating…'}
                      readOnly
                      disabled
                      style={{
                        fontFamily: 'ui-monospace, monospace',
                        fontWeight: 600,
                        color: 'var(--color-primary)',
                        background: 'var(--surface-muted, #F3F4F6)',
                        cursor: 'not-allowed',
                      }}
                      title="Auto-incremented per agent. Locked once assigned."
                    />
                  </Field>
                  <Field label="Agent contact">
                    <input
                      className="form-input"
                      value={[form.client_name, form.client_email || form.client_phone].filter(Boolean).join(' · ')}
                      disabled
                      readOnly
                    />
                  </Field>
                </div>
              </Section>

              {/* Guest details collapse — agent enquiries usually
                  arrive with no guest disclosed yet, so we don't
                  push an empty section. The CTA reads as a clear
                  next-step affordance (same .btn .btn-ghost styling
                  used elsewhere in the form) so the user can see
                  they need to click to add details. Property picking
                  happens on the next page (matches the direct flow
                  via /enquiry/new/match). */}
              <Section
                title="Guest details (optional)"
                subtitle="Agents often don't disclose the guest up front. If left blank, the card uses the auto-generated code above."
              >
                {agentGuestOpen ? (
                  <>
                    <div className="enquiry-grid-3">
                      <Field label="Guest name">
                        <input
                          className="form-input"
                          value={guestForm.guest_name}
                          onChange={(e) => setGuestForm(p => ({ ...p, guest_name: e.target.value }))}
                          placeholder="e.g. Sarah Whitmore"
                          autoFocus
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
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        setAgentGuestOpen(false);
                        setGuestForm({ guest_name: '', guest_email: '', guest_phone: '' });
                      }}
                      style={{ fontSize: '0.8125rem', marginTop: 8 }}
                    >
                      − Hide guest details
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setAgentGuestOpen(true)}
                    style={{ fontSize: '0.875rem' }}
                  >
                    + Add guest details
                  </button>
                )}
              </Section>
            </>)}
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
                subtitle="Pick the channel + paste the link to the message thread. The channel drives the ref-code stream (Airbnb → A###, VRBO → V###)."
              >
                <Field label="Channel *">
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {([
                      { key: 'airbnb', label: 'Airbnb' },
                      { key: 'vrbo',   label: 'VRBO'   },
                    ] as const).map(opt => (
                      <label
                        key={opt.key}
                        className={`btn ${platformChannel === opt.key ? 'btn-primary' : 'btn-outline'}`}
                        style={{ cursor: 'pointer', fontWeight: 500 }}
                      >
                        <input
                          type="radio"
                          name="platform_channel"
                          checked={platformChannel === opt.key}
                          onChange={() => setPlatformChannel(opt.key)}
                          style={{ display: 'none' }}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </Field>
                <Field label="Conversation URL *" style={{ marginTop: 12 }}>
                  <input
                    className="form-input"
                    type="url"
                    name="source_url"
                    value={form.source_url}
                    onChange={handleChange}
                    placeholder={platformChannel === 'vrbo'
                      ? 'https://www.vrbo.com/conversations/...'
                      : 'https://www.airbnb.com/messaging/...'}
                    required
                  />
                </Field>
                <Field label="Property the guest enquired about *" style={{ marginTop: 12 }}>
                  <PlatformPropertyPicker
                    value={platformPropertyId}
                    onChange={setPlatformPropertyId}
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

        {/* Stay + Context only show once the agent is locked in
            (agent path) or immediately (direct/platform). Keeps
            the agent flow strictly linear: pick agent → reveal
            the rest. */}
        {(!isAgent || agentId) && (<>
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
          {!isPlatform && (
            <Field label="Specific property (optional)" style={{ marginBottom: 12 }}>
              <PlatformPropertyPicker
                value={directPropertyId}
                onChange={setDirectPropertyId}
              />
              <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: 4 }}>
                Use this when the {isAgent ? 'agent has named' : 'guest has named'} a specific house. Pre-ticks it on the match step.
              </div>
            </Field>
          )}
          <Field label="Nationality">
            <input className="form-input" name="nationality" value={form.nationality} onChange={handleChange} placeholder="e.g. UK" />
          </Field>

          {/* Budget — channel-aware price tier chips. Channel is
              implied by the source the user already picked (Direct /
              Agent / Platform) so the R-ranges shown on each chip
              reflect what the guest pays in THAT scenario, not the
              owner-side baseline. Same component the global search
              modal uses — one filter pipeline, no parallel logic. */}
          <Field label="Budget" style={{ marginTop: 12 }}>
            <PriceBucketFilter
              channel={isAgent ? 'agent' : isPlatform ? 'platform' : 'direct'}
              value={form.budget_tiers}
              onChange={(tiers) => setForm(prev => ({ ...prev, budget_tiers: tiers }))}
            />
          </Field>

          <Field label="Notes" style={{ marginTop: 12 }}>
            <textarea className="form-input" name="notes" rows={3} value={form.notes} onChange={handleChange} placeholder="Anything else worth knowing. Special requests, source of lead, etc." />
          </Field>
        </Section>
        </>)}
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


function Field({ label, children, style }: { label: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="form-group" style={style}>
      <label className="form-label">{label}</label>
      {children}
    </div>
  );
}

/** Inline searchable property picker for platform enquiries.
 *
 *  Hayley picks the property the Airbnb conversation is about right
 *  on the new-enquiry form so save can auto-attach a draft proposal
 *  for it and the deal modal can surface a direct "Open on Airbnb"
 *  link. Single-select; typeahead filters by property_name +
 *  suburb. Shows the picked property's airbnb_url inline as a
 *  clickable chip so the team can hop straight to the listing.
 *
 *  Fetches the active (published, non-archived) portfolio once on
 *  mount; ~60 rows in prod, so the in-memory filter is fine. */
interface PlatformPropertyRow {
  id: string;
  property_name: string;
  suburb: string | null;
  airbnb_url: string | null;
}

function PlatformPropertyPicker({
  value, onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { supabase } = useAuth();
  const [rows, setRows] = useState<PlatformPropertyRow[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('partner_properties')
        .select('id, property_name, suburb, listing_urls')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .eq('is_published', true)
        .eq('is_archived', false)
        .order('property_name', { ascending: true });
      if (cancelled || error) return;
      const mapped: PlatformPropertyRow[] = (data || []).map((r: any) => ({
        id: r.id,
        property_name: r.property_name || '',
        suburb: r.suburb || null,
        airbnb_url: (r.listing_urls && typeof r.listing_urls === 'object' && typeof r.listing_urls.airbnb === 'string')
          ? (r.listing_urls.airbnb.trim() || null)
          : null,
      }));
      setRows(mapped);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  const picked = value ? rows.find(r => r.id === value) || null : null;
  const lowerQ = query.trim().toLowerCase();
  const filtered = lowerQ
    ? rows.filter(r =>
        r.property_name.toLowerCase().includes(lowerQ)
        || (r.suburb || '').toLowerCase().includes(lowerQ))
    : rows;

  // Picked state — show name + (optional) Airbnb chip + clear button.
  if (picked) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        background: 'var(--color-primary-bg)',
        border: '1px solid var(--color-primary)',
        borderRadius: 'var(--radius-sm)',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-primary)' }}>
            {picked.property_name}
            {picked.suburb && (
              <span style={{ color: 'var(--text-secondary)', fontWeight: 400, marginLeft: 8 }}>
                · {picked.suburb}
              </span>
            )}
          </div>
        </div>
        {picked.airbnb_url && (
          <a
            href={picked.airbnb_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline"
            style={{ fontSize: '0.75rem', padding: '4px 10px', textDecoration: 'none' }}
            title="Open this listing on Airbnb in a new tab"
          >
            🔗 Airbnb
          </a>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: '0.75rem', padding: '4px 8px' }}
          onClick={() => { onChange(null); setQuery(''); }}
        >
          Change
        </button>
      </div>
    );
  }

  // Picker state — text input + dropdown of matches.
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="form-input"
        type="search"
        // Chrome ignores autoComplete="off" on address-shaped inputs.
        // The reliable trick is to use autoComplete="new-password" —
        // Chrome treats it as "the user is creating a new password"
        // and skips its address/contact autofill suggestions.
        // Combined with a non-standard name, this kills the dropdown.
        name="ctr-property-search-1eb2"
        autoComplete="new-password"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-form-type="other"
        data-lpignore="true"
        data-1p-ignore="true"
        role="combobox"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder="Type a property name or suburb"
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          right: 0,
          maxHeight: 260,
          overflowY: 'auto',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          boxShadow: 'var(--shadow-md)',
          zIndex: 30,
        }}>
          {filtered.slice(0, 50).map(r => (
            <button
              key={r.id}
              type="button"
              onMouseDown={(e) => {
                // Use onMouseDown not onClick so we beat the input's
                // onBlur — clicking a row would otherwise close the
                // dropdown before the pick registered.
                e.preventDefault();
                onChange(r.id);
                setQuery('');
                setOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '8px 12px',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--border-light)',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
                fontSize: '0.875rem',
                color: 'var(--text)',
              }}
            >
              <span style={{ fontWeight: 500 }}>
                {r.property_name}
                {r.suburb && (
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 400, marginLeft: 8 }}>
                    · {r.suburb}
                  </span>
                )}
              </span>
              {r.airbnb_url && (
                <span style={{
                  fontSize: '0.625rem',
                  fontWeight: 600,
                  color: 'var(--color-primary)',
                  background: 'var(--color-primary-bg)',
                  padding: '1px 6px',
                  borderRadius: 4,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}>
                  Airbnb URL on file
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          right: 0,
          padding: '10px 12px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-secondary)',
          fontSize: '0.8125rem',
          fontStyle: 'italic',
        }}>
          No properties match.
        </div>
      )}
    </div>
  );
}


