/* eslint-disable */
// @ts-nocheck
/**
 * SendBrochurePicker — modal opened by the FAB "Send brochure" action.
 * Lists every active property in a searchable card grid; each row exposes
 * Copy / WhatsApp / Email buttons that act on that property's public
 * brochure URL. Inactive (archived) properties are deliberately excluded —
 * they don't have a published brochure.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { CT_RENTALS_PARTNER_ID } from '../pages/constants';
import { useToast } from './ToastProvider';
import { SkeletonRows } from './Skeleton';
import EmptyState from './EmptyState';
import ActionModal from './ActionModal';

type ShareMode = 'branded' | 'agent';
const AGENT_DOMAIN = (import.meta as any).env?.VITE_AGENT_DOMAIN || 'ctvilla.co.za';
const BRAND_DOMAIN = (import.meta as any).env?.VITE_BRAND_DOMAIN || 'southernescapes.co.za';

export default function SendBrochurePicker({ onClose }: { onClose: () => void }) {
  const { supabase, user } = useAuth();
  const toast = useToast();
  const [properties, setProperties] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [mode, setMode] = useState<ShareMode>('branded');

  useEffect(() => {
    // ActionModal owns the body-scroll lock and Escape handling.
    // This effect just loads the property list once on mount.
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('partner_properties')
        .select('id, slug, property_name, suburb, city, hero_image_url, is_published')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .eq('is_published', true)
        .order('property_name');
      if (!cancelled) {
        setProperties(data || []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  const filtered = useMemo(() => {
    if (!search) return properties;
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
    return properties.filter(p => {
      const text = [p.property_name, p.suburb, p.city].filter(Boolean).join(' ').toLowerCase();
      return terms.every(t => text.includes(t));
    });
  }, [properties, search]);

  function brochureUrl(p: any) {
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
    const fromEmail = user?.email || null;
    const join = path.indexOf('?') === -1 ? '?' : '&';
    const fromQs = fromEmail ? `${join}from=${encodeURIComponent(fromEmail)}` : '';
    return `https://${BRAND_DOMAIN}${path}${fromQs}`;
  }

  async function copy(p: any) {
    const url = brochureUrl(p);
    try { await navigator.clipboard.writeText(url); }
    catch { /* clipboard blocked — silently fall through */ }
    setCopied(p.id);
    toast.success(`Link to ${p.property_name} copied`);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <ActionModal title="Send a brochure" width={720} hideFooter onClose={onClose}>
      {/* Branded vs Agent mode applies to every property in the list. */}
      <div className="bsm-mode" style={{ marginBottom: 'var(--s-3)' }}>
        <button type="button" className={`bsm-mode-btn ${mode === 'branded' ? 'is-active' : ''}`} onClick={() => setMode('branded')}>
          <div className="bsm-mode-title">Branded</div>
          <div className="bsm-mode-sub">Company link, full branding</div>
        </button>
        <button type="button" className={`bsm-mode-btn ${mode === 'agent' ? 'is-active' : ''}`} onClick={() => setMode('agent')}>
          <div className="bsm-mode-title">Agent</div>
          <div className="bsm-mode-sub">Neutral link, no branding</div>
        </button>
      </div>
      <div className="list-search" style={{ marginBottom: 'var(--s-3)' }}>
        <span className="list-search-icon">🔍</span>
        <input
          type="text"
          placeholder="Find a property…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        {search && <button className="list-search-clear" onClick={() => setSearch('')}>✕</button>}
      </div>

      {loading ? (
        <SkeletonRows count={6} cols={2} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="🔎"
          title={properties.length === 0 ? 'No active brochures' : 'Nothing matches your search'}
          description={properties.length === 0
            ? 'Add or reactivate a property to send its brochure.'
            : 'Try a different search term.'}
        />
      ) : (
        <ul className="sbp-list">
          {filtered.map(p => {
            const url = brochureUrl(p);
            const subject = encodeURIComponent(`${p.property_name} brochure`);
            const body = encodeURIComponent(`Have a look at this brochure: ${url}`);
            const wa = encodeURIComponent(`Brochure for ${p.property_name}: ${url}`);
            return (
              <li key={p.id} className="sbp-row">
                <div className="sbp-thumb">
                  {p.hero_image_url
                    ? <img src={p.hero_image_url} alt="" loading="lazy" />
                    : <div className="sbp-thumb-empty">🏠</div>}
                </div>
                <div className="sbp-meta">
                  <div className="sbp-name">{p.property_name}</div>
                  <div className="sbp-loc">{[p.suburb, p.city].filter(Boolean).join(', ')}</div>
                </div>
                <div className="sbp-actions">
                  <button className="btn btn-primary" style={{ fontSize: '0.75rem' }} onClick={() => copy(p)}>
                    {copied === p.id ? '✓ Copied' : '🔗 Copy'}
                  </button>
                  <a className="btn btn-ghost" style={{ fontSize: '0.75rem' }} href={`https://wa.me/?text=${wa}`} target="_blank" rel="noopener noreferrer">
                    💬 WhatsApp
                  </a>
                  <a className="btn btn-ghost" style={{ fontSize: '0.75rem' }} href={`mailto:?subject=${subject}&body=${body}`}>
                    ✉️ Email
                  </a>
                  <a className="btn btn-ghost" style={{ fontSize: '0.75rem' }} href={url} target="_blank" rel="noopener noreferrer">
                    👁 Preview
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ActionModal>
  );
}
