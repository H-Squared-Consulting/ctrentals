import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import DataTable from '../components/DataTable';
import type { DataRow } from '../components/DataTable';
import PropertyEditModal from './PropertyEditModal';
import PricingModal from './PricingModal';
import BrochureShareMenu from '../components/BrochureShareMenu';
import EmptyState from '../components/EmptyState';
import { SkeletonGrid } from '../components/Skeleton';
import { useToast } from '../components/ToastProvider';
import MultiPicker from '../components/MultiPicker';
import { CT_RENTALS_PARTNER_ID, PROPERTY_TYPE_OPTIONS } from './constants';
import { peakDirectGuestRate } from '../lib/displayRate';

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
  is_archived: boolean;
  /** 'system' = baseline-driven, 'fixed' = property_fixed_rates carries
   *  the per-season guest rate directly. Drives which source the card
   *  displays as Direct. */
  pricing_mode: 'system' | 'fixed' | null;
  // Operational link bag — same JSONB column the External listing URLs
  // editor writes to. `guidebook` is reserved for the hostful.ly /
  // similar back-of-house digital guide for the property.
  listing_urls: Record<string, string> | null;
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
  // Distinguishing-attribute filters: multi-select per exact value so
  // "show me 3 OR 4 bedrooms" works without dragging in 5+ as well.
  // Empty array = no constraint on that field.
  const [bedCounts, setBedCounts] = useState<number[]>([]);
  const [bathCounts, setBathCounts] = useState<number[]>([]);
  const [sleepCounts, setSleepCounts] = useState<number[]>([]);
  const [suburbFilter, setSuburbFilter] = useState<string[]>([]);
  /** Card view sort. Table view sorts via DataTable's column headers.
   *  Key + direction encoded as one string so a native select works. */
  type SortKey =
    | 'bedrooms-desc' | 'bedrooms-asc'
    | 'property_name-asc' | 'property_name-desc'
    | 'suburb-asc'
    | 'sleeps-desc' | 'sleeps-asc'
    | 'dailyrate-desc' | 'dailyrate-asc';
  const [sortKey, setSortKey] = useState<SortKey>('bedrooms-desc');
  // Property whose Share dialog (Branded / Agent variant picker) is open.
  // Both the card's Copy and Preview buttons route here so the user picks
  // which brochure variant before sharing — otherwise the choice silently
  // defaults to branded.
  const [sharingProperty, setSharingProperty] = useState<Property | null>(null);
  // Status filter — default Active, with explicit options for the other
  // two buckets plus an "All" view. Replaces the prior pair of checkboxes
  // so the toolbar stays on one line.
  type StatusFilter = 'active' | 'inactive' | 'archived' | 'all';
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editingProperty, setEditingProperty] = useState<any | null>(null);
  /** Edit vs view-only entry point. Card click → view; Edit button → edit;
   *  + Add Property → edit (new properties are inherently edits). */
  const [editorMode, setEditorMode] = useState<'view' | 'edit'>('edit');
  /** Per-row "busy" flag while a publish toggle is in flight. Keeps the
   *  button disabled so a stray double-click can't fire two updates. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pricingProperty, setPricingProperty] = useState<any | null>(null);

  useEffect(() => { setPageTitle('Properties'); }, [setPageTitle]);

  // Property → peak Direct guest rate (matching /price-list's
  // Direct column). System-mode properties: directGuestRate(baseline).
  // Fixed-mode properties: the peak property_fixed_rates.guest_rate
  // for the current year. Computed once on load via the canonical
  // helper so the cards never disagree with the Price List.
  const [directRateById, setDirectRateById] = useState<Record<string, number>>({});

  async function loadProperties() {
    try {
      setLoading(true);
      const year = new Date().getFullYear();
      const [pRes, bRes, seasonRes] = await Promise.all([
        supabase
          .from('partner_properties')
          .select('*')
          .eq('partner_id', CT_RENTALS_PARTNER_ID)
          .order('bedrooms', { ascending: false }),
        supabase
          .from('baselines')
          .select('property_id, daily_rate')
          .eq('year', year),
        // Resolve the Peak season's id so we can grab the fixed-mode
        // guest rate for that season specifically (a property can be
        // Fixed-mode with different guest rates per season).
        supabase
          .from('seasons')
          .select('id, key')
          .eq('partner_id', CT_RENTALS_PARTNER_ID),
      ]);
      const peakSeasonId = (seasonRes.data || []).find((s: any) => s.key === 'peak')?.id ?? null;
      const fixedRes = peakSeasonId
        ? await supabase
            .from('property_fixed_rates')
            .select('property_id, guest_rate')
            .eq('year', year)
            .eq('season_id', peakSeasonId)
        : { data: [] as Array<{ property_id: string; guest_rate: number }> };

      const baselineById: Record<string, number> = {};
      for (const b of (bRes.data || [])) baselineById[b.property_id] = Number(b.daily_rate);
      const fixedById: Record<string, number> = {};
      for (const f of ((fixedRes as any).data || [])) fixedById[f.property_id] = Number(f.guest_rate);

      const { data, error } = pRes;
      if (error) throw error;
      const props = (data as Property[]) || [];

      // Compute the displayed Direct rate via the same helper the
      // Price List page uses — pricing-mode aware, no duplicated
      // arithmetic.
      const directById: Record<string, number> = {};
      for (const p of props) {
        const rate = peakDirectGuestRate({
          pricingMode: p.pricing_mode ?? null,
          baselineDailyRate: baselineById[p.id],
          fixedPeakGuestRate: fixedById[p.id],
        });
        if (rate != null) directById[p.id] = rate;
      }
      setDirectRateById(directById);
      setProperties(props);
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
    () => properties.filter(p => !p.is_archived && !p.is_published).length,
    [properties],
  );
  const archivedCount = useMemo(
    () => properties.filter(p => p.is_archived).length,
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

  // Bed / bath / sleeps options are derived from the actual data so we
  // don't surface filter values that match zero properties.
  const bedOptions = useMemo(
    () => Array.from(new Set(properties.map(p => p.bedrooms).filter((n): n is number => typeof n === 'number' && n > 0))).sort((a, b) => a - b),
    [properties],
  );
  const bathOptions = useMemo(
    () => Array.from(new Set(properties.map(p => p.bathrooms).filter((n): n is number => typeof n === 'number' && n > 0))).sort((a, b) => a - b),
    [properties],
  );
  const sleepOptions = useMemo(
    () => Array.from(new Set(properties.map(p => p.sleeps).filter((n): n is number => typeof n === 'number' && n > 0))).sort((a, b) => a - b),
    [properties],
  );

  const filteredProperties = useMemo(() => {
    // Narrow by the selected status bucket, then by search + attribute
    // filters. The dropdown is single-select rather than two toggles so
    // the toolbar fits in one row.
    let list = properties.filter(p => {
      switch (statusFilter) {
        case 'active':   return !p.is_archived && p.is_published;
        case 'inactive': return !p.is_archived && !p.is_published;
        case 'archived': return p.is_archived;
        case 'all':      return true;
      }
    });
    if (searchQuery) {
      const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter(p => {
        const text = [p.property_name, p.suburb, p.city].filter(Boolean).join(' ').toLowerCase();
        return terms.every(t => text.includes(t));
      });
    }
    if (bedCounts.length) list = list.filter(p => p.bedrooms != null && bedCounts.includes(p.bedrooms));
    if (bathCounts.length) list = list.filter(p => p.bathrooms != null && bathCounts.includes(p.bathrooms));
    if (sleepCounts.length) list = list.filter(p => p.sleeps != null && sleepCounts.includes(p.sleeps));
    if (suburbFilter.length) list = list.filter(p => p.suburb != null && suburbFilter.includes(p.suburb));
    return list;
  }, [properties, searchQuery, statusFilter, bedCounts, bathCounts, sleepCounts, suburbFilter]);

  /** Sorted list for card view. Table view ignores this and uses
   *  DataTable's own column sorting. */
  const sortedCardProperties = useMemo(() => {
    const [field, dir] = sortKey.split('-') as [string, 'asc' | 'desc'];
    const mult = dir === 'asc' ? 1 : -1;
    const list = [...filteredProperties];
    list.sort((a, b) => {
      let av: number | string | null;
      let bv: number | string | null;
      if (field === 'dailyrate') {
        av = directRateById[a.id] ?? null;
        bv = directRateById[b.id] ?? null;
      } else {
        av = (a as Property)[field as keyof Property] as number | string | null;
        bv = (b as Property)[field as keyof Property] as number | string | null;
      }
      // Nulls always sort last regardless of direction.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
      return String(av).localeCompare(String(bv)) * mult;
    });
    return list;
  }, [filteredProperties, sortKey, directRateById]);

  const filtersActive = !!(bedCounts.length || bathCounts.length || sleepCounts.length || suburbFilter.length);
  function clearFilters() {
    setBedCounts([]); setBathCounts([]); setSleepCounts([]); setSuburbFilter([]);
  }

  const columns = [
    {
      key: 'slug', label: 'ID', sortable: true, width: '90px',
      render: (row: DataRow) => (
        <span style={{ fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)', fontSize: '0.75rem', fontWeight: 600 }}>
          {(row as Property).slug || '-'}
        </span>
      ),
    },
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
      // Direct guest rate at peak season — same source as the card
      // view and as /price-list. For system-mode properties this
      // is directGuestRate(baseline); for fixed-mode it's the peak
      // property_fixed_rates.guest_rate row.
      key: 'daily_rate', label: 'Direct rate', align: 'right' as const, sortable: true, hideOnMobile: true,
      render: (row: DataRow) => {
        const p = row as Property;
        const rate = directRateById[p.id];
        if (!rate) return <span className="text-light">-</span>;
        return `${p.price_currency || 'ZAR'} ${Number(rate).toLocaleString('en-ZA', { maximumFractionDigits: 0 })} / night`;
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
      render: (row: DataRow) => {
        const p = row as Property;
        if (p.is_archived) return <span className="ops-status-pill ops-status-pill--archived">Archived</span>;
        if (p.is_published) return <span className="ops-status-pill ops-status-pill--active">Active</span>;
        return <span className="ops-status-pill ops-status-pill--inactive">Inactive</span>;
      },
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
        initialMode={editorMode}
      />
    );
  }

  return (
    <div>
      {/* ── Toolbar — view modes + actions on top row, filters + search below ── */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="list-toolbar" style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: 12, marginBottom: 12 }}>
          <div className="list-toolbar-left">
            <div className="view-toggle">
              <button
                className={`view-toggle-btn ${viewMode === 'cards' ? 'active' : ''}`}
                onClick={() => setViewMode('cards')}
                title="Card view"
              >
                ▦ Cards
              </button>
              <button
                className={`view-toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
                onClick={() => setViewMode('table')}
                title="Table view"
              >
                ☰ Table
              </button>
            </div>
          </div>
          <div className="list-toolbar-right">
            <button className="btn btn-primary" onClick={() => (setEditorMode('edit'), setEditingProperty({}))}>+ New Property</button>
          </div>
        </div>
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            {/* Status — single-select keeps the toolbar to one row.
                Inactive = temporarily parked. Archived = retired. */}
            <select
              className="list-filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              title="Status filter"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive ({inactiveCount})</option>
              <option value="archived">Archived ({archivedCount})</option>
              <option value="all">All ({properties.length})</option>
            </select>
            {/* Distinguishing-attribute filters — all multi-select so
                "3 OR 4 beds" / "Camps Bay OR Clifton" work without
                dragging in extras. */}
            <MultiPicker
              label="Suburb"
              options={suburbOptions}
              selected={suburbFilter}
              onChange={(v) => setSuburbFilter(v.map(String))}
            />
            <MultiPicker
              label="Beds"
              options={bedOptions}
              selected={bedCounts}
              onChange={(v) => setBedCounts(v as number[])}
            />
            <MultiPicker
              label="Baths"
              options={bathOptions}
              selected={bathCounts}
              onChange={(v) => setBathCounts(v as number[])}
            />
            <MultiPicker
              label="Sleeps"
              options={sleepOptions}
              selected={sleepCounts}
              onChange={(v) => setSleepCounts(v as number[])}
            />
            {filtersActive && (
              <button className="btn btn-ghost" style={{ fontSize: '0.75rem' }} onClick={clearFilters}>
                Clear filters
              </button>
            )}
            {/* Sort — only relevant for card view; DataTable handles
                sorting via column headers in table mode. */}
            {viewMode === 'cards' && (
              <select
                className="list-filter-select"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                title="Sort properties"
              >
                <option value="bedrooms-desc">Beds: most first</option>
                <option value="bedrooms-asc">Beds: fewest first</option>
                <option value="property_name-asc">Name: A → Z</option>
                <option value="property_name-desc">Name: Z → A</option>
                <option value="suburb-asc">Suburb: A → Z</option>
                <option value="sleeps-desc">Sleeps: most first</option>
                <option value="dailyrate-desc">Daily rate: high to low</option>
                <option value="dailyrate-asc">Daily rate: low to high</option>
              </select>
            )}
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
          </div>
          <div className="list-toolbar-right">
            <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
              {filteredProperties.length} of {properties.length} total
            </span>
          </div>
        </div>
      </div>

      {/* ── Card View ── */}
      {viewMode === 'cards' && (
        <div className="property-grid">
          {sortedCardProperties.length === 0 ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <EmptyState
                icon={statusFilter === 'active' ? '🏡' : statusFilter === 'archived' ? '📥' : '🛋'}
                title={
                  properties.length === 0
                    ? 'No properties yet'
                    : `No ${statusFilter === 'all' ? '' : statusFilter} properties match your search`
                }
                description={
                  properties.length === 0
                    ? 'Add your first property to start building brochures.'
                    : 'Try a different search term, or switch the status filter.'
                }
                action={properties.length === 0 ? (
                  <button className="btn btn-primary" onClick={() => (setEditorMode('edit'), setEditingProperty({}))}>+ Add property</button>
                ) : null}
              />
            </div>
          ) : (
            sortedCardProperties.map(property => (
              <div
                key={property.id}
                className="property-card"
                onClick={() => { setEditorMode('view'); setEditingProperty(property); }}
              >
                <div className="property-card__image">
                  {property.hero_image_url ? (
                    <img src={property.hero_image_url} alt={property.property_name} />
                  ) : (
                    <div className="property-card__no-image">🏠</div>
                  )}
                  {property.is_archived
                    ? <span className="property-card__badge property-card__badge--archived">Archived</span>
                    : property.is_published
                      ? <span className="property-card__badge property-card__badge--active">Active</span>
                      : <span className="property-card__badge property-card__badge--inactive">Inactive</span>
                  }
                </div>
                <div className="property-card__body">
                  <div className="property-card__name-row">
                    <h3 className="property-card__name">{property.property_name}</h3>
                    {property.slug && (
                      <span className="property-card__uid" title="Unique ID">{property.slug}</span>
                    )}
                  </div>
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
                  {(() => {
                    const rate = directRateById[property.id];
                    if (!rate || rate <= 0) return null;
                    return (
                      <div className="property-card__price">
                        {property.price_currency || 'ZAR'} {Number(rate).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        <span className="property-card__price-label"> / night · direct</span>
                      </div>
                    );
                  })()}
                </div>
                <div className="property-card__footer">
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: '0.75rem' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const url = property.listing_urls?.guidebook?.trim();
                      if (!url) { toast.info('No guidebook linked yet'); return; }
                      const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
                      window.open(href, '_blank', 'noopener,noreferrer');
                    }}
                    title="Open digital guidebook"
                  >
                    📖 Guidebook
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
                      title="Brochure — pick branded or agent variant to share"
                    >
                      🔗 Brochure
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
          // Inject daily_rate from the baselines map so DataTable's built-in
          // column sort can compare on the same value the render uses; the
          // existing nulls-last behaviour in DataTable handles missing rates.
          data={filteredProperties.map(p => ({ ...p, daily_rate: directRateById[p.id] ?? null }))}
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
                  onClick={(e: React.MouseEvent) => { e.stopPropagation(); setPricingProperty(r); }}
                  title="Pricing"
                >
                  💰
                </span>
                {r.is_published && (
                  <span
                    className="action-icon"
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); setSharingProperty(r); }}
                    title="Brochure"
                  >
                    🔗
                  </span>
                )}
              </div>
            );
          }}
          onRowClick={(row: DataRow) => { setEditorMode('view'); setEditingProperty(row as Property); }}
          pageSize={25}
          emptyMessage={`No ${statusFilter === 'all' ? '' : statusFilter} properties.`}
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

      {/* ── Share Brochure (variant picker) ── */}
      {sharingProperty && (
        <BrochureShareMenu
          property={sharingProperty}
          onClose={() => setSharingProperty(null)}
        />
      )}

    </div>
  );
}
