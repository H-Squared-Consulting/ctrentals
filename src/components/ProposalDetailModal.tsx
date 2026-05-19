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

import { useState } from 'react';
import { StatusBadge } from './DataTable';
import { useToast } from './ToastProvider';
import { fmtRand } from '../lib/pricingEngine';
import { notifyPipelineChanged } from '../lib/pipelineEvents';

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
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  draft: { label: 'Draft', bg: '#F3F4F6', color: '#6B7280' },
  sent: { label: 'Sent', bg: '#DBEAFE', color: '#1E40AF' },
  viewed: { label: 'Viewed', bg: '#E0E7FF', color: '#3730A3' },
  interested: { label: 'Interested', bg: '#D1FAE5', color: '#065F46' },
  expired: { label: 'Expired', bg: '#FEE2E2', color: '#991B1B' },
};

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
        <div className="modal-header">
          <h2 className="modal-title">{proposal.guest_name} — {proposal.property_name || 'Proposal'}</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body">
          {/* Recipient + meta */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '14px', fontSize: '0.8125rem' }}>
            <div><span style={{ color: 'var(--text-light)' }}>Recipient</span><br />{proposal.guest_name}{proposal.is_agent ? <span className="status-badge" style={{ background: '#E0E7FF', color: '#3730A3', marginLeft: '6px', fontSize: '0.5625rem' }}>Agent</span> : ''}</div>
            <div><span style={{ color: 'var(--text-light)' }}>Status</span><br /><StatusBadge status={proposal.status} config={STATUS_CONFIG} /></div>
            <div><span style={{ color: 'var(--text-light)' }}>Email</span><br />{proposal.guest_email || '—'}</div>
            <div><span style={{ color: 'var(--text-light)' }}>Phone</span><br />{proposal.guest_phone || '—'}</div>
            <div><span style={{ color: 'var(--text-light)' }}>Check-in</span><br />{fmtDateLong(proposal.check_in)}</div>
            <div><span style={{ color: 'var(--text-light)' }}>Check-out</span><br />{fmtDateLong(proposal.check_out)}</div>
            <div><span style={{ color: 'var(--text-light)' }}>Guests</span><br />{proposal.guests_total ?? '—'}</div>
            <div><span style={{ color: 'var(--text-light)' }}>Ref</span><br /><span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{proposal.ref_code}</span></div>
          </div>

          {/* Pricing block */}
          {guestPrice != null ? (
            <div style={{ padding: '12px 14px', background: 'var(--border-light)', borderRadius: 'var(--radius-sm)', marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                <strong style={{ fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>Pricing</strong>
                <span style={{ fontSize: '0.6875rem', color: 'var(--text-light)' }}>
                  {proposal.scenario_type}{proposal.season_tag ? ` · ${proposal.season_tag}` : ''}
                </span>
              </div>
              <div style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '8px' }}>
                {fmtRand(guestPrice)} <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-light)' }}>/ night</span>
              </div>
              <div className="pricing-breakdown" style={{ fontSize: '0.75rem' }}>
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
                {proposal.scenario_type === 'agent' && agentTake != null && agentTake > 0 && (
                  <div className="pricing-breakdown-row">
                    <span className="pricing-breakdown-label">Agent commission</span>
                    <span className="pricing-breakdown-value">{fmtRand(agentTake)}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ padding: '12px', background: 'var(--border-light)', borderRadius: 'var(--radius-sm)', marginBottom: '14px', fontSize: '0.75rem', color: 'var(--text-light)' }}>
              No pricing snapshot linked. Use Edit Pricing to attach one.
            </div>
          )}

          {/* Timeline */}
          <div style={{ padding: '12px', background: '#F9FAFB', borderRadius: 'var(--radius-sm)', marginBottom: '14px' }}>
            <strong style={{ fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>Timeline</strong>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '8px', fontSize: '0.8125rem' }}>
              <div>Created: {fmtDateTime(proposal.created_at)}</div>
              <div>Sent: {proposal.sent_at ? fmtDateTime(proposal.sent_at) : <span style={{ color: 'var(--text-light)' }}>—</span>}</div>
              <div>Viewed: {proposal.viewed_at ? fmtDateTime(proposal.viewed_at) : <span style={{ color: 'var(--text-light)' }}>—</span>}</div>
              <div>Interest: {proposal.accepted_at ? fmtDateTime(proposal.accepted_at) : <span style={{ color: 'var(--text-light)' }}>—</span>}</div>
            </div>
          </div>

          {/* Link */}
          <div style={{ padding: '10px 12px', background: 'var(--color-primary-bg, #EFF6FF)', borderRadius: 'var(--radius-sm)' }}>
            <strong style={{ fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-primary, #1E40AF)' }}>Proposal Link</strong>
            <div style={{ marginTop: '4px', fontSize: '0.75rem', wordBreak: 'break-all', fontFamily: 'monospace', color: 'var(--text-mid)' }}>
              {proposalUrl(proposal.ref_code)}
            </div>
          </div>
        </div>

        <div className="modal-footer">
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
            <button className="btn btn-outline" style={{ color: '#25D366', borderColor: '#25D366' }} onClick={() => { sendWhatsApp(); onClose(); }}>
              WhatsApp
            </button>
          )}
          {proposal.guest_email && (
            <button className="btn btn-outline" onClick={() => { sendEmail(); onClose(); }}>
              Email
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
