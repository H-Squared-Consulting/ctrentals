/**
 * SendProposalDialog -- shared quick-send confirmation.
 *
 * Mounted from the Pipeline Kanban (Proposed column "📤 Send" action) and
 * the Property Editor's Proposals tab. Lets the user fire off the proposal
 * link via WhatsApp / Email (channel deep-link) or copy it for anywhere
 * else; either way the proposal flips to status='sent' and the host's
 * onSent callback fires.
 *
 * Kept dumb on purpose — owns the network call to flip the status and
 * fires notifyPipelineChanged() so any other Pipeline view re-fetches.
 */

import { useState } from 'react';
import ActionModal from './ActionModal';
import { notifyPipelineChanged } from '../lib/pipelineEvents';

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

export interface SendableProposal {
  id: string;
  ref_code: string;
  property_name: string;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  is_agent: boolean;
}

interface Props {
  proposal: SendableProposal;
  supabase: any;
  onClose: () => void;
  /** Fires after the proposal is marked sent. Host should refetch. */
  onSent: () => void;
}

export default function SendProposalDialog({ proposal, supabase, onClose, onSent }: Props) {
  const [marking, setMarking] = useState(false);
  const [copied, setCopied] = useState(false);

  function proposalUrl() {
    return `${window.location.origin}/proposal.html?ref=${proposal.ref_code}`;
  }

  async function markSent() {
    setMarking(true);
    await supabase
      .from('proposals')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', proposal.id);
    notifyPipelineChanged();
    setMarking(false);
  }

  function sendWhatsApp() {
    const msg = encodeURIComponent(
      `Hi ${proposal.guest_name.split(' ')[0]},\n\nHere is your property proposal from CT Rentals:\n${proposalUrl()}\n\nLet us know if you have any questions!`
    );
    let phone = (proposal.guest_phone || '').replace(/[^0-9]/g, '');
    if (phone.startsWith('0')) phone = '27' + phone.slice(1);
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
    markSent().then(onSent);
  }

  function sendEmail() {
    const subject = encodeURIComponent(`CT Rentals — Property Proposal: ${proposal.property_name}`);
    const body = encodeURIComponent(
      `Hi ${proposal.guest_name.split(' ')[0]},\n\nHere is your property proposal from CT Rentals:\n${proposalUrl()}\n\nLet us know if you have any questions!\n\nBest regards,\nCT Rentals`
    );
    window.open(`mailto:${proposal.guest_email || ''}?subject=${subject}&body=${body}`, '_blank');
    markSent().then(onSent);
  }

  async function copyAndMark() {
    try {
      await navigator.clipboard.writeText(proposalUrl());
      setCopied(true);
    } catch {
      /* ignore — still mark as sent */
    }
    await markSent();
    // Hold the dialog open briefly so the user sees the "✓ Copied" state.
    setTimeout(onSent, 700);
  }

  const hasPhone = !!proposal.guest_phone;
  const hasEmail = !!proposal.guest_email;
  const hasContact = hasPhone || hasEmail;

  const propertyName = titleCase(proposal.property_name);
  const guestName = titleCase(proposal.guest_name);

  return (
    <ActionModal
      title="Send proposal"
      subtitle={`To ${guestName}${proposal.is_agent ? ' (agent)' : ''}`}
      width={520}
      summary={
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="form-label" style={{ margin: 0 }}>Property</span>
            <strong>{propertyName}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="form-label" style={{ margin: 0 }}>Recipient</span>
            <span style={{ fontWeight: 500 }}>{guestName}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
            <span className="form-label" style={{ margin: 0 }}>Ref</span>
            <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--color-primary)' }}>{proposal.ref_code}</span>
          </div>
        </>
      }
      onClose={onClose}
    >
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
        Pick how to send the proposal link. The proposal will be marked as Sent once shared.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {hasPhone && (
          <button
            className="btn btn-outline"
            style={{ color: '#25D366', borderColor: '#25D366', justifyContent: 'flex-start' }}
            onClick={sendWhatsApp}
            disabled={marking}
          >
            📱 Send via WhatsApp
          </button>
        )}
        {hasEmail && (
          <button
            className="btn btn-outline"
            style={{ justifyContent: 'flex-start' }}
            onClick={sendEmail}
            disabled={marking}
          >
            ✉ Send via Email
          </button>
        )}
        <button
          className="btn btn-outline"
          style={{ justifyContent: 'flex-start' }}
          onClick={copyAndMark}
          disabled={marking}
        >
          {copied ? '✓ Link copied to clipboard' : '🔗 Copy link & mark sent'}
        </button>
        {!hasContact && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', padding: '8px 4px 0', borderTop: '1px dashed var(--border)' }}>
            No email or phone on file. Add contact details to send via WhatsApp or Email next time.
          </div>
        )}
      </div>
    </ActionModal>
  );
}
