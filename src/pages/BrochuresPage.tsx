import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import { CT_RENTALS_PARTNER_ID } from './constants';

interface Property {
  id: string;
  property_name: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sleeps: number | null;
  suburb: string | null;
  city: string | null;
  hero_image_url: string | null;
  is_published: boolean;
}

function getBrochureUrl(propertyId: string) {
  return `${window.location.origin}/brochure.html?id=${propertyId}`;
}

export default function BrochuresPage() {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();

  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => { setPageTitle('House Brochures'); }, [setPageTitle]);

  async function loadProperties() {
    setLoading(true);
    const { data, error } = await supabase
      .from('partner_properties')
      .select('id, property_name, bedrooms, bathrooms, sleeps, suburb, city, hero_image_url, is_published')
      .eq('partner_id', CT_RENTALS_PARTNER_ID)
      .order('property_name');
    if (!error && data) setProperties(data as Property[]);
    setLoading(false);
  }

  useEffect(() => { if (supabase) loadProperties(); }, [supabase]);

  const filtered = useMemo(() => {
    if (!searchQuery) return properties;
    const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    return properties.filter(p => {
      const text = [p.property_name, p.suburb, p.city].filter(Boolean).join(' ').toLowerCase();
      return terms.every(t => text.includes(t));
    });
  }, [properties, searchQuery]);

  function copyLink(propertyId: string) {
    navigator.clipboard.writeText(getBrochureUrl(propertyId));
    setCopied(propertyId);
    setTimeout(() => setCopied(null), 2000);
  }

  if (loading) return <div className="page-loader"><div className="spinner" /></div>;

  return (
    <div>
      {/* Toolbar */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            <div className="list-search" style={{ maxWidth: '300px' }}>
              <span className="list-search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search properties..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && <button className="list-search-clear" onClick={() => setSearchQuery('')}>✕</button>}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
              {filtered.length} properties
            </span>
          </div>
        </div>
      </div>

      {/* Property Grid */}
      <div className="brochure-grid">
        {filtered.length === 0 ? (
          <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
            <p className="empty-state-message">No properties found.</p>
          </div>
        ) : (
          filtered.map(property => (
            <div key={property.id} className="brochure-card">
              <div className="brochure-card__image">
                {property.hero_image_url ? (
                  <img src={property.hero_image_url} alt={property.property_name} />
                ) : (
                  <div className="brochure-card__no-image">🏠</div>
                )}
              </div>
              <div className="brochure-card__body">
                <h3 className="brochure-card__name">{property.property_name}</h3>
                {property.suburb && (
                  <p className="brochure-card__location">{[property.suburb, property.city].filter(Boolean).join(', ')}</p>
                )}
                <div className="brochure-card__stats">
                  {property.bedrooms != null && property.bedrooms > 0 && (
                    <span className="brochure-card__stat">{property.bedrooms} bed{property.bedrooms !== 1 ? 's' : ''}</span>
                  )}
                  {property.bathrooms != null && property.bathrooms > 0 && (
                    <span className="brochure-card__stat">{property.bathrooms} bath</span>
                  )}
                  {property.sleeps != null && property.sleeps > 0 && (
                    <span className="brochure-card__stat">{property.sleeps} guests</span>
                  )}
                </div>
              </div>
              <div className="brochure-card__actions">
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: '0.75rem' }}
                  onClick={() => copyLink(property.id)}
                >
                  {copied === property.id ? '✓ Copied' : '🔗 Copy Link'}
                </button>
                <a
                  className="btn btn-outline"
                  style={{ fontSize: '0.75rem' }}
                  href={getBrochureUrl(property.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  👁 Preview
                </a>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
