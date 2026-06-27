/**
 * BookingFormShareModal -- share (or revoke) a self-serve form link for a
 * booking. Clone of AgentPortalShareMenu's lifecycle: Copy / WhatsApp / Email
 * the link, plus Reset link (rotate) and Stop access (revoke). On open it mints
 * the active token via ensureBookingFormToken so there's always a URL to share.
 *
 * Built on <ActionModal> — no bespoke modal shell.
 */

import { useEffect, useState } from 'react';
import ActionModal from './ActionModal';
import {
  ensureBookingFormToken,
  regenerateBookingFormToken,
  revokeBookingFormToken,
  getBookingFormUrl,
} from '../lib/bookingFormLinks';
import type { BookingFormType } from '../lib/bookingForm';

interface Props {
  bookingId: string;
  formType: BookingFormType;
  /** First name for the message greeting (guest's, or the agent's). */
  recipientFirstName?: string | null;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  supabase: any;
  onClose: () => void;
}

export default function BookingFormShareModal({
  bookingId, formType, recipientFirstName, recipientEmail, recipientPhone, supabase, onClose,
}: Props) {
  const [url, setUrl] = useState<string>('');
  const [busy, setBusy] = useState(true);
  const [copied, setCopied] = useState(false);

  const isAgent = formType === 'agent';
  const who = isAgent ? 'agent' : 'guest';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await ensureBookingFormToken(supabase, bookingId, formType);
        if (!cancelled) setUrl(getBookingFormUrl(token, formType));
      } catch (err) {
        console.error('ensureBookingFormToken failed', err);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, bookingId, formType]);

  const greeting = recipientFirstName?.trim() ? `Hi ${recipientFirstName.trim()},` : 'Hi,';
  const message = isAgent
    ? `${greeting}\n\nThanks for securing this booking. Please pop the booking details in here so we can get everything ready:\n\n${url}\n\nWarm regards,\nSouthern Escapes`
    : `${greeting}\n\nLooking forward to your stay! Please share a few details (flight times, check-in/out, any extras) here:\n\n${url}\n\nWarm regards,\nSouthern Escapes`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard can fail in some contexts — silent */ }
  }

  async function reset() {
    setBusy(true);
    try {
      const token = await regenerateBookingFormToken(supabase, bookingId, formType);
      setUrl(getBookingFormUrl(token, formType));
    } catch (err) { console.error(err); }
    setBusy(false);
  }

  async function stop() {
    setBusy(true);
    try {
      await revokeBookingFormToken(supabase, bookingId, formType);
      onClose();
    } catch (err) { console.error(err); setBusy(false); }
  }

  let phone = (recipientPhone || '').replace(/[^0-9]/g, '');
  if (phone.startsWith('0')) phone = '27' + phone.slice(1);

  return (
    <ActionModal
      title={isAgent ? 'Send agent details form' : 'Send guest details form'}
      subtitle={`A self-serve link the ${who} fills in — it writes back into this booking.`}
      width={560}
      onClose={onClose}
      primaryAction={
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      }
      secondaryActions={
        <>
          <button className="btn btn-ghost" onClick={reset} disabled={busy} title="Issue a fresh link; the old one stops working">
            ↻ Reset link
          </button>
          <button className="btn btn-outline-danger" onClick={stop} disabled={busy} title="Turn the link off entirely">
            Stop access
          </button>
        </>
      }
    >
      <div className="form-label" style={{ margin: '0 0 6px' }}>Link</div>
      <div style={{
        padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)', fontSize: '0.8125rem', wordBreak: 'break-all',
        fontFamily: 'ui-monospace, monospace', color: 'var(--color-primary)', marginBottom: 12,
      }}>
        {busy ? 'Generating…' : url}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {phone && (
          <a className="btn btn-outline-whatsapp" style={{ justifyContent: 'flex-start' }}
            href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
            📱 Send via WhatsApp
          </a>
        )}
        {recipientEmail && (
          <a className="btn btn-outline" style={{ justifyContent: 'flex-start' }}
            href={`mailto:${recipientEmail.toLowerCase()}?subject=${encodeURIComponent(isAgent ? 'Booking details' : 'A few details for your stay')}&body=${encodeURIComponent(message)}`}>
            ✉ Open email draft
          </a>
        )}
        <button className="btn btn-outline" style={{ justifyContent: 'flex-start' }} onClick={copy} disabled={busy}>
          {copied ? '✓ Link copied' : '🔗 Copy link'}
        </button>
      </div>
    </ActionModal>
  );
}
