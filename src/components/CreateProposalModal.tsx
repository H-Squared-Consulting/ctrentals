/**
 * CreateProposalModal -- Capture guest details + commit a sendable proposal.
 *
 * One-step flow: opens with a calculated pricing snapshot in hand, asks for
 * guest details, then inserts BOTH a pricing_proposals row (the immutable
 * pricing record) AND a proposals row (the sendable artefact, with ref code).
 * The proposals row's pricing_proposal_id FK links them.
 *
 * After this, the proposal is visible in:
 *   - Property Editor → Proposals tab (reads from `proposals`)
 *   - Operations → Proposals (reads from `proposals`, joined to pricing_proposals
 *     for the per-night price)
 */

import { useEffect, useState } from 'react';
import ActionModal from './ActionModal';
import { useToast } from './ToastProvider';
import { CT_RENTALS_PARTNER_ID } from '../pages/constants';
import { fmtRand } from '../lib/pricingEngine';
import { nightsBetween } from '../lib/nights';
import { notifyPipelineChanged } from '../lib/pipelineEvents';
import { syncEnquiryFromProposal } from '../lib/statusSync';
import { nextProposalRefCodeFor } from '../lib/refCodes';
import type { PricingSnapshot } from './PricingDashboard';

interface GuestRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

/** Pre-fill data sourced from an enquiry record so the recipient form doesn't
 *  start blank when the proposal is created in response to a guest enquiry. */
export interface EnquiryPrefill {
  id: string;
  /** Parent enquiry's ref_code. Drives the new proposal's ref_code
   *  format — direct enquiries (D###) produce PD####N children;
   *  legacy formats fall through to the old CTR-… generator. */
  ref_code?: string | null;
  /** 1-line summary the user writes at capture so the enquiry is
   *  distinguishable on the kanban (e.g. "Family of 6, Constantia
   *  Easter"). Used as the deal card headline. */
  subject?: string | null;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  check_in: string | null;
  check_out: string | null;
  guests_total: number | null;
  notes: string | null;
  /** Agent-on-behalf enquiry flag + the disclosed-guest fields. When the
   *  enquiry is from an agent and the underlying guest hasn't been
   *  disclosed yet, guest_name will be null and we fall back to a
   *  "Valued Guest" placeholder on the proposal — keeps the proposal
   *  forwardable without baking the agent's identity into the greeting. */
  is_agent?: boolean;
  /** Set on agent-on-behalf enquiries — pre-selects this agent in the
   *  PricingDashboard's agent dropdown so the user doesn't have to
   *  re-pick the same person they already saved on the enquiry. */
  agent_id?: string | null;
  guest_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
}

interface CreateProposalModalProps {
  /** Pricing snapshot from the widget — has not yet been persisted. */
  snapshot: PricingSnapshot;
  property: { id: string; property_name: string };
  supabase: any;
  onClose: () => void;
  onCreated: (refCode: string) => void;
  /** Optional enquiry to pre-fill recipient + dates and link via enquiry_id. */
  enquiryPrefill?: EnquiryPrefill | null;
}

function generateRefCode() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `CTR-${date}-${rand}`;
}

export default function CreateProposalModal({
  snapshot,
  property,
  supabase,
  onClose,
  onCreated,
  enquiryPrefill,
}: CreateProposalModalProps) {
  const toast = useToast();

  // Agent scenario: pre-fill recipient details from Settings → Agents.
  // The "guest" on an agent proposal is really the agent who'll forward it.
  // A *specific* agent (agentContact set) overrides any enquiry-side
  // recipient details — the agent IS the recipient on these proposals,
  // not the guest the enquiry came from. A generic agent rate (no
  // agentContact) falls back to the enquiry's details so a manually-
  // entered "test"-style enquiry's recipient still seeds the form.
  const agentPrefill = snapshot.scenarioType === 'agent' ? snapshot.agentContact : null;

  // Agent-on-behalf enquiry without a disclosed underlying guest: the
  // proposal page's "Dear X," greeting can't be the agent's name (the
  // agent will forward this to their guest). Default to a "Guest"
  // placeholder so the public page reads "Dear Guest," — generic and
  // forwardable. Once the agent shares the actual guest later, the
  // cascade helper updates the proposal's guest_name in place.
  const isAgentEnquiryNoGuest = !!enquiryPrefill?.is_agent && !enquiryPrefill?.guest_name;
  const initialName = isAgentEnquiryNoGuest
    ? 'Guest'
    : (enquiryPrefill?.guest_name || agentPrefill?.name || enquiryPrefill?.client_name || '');
  // Recipient email/phone always go to whoever we actually send to. For
  // agent enquiries that's the agent (client_*); for direct it's the
  // guest (client_* mirrors guest_*).
  const initialEmail = enquiryPrefill?.is_agent
    ? (enquiryPrefill?.client_email || agentPrefill?.email || '')
    : (agentPrefill?.email || enquiryPrefill?.client_email || '');
  const initialPhone = enquiryPrefill?.is_agent
    ? (enquiryPrefill?.client_phone || agentPrefill?.phone || '')
    : (agentPrefill?.phone || enquiryPrefill?.client_phone || '');

  const [guestName, setGuestName] = useState(initialName);
  const [guestEmail, setGuestEmail] = useState(initialEmail);
  const [guestPhone, setGuestPhone] = useState(initialPhone);
  const [guestsTotal, setGuestsTotal] = useState(enquiryPrefill?.guests_total ? String(enquiryPrefill.guests_total) : '');
  const [checkIn, setCheckIn] = useState(enquiryPrefill?.check_in || '');
  const [checkOut, setCheckOut] = useState(enquiryPrefill?.check_out || '');
  const [isAgent, setIsAgent] = useState(snapshot.scenarioType === 'agent');
  const [notes, setNotes] = useState(enquiryPrefill?.notes || '');
  const [saving, setSaving] = useState(false);
  // Two-step wizard: 'details' collects guest info first (incl. optional
  // dates/guests), then 'review' confirms the pricing as the final pre-send
  // gate — with stay total (per-night × nights) computed once dates are set
  // so the user signs off on the actual stay cost, not just the per-night.
  const [step, setStep] = useState<'details' | 'review'>('details');

  // ── Guest lookup state ──
  // selectedGuest is set once the user picks an existing guest (via search
  // or via the email-blur dedupe prompt). When set, the name/email/phone
  // fields lock and the proposal links to that guest on save. Empty =
  // creating a new guest from whatever's in the fields.
  const [selectedGuest, setSelectedGuest] = useState<GuestRow | null>(null);
  const [guestSearch, setGuestSearch] = useState('');
  const [guestMatches, setGuestMatches] = useState<GuestRow[]>([]);
  const [emailMatch, setEmailMatch] = useState<GuestRow | null>(null);
  const isLocked = selectedGuest != null;

  // Debounced search of the guests table by name or email.
  useEffect(() => {
    if (isLocked) { setGuestMatches([]); return; }
    const q = guestSearch.trim();
    if (q.length < 2) { setGuestMatches([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('guests')
        .select('id, name, email, phone')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
        .order('name')
        .limit(8);
      if (!cancelled) setGuestMatches((data as GuestRow[]) || []);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [guestSearch, supabase, isLocked]);

  function applyGuest(g: GuestRow) {
    setSelectedGuest(g);
    setGuestName(g.name);
    setGuestEmail(g.email || '');
    setGuestPhone(g.phone || '');
    setGuestSearch('');
    setGuestMatches([]);
    setEmailMatch(null);
  }

  function switchGuest() {
    setSelectedGuest(null);
    setEmailMatch(null);
  }

  // On email blur (only when not already linked to a guest), check the
  // guests table for an exact match and offer to link rather than create
  // a duplicate. Belt-and-braces — a DB unique constraint on
  // (partner_id, lower(email)) should follow in a schema PR with Jordon.
  async function onEmailBlur() {
    if (isLocked) return;
    const e = guestEmail.trim().toLowerCase();
    if (!e) { setEmailMatch(null); return; }
    const { data } = await supabase
      .from('guests')
      .select('id, name, email, phone')
      .eq('partner_id', CT_RENTALS_PARTNER_ID)
      .ilike('email', e)
      .limit(1);
    if (data && data.length > 0) setEmailMatch(data[0] as GuestRow);
    else setEmailMatch(null);
  }

  async function handleSubmit() {
    if (saving) return;
    if (!guestName.trim()) { toast.warning('Recipient name is required'); return; }
    // Dates are optional, but if one is given the other must be too,
    // and check-out must follow check-in.
    if ((checkIn && !checkOut) || (!checkIn && checkOut)) {
      toast.warning('Enter both check-in and check-out, or leave both blank');
      return;
    }
    if (checkIn && checkOut && checkIn >= checkOut) {
      toast.warning('Check-out must be after check-in');
      return;
    }

    setSaving(true);
    try {
      // 0) Resolve the guest_id — link to existing or create a new row.
      // Priority:
      //   a. User explicitly picked one via the search/email-match UI.
      //   b. The entered email already matches a row (silent dedupe — the
      //      partial UNIQUE index would reject the insert otherwise, and
      //      the user shouldn't have to read a warning to avoid an error).
      //   c. Insert a new guests row.
      let guestId: string | null = selectedGuest?.id ?? null;
      const emailNormalized = guestEmail.trim().toLowerCase();
      if (!guestId && emailNormalized) {
        const { data: existing } = await supabase
          .from('guests')
          .select('id')
          .eq('partner_id', CT_RENTALS_PARTNER_ID)
          .ilike('email', emailNormalized)
          .limit(1)
          .maybeSingle();
        if (existing?.id) guestId = existing.id;
      }
      if (!guestId) {
        const guestInsert = await supabase
          .from('guests')
          .insert({
            partner_id: CT_RENTALS_PARTNER_ID,
            name: guestName.trim(),
            email: guestEmail.trim() || null,
            phone: guestPhone.trim() || null,
            status: 'lead',
          })
          .select('id')
          .single();
        if (guestInsert.error) throw guestInsert.error;
        guestId = guestInsert.data.id;
      }

      // 1) Persist the pricing snapshot first so we have an ID to link.
      const b = snapshot.breakdown;
      const pricingPayload = {
        property_id: snapshot.propertyId,
        scenario_type: snapshot.scenarioType,
        agent_id: snapshot.agentId,
        agents: snapshot.agents.map(a => ({ id: a.id, pct: a.pct })),
        channel_profile_id: snapshot.channelId,
        baseline_used: snapshot.baseline,
        baseline_mode: 'daily' as const,
        commission_pct: snapshot.totalMarginPct,
        reduced_baseline: snapshot.reducedBaseline,
        reduced_commission_pct: snapshot.reducedCtrPct !== null || snapshot.reducedAgentPct !== null
          ? (snapshot.reducedCtrPct ?? snapshot.ctrPct) + (snapshot.reducedAgentPct ?? snapshot.agentPct)
          : null,
        season_tag: snapshot.seasonTag,
        season_multiplier: snapshot.seasonMultiplier,
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
      const pricingRes = await supabase
        .from('pricing_proposals')
        .insert(pricingPayload)
        .select('id')
        .single();
      if (pricingRes.error) throw pricingRes.error;
      const pricingProposalId = pricingRes.data.id;

      // 2) Create the sendable proposal linked to that snapshot.
      //    Direct-enquiry parents (Dxxx) get PDxxxxN children — one
      //    sequence per parent. Other parents (agent legacy ENQ-…,
      //    standalone) keep the old CTR-YYYYMMDD-XXXX format until
      //    those streams migrate.
      const refCode =
        (await nextProposalRefCodeFor(supabase, enquiryPrefill?.ref_code)) ??
        generateRefCode();
      const proposalPayload = {
        ref_code: refCode,
        partner_id: CT_RENTALS_PARTNER_ID,
        enquiry_id: enquiryPrefill?.id || null,
        property_id: property.id,
        pricing_proposal_id: pricingProposalId,
        // Link to the resolved guest record. Snapshot fields below stay
        // populated so older readers + historical accuracy don't break
        // when the guest record is later edited.
        guest_id: guestId,
        guest_name: guestName.trim(),
        guest_email: guestEmail.trim() || null,
        guest_phone: guestPhone.trim() || null,
        guests_total: guestsTotal.trim() ? Number(guestsTotal) : null,
        check_in: checkIn || null,
        check_out: checkOut || null,
        status: 'drafting' as const,
        is_agent: isAgent,
        notes: notes.trim() || null,
      };
      const propRes = await supabase.from('proposals').insert(proposalPayload).select('id').single();
      if (propRes.error) throw propRes.error;
      const newProposalId = propRes.data.id;

      // Mirror the new proposal's status onto the enquiry's deal_status
      // (1:1 case only). If this is a second proposal on the same enquiry,
      // syncEnquiryFromProposal sees count > 1 and no-ops.
      if (newProposalId) {
        await syncEnquiryFromProposal(supabase, newProposalId, 'drafting');
      }

      notifyPipelineChanged();
      toast.success(`Proposal ${refCode} created`);
      onCreated(refCode);
    } catch (err: any) {
      console.error('CreateProposalModal error:', err);
      toast.error('Failed to create proposal: ' + (err?.message || String(err)));
    } finally {
      setSaving(false);
    }
  }

  const guestPrice = snapshot.breakdown.clientPriceExclVat;

  const b = snapshot.breakdown;

  const propertyName = titleCase(property.property_name);
  const stepNum = step === 'details' ? 1 : 2;
  const stepTitle = step === 'details' ? 'Recipient details' : 'Review pricing';

  // Stay total — only meaningful when both dates are provided. If either
  // is empty (agent quote with no dates) we show per-night only.
  const stayNights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : null;
  const stayTotal = stayNights && stayNights > 0 ? guestPrice * stayNights : null;

  return (
    <ActionModal
      title={`${stepTitle}`}
      subtitle={<>Step {stepNum} of 2 · {propertyName}</>}
      width={620}
      onClose={onClose}
      secondaryActions={step === 'review' ? (
        <button className="btn btn-ghost" onClick={() => setStep('details')}>← Back</button>
      ) : null}
      primaryAction={step === 'details' ? (
        <button
          className="btn btn-primary"
          onClick={() => setStep('review')}
          disabled={!guestName.trim()}
        >
          Continue →
        </button>
      ) : (
        <button
          className="btn btn-primary"
          onClick={handleSubmit}
          disabled={saving || !guestName.trim()}
        >
          {saving ? 'Creating…' : 'Create Proposal'}
        </button>
      )}
    >
      {step === 'review' && (
        <>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: 14 }}>
            Confirm the pricing below. The proposal will save with these numbers. You can edit them later from Operations.
          </div>

          <div className="pricing-price-block" style={{ marginBottom: 14 }}>
            <div className="pricing-price-label">Guest pays</div>
            <div className="pricing-price-value">{fmtRand(guestPrice)}</div>
            <div className="pricing-price-sublabel">
              per night{snapshot.seasonTag ? ` · ${snapshot.seasonTag} season (×${snapshot.seasonMultiplier})` : ''}
            </div>
            {stayNights != null && stayTotal != null && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  Stay total · {stayNights} night{stayNights !== 1 ? 's' : ''}
                </span>
                <strong style={{ fontSize: '1.125rem' }}>{fmtRand(stayTotal)}</strong>
              </div>
            )}
          </div>

          {/* When dates are known, scale the breakdown rows to stay totals
              so the user signs off on what each party actually earns over
              the stay, not per-night. Display-only — the saved pricing
              snapshot still stores per-night rates for downstream readers. */}
          {stayNights != null && stayNights > 0 && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6, textAlign: 'right' }}>
              Totals for {stayNights} night{stayNights !== 1 ? 's' : ''}
            </div>
          )}
          <div className="pricing-breakdown">
            <div className="pricing-breakdown-row">
              <span className="pricing-breakdown-label">Owner receives</span>
              <span className="pricing-breakdown-value">{fmtRand(stayNights != null && stayNights > 0 ? b.ownerNet * stayNights : b.ownerNet)}</span>
            </div>
            <div className="pricing-breakdown-row">
              <span className="pricing-breakdown-label">CTR earns</span>
              <span className="pricing-breakdown-value pricing-breakdown-value--accent">{fmtRand(stayNights != null && stayNights > 0 ? b.ctrTake * stayNights : b.ctrTake)}</span>
            </div>
            {snapshot.scenarioType === 'agent' && b.agentTake > 0 && (
              <div className="pricing-breakdown-row">
                <span className="pricing-breakdown-label">
                  Agent earns{snapshot.agentContact ? ` (${snapshot.agentContact.name})` : ''}
                </span>
                <span className="pricing-breakdown-value">{fmtRand(stayNights != null && stayNights > 0 ? b.agentTake * stayNights : b.agentTake)}</span>
              </div>
            )}
            {snapshot.scenarioType === 'platform' && b.platformFees > 0 && (
              <div className="pricing-breakdown-row pricing-breakdown-row--platform">
                <span className="pricing-breakdown-label">Platform fee</span>
                <span className="pricing-breakdown-value">{fmtRand(stayNights != null && stayNights > 0 ? b.platformFees * stayNights : b.platformFees)}</span>
              </div>
            )}
          </div>
        </>
      )}

      {step === 'details' && (
        <>
          <div style={{ padding: '10px 14px', background: 'var(--bg)', borderRadius: 6, marginBottom: 14, fontSize: '0.8125rem', display: 'flex', justifyContent: 'space-between', border: '1px solid var(--border-light)' }}>
            <span className="form-label" style={{ margin: 0 }}>Guest pays</span>
            <strong>{fmtRand(guestPrice)} / night</strong>
          </div>

          {/* Agent context panel. When the proposal scenario is "agent" we
              ALWAYS send the link to the agent — the underlying guest may
              not even be known yet. This panel makes that explicit so the
              user isn't confused about why the name field below says
              "Guest" while the email is the agent's address. */}
          {isAgent && (agentPrefill || enquiryPrefill?.client_email) && (
            <div style={{ padding: '10px 14px', marginBottom: 14, background: 'var(--info-bg, #EFF6FF)', border: '1px solid var(--info)', borderRadius: 6, fontSize: '0.8125rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="form-label" style={{ margin: 0 }}>Sending to (agent)</span>
                <strong>{agentPrefill?.name || enquiryPrefill?.client_name}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                <span>{agentPrefill?.email || enquiryPrefill?.client_email || '—'}</span>
                <span>{agentPrefill?.phone || enquiryPrefill?.client_phone || ''}</span>
              </div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-light)', marginTop: 6, fontStyle: 'italic' }}>
                The greeting below is what the proposal page shows ("Dear &lt;name&gt;,"). Default is "Guest" — the agent forwards to their guest, so a generic greeting works either way. Override when you know the guest.
              </div>
            </div>
          )}

          {/* Existing-guest lookup — sits above the editable fields so the
              user is gently nudged to link rather than re-type a known
              contact. Free-text below still works if she ignores it.
              Hidden for agent proposals: the recipient is the agent, not
              a guest, and surfacing this search just confuses the role. */}
          {!isAgent && (
          <div className="form-group">
            <label className="form-label">Existing guest? (optional)</label>
            <input
              type="text"
              className="form-input"
              value={guestSearch}
              onChange={(e) => setGuestSearch(e.target.value)}
              placeholder="🔍 Search by name or email…"
              disabled={isLocked}
            />
            {!isLocked && guestSearch.trim().length >= 2 && guestMatches.length > 0 && (
              <div style={{ marginTop: 6, border: '1px solid var(--border)', borderRadius: 6, maxHeight: 200, overflowY: 'auto', background: 'var(--surface)' }}>
                {guestMatches.map(g => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => applyGuest(g)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border-light)', cursor: 'pointer' }}
                  >
                    <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{titleCase(g.name)}</div>
                    {(g.email || g.phone) && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {g.email || ''}{g.email && g.phone ? ' · ' : ''}{g.phone || ''}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
            {!isLocked && guestSearch.trim().length >= 2 && guestMatches.length === 0 && (
              <div style={{ marginTop: 6, padding: '8px 12px', background: 'var(--bg)', borderRadius: 6, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                No matches. Fill the fields below to create a new guest.
              </div>
            )}
            {isLocked && selectedGuest && (
              <div style={{ marginTop: 6, padding: '8px 12px', background: 'var(--success-bg, var(--bg))', borderRadius: 6, fontSize: '0.8125rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span>✓ Linked to <strong>{titleCase(selectedGuest.name)}</strong></span>
                <button
                  type="button"
                  onClick={switchGuest}
                  style={{ background: 'none', border: 'none', color: 'var(--color-primary)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', padding: 0 }}
                >
                  Switch
                </button>
              </div>
            )}
          </div>
          )}

          <div className="form-group">
            <label className="form-label">
              {isAgent
                ? 'Greeting name (shown on proposal as "Dear …,") *'
                : 'Guest name *'}
            </label>
            <input
              type="text"
              className="form-input"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder={isAgent ? 'Guest (or the actual guest name if disclosed)' : 'e.g. Hayley Harrod'}
              readOnly={isLocked}
              autoFocus
            />
          </div>

          {/* Email + Phone are user-editable for direct proposals (the
              recipient IS the guest, so these are guest contact details).
              For agent proposals they're locked to the agent's contact
              and shown read-only in the "Sending to (agent)" panel above
              — exposing them again here would let the user accidentally
              overwrite the agent's address. The values still get saved
              to proposals.guest_email/phone because that's where the
              send actually goes. */}
          {!isAgent && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input
                  type="email"
                  className="form-input"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  onBlur={onEmailBlur}
                  placeholder="recipient@example.com"
                  readOnly={isLocked}
                />
                {emailMatch && !isLocked && (
                  <div style={{ marginTop: 6, padding: '8px 10px', background: 'var(--warning-bg)', borderRadius: 6, fontSize: '0.8125rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>Email matches <strong>{titleCase(emailMatch.name)}</strong>.</span>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button type="button" className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => applyGuest(emailMatch)}>Link</button>
                      <button type="button" className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => setEmailMatch(null)}>Use anyway</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input
                  type="tel"
                  className="form-input"
                  value={guestPhone}
                  onChange={(e) => setGuestPhone(e.target.value)}
                  placeholder="+27 …"
                  readOnly={isLocked}
                />
              </div>
            </div>
          )}

          <div style={{ fontSize: '0.625rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginTop: 8, marginBottom: 6 }}>
            Optional. Only fill in if the recipient has dates or guest count in mind.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Check-in</label>
              <input type="date" className="form-input" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Check-out</label>
              <input type="date" className="form-input" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Guests</label>
              <input type="number" className="form-input" value={guestsTotal} onChange={(e) => setGuestsTotal(e.target.value)} min={1} step={1} placeholder="—" />
            </div>
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', cursor: 'pointer', fontWeight: 500 }}>
              <input type="checkbox" checked={isAgent} onChange={(e) => setIsAgent(e.target.checked)} />
              Sending to an agent (removes Southern Escapes branding)
            </label>
          </div>

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea
              className="form-input"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional internal note"
            />
          </div>
        </>
      )}
    </ActionModal>
  );
}
