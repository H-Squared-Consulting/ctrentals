/* eslint-disable */
// @ts-nocheck
/**
 * BrochureShareMenu — small modal triggered from the property card's
 * Brochure button. Surfaces the same share actions as the SendBrochurePicker
 * (copy / WhatsApp / email / preview) but scoped to a single property.
 *
 * Two share modes:
 *   - "Branded" → the company-domain URL with company branding visible.
 *   - "Agent"   → the neutral URL with branding stripped + an "Enquire
 *                 through your agent" panel. Useful when sharing with an
 *                 agent who doesn't want their client going direct.
 *
 * Until the neutral domain is registered, the agent variant is just the
 * same origin with ?brand=agent appended — the brochure template reads
 * that param and swaps the contact block accordingly. When the real
 * neutral domain exists, set VITE_AGENT_DOMAIN and the agent URL flips
 * over without any other code change.
 */
import { useState } from 'react';
import { useToast } from './ToastProvider';
import { useAuth } from '../contexts/AuthContext';
import ActionModal from './ActionModal';

type Mode = 'branded' | 'agent';

const AGENT_DOMAIN = (import.meta as any).env?.VITE_AGENT_DOMAIN || 'ctvilla.co.za';
const BRAND_DOMAIN = (import.meta as any).env?.VITE_BRAND_DOMAIN || 'southernescapes.co.za';

function brochureUrl(p: any, mode: Mode, fromEmail: string | null) {
  const path = p.slug
    ? `/brochures/${encodeURIComponent(p.slug)}`
    : `/brochure.html?id=${encodeURIComponent(p.id)}`;
  if (mode === 'agent') {
    if (AGENT_DOMAIN) return `https://${AGENT_DOMAIN}${path}`;
    // Fallback for testing before the neutral domain is registered.
    const join = path.indexOf('?') === -1 ? '?' : '&';
    return `https://${BRAND_DOMAIN}${path}${join}brand=agent`;
  }
  // Branded link carries the admin's email so the brochure's "Book Direct"
  // panel shows the person who shared it as the point of contact.
  const join = path.indexOf('?') === -1 ? '?' : '&';
  const fromQs = fromEmail ? `${join}from=${encodeURIComponent(fromEmail)}` : '';
  return `https://${BRAND_DOMAIN}${path}${fromQs}`;
}

export default function BrochureShareMenu({
  property,
  onClose,
}: {
  property: { id: string; slug?: string | null; property_name: string; hero_image_url?: string | null; suburb?: string | null; city?: string | null };
  onClose: () => void;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<Mode>('branded');

  const url = brochureUrl(property, mode, user?.email || null);
  const subject = encodeURIComponent(`${property.property_name} brochure`);
  const body = encodeURIComponent(`Have a look at this brochure: ${url}`);
  const wa = encodeURIComponent(`Brochure for ${property.property_name}: ${url}`);

  async function copy() {
    try { await navigator.clipboard.writeText(url); }
    catch { /* ignore — fall through to toast */ }
    setCopied(true);
    toast.success(`${mode === 'agent' ? 'Agent link' : 'Branded link'} copied`);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <ActionModal title="Share brochure" width={440} hideFooter onClose={onClose}>
      <div className="bsm-card">
        <div className="bsm-thumb">
          {property.hero_image_url
            ? <img src={property.hero_image_url} alt="" loading="lazy" />
            : <div className="bsm-thumb-empty">🏠</div>}
        </div>
        <div>
          <div className="bsm-name">{property.property_name}</div>
          <div className="bsm-loc">{[property.suburb, property.city].filter(Boolean).join(', ')}</div>
        </div>
      </div>

      {/* Branded vs Agent link toggle. Agents won't share a branded URL
          that lets their client go direct — this lets the user pick. */}
      <div className="bsm-mode">
        <button
          type="button"
          className={`bsm-mode-btn ${mode === 'branded' ? 'is-active' : ''}`}
          onClick={() => setMode('branded')}
        >
          <div className="bsm-mode-title">Branded</div>
          <div className="bsm-mode-sub">Company link, full branding</div>
        </button>
        <button
          type="button"
          className={`bsm-mode-btn ${mode === 'agent' ? 'is-active' : ''}`}
          onClick={() => setMode('agent')}
        >
          <div className="bsm-mode-title">Agent</div>
          <div className="bsm-mode-sub">Neutral link, no branding</div>
        </button>
      </div>

      <div className="bsm-link">
        <span className="bsm-link-url" title={url}>{url}</span>
        <button className="btn btn-primary" style={{ fontSize: '0.75rem' }} onClick={copy}>
          {copied ? '✓ Copied' : '🔗 Copy'}
        </button>
      </div>

      <div className="bsm-actions">
        <a className="btn btn-outline" href={`https://wa.me/?text=${wa}`} target="_blank" rel="noopener noreferrer">
          💬 WhatsApp
        </a>
        <a className="btn btn-outline" href={`mailto:?subject=${subject}&body=${body}`}>
          ✉️ Email
        </a>
        <a className="btn btn-outline" href={url} target="_blank" rel="noopener noreferrer">
          👁 Preview
        </a>
      </div>
    </ActionModal>
  );
}
