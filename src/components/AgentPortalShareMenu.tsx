/**
 * AgentPortalShareMenu -- modal triggered from the Portal cell on the
 * Agents page. Lets Hayley copy the agent's portal URL, send it via
 * WhatsApp or email with an editable default message, and (for the
 * rare moments she needs to) reset the link or stop access entirely.
 *
 * The two management actions live at the bottom in plain English so
 * the modal feels like "share something" first, "manage it" second --
 * the day-to-day click is always Copy / WhatsApp / Email.
 */

import { useState } from 'react';
import { useToast } from './ToastProvider';
import ActionModal from './ActionModal';
import {
  getPortalUrl,
  getTokenForAgent,
  regenerateToken,
  revokePortal,
} from '../lib/mockAdminStore';

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

function defaultMessage(firstName: string, url: string): string {
  // Single conversational line followed by the link. WhatsApp drops
  // body text when it's separated from the URL by blank lines, so we
  // keep everything compact. No em dashes (house style).
  return `Hi ${firstName}, here's your Southern Escapes agent portal. Pick a property and submit enquiries directly through the link. Any questions, give me a shout. ${url}`;
}

function defaultSubject(): string {
  return 'Your Southern Escapes agent portal';
}

interface AgentLite {
  id: string;
  name: string;
  company?: string | null;
  email?: string | null;
}

export default function AgentPortalShareMenu({
  agent,
  onClose,
}: {
  agent: AgentLite;
  onClose: () => void;
}) {
  const toast = useToast();
  const firstName = titleCase((agent.name || '').split(' ')[0]);

  // Track the live token locally so the Reset action can refresh the
  // URL inside the open modal without remounting it.
  const [currentToken, setCurrentToken] = useState(() => getTokenForAgent(agent.id) || '');
  const url = getPortalUrl(currentToken);

  const [message, setMessage] = useState(defaultMessage(firstName, url));
  const [subject, setSubject] = useState(defaultSubject());
  const [copied, setCopied] = useState(false);

  async function copy() {
    try { await navigator.clipboard.writeText(url); }
    catch { /* fall through to toast */ }
    setCopied(true);
    toast.success('Portal link copied');
    setTimeout(() => setCopied(false), 2000);
  }

  function resetLink() {
    const ok = confirm(
      `This will stop the current link from working for ${titleCase(agent.name)}.\n\n` +
      `Their next visit to the old link will show "Link not valid". You'll need to send them the new link below via WhatsApp or Email.\n\n` +
      `Continue?`
    );
    if (!ok) return;
    const newToken = regenerateToken(agent.id);
    setCurrentToken(newToken);
    // Refresh the default message with the new URL. If Hayley had
    // already edited it, only the canonical link-only template gets
    // updated; we don't overwrite her custom text -- only re-apply
    // the default when it still looks like the default.
    const newUrl = getPortalUrl(newToken);
    setMessage(prev => prev.includes(url) ? prev.replace(url, newUrl) : defaultMessage(firstName, newUrl));
    toast.success('New link ready. Send it via WhatsApp or Email below.');
  }

  function stopAccess() {
    const ok = confirm(
      `This will turn off ${titleCase(agent.name)}'s portal access.\n\n` +
      `They will not be able to use any link until you turn it back on from the Agents page.\n\n` +
      `Continue?`
    );
    if (!ok) return;
    revokePortal(agent.id);
    toast.success(`Portal access stopped for ${titleCase(agent.name)}`);
    onClose();
  }

  const waHref = `https://wa.me/?text=${encodeURIComponent(message)}`;
  const mailHref = `mailto:${encodeURIComponent(agent.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;

  return (
    <ActionModal
      title="Share portal link"
      subtitle={
        <>
          To <strong>{titleCase(agent.name)}</strong>
          {agent.company && <> · {titleCase(agent.company)}</>}
        </>
      }
      width={520}
      hideFooter
      onClose={onClose}
    >
      <div style={{
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--s-3)',
        marginBottom: 'var(--s-4)',
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

      <div className="form-group" style={{ marginBottom: 'var(--s-3)' }}>
        <label className="form-label">Email subject</label>
        <input
          className="form-input"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </div>

      <div className="form-group" style={{ marginBottom: 'var(--s-4)' }}>
        <label className="form-label">Message</label>
        <textarea
          className="form-input"
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
          Edit before sending. The link is already included in the body.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
        <a
          className="btn btn-whatsapp"
          style={{ flex: 1, textAlign: 'center' }}
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          WhatsApp
        </a>
        <a
          className="btn btn-primary"
          style={{ flex: 1, textAlign: 'center' }}
          href={mailHref}
          aria-disabled={!agent.email}
          onClick={(e) => {
            if (!agent.email) {
              e.preventDefault();
              toast.warning('This agent has no email on file. Add one in the agent edit modal.');
            }
          }}
        >
          Email
        </a>
      </div>

      {/* Manage block. Lives at the bottom under a divider so the
          everyday "share" actions stay the visual centre of the
          modal. Plain English labels, not "regenerate / revoke". */}
      <div style={{
        marginTop: 'var(--s-5)',
        paddingTop: 'var(--s-4)',
        borderTop: '1px solid var(--border-light)',
      }}>
        <div style={{
          fontSize: '0.75rem',
          color: 'var(--text-secondary)',
          marginBottom: 'var(--s-3)',
        }}>
          Need to change something?
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
          <button
            type="button"
            className="btn btn-outline"
            style={{ flex: 1, fontSize: '0.8125rem' }}
            onClick={resetLink}
            title="Stop the current link and create a new one"
          >
            🔄 Reset link
          </button>
          <button
            type="button"
            className="btn btn-outline-danger"
            style={{ flex: 1, fontSize: '0.8125rem' }}
            onClick={stopAccess}
            title="Turn off this agent's portal access"
          >
            🚫 Stop access
          </button>
        </div>
      </div>
    </ActionModal>
  );
}
