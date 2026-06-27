/**
 * EmailComposerModal — reusable compose-and-handoff dialog for the
 * management-phase email / WhatsApp sequence. Generalized from
 * SendProposalDialog: same ✎ Edit / Copy / mailto / Mark-as-Sent UX,
 * but the subject + body arrive pre-rendered (a DB template rendered
 * against live booking variables) and the recipient is a plain
 * { name, email?, phone? } rather than a proposal.
 *
 * This is a handoff tool, not a sender. The share buttons open the
 * user's OWN WhatsApp / mail client with the (possibly edited) subject
 * + body baked in. The explicit "Mark as Sent" primary records the
 * action via onMarkSent(channel) and closes — staff stay in control.
 *
 * SendProposalDialog is deliberately left untouched (it owns the live
 * proposal-batch flow with its agent-name override + status sync). This
 * is the trimmed, reusable sibling: no batch, no proposal specifics.
 */

import { useState, type ReactNode } from 'react';
import ActionModal from './ActionModal';

/** Local titleCase — the codebase has no shared export; mirrors the one
 *  SendProposalDialog defines so recipient names render consistently. */
function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

interface Props {
  title: string;
  /** Optional sub-line under the title (channel/step context). */
  subtitle?: ReactNode;
  recipient: { name: string; email?: string | null; phone?: string | null };
  /** Pre-rendered template subject. Seeds the editable field. */
  subject: string;
  /** Pre-rendered template body. Seeds the editable field. */
  body: string;
  /** Optional extra context rows shown in the summary panel (dates,
   *  nights, property, etc.). Rendered below the recipient line. */
  contextSummary?: ReactNode;
  /** When true this step is a WhatsApp action (the 24h pre-arrival):
   *  offer the WhatsApp button (if a phone is on file) and record the
   *  mark against the 'whatsapp' channel. */
  whatsapp?: boolean;
  /** Primary-button label. Defaults to "✓ Mark as Sent". */
  markSentLabel?: string;
  /** Records the action. Receives the channel the step was sent on.
   *  When omitted the modal is compose-only (no primary button). */
  onMarkSent?: (channel: 'email' | 'whatsapp') => Promise<void> | void;
  onClose: () => void;
}

export default function EmailComposerModal({
  title,
  subtitle,
  recipient,
  subject: subjectProp,
  body: bodyProp,
  contextSummary,
  whatsapp = false,
  markSentLabel = '✓ Mark as Sent',
  onMarkSent,
  onClose,
}: Props) {
  const [marking, setMarking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editMode, setEditMode] = useState(false);

  // Subject + body arrive fully rendered from the template engine. They
  // seed local state once; ✎ Edit lets the user take over and their
  // edits then drive what every share channel opens with. A fresh Draft
  // click mounts a NEW modal instance, so seeding on mount is enough —
  // we never need to re-sync from props mid-life.
  const [subject, setSubject] = useState(subjectProp);
  const [body, setBody] = useState(bodyProp);

  const email = recipient.email ? recipient.email.toLowerCase() : '';
  const phone = recipient.phone || '';
  const hasEmail = !!email;
  const hasPhone = !!phone;
  // WhatsApp is only offered for steps flagged as WhatsApp AND when we
  // actually hold a number to message.
  const showWhatsApp = whatsapp && hasPhone;
  const hasContact = hasEmail || showWhatsApp;
  // Which channel "Mark as Sent" records. Driven by the action's medium
  // (the whatsapp flag), not by whichever share button the user clicked
  // — the sequence step itself defines whether it's an email or WhatsApp.
  const channel: 'email' | 'whatsapp' = whatsapp ? 'whatsapp' : 'email';

  const recipientName = titleCase(recipient.name);
  // Drop any leading icon/symbol from the label for inline prose use
  // ("click Mark as Sent below") so a custom label still reads cleanly.
  const plainMarkLabel = (markSentLabel || 'Mark as Sent').replace(/^[^A-Za-z0-9]+/, '');

  function sendWhatsApp() {
    // wa.me takes a single message — bake the (possibly edited) subject +
    // body in. Subject is meaningless on WhatsApp, so inline it so a
    // custom-edited subject still carries through.
    const composed = `${subject}\n\n${body}`;
    let digits = phone.replace(/[^0-9]/g, '');
    if (digits.startsWith('0')) digits = '27' + digits.slice(1);
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(composed)}`, '_blank');
  }

  // The Email button is a real <a href="mailto:..."> below — browsers
  // open mailto: reliably through OS protocol handling, whereas
  // window.open(mailto:...) is inconsistent (Chrome can silently no-op).

  async function copyMessage() {
    // Copy the body so what the user pastes anywhere matches what the
    // email / WhatsApp draft would have contained.
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard API can fail in some browser contexts — silent */
    }
  }

  async function handleMarkSent() {
    if (!onMarkSent) { onClose(); return; }
    setMarking(true);
    try {
      await onMarkSent(channel);
      onClose();
    } catch {
      // Keep the modal open so the user can retry; surfacing the error is
      // the host's job (onMarkSent owns the DB write).
      setMarking(false);
    }
  }

  return (
    <ActionModal
      title={title}
      subtitle={subtitle}
      width={620}
      summary={
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: contextSummary ? 6 : 0,
              gap: 12,
            }}
          >
            <span className="form-label" style={{ margin: 0 }}>Recipient</span>
            <span style={{ fontWeight: 500, textAlign: 'right' }}>
              {recipientName || '—'}
              {hasEmail && (
                <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}> · {email}</span>
              )}
            </span>
          </div>
          {contextSummary}
        </>
      }
      onClose={onClose}
      primaryAction={
        onMarkSent ? (
          <button className="btn btn-primary" onClick={handleMarkSent} disabled={marking}>
            {marking ? 'Marking…' : markSentLabel}
          </button>
        ) : null
      }
    >
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
        Share via {showWhatsApp ? 'WhatsApp, ' : ''}email or clipboard.
        {onMarkSent && (
          <> When you've actually sent it, click <strong>{plainMarkLabel}</strong> below to record it.</>
        )}
      </p>

      {/* Subject + body as two labeled boxes — mirrors a real email
          composer so what the user sees here matches what lands in their
          mail client. Read-only by default; ✎ Edit flips both into
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
          rows={14}
          disabled={marking}
          style={{ fontFamily: 'inherit' }}
        />
      ) : (
        <div style={{ padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.8125rem', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
          {body}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
        {showWhatsApp && (
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
            href={`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
          >
            ✉ Open Email draft
          </a>
        )}
        <button
          className="btn btn-outline"
          style={{ justifyContent: 'flex-start' }}
          onClick={copyMessage}
          disabled={marking}
        >
          {copied ? '✓ Message copied to clipboard' : '🔗 Copy message'}
        </button>
        {!hasContact && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', padding: '8px 4px 0', borderTop: '1px dashed var(--border)' }}>
            No {whatsapp ? 'phone number' : 'email address'} on file for this recipient. Use Copy to paste the message wherever you need it.
          </div>
        )}
      </div>
    </ActionModal>
  );
}
