import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import DataTable from '../components/DataTable';
import type { DataRow } from '../components/DataTable';
import PropertyEditModal from './PropertyEditModal';
import PricingModal from './PricingModal';
import { CT_RENTALS_PARTNER_ID, PROPERTY_TYPE_OPTIONS } from './constants';

interface Property extends DataRow {
  id: string;
  property_name: string;
  slug: string | null;
  tagline: string | null;
  suburb: string | null;
  city: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sleeps: number | null;
  price_from: number | null;
  price_currency: string | null;
  property_type: string | null;
  hero_image_url: string | null;
  amenity_tags: string[] | null;
  is_published: boolean;
}

type ViewMode = 'cards' | 'table';

export default function PropertiesPage() {
  const { supabase, user } = useAuth();
  const { setPageTitle } = useLayout();

  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [searchQuery, setSearchQuery] = useState('');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editingProperty, setEditingProperty] = useState<any | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pricingProperty, setPricingProperty] = useState<any | null>(null);

  useEffect(() => { setPageTitle('Properties'); }, [setPageTitle]);

  async function loadProperties() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('partner_properties')
        .select('*')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .order('bedrooms', { ascending: false });

      if (error) throw error;
      setProperties((data as Property[]) || []);
    } catch (err) {
      console.error('Error loading properties:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (supabase) loadProperties();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  const filteredProperties = useMemo(() => {
    if (!searchQuery) return properties;
    const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    return properties.filter(p => {
      const text = [p.property_name, p.suburb, p.city].filter(Boolean).join(' ').toLowerCase();
      return terms.every(t => text.includes(t));
    });
  }, [properties, searchQuery]);

  const columns = [
    { key: 'property_name', label: 'Property Name', sortable: true },
    {
      key: 'suburb', label: 'Suburb', sortable: true, hideOnMobile: true,
      render: (row: DataRow) => (row as Property).suburb || <span className="text-light">-</span>,
    },
    {
      key: 'bedrooms', label: 'Bedrooms', align: 'center' as const, sortable: true, width: '90px',
      render: (row: DataRow) => (row as Property).bedrooms ?? '-',
    },
    {
      key: 'sleeps', label: 'Sleeps', align: 'center' as const, sortable: true, width: '70px',
      render: (row: DataRow) => (row as Property).sleeps ?? '-',
    },
    {
      key: 'price_from', label: 'Price From', align: 'right' as const, sortable: true, hideOnMobile: true,
      render: (row: DataRow) => {
        const p = row as Property;
        if (!p.price_from) return <span className="text-light">-</span>;
        return `${p.price_currency || 'ZAR'} ${Number(p.price_from).toLocaleString()}`;
      },
    },
    {
      key: 'property_type', label: 'Type', hideOnMobile: true,
      render: (row: DataRow) => {
        const p = row as Property;
        const opt = PROPERTY_TYPE_OPTIONS.find((o) => o.value === p.property_type);
        return opt ? opt.label : p.property_type || <span className="text-light">-</span>;
      },
    },
    {
      key: 'is_published', label: 'Status', align: 'center' as const,
      render: (row: DataRow) => (row as Property).is_published
        ? <span className="status-badge" style={{ background: '#D1FAE5', color: '#059669' }}>Active</span>
        : <span className="status-badge" style={{ background: '#F3F4F6', color: '#6B7280' }}>Inactive</span>,
    },
  ];

  const activeCount = properties.filter(p => p.is_published).length;
  const inactiveCount = properties.length - activeCount;

  if (loading) {
    return <div className="page-loader"><div className="spinner" /></div>;
  }

  return (
    <div>
      {/* ── Summary Cards ── */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="summary-cards">
          <div className="summary-card summary-card--primary">
            <div className="summary-card__value">{properties.length}</div>
            <div className="summary-card__label">Total Properties</div>
          </div>
          <div className="summary-card summary-card--success">
            <div className="summary-card__value">{activeCount}</div>
            <div className="summary-card__label">Active</div>
          </div>
          <div className="summary-card summary-card--warning">
            <div className="summary-card__value">{inactiveCount}</div>
            <div className="summary-card__label">Inactive</div>
          </div>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            <div className="list-search">
              <span className="list-search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search properties..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="list-search-clear" onClick={() => setSearchQuery('')}>✕</button>
              )}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
              {filteredProperties.length} of {properties.length}
            </span>
          </div>
          <div className="list-toolbar-right">
            <div className="view-toggle">
              <button
                className={`view-toggle-btn ${viewMode === 'cards' ? 'active' : ''}`}
                onClick={() => setViewMode('cards')}
                title="Card view"
              >
                ▦
              </button>
              <button
                className={`view-toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
                onClick={() => setViewMode('table')}
                title="Table view"
              >
                ☰
              </button>
            </div>
            <button className="btn btn-ghost" onClick={() => loadProperties()}>↻ Refresh</button>
            <button className="btn btn-primary" onClick={() => setEditingProperty({})}>+ Add Property</button>
          </div>
        </div>
      </div>

      {/* ── Card View ── */}
      {viewMode === 'cards' && (
        <div className="property-grid">
          {filteredProperties.length === 0 ? (
            <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
              <p className="empty-state-message">No properties found.</p>
            </div>
          ) : (
            filteredProperties.map(property => (
              <div
                key={property.id}
                className="property-card"
                onClick={() => setEditingProperty(property)}
              >
                <div className="property-card__image">
                  {property.hero_image_url ? (
                    <img src={property.hero_image_url} alt={property.property_name} />
                  ) : (
                    <div className="property-card__no-image">🏠</div>
                  )}
                  {property.is_published
                    ? <span className="property-card__badge property-card__badge--active">Active</span>
                    : <span className="property-card__badge property-card__badge--inactive">Inactive</span>
                  }
                </div>
                <div className="property-card__body">
                  <h3 className="property-card__name">{property.property_name}</h3>
                  {property.suburb && (
                    <p className="property-card__location">{[property.suburb, property.city].filter(Boolean).join(', ')}</p>
                  )}
                  {property.tagline && (
                    <p className="property-card__tagline">{property.tagline}</p>
                  )}
                  <div className="property-card__stats">
                    {property.bedrooms != null && property.bedrooms > 0 && (
                      <span className="property-card__stat">🛏 {property.bedrooms} bed{property.bedrooms !== 1 ? 's' : ''}</span>
                    )}
                    {property.bathrooms != null && property.bathrooms > 0 && (
                      <span className="property-card__stat">🚿 {property.bathrooms} bath</span>
                    )}
                    {property.sleeps != null && property.sleeps > 0 && (
                      <span className="property-card__stat">👤 {property.sleeps} guests</span>
                    )}
                  </div>
                  {property.price_from != null && property.price_from > 0 && (
                    <div className="property-card__price">
                      {property.price_currency || 'ZAR'} {Number(property.price_from).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      <span className="property-card__price-label"> / week</span>
                    </div>
                  )}
                </div>
                <div className="property-card__footer">
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: '0.75rem' }}
                    onClick={(e) => { e.stopPropagation(); setEditingProperty(property); }}
                  >
                    ✏️ Edit
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: '0.75rem' }}
                    onClick={(e) => { e.stopPropagation(); setPricingProperty(property); }}
                  >
                    💰 Pricing
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Table View ── */}
      {viewMode === 'table' && (
        <DataTable
          columns={columns}
          data={properties}
          loading={false}
          searchable={false}
          defaultSort={{ key: 'bedrooms', direction: 'desc' }}
          headerActions={undefined}
          actions={(row: DataRow) => (
            <div style={{ display: 'flex', gap: '4px' }}>
              <span
                className="action-icon"
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); setEditingProperty(row as Property); }}
                title="Edit property"
              >
                ✏️
              </span>
              <span
                className="action-icon"
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); setPricingProperty(row as Property); }}
                title="Pricing"
              >
                💰
              </span>
            </div>
          )}
          onRowClick={(row: DataRow) => setEditingProperty(row as Property)}
          pageSize={25}
          emptyMessage="No properties yet."
        />
      )}

      {/* ── Edit Modal ── */}
      {editingProperty && (
        <PropertyEditModal
          property={editingProperty}
          partnerId={CT_RENTALS_PARTNER_ID}
          onClose={() => setEditingProperty(null)}
          onSave={async () => { setEditingProperty(null); await loadProperties(); }}
          supabase={supabase}
          user={user}
        />
      )}

      {/* ── Pricing Modal ── */}
      {pricingProperty && (
        <PricingModal
          property={pricingProperty}
          onClose={() => setPricingProperty(null)}
          supabase={supabase}
        />
      )}
    </div>
  );
}
