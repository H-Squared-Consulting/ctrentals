/**
 * ProposalDetailModal -- self-contained proposal viewer + actions.
 *
 * Mounted from Operations → Proposals and the Property Editor's Proposals
 * tab. Shows: guest/agent info, pricing breakdown (when a pricing_proposal
 * is linked), timeline, the public ref link, and quick-actions for sharing.
 *
 * Host is responsible for:
 *   - providing the proposal data (already loaded with pricing join)
 *   - reacting to onChange after a status mutation (refetch its list)
 *   - opening the calculator in edit mode when the user clicks Edit Pricing
 */

import { useEffect, useState } from 'react';
import DetailModal, { DetailModalSection } from './DetailModal';
import NightCount from './NightCount';
import { fmtRand } from '../lib/pricingEngine';
import { nightsBetween } from '../lib/nights';

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

const STATUS_ACCENT: Record<string, string> = {
  draft: 'var(--text-light)',
  drafting: 'var(--text-light)',
  ready: 'var(--warning)',
  sent: 'var(--info)',
  viewed: 'var(--info)',
  interested: 'var(--success)',
  accepted: 'var(--success)',
  booked: 'var(--success)',
  declined: 'var(--text-light)',
  expired: 'var(--text-light)',
  archived: 'var(--text-light)',
  cancelled: 'var(--text-light)',
};

const STATUS_PILL_KEY: Record<string, string> = {
  draft: 'drafting', drafting: 'drafting', ready: 'ready',
  sent: 'sent', viewed: 'sent', interested: 'sent',
  accepted: 'accepted', booked: 'accepted',
  declined: 'declined', expired: 'declined', archived: 'declined', cancelled: 'declined',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Drafting', drafting: 'Drafting', ready: 'Ready',
  sent: 'Sent', viewed: 'Sent', interested: 'Sent',
  accepted: 'Accepted', booked: 'Accepted',
  declined: 'Declined', expired: 'Declined', archived: 'Declined', cancelled: 'Declined',
};

export interface ProposalForDetail {
  id: string;
  ref_code: string;
  property_id: string;
  property_name?: string;
  pricing_proposal_id: string | null;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  check_in: string | null;
  check_out: string | null;
  guests_total: number | null;
  status: string;
  is_agent: boolean;
  sent_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
  created_at: string;
  notes: string | null;
  /** Parent enquiry's id + ref_code (from a join). Standalone proposals
   *  raised without an enquiry have both null. Used to render a clickable
   *  "From enquiry ENQ-…" handle in the subtitle that navigates to the
   *  Proposals page filtered to this enquiry's siblings. */
  enquiry_id?: string | null;
  enquiry_ref_code?: string | null;
  /** From a pricing_proposals join — may be absent when no snapshot linked. */
  guest_price?: number | null;
  scenario_type?: string | null;
  season_tag?: string | null;
  owner_net?: number | null;
  company_take?: number | null;
  /** Multi-agent split stored on pricing_proposals.agents. Each entry is
   *  the agent id + their commission % used for this proposal. */
  agents?: Array<{ id: string; pct: number }> | null;
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

function fmtDateLong(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const BRAND_DOMAIN = (import.meta as any).env?.VITE_BRAND_DOMAIN || 'southernescapes.co.za';

function proposalUrl(refCode: string) {
  return `https://${BRAND_DOMAIN}/proposal.html?ref=${refCode}`;
}

interface ProposalDetailModalProps {
  proposal: ProposalForDetail;
  supabase: any;
  onClose: () => void;
  /** Called after any mutation (status change) so the host can refetch. */
  onChange?: () => void;
  /** Opens the calculator pre-filled with this proposal's pricing snapshot.
   *  Only shown in pre-send states (drafting/ready). Hidden once Sent. */
  onEditPricing?: () => void;
  /** Continue button — opens the host's Send flow (SendProposalDialog).
   *  Only shown in pre-send states. Hidden once Sent. */
  onSend?: () => void;
  /** Accept / Decline — only shown once the proposal is Sent. The host
   *  is responsible for writing the new status and syncing the enquiry. */
  onAccept?: () => void;
  onDecline?: () => void;
  /** When set, the Accept button is disabled with this string as the
   *  hover hint. Used for agent enquiries with no disclosed guest —
   *  accepting without a guest leaves the booking un-attributable. */
  acceptDisabledReason?: string | null;
  /** Click handler for the "From enquiry ENQ-…" subtitle link. Hosts wire
   *  this to navigate to the Proposals page filtered to this enquiry's
   *  siblings (?enquiry=<id>). Omitted on standalone proposals. */
  onOpenEnquiry?: (enquiryId: string) => void;
}

export default function ProposalDetailModal({
  proposal,
  supabase,
  onClose,
  onChange: _onChange,
  onEditPricing,
  onSend,
  onAccept,
  onDecline,
  acceptDisabledReason,
  onOpenEnquiry,
}: ProposalDetailModalProps) {

  // Resolve agent ids → names so the breakdown can show each agent by
  // name rather than just their pct. JSONB on pricing_proposals only
  // stores { id, pct }; the names live on the `agents` table. One small
  // lookup per modal open keeps things simple.
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!proposal.agents || proposal.agents.length === 0) return;
    let cancelled = false;
    (async () => {
      const ids = proposal.agents!.map(a => a.id).filter(Boolean);
      if (!ids.length) return;
      const { data } = await supabase.from('agents').select('id,name').in('id', ids);
      if (!cancelled && data) {
        const map: Record<string, string> = {};
        for (const row of data) map[row.id] = row.name;
        setAgentNames(map);
      }
    })();
    return () => { cancelled = true; };
  }, [proposal.agents, supabase]);

  // Derive per-line pricing splits when a snapshot is linked.
  const ownerNet = proposal.owner_net != null ? Math.round(Number(proposal.owner_net)) : null;
  const ctrTake = proposal.company_take != null ? Math.round(Number(proposal.company_take)) : null;
  const guestPrice = proposal.guest_price != null ? Math.round(Number(proposal.guest_price)) : null;
  const agentTake = guestPrice != null && ownerNet != null && ctrTake != null
    ? guestPrice - ownerNet - ctrTake
    : null;

  const guestName = titleCase(proposal.guest_name);
  const propertyName = titleCase(proposal.property_name || '');
  const statusLabel = STATUS_LABEL[proposal.status] ?? proposal.status;
  const statusPillKey = STATUS_PILL_KEY[proposal.status] ?? 'sent';
  const accent = STATUS_ACCENT[proposal.status] ?? 'var(--text-light)';

  const subtitle = (
    <>
      <span className={`ops-status-pill ops-status-pill--${statusPillKey}`}>
        <span className="ops-status-pill-dot" />
        {statusLabel}
      </span>
      {propertyName && <span>· {propertyName}</span>}
      {proposal.check_in && proposal.check_out && (
        <span>· {fmtDate(proposal.check_in)} to {fmtDate(proposal.check_out)}<NightCount checkIn={proposal.check_in} checkOut={proposal.check_out} /></span>
      )}
      {proposal.enquiry_ref_code && proposal.enquiry_id && onOpenEnquiry && (
        // Click handle to jump to all proposals raised under the same
        // enquiry. Standalone proposals (no enquiry_id) skip this entirely.
        <span>
          · From{' '}
          <button
            type="button"
            className="ops-board-card-tag ops-board-card-tag--clickable"
            onClick={() => onOpenEnquiry(proposal.enquiry_id!)}
            title="Show all proposals from this enquiry"
          >
            {proposal.enquiry_ref_code} →
          </button>
        </span>
      )}
      {proposal.is_agent && <span className="ops-board-card-tag ops-board-card-tag--agent">Agent</span>}
    </>
  );

  // Footer changes shape based on the proposal's lifecycle stage. Once
  // Sent the user can mark the outcome (Accepted / Declined). Pre-send
  // (draft/drafting/ready) is now a pure VIEW screen — Edit Pricing
  // and Continue (Send) both live on the deal modal's proposal row so
  // the user has one canonical place to act from, and this detail
  // page reads cleanly as "here's what I've drafted so far". Closed
  // states (accepted/declined) also show no footer actions.
  const isSent = proposal.status === 'sent' || proposal.status === 'viewed' || proposal.status === 'interested';

  const footer = (
    <>
      {isSent && onDecline && (
        // Red danger styling so the destructive outcome reads
        // distinctly from Accept (was grey from STATUS_ACCENT.declined,
        // which made the two buttons look near-identical and the user
        // couldn't tell them apart at a glance).
        <button
          className="btn btn-outline-danger"
          onClick={onDecline}
        >
          ✕ Mark Declined
        </button>
      )}
      {isSent && onAccept && (
        // Same idea — green Accepted accent makes the action's outcome
        // unambiguous before the user commits. When the parent enquiry
        // hasn't met the prerequisites for accepting (agent enquiry +
        // no disclosed guest) we keep the click handler live and let
        // the host show a friendlier explainer; disabling the button
        // silently swallowed the click and left the user stuck.
        <button
          className="btn"
          style={{
            background: STATUS_ACCENT.accepted,
            color: '#fff', border: 'none',
            opacity: acceptDisabledReason ? 0.6 : 1,
          }}
          onClick={onAccept}
          title={acceptDisabledReason || undefined}
        >
          ✓ Mark Accepted
        </button>
      )}
    </>
  );

  return (
    <DetailModal
      title={guestName || propertyName || 'Proposal'}
      subtitle={subtitle}
      accentColour={accent}
      canEdit={false}
      footerActions={footer}
      onClose={onClose}
    >
      <DetailModalSection heading="Recipient">
        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label">Email</label>
            <div style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{(proposal.guest_email || '—').toLowerCase()}</div>
          </div>
          <div className="form-group">
            <label className="form-label">Phone</label>
            <div style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{proposal.guest_phone || '—'}</div>
          </div>
          <div className="form-group">
            <label className="form-label">Guests</label>
            <div style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{proposal.guests_total ?? '—'}</div>
          </div>
          <div className="form-group">
            <label className="form-label">Ref</label>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem', fontWeight: 500 }}>{proposal.ref_code}</div>
          </div>
        </div>
      </DetailModalSection>

      <DetailModalSection
        heading="Pricing"
        headingRight={
          guestPrice != null && (proposal.scenario_type || proposal.season_tag)
            ? <>{proposal.scenario_type}{proposal.season_tag ? ` · ${proposal.season_tag}` : ''}</>
            : null
        }
      >
        {guestPrice != null ? (() => {
          // Stay totals — mirrors the CreateProposalModal Step 2 review
          // panel so the user sees per-night and the full stay total
          // (per-night × nights) side by side once dates are set. Breakdown
          // rows scale to stay totals too. Display-only: the stored
          // pricing_proposals snapshot keeps per-night rates for readers.
          const stayNights = proposal.check_in && proposal.check_out
            ? nightsBetween(proposal.check_in, proposal.check_out)
            : null;
          const stayTotal = stayNights && stayNights > 0 ? guestPrice * stayNights : null;
          const scale = (n: number) => stayNights && stayNights > 0 ? n * stayNights : n;
          return (
            <>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 8, color: 'var(--text)' }}>
                {fmtRand(guestPrice)}
                <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-secondary)', marginLeft: 6 }}>/ night</span>
              </div>
              {stayNights != null && stayTotal != null && (
                <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px dashed var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    Stay total · {stayNights} night{stayNights !== 1 ? 's' : ''}
                  </span>
                  <strong style={{ fontSize: '1.125rem' }}>{fmtRand(stayTotal)}</strong>
                </div>
              )}
              {stayNights != null && stayNights > 0 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6, textAlign: 'right' }}>
                  Totals for {stayNights} night{stayNights !== 1 ? 's' : ''}
                </div>
              )}
              <div className="pricing-breakdown" style={{ fontSize: '0.8125rem' }}>
                {ownerNet != null && (
                  <div className="pricing-breakdown-row">
                    <span className="pricing-breakdown-label">Owner receives</span>
                    <span className="pricing-breakdown-value">{fmtRand(scale(ownerNet))}</span>
                  </div>
                )}
                {ctrTake != null && (
                  <div className="pricing-breakdown-row">
                    <span className="pricing-breakdown-label">CTR earns</span>
                    <span className="pricing-breakdown-value">{fmtRand(scale(ctrTake))}</span>
                  </div>
                )}
                {proposal.scenario_type === 'agent' && agentTake != null && agentTake > 0 && (() => {
                  const splits = proposal.agents?.filter(a => !!a.id) || [];
                  const totalPct = splits.reduce((s, a) => s + (Number(a.pct) || 0), 0);
                  if (splits.length === 0 || totalPct <= 0) {
                    return (
                      <div className="pricing-breakdown-row">
                        <span className="pricing-breakdown-label">Agent commission</span>
                        <span className="pricing-breakdown-value">{fmtRand(scale(agentTake))}</span>
                      </div>
                    );
                  }
                  return splits.map(sa => {
                    const share = Math.round((Number(sa.pct) / totalPct) * agentTake);
                    return (
                      <div key={sa.id} className="pricing-breakdown-row">
                        <span className="pricing-breakdown-label">
                          {agentNames[sa.id] || 'Agent'} ({Number(sa.pct).toFixed(1)}%)
                        </span>
                        <span className="pricing-breakdown-value">{fmtRand(scale(share))}</span>
                      </div>
                    );
                  });
                })()}
              </div>
            </>
          );
        })() : (
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
            No pricing snapshot linked. Open the deal modal and use Edit pricing on the proposal row to attach one.
          </div>
        )}
      </DetailModalSection>

      <DetailModalSection heading="Timeline">
        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label">Created</label>
            <div style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{fmtDateTime(proposal.created_at)}</div>
          </div>
          <div className="form-group">
            <label className="form-label">Sent</label>
            <div style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
              {proposal.sent_at ? fmtDateTime(proposal.sent_at) : <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>not sent</span>}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Viewed</label>
            <div style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
              {proposal.viewed_at ? fmtDateTime(proposal.viewed_at) : <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>not viewed</span>}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Interest</label>
            <div style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
              {proposal.accepted_at ? fmtDateTime(proposal.accepted_at) : <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>none yet</span>}
            </div>
          </div>
        </div>
      </DetailModalSection>

      <DetailModalSection heading="Proposal Link">
        {/* Eye-icon button matching the rest of the platform (deal
            modal proposal rows, deal cards) — opens the public
            proposal page in a new tab. The raw URL was previously
            shown inline, but users kept asking "where do I click?"
            because there was no button affordance. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <a
            href={proposalUrl(proposal.ref_code)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost"
            style={{ fontSize: '0.8125rem', textDecoration: 'none' }}
            title="Open the proposal page as the recipient sees it"
          >
            👁 View proposal page
          </a>
          <span style={{ fontSize: '0.75rem', fontFamily: 'ui-monospace, monospace', color: 'var(--text-light)', wordBreak: 'break-all' }}>
            {proposalUrl(proposal.ref_code)}
          </span>
        </div>
      </DetailModalSection>
    </DetailModal>
  );
}
