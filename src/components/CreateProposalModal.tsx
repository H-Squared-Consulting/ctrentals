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

import { useState } from 'react';
import { useToast } from './ToastProvider';
import { CT_RENTALS_PARTNER_ID } from '../pages/constants';
import { fmtRand } from '../lib/pricingEngine';
import { notifyPipelineChanged } from '../lib/pipelineEvents';
import type { PricingSnapshot } from './PricingWidget';

/** Pre-fill data sourced from an enquiry record so the recipient form doesn't
 *  start blank when the proposal is created in response to a guest enquiry. */
export interface EnquiryPrefill {
  id: string;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  check_in: string | null;
  check_out: string | null;
  guests_total: number | null;
  notes: string | null;
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
  const agentPrefill = snapshot.scenarioType === 'agent' ? snapshot.agentContact : null;

  // Enquiry pre-fill takes precedence over agent contact when both exist
  // (an agent-scenario proposal raised against an enquiry uses the
  // enquiry's recipient details; the agent's contact still seeds the
  // calculator's agent selection upstream).
  const initialName = enquiryPrefill?.client_name || agentPrefill?.name || '';
  const initialEmail = enquiryPrefill?.client_email || agentPrefill?.email || '';
  const initialPhone = enquiryPrefill?.client_phone || '';

  const [guestName, setGuestName] = useState(initialName);
  const [guestEmail, setGuestEmail] = useState(initialEmail);
  const [guestPhone, setGuestPhone] = useState(initialPhone);
  const [guestsTotal, setGuestsTotal] = useState(enquiryPrefill?.guests_total ? String(enquiryPrefill.guests_total) : '');
  const [checkIn, setCheckIn] = useState(enquiryPrefill?.check_in || '');
  const [checkOut, setCheckOut] = useState(enquiryPrefill?.check_out || '');
  const [isAgent, setIsAgent] = useState(snapshot.scenarioType === 'agent');
  const [notes, setNotes] = useState(enquiryPrefill?.notes || '');
  const [saving, setSaving] = useState(false);
  // Two-step wizard: 'review' shows the pricing for confirmation; 'details'
  // collects guest info. The ladies need a visual breakpoint between "I've
  // calculated this" and "I'm committing to a sendable proposal."
  const [step, setStep] = useState<'review' | 'details'>('review');

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
      const refCode = generateRefCode();
      const proposalPayload = {
        ref_code: refCode,
        partner_id: CT_RENTALS_PARTNER_ID,
        enquiry_id: enquiryPrefill?.id || null,
        property_id: property.id,
        pricing_proposal_id: pricingProposalId,
        guest_name: guestName.trim(),
        guest_email: guestEmail.trim() || null,
        guest_phone: guestPhone.trim() || null,
        guests_total: guestsTotal.trim() ? Number(guestsTotal) : null,
        check_in: checkIn || null,
        check_out: checkOut || null,
        status: 'draft' as const,
        is_agent: isAgent,
        notes: notes.trim() || null,
      };
      const propRes = await supabase.from('proposals').insert(proposalPayload);
      if (propRes.error) throw propRes.error;

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px' }}>
        <div className="modal-header">
          <h2 className="modal-title">
            {step === 'review' ? 'Review Pricing' : 'Recipient Details'} — {property.property_name}
          </h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body">
          {step === 'review' && (
            <>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                Confirm the pricing below. The proposal will save with these numbers — you can edit them later from Operations → Pipeline.
              </div>

              <div className="pricing-price-block" style={{ marginBottom: '14px' }}>
                <div className="pricing-price-label">Guest pays</div>
                <div className="pricing-price-value">{fmtRand(guestPrice)}</div>
                <div className="pricing-price-sublabel">
                  per night{snapshot.seasonTag ? ` · ${snapshot.seasonTag} season (×${snapshot.seasonMultiplier})` : ''}
                </div>
              </div>

              <div className="pricing-breakdown">
                <div className="pricing-breakdown-row">
                  <span className="pricing-breakdown-label">Owner receives</span>
                  <span className="pricing-breakdown-value">{fmtRand(b.ownerNet)}</span>
                </div>
                <div className="pricing-breakdown-row">
                  <span className="pricing-breakdown-label">CTR earns</span>
                  <span className="pricing-breakdown-value pricing-breakdown-value--accent">{fmtRand(b.ctrTake)}</span>
                </div>
                {snapshot.scenarioType === 'agent' && b.agentTake > 0 && (
                  <div className="pricing-breakdown-row">
                    <span className="pricing-breakdown-label">
                      Agent earns{snapshot.agentContact ? ` (${snapshot.agentContact.name})` : ''}
                    </span>
                    <span className="pricing-breakdown-value">{fmtRand(b.agentTake)}</span>
                  </div>
                )}
                {snapshot.scenarioType === 'platform' && b.platformFees > 0 && (
                  <div className="pricing-breakdown-row pricing-breakdown-row--platform">
                    <span className="pricing-breakdown-label">Platform fee</span>
                    <span className="pricing-breakdown-value">{fmtRand(b.platformFees)}</span>
                  </div>
                )}
              </div>
            </>
          )}

          {step === 'details' && (
            <>
              {/* Compact pricing reminder so the user knows what they're committing to */}
              <div style={{ padding: '10px 14px', background: 'var(--border-light)', borderRadius: 'var(--radius-sm)', marginBottom: '16px', fontSize: '0.8125rem', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Guest pays</span>
                <strong>{fmtRand(guestPrice)} / night</strong>
              </div>

              <div className="form-group">
                <label className="form-label">{isAgent ? 'Agent name' : 'Guest name'} *</label>
                <input
                  type="text"
                  className="form-input"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder={isAgent ? 'e.g. Anneline Klaase' : 'e.g. Hayley Harrod'}
                  autoFocus
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input
                    type="email"
                    className="form-input"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    placeholder="recipient@example.com"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input
                    type="tel"
                    className="form-input"
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value)}
                    placeholder="+27 …"
                  />
                </div>
              </div>

              <div style={{ fontSize: '0.6875rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                Optional — only fill in if the recipient has dates / guest count in mind
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
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
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={isAgent} onChange={(e) => setIsAgent(e.target.checked)} />
                  Sending to an agent (removes CT Rentals branding)
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
        </div>

        <div className="modal-footer">
          {step === 'review' ? (
            <>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <div style={{ flex: 1 }} />
              <button className="btn btn-primary" onClick={() => setStep('details')}>
                Continue →
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={() => setStep('review')}>← Back</button>
              <div style={{ flex: 1 }} />
              <button
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={saving || !guestName.trim()}
              >
                {saving ? 'Creating…' : 'Create Proposal'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
