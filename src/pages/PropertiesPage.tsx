import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import DataTable from '../components/DataTable';
import type { DataRow } from '../components/DataTable';
import PropertyEditModal from './PropertyEditModal';
import PricingModal from './PricingModal';
import EmptyState from '../components/EmptyState';
import { SkeletonGrid } from '../components/Skeleton';
import BrochureShareMenu from '../components/BrochureShareMenu';
import { useToast } from '../components/ToastProvider';
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
  const toast = useToast();

  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [searchQuery, setSearchQuery] = useState('');
  // Distinguishing-attribute filters. "" / 0 means "no constraint".
  const [minBeds, setMinBeds] = useState<string>('');
  const [minBaths, setMinBaths] = useState<string>('');
  const [minSleeps, setMinSleeps] = useState<string>('');
  const [suburbFilter, setSuburbFilter] = useState<string>('');
  // Hide inactive (unpublished) properties by default — they're parked, not
  // working stock. The user flips this on when they want to reactivate one.
  const [showInactive, setShowInactive] = useState(false);
  // Two-step confirm for archiving — first click arms, second click commits.
  // Auto-cancels after a few seconds if the user doesn't follow through.
  const [confirmingArchive, setConfirmingArchive] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmingArchive) return;
    const t = setTimeout(() => setConfirmingArchive(null), 5000);
    return () => clearTimeout(t);
  }, [confirmingArchive]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editingProperty, setEditingProperty] = useState<any | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pricingProperty, setPricingProperty] = useState<any | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sharingProperty, setSharingProperty] = useState<any | null>(null);

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

  const inactiveCount = useMemo(
    () => properties.filter(p => !p.is_published).length,
    [properties],
  );

  // Unique suburbs (from the visible active/inactive list) populate the
  // suburb filter dropdown. Sorted A→Z so the user can scan it quickly.
  const suburbOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of properties) {
      if (p.suburb) set.add(p.suburb);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [properties]);

  const filteredProperties = useMemo(() => {
    // First filter by active state — only active shown unless the user
    // explicitly flips the inactive toggle. Then narrow by search and
    // by the distinguishing-attribute filters.
    let list = showInactive
      ? properties.filter(p => !p.is_published)
      : properties.filter(p => p.is_published);
    if (searchQuery) {
      const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter(p => {
        const text = [p.property_name, p.suburb, p.city].filter(Boolean).join(' ').toLowerCase();
        return terms.every(t => text.includes(t));
      });
    }
    const beds = Number(minBeds);
    if (beds > 0) list = list.filter(p => (p.bedrooms ?? 0) >= beds);
    const baths = Number(minBaths);
    if (baths > 0) list = list.filter(p => (p.bathrooms ?? 0) >= baths);
    const sleeps = Number(minSleeps);
    if (sleeps > 0) list = list.filter(p => (p.sleeps ?? 0) >= sleeps);
    if (suburbFilter) list = list.filter(p => p.suburb === suburbFilter);
    return list;
  }, [properties, searchQuery, showInactive, minBeds, minBaths, minSleeps, suburbFilter]);

  const filtersActive = !!(minBeds || minBaths || minSleeps || suburbFilter);
  function clearFilters() {
    setMinBeds(''); setMinBaths(''); setMinSleeps(''); setSuburbFilter('');
  }

  async function makeActive(propertyId: string) {
    try {
      const { error } = await supabase
        .from('partner_properties')
        .update({ is_published: true })
        .eq('id', propertyId);
      if (error) throw error;
      setProperties(prev => prev.map(p => p.id === propertyId ? { ...p, is_published: true } : p));
      toast.success('Property activated');
    } catch (err: any) {
      toast.error('Failed to activate: ' + (err?.message || err));
    }
  }

  async function makeInactive(propertyId: string) {
    try {
      const { error } = await supabase
        .from('partner_properties')
        .update({ is_published: false })
        .eq('id', propertyId);
      if (error) throw error;
      setProperties(prev => prev.map(p => p.id === propertyId ? { ...p, is_published: false } : p));
      toast.success('Property archived');
    } catch (err: any) {
      toast.error('Failed to archive: ' + (err?.message || err));
    }
  }

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


  if (loading) {
    // Skeleton stand-in matches the real card grid layout so there's no
    // flash-of-blank when data arrives — feels like the page is filling in.
    return (
      <div>
        <div className="card" style={{ marginBottom: '16px', height: 48 }}>
          <div className="skeleton skeleton-fill" />
        </div>
        <SkeletonGrid count={8} />
      </div>
    );
  }

  // When editing or creating, render the editor in place of the property
  // list rather than overlaying it — keeps the top nav + page chrome
  // continuous with the rest of the platform.
  if (editingProperty) {
    return (
      <PropertyEditModal
        property={editingProperty}
        partnerId={CT_RENTALS_PARTNER_ID}
        onClose={() => setEditingProperty(null)}
        onSave={async () => { setEditingProperty(null); await loadProperties(); }}
        supabase={supabase}
        user={user}
      />
    );
  }

  return (
    <div>
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
              {filteredProperties.length} {showInactive ? 'inactive' : 'active'}
              {properties.length !== filteredProperties.length && ` of ${properties.length} total`}
            </span>
            {/* Distinguishing-attribute filters — bedrooms, bathrooms,
                sleeps, suburb. Compact selects so they fit inline with
                search; show Clear when anything's active. */}
            <select
              className="list-filter-select"
              value={minBeds}
              onChange={(e) => setMinBeds(e.target.value)}
              title="Filter by minimum bedrooms"
            >
              <option value="">Beds: any</option>
              {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}+ beds</option>)}
            </select>
            <select
              className="list-filter-select"
              value={minBaths}
              onChange={(e) => setMinBaths(e.target.value)}
              title="Filter by minimum bathrooms"
            >
              <option value="">Baths: any</option>
              {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}+ baths</option>)}
            </select>
            <select
              className="list-filter-select"
              value={minSleeps}
              onChange={(e) => setMinSleeps(e.target.value)}
              title="Filter by minimum guests"
            >
              <option value="">Sleeps: any</option>
              {[2,4,6,8,10,12,14,16].map(n => <option key={n} value={n}>{n}+ guests</option>)}
            </select>
            <select
              className="list-filter-select"
              value={suburbFilter}
              onChange={(e) => setSuburbFilter(e.target.value)}
              title="Filter by suburb"
            >
              <option value="">Suburb: any</option>
              {suburbOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {filtersActive && (
              <button className="btn btn-ghost" style={{ fontSize: '0.75rem' }} onClick={clearFilters}>
                Clear filters
              </button>
            )}
            {/* Active / Inactive toggle — minimal but obvious. */}
            <label className="list-toolbar-toggle" title={showInactive ? 'Show active properties' : 'Show inactive (archived) properties'}>
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              <span>Show inactive ({inactiveCount})</span>
            </label>
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
            <div style={{ gridColumn: '1 / -1' }}>
              <EmptyState
                icon={showInactive ? '📥' : '🏡'}
                title={
                  showInactive
                    ? (inactiveCount === 0 ? 'No inactive properties' : 'No inactive properties match your search')
                    : (properties.length === 0 ? 'No properties yet' : 'No active properties match your search')
                }
                description={
                  showInactive
                    ? 'Properties you archive will show up here. They keep all their data and can be reactivated at any time.'
                    : (properties.length === 0
                        ? 'Add your first property to start building brochures.'
                        : 'Try a different search term, or toggle "Show inactive" to look in the archive.')
                }
                action={!showInactive && properties.length === 0 ? (
                  <button className="btn btn-primary" onClick={() => setEditingProperty({})}>+ Add property</button>
                ) : null}
              />
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
                  {property.is_published && (
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: '0.75rem' }}
                      onClick={(e) => { e.stopPropagation(); setSharingProperty(property); }}
                      title="Share or preview this property's brochure"
                    >
                      📄 Brochure
                    </button>
                  )}
                  {property.is_published ? (
                    confirmingArchive === property.id ? (
                      <>
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: '0.75rem' }}
                          onClick={(e) => { e.stopPropagation(); setConfirmingArchive(null); }}
                        >
                          Cancel
                        </button>
                        <button
                          className="btn btn-danger"
                          style={{ fontSize: '0.75rem' }}
                          onClick={(e) => { e.stopPropagation(); makeInactive(property.id); setConfirmingArchive(null); }}
                        >
                          Yes, archive
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}
                        onClick={(e) => { e.stopPropagation(); setConfirmingArchive(property.id); }}
                        title="Archive — hides this property from the public brochure list"
                      >
                        📥 Archive
                      </button>
                    )
                  ) : (
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: '0.75rem' }}
                      onClick={(e) => { e.stopPropagation(); makeActive(property.id); }}
                    >
                      ✓ Make active
                    </button>
                  )}
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
          data={filteredProperties}
          loading={false}
          searchable={false}
          defaultSort={{ key: 'bedrooms', direction: 'desc' }}
          headerActions={undefined}
          actions={(row: DataRow) => {
            const r = row as Property;
            return (
              <div style={{ display: 'flex', gap: '4px' }}>
                <span
                  className="action-icon"
                  onClick={(e: React.MouseEvent) => { e.stopPropagation(); setEditingProperty(r); }}
                  title="Edit property"
                >
                  ✏️
                </span>
                <span
                  className="action-icon"
                  onClick={(e: React.MouseEvent) => { e.stopPropagation(); setPricingProperty(r); }}
                  title="Pricing"
                >
                  💰
                </span>
                {r.is_published && (
                  <span
                    className="action-icon"
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); setSharingProperty(r); }}
                    title="Share or preview brochure"
                  >
                    📄
                  </span>
                )}
                {r.is_published ? (
                  confirmingArchive === r.id ? (
                    <span
                      className="action-icon"
                      style={{ color: 'var(--color-danger)', fontWeight: 700 }}
                      onClick={(e: React.MouseEvent) => { e.stopPropagation(); makeInactive(r.id); setConfirmingArchive(null); }}
                      title="Click again to confirm archive"
                    >
                      Confirm?
                    </span>
                  ) : (
                    <span
                      className="action-icon"
                      onClick={(e: React.MouseEvent) => { e.stopPropagation(); setConfirmingArchive(r.id); }}
                      title="Archive"
                    >
                      📥
                    </span>
                  )
                ) : (
                  <span
                    className="action-icon"
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); makeActive(r.id); }}
                    title="Make active"
                  >
                    ✓
                  </span>
                )}
              </div>
            );
          }}
          onRowClick={(row: DataRow) => setEditingProperty(row as Property)}
          pageSize={25}
          emptyMessage={showInactive ? 'No inactive properties.' : 'No active properties yet.'}
        />
      )}

      {/* PropertyEditModal renders in place of this whole list when
          editingProperty is set — handled at the top of this component. */}

      {/* ── Pricing Modal ── */}
      {pricingProperty && (
        <PricingModal
          property={pricingProperty}
          onClose={() => setPricingProperty(null)}
          supabase={supabase}
        />
      )}

      {/* ── Share brochure (per-property quick send) ── */}
      {sharingProperty && (
        <BrochureShareMenu
          property={sharingProperty}
          onClose={() => setSharingProperty(null)}
        />
      )}

    </div>
  );
}
