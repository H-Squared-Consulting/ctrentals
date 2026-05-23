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
import { useToast } from './ToastProvider';
import { fmtRand } from '../lib/pricingEngine';
import { notifyPipelineChanged } from '../lib/pipelineEvents';

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

function proposalUrl(refCode: string) {
  return `${window.location.origin}/proposal.html?ref=${refCode}`;
}

interface ProposalDetailModalProps {
  proposal: ProposalForDetail;
  supabase: any;
  onClose: () => void;
  /** Called after any mutation (status change) so the host can refetch. */
  onChange?: () => void;
  /** Opens the calculator pre-filled with this proposal's pricing snapshot. */
  onEditPricing?: () => void;
}

export default function ProposalDetailModal({
  proposal,
  supabase,
  onClose,
  onChange,
  onEditPricing,
}: ProposalDetailModalProps) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

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

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(proposalUrl(proposal.ref_code));
      setCopied(true);
      toast.success('Link copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }

  async function markSentIfDraft() {
    if (proposal.status !== 'draft') return;
    await supabase
      .from('proposals')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', proposal.id);
    notifyPipelineChanged();
    onChange?.();
  }

  function sendWhatsApp() {
    const url = proposalUrl(proposal.ref_code);
    const msg = encodeURIComponent(
      `Hi ${proposal.guest_name},\n\nHere is your property proposal from CT Rentals:\n${url}\n\nLet us know if you have any questions!`
    );
    let phone = (proposal.guest_phone || '').replace(/[^0-9]/g, '');
    if (phone.startsWith('0')) phone = '27' + phone.slice(1);
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
    markSentIfDraft();
  }

  function sendEmail() {
    const url = proposalUrl(proposal.ref_code);
    const subject = encodeURIComponent(`CT Rentals — Property Proposal: ${proposal.property_name || 'Property'}`);
    const body = encodeURIComponent(
      `Hi ${proposal.guest_name},\n\nHere is your property proposal from CT Rentals:\n${url}\n\nLet us know if you have any questions!\n\nBest regards,\nCT Rentals`
    );
    window.open(`mailto:${proposal.guest_email || ''}?subject=${subject}&body=${body}`, '_blank');
    markSentIfDraft();
  }

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
      {proposal.is_agent && <span className="ops-board-card-tag ops-board-card-tag--agent">Agent</span>}
    </>
  );

  const footer = (
    <>
      {onEditPricing && (
        <button
          className="btn btn-ghost"
          onClick={onEditPricing}
          disabled={!proposal.pricing_proposal_id}
          title={proposal.pricing_proposal_id ? 'Edit the pricing for this proposal' : 'No pricing snapshot linked'}
        >
          💰 Edit Pricing
        </button>
      )}
      <button className="btn btn-ghost" onClick={handleCopy}>
        {copied ? '✓ Copied' : '🔗 Copy Link'}
      </button>
      <a className="btn btn-ghost" href={proposalUrl(proposal.ref_code)} target="_blank" rel="noopener noreferrer">
        👁 Preview
      </a>
      {proposal.guest_phone && (
        <button className="btn btn-outline-whatsapp" onClick={() => { sendWhatsApp(); onClose(); }}>
          WhatsApp
        </button>
      )}
      {proposal.guest_email && (
        <button className="btn btn-outline" onClick={() => { sendEmail(); onClose(); }}>
          Email
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
        {guestPrice != null ? (
          <>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 8, color: 'var(--text)' }}>
              {fmtRand(guestPrice)}
              <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-secondary)', marginLeft: 6 }}>/ night</span>
            </div>
            <div className="pricing-breakdown" style={{ fontSize: '0.8125rem' }}>
              {ownerNet != null && (
                <div className="pricing-breakdown-row">
                  <span className="pricing-breakdown-label">Owner receives</span>
                  <span className="pricing-breakdown-value">{fmtRand(ownerNet)}</span>
                </div>
              )}
              {ctrTake != null && (
                <div className="pricing-breakdown-row">
                  <span className="pricing-breakdown-label">CTR earns</span>
                  <span className="pricing-breakdown-value">{fmtRand(ctrTake)}</span>
                </div>
              )}
              {proposal.scenario_type === 'agent' && agentTake != null && agentTake > 0 && (() => {
                const splits = proposal.agents?.filter(a => !!a.id) || [];
                const totalPct = splits.reduce((s, a) => s + (Number(a.pct) || 0), 0);
                if (splits.length === 0 || totalPct <= 0) {
                  return (
                    <div className="pricing-breakdown-row">
                      <span className="pricing-breakdown-label">Agent commission</span>
                      <span className="pricing-breakdown-value">{fmtRand(agentTake)}</span>
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
                      <span className="pricing-breakdown-value">{fmtRand(share)}</span>
                    </div>
                  );
                });
              })()}
            </div>
          </>
        ) : (
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
            No pricing snapshot linked. Use Edit Pricing to attach one.
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
        <div style={{ fontSize: '0.8125rem', wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace', color: 'var(--color-primary)' }}>
          {proposalUrl(proposal.ref_code)}
        </div>
      </DetailModalSection>
    </DetailModal>
  );
}
