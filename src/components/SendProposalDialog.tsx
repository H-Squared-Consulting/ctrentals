/**
 * SendProposalDialog — shared send-and-confirm dialog for one OR many
 * proposals that share a single recipient.
 *
 * Caller passes a proposals[] array (always at least one element). The
 * dialog derives recipient + contact channels from proposals[0]; it is
 * the caller's responsibility to ensure every proposal in the array
 * belongs to the same guest/agent — the kanban's "send selected" mode
 * enforces this at the picker level.
 *
 * UX:
 *   - Subject + body are pre-filled with a formal template (single- and
 *     multi-proposal variants). Both are read-only until the user hits
 *     ✎ Edit, at which point they become editable text fields.
 *   - Three share buttons (WhatsApp, Email draft, Copy links) open the
 *     channel with the current subject + body baked in. They do NOT mark
 *     the proposals as sent — the explicit "✓ Mark as Sent" primary
 *     action flips the status (for every proposal in the batch) and
 *     syncs each linked enquiry's deal_status.
 *   - ← Back returns the user to the modal they came from (caller wires
 *     this); Cancel discards.
 */

import { useMemo, useState } from 'react';
import ActionModal from './ActionModal';
import { notifyPipelineChanged } from '../lib/pipelineEvents';
import { syncEnquiryFromProposal } from '../lib/statusSync';

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
  /** One or more proposals, all sharing the same recipient. */
  proposals: SendableProposal[];
  supabase: any;
  onClose: () => void;
  /** Fires after the batch is marked sent. Host should refetch. */
  onSent: () => void;
  /** Optional Back action — when set, a "← Back" button appears in the
   *  footer left slot. */
  onBack?: () => void;
}

const BRAND_DOMAIN = (import.meta as any).env?.VITE_BRAND_DOMAIN || 'southernescapes.co.za';

function proposalUrl(refCode: string): string {
  return `https://${BRAND_DOMAIN}/proposal.html?ref=${refCode}`;
}

/** Build a formal subject/body for the batch. Single- vs multi-proposal
 *  templates branch only on count; tone stays consistent. The recipient's
 *  first name personalises the greeting without being overly familiar. */
function buildTemplate(proposals: SendableProposal[]): { subject: string; body: string } {
  const recipient = proposals[0];
  const firstName = (recipient.guest_name || '').split(' ')[0] || 'there';
  const greeting = `Dear ${firstName},`;
  const signoff = '\n\nKind regards,\nSouthern Escapes';

  if (proposals.length === 1) {
    const p = proposals[0];
    const subject = `Southern Escapes — Proposal for ${titleCase(p.property_name)}`;
    const body =
      `${greeting}\n\n` +
      `Thank you for your interest in Southern Escapes. Please find your proposal for ${titleCase(p.property_name)} below:\n\n` +
      `  ${proposalUrl(p.ref_code)}\n\n` +
      `The link above contains the full details of the property, including pricing and availability. ` +
      `Please don't hesitate to reach out should you have any questions or wish to proceed.` +
      signoff;
    return { subject, body };
  }

  const subject = `Southern Escapes — ${proposals.length} property proposals for your stay`;
  const list = proposals
    .map(p => `  • ${titleCase(p.property_name)} (Ref ${p.ref_code}) — ${proposalUrl(p.ref_code)}`)
    .join('\n');
  const body =
    `${greeting}\n\n` +
    `Thank you for your interest in Southern Escapes. Please find below ${proposals.length} proposals for your consideration:\n\n` +
    `${list}\n\n` +
    `Each link contains the full details of the property, including pricing and availability. ` +
    `Please don't hesitate to reach out should you have any questions or wish to proceed.` +
    signoff;
  return { subject, body };
}

export default function SendProposalDialog({ proposals, supabase, onClose, onSent, onBack }: Props) {
  const [marking, setMarking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editMode, setEditMode] = useState(false);

  // Pre-fill subject/body from the template. The user can take over by
  // clicking ✎ Edit; their changes then drive what the share channels
  // open with. Recomputed only on first mount — once the user edits,
  // their version sticks even if proposals prop changes (unlikely here).
  const initial = useMemo(() => buildTemplate(proposals), [proposals]);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);

  const recipient = proposals[0];
  const isAgent = recipient.is_agent;
  const hasPhone = !!recipient.guest_phone;
  const hasEmail = !!recipient.guest_email;
  const hasContact = hasPhone || hasEmail;
  const guestName = titleCase(recipient.guest_name);

  async function markSent() {
    setMarking(true);
    const now = new Date().toISOString();
    const ids = proposals.map(p => p.id);
    await supabase
      .from('proposals')
      .update({ status: 'sent', sent_at: now })
      .in('id', ids);
    // Sync each linked enquiry's deal_status (1:1 guard inside the helper
    // skips multi-proposal enquiries automatically — see statusSync.ts).
    for (const p of proposals) {
      await syncEnquiryFromProposal(supabase, p.id, 'sent');
    }
    notifyPipelineChanged();
    setMarking(false);
    onSent();
  }

  function sendWhatsApp() {
    // WhatsApp wa.me takes a single message — bake the (possibly edited)
    // body in. Subject is irrelevant on WhatsApp so we prefix it inline
    // so any custom-edited subject still carries through.
    const composed = `${subject}\n\n${body}`;
    let phone = (recipient.guest_phone || '').replace(/[^0-9]/g, '');
    if (phone.startsWith('0')) phone = '27' + phone.slice(1);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(composed)}`, '_blank');
  }

  // The Email button is a real <a href="mailto:..."> below — browsers
  // open mailto: links reliably through OS protocol handling, whereas
  // window.open(mailto:...) is inconsistent (Chrome can silently no-op).

  async function copyLinks() {
    // Copies the full composed body so what the user pastes anywhere
    // matches what the email / WhatsApp draft would have contained.
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard API can fail in some browser contexts — silent */
    }
  }

  const isMulti = proposals.length > 1;
  const title = isMulti ? `Send ${proposals.length} proposals` : 'Send proposal';
  const subtitleSuffix = isAgent ? ' (agent)' : '';

  return (
    <ActionModal
      title={title}
      subtitle={`To ${guestName}${subtitleSuffix}`}
      width={620}
      summary={
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="form-label" style={{ margin: 0 }}>Recipient</span>
            <span style={{ fontWeight: 500 }}>{guestName}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="form-label" style={{ margin: 0 }}>{isMulti ? 'Proposals' : 'Property'}</span>
            <span style={{ fontWeight: 500, textAlign: 'right' }}>
              {isMulti
                ? `${proposals.length} properties`
                : titleCase(proposals[0].property_name)}
            </span>
          </div>
          {!isMulti && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
              <span className="form-label" style={{ margin: 0 }}>Ref</span>
              <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--color-primary)' }}>{proposals[0].ref_code}</span>
            </div>
          )}
        </>
      }
      onClose={onClose}
      primaryAction={
        <button className="btn btn-primary" onClick={markSent} disabled={marking}>
          {marking ? 'Marking…' : isMulti ? `✓ Mark all ${proposals.length} as Sent` : '✓ Mark as Sent'}
        </button>
      }
      secondaryActions={onBack ? (
        <button className="btn btn-ghost" onClick={onBack} disabled={marking}>
          ← Back
        </button>
      ) : undefined}
    >
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
        Share via WhatsApp, email or clipboard. When you've actually sent it, click <strong>{isMulti ? `Mark all ${proposals.length} as Sent` : 'Mark as Sent'}</strong> below to move {isMulti ? 'them' : 'it'} to the Sent column.
      </p>

      {/* Subject + body as two separate labeled boxes — mirrors a real
          email composer so what the user sees here matches what lands in
          their mail client. Read-only by default; ✎ Edit flips both into
          editable form inputs. Standard form-input + form-label classes
          keep the visual language consistent. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="form-label" style={{ margin: 0 }}>Subject</span>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: '0.6875rem', padding: '2px 8px' }}
          onClick={() => setEditMode((s) => !s)}
          disabled={marking}
        >
          {editMode ? '✓ Done editing' : '✎ Edit'}
        </button>
      </div>
      {editMode ? (
        <input
          className="form-input"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          disabled={marking}
        />
      ) : (
        <div style={{ padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.8125rem', fontWeight: 600 }}>
          {subject}
        </div>
      )}

      <div className="form-label" style={{ margin: '12px 0 6px' }}>Message</div>
      {editMode ? (
        <textarea
          className="form-input"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          disabled={marking}
          style={{ fontFamily: 'inherit' }}
        />
      ) : (
        <div style={{ padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.8125rem', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
          {body}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
        {hasPhone && (
          <button
            className="btn btn-outline-whatsapp"
            style={{ justifyContent: 'flex-start' }}
            onClick={sendWhatsApp}
            disabled={marking}
          >
            📱 Open WhatsApp
          </button>
        )}
        {hasEmail && (
          // mailto: hands off to the OS default mail handler — on macOS
          // that's Apple Mail with the team's configured account. If the
          // click does nothing, check Chrome's protocol handler settings
          // at chrome://settings/handlers — Mail.app must be allowed.
          <a
            className="btn btn-outline"
            style={{ justifyContent: 'flex-start', pointerEvents: marking ? 'none' : undefined, opacity: marking ? 0.6 : 1 }}
            href={`mailto:${recipient.guest_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
          >
            ✉ Open Email draft
          </a>
        )}
        <button
          className="btn btn-outline"
          style={{ justifyContent: 'flex-start' }}
          onClick={copyLinks}
          disabled={marking}
        >
          {copied ? '✓ Message copied to clipboard' : isMulti ? '🔗 Copy message (with all links)' : '🔗 Copy message'}
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
