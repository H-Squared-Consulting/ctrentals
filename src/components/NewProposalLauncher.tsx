/**
 * NewProposalLauncher -- triggered by the FAB's "New proposal" action.
 *
 * Two-step launcher:
 *   1. Property picker (searchable list of active properties).
 *   2. PricingModal opens for the picked property — from there the user
 *      runs the calculator and clicks Create Proposal, which fires the
 *      existing two-step Review → Recipient details flow.
 *
 * Visual language matches SendBrochurePicker so the FAB's two pickers feel
 * like siblings.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { CT_RENTALS_PARTNER_ID } from '../pages/constants';
import { SkeletonRows } from './Skeleton';
import EmptyState from './EmptyState';
import PricingModal from '../pages/PricingModal';
import type { EnquiryPrefill } from './CreateProposalModal';

interface Property {
  id: string;
  property_name: string;
  suburb: string | null;
  city: string | null;
  bedrooms: number | null;
  hero_image_url: string | null;
}

interface Props {
  onClose: () => void;
  /** When supplied, the chosen property's PricingModal is opened with this
   *  enquiry pre-filled, and the resulting proposal links back to the
   *  enquiry. Used by the New Enquiry page's post-save CTA. */
  enquiryPrefill?: EnquiryPrefill | null;
}

export default function NewProposalLauncher({ onClose, enquiryPrefill }: Props) {
  const { supabase } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Property | null>(null);

  // Load active properties on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('partner_properties')
        .select('id, property_name, suburb, city, bedrooms, hero_image_url, is_published')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .eq('is_published', true)
        .order('property_name');
      if (!cancelled) {
        setProperties(data || []);
        setLoading(false);
      }
    })();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !selected) onClose(); }
    document.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
    // Intentionally narrow deps so selecting/closing doesn't re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  const filtered = useMemo(() => {
    if (!search.trim()) return properties;
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
    return properties.filter(p => {
      const hay = [p.property_name, p.suburb, p.city].filter(Boolean).join(' ').toLowerCase();
      return terms.every(t => hay.includes(t));
    });
  }, [properties, search]);

  // Once a property is picked, hand off to PricingModal. The picker stays
  // mounted underneath but visually inert (its modal-overlay z-index is
  // below PricingModal's, so clicks land on the calculator).
  if (selected) {
    return (
      <PricingModal
        property={selected}
        supabase={supabase}
        enquiryPrefill={enquiryPrefill}
        onClose={() => { setSelected(null); onClose(); }}
      />
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '720px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="modal-header">
          <h2 className="modal-title">New Proposal — pick a property</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
          <input
            type="search"
            className="form-input"
            placeholder="Search properties by name or suburb…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            style={{ marginBottom: '12px' }}
          />

          {loading ? (
            <SkeletonRows count={5} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="🏠"
              title={search ? 'No properties match' : 'No active properties'}
              description={search ? 'Try a different search term.' : 'Publish a property first.'}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filtered.map(p => (
                <button
                  key={p.id}
                  className="prop-select-row prop-select-row--active"
                  onClick={() => setSelected(p)}
                  style={{ textAlign: 'left', border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer' }}
                >
                  {p.hero_image_url && (
                    <img src={p.hero_image_url} alt="" className="prop-select-thumb" />
                  )}
                  <div className="prop-select-info">
                    <span className="prop-select-name">{p.property_name}</span>
                    <span className="prop-select-meta">
                      {p.bedrooms ? `${p.bedrooms} bed` : ''}{p.suburb ? ` · ${p.suburb}` : ''}{p.city && p.city !== p.suburb ? `, ${p.city}` : ''}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', alignSelf: 'center' }}>→</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
