/**
 * AgentLinkShareModal — lightweight share UX served on the public agent
 * portal (/q/:token). Given a proposal URL and an optional brochure URL,
 * surfaces Copy / WhatsApp / Email per link so the agent can forward
 * both to their guest in a couple of taps.
 *
 * No auth dependency: the public portal has no AuthContext, so we lean
 * only on ToastProvider (mounted at root) and ActionModal. Default
 * messages prefill from the guest's first name when known.
 */

import { useState } from 'react';
import { useToast } from './ToastProvider';
import ActionModal from './ActionModal';

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

function defaultProposalMessage(firstName: string, propertyName: string, url: string): string {
  // Keep the URL on the same line as the body — WhatsApp drops body
  // text when separated from the link by blank lines.
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  const subject = propertyName ? ` for ${propertyName}` : '';
  return `${greeting} here's the proposal${subject}. Let me know what you think. ${url}`;
}

function defaultBrochureMessage(firstName: string, propertyName: string, url: string): string {
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  const subject = propertyName ? ` for ${propertyName}` : '';
  return `${greeting} here's the brochure${subject}. ${url}`;
}

interface ShareLinkRowProps {
  label: string;
  url: string;
  message: string;
  subject: string;
  email: string;
}

function ShareLinkRow({ label, url, message, subject, email }: ShareLinkRowProps) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try { await navigator.clipboard.writeText(url); }
    catch { /* fall through to toast */ }
    setCopied(true);
    toast.success(`${label} link copied`);
    setTimeout(() => setCopied(false), 2000);
  }

  const waHref = `https://wa.me/?text=${encodeURIComponent(message)}`;
  const mailHref = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;

  return (
    <div style={{ marginBottom: 'var(--s-4)' }}>
      <div style={{
        fontSize: '0.6875rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: 'var(--text-secondary)',
        marginBottom: 'var(--s-2)',
      }}>
        {label}
      </div>
      <div style={{
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--s-3)',
        marginBottom: 'var(--s-2)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-3)',
      }}>
        <span style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: '0.8125rem',
          color: 'var(--text)',
        }} title={url}>{url}</span>
        <button className="btn btn-primary" style={{ fontSize: '0.75rem' }} onClick={copy}>
          {copied ? '✓ Copied' : '🔗 Copy'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
        <a
          className="btn btn-whatsapp"
          style={{ flex: 1, textAlign: 'center', fontSize: '0.8125rem' }}
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          WhatsApp
        </a>
        <a
          className="btn btn-primary"
          style={{ flex: 1, textAlign: 'center', fontSize: '0.8125rem' }}
          href={mailHref}
        >
          Email
        </a>
      </div>
    </div>
  );
}

export default function AgentLinkShareModal({
  propertyName,
  proposalUrl,
  brochureUrl,
  guestFirstName,
  guestEmail,
  onClose,
}: {
  propertyName: string;
  proposalUrl: string;          // empty string when proposal is locked (terminal status)
  brochureUrl?: string | null;
  guestFirstName?: string | null;
  guestEmail?: string | null;
  onClose: () => void;
}) {
  const firstName = titleCase((guestFirstName || '').split(' ')[0]);
  const propName = titleCase(propertyName);
  const email = guestEmail || '';

  return (
    <ActionModal
      title="Share with your guest"
      subtitle={propName ? <>For <strong>{propName}</strong></> : undefined}
      width={520}
      hideFooter
      onClose={onClose}
    >
      {proposalUrl ? (
        <ShareLinkRow
          label="Proposal link"
          url={proposalUrl}
          message={defaultProposalMessage(firstName, propName, proposalUrl)}
          subject={propName ? `Proposal — ${propName}` : 'Your proposal'}
          email={email}
        />
      ) : null}
      {brochureUrl ? (
        <ShareLinkRow
          label="Brochure link"
          url={brochureUrl}
          message={defaultBrochureMessage(firstName, propName, brochureUrl)}
          subject={propName ? `Brochure — ${propName}` : 'Property brochure'}
          email={email}
        />
      ) : null}
      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 'var(--s-2)' }}>
        Copy the link, open WhatsApp pre-filled with a default message, or open your email client.
      </div>
    </ActionModal>
  );
}
