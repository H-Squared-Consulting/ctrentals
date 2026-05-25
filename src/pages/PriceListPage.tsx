/**
 * Price List — a clean, read-only reference of guest prices.
 *
 * The Settings → Pricing screen is the once-a-year input tool (locked, with
 * owner rates and CTR margins on show). This page is the everyday front of
 * house: pick a season-year and season, and read off the guest-facing prices
 * for each property. No editing, no internal figures.
 *
 * Prices are computed with the SAME helpers the settings screen uses
 * (src/lib/pricingEngine.ts), so the two can never disagree.
 *
 * Columns: ID, Property, Beds, then guest rates — Direct, Agent, and one
 * column per active platform. Defaults to sorting by Beds, highest first.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import { useToast } from '../components/ToastProvider';
import DataTable from '../components/DataTable';
import type { DataRow } from '../components/DataTable';
import { CT_RENTALS_PARTNER_ID } from './constants';
import {
  directGuestRate,
  agentGuestRate,
  platformListPrice,
} from '../lib/pricingEngine';

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

interface Property {
  id: string;
  slug: string | null;
  property_name: string;
  bedrooms: number | null;
  is_published: boolean;
  pricing_mode: 'system' | 'fixed';
}
interface BaselineRow {
  property_id: string;
  year: number;
  daily_rate: number;
}
interface Platform {
  id: string;
  platform_name: string;
  fee_pct: number;
  fixed_fee: number;
}
const SEASON_ORDER = [
  { key: 'peak',     label: 'Peak' },
  { key: 'high',     label: 'High' },
  { key: 'shoulder', label: 'Shoulder' },
  { key: 'winter',   label: 'Winter' },
] as const;
type SeasonKey = typeof SEASON_ORDER[number]['key'];
interface SeasonRow {
  id: string;
  key: SeasonKey;
  name: string;
  multiplier: number;
  date_ranges: Array<{ start: string; end: string }>;
}
interface OverrideRow {
  property_id: string;
  year: number;
  season_id: string;
  override_rate: number;
}
interface FixedRateRow {
  property_id: string;
  year: number;
  season_id: string;
  guest_rate: number | null;
}
interface PriceRow {
  id: string;
  slug: string;
  name: string;
  beds: number;
  isFixed: boolean;
  direct_rate: number;
  agent_rate: number;
  [key: string]: unknown;
}

// Season-years selectable in the switcher. Matches Settings → Pricing.
const YEAR_OPTIONS = [2026, 2027];
const seasonLabel = (y: number) => `${y}/${y + 1}`;

function cellKey(propertyId: string, year: number, season: SeasonKey) {
  return `${propertyId}:${year}:${season}`;
}

/** "12-15 → 01-15" becomes "15 Dec → 15 Jan". Used for the season tooltips. */
function fmtDateRanges(ranges: Array<{ start: string; end: string }>): string {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmt(mmdd: string): string {
    const [mm, dd] = mmdd.split('-').map(s => parseInt(s, 10));
    return `${dd} ${MONTHS[mm - 1] || '?'}`;
  }
  return (ranges || []).map(r => `${fmt(r.start)} → ${fmt(r.end)}`).join(' · ');
}

export default function PriceListPage() {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();
  const toast = useToast();

  const [properties, setProperties] = useState<Property[]>([]);
  const [baselines, setBaselines] = useState<BaselineRow[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [overridesByKey, setOverridesByKey] = useState<Map<string, OverrideRow>>(new Map());
  const [fixedRatesByKey, setFixedRatesByKey] = useState<Map<string, FixedRateRow>>(new Map());
  const [loading, setLoading] = useState(true);

  const [year, setYear] = useState<number>(YEAR_OPTIONS[0]);
  const [season, setSeason] = useState<SeasonKey>('peak');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');

  useEffect(() => { setPageTitle('Price List'); }, [setPageTitle]);

  async function load() {
    setLoading(true);
    const [propRes, baseRes, platRes, seasonRes, ovRes, fxRes] = await Promise.all([
      supabase
        .from('partner_properties')
        .select('id, slug, property_name, bedrooms, is_published, pricing_mode')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .eq('is_archived', false)
        .order('slug'),
      supabase
        .from('baselines')
        .select('property_id, year, daily_rate')
        .in('year', YEAR_OPTIONS),
      supabase
        .from('channel_defaults')
        .select('id, platform_name, fee_pct, fixed_fee, is_active')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .eq('is_active', true)
        .order('platform_name'),
      supabase
        .from('seasons')
        .select('id, key, name, multiplier, date_ranges, sort_order')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .order('sort_order'),
      supabase
        .from('property_season_overrides')
        .select('property_id, year, season_id, override_rate')
        .in('year', YEAR_OPTIONS),
      supabase
        .from('property_fixed_rates')
        .select('property_id, year, season_id, guest_rate')
        .in('year', YEAR_OPTIONS),
    ]);
    if (propRes.data) setProperties(propRes.data as Property[]);
    if (baseRes.data) setBaselines(baseRes.data as BaselineRow[]);
    if (platRes.data) setPlatforms(platRes.data as Platform[]);
    const seasonRows = (seasonRes.data || []) as SeasonRow[];
    setSeasons(seasonRows);
    const keyById = new Map<string, SeasonKey>();
    for (const s of seasonRows) keyById.set(s.id, s.key);
    const ov = new Map<string, OverrideRow>();
    for (const r of (ovRes.data || []) as OverrideRow[]) {
      const k = keyById.get(r.season_id);
      if (k) ov.set(`${r.property_id}:${r.year}:${k}`, r);
    }
    setOverridesByKey(ov);
    const fx = new Map<string, FixedRateRow>();
    for (const r of (fxRes.data || []) as FixedRateRow[]) {
      const k = keyById.get(r.season_id);
      if (k) fx.set(`${r.property_id}:${r.year}:${k}`, r);
    }
    setFixedRatesByKey(fx);
    setLoading(false);
  }
  useEffect(() => { if (supabase) load(); /* eslint-disable-next-line */ }, [supabase]);

  const seasonByKey = useMemo(() => {
    const m = new Map<SeasonKey, SeasonRow>();
    for (const s of seasons) m.set(s.key, s);
    return m;
  }, [seasons]);
  const baselineByKey = useMemo(() => {
    const m = new Map<string, BaselineRow>();
    for (const b of baselines) m.set(`${b.property_id}:${b.year}`, b);
    return m;
  }, [baselines]);

  const filtered = useMemo(() => {
    let result = properties;
    if (statusFilter === 'active')   result = result.filter(p => p.is_published);
    if (statusFilter === 'inactive') result = result.filter(p => !p.is_published);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(p =>
        p.property_name.toLowerCase().includes(q) ||
        (p.slug || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [properties, statusFilter, search]);

  async function copyToClipboard(value: number, label: string) {
    try {
      await navigator.clipboard.writeText(String(value));
      toast.success(`${label}: ${value.toLocaleString('en-US')} copied`);
    } catch {
      toast.error('Could not copy');
    }
  }

  const currentSeasonOrder = SEASON_ORDER.find(s => s.key === season) || SEASON_ORDER[0];
  const currentSeasonRow = seasonByKey.get(season);
  const currentDates = currentSeasonRow ? fmtDateRanges(currentSeasonRow.date_ranges) : '';
  const mult = currentSeasonRow?.multiplier ?? 1;

  const rows: PriceRow[] = useMemo(() => filtered.map(prop => {
    const peakBase = baselineByKey.get(`${prop.id}:${year}`)?.daily_rate ?? null;
    const isFixed = prop.pricing_mode === 'fixed';
    const ck = cellKey(prop.id, year, season);
    const platformPrices: Record<string, number | null> = {};

    let directRate: number | null;
    let agentRate: number | null;
    if (isFixed) {
      // Fixed properties carry a single negotiated guest rate per season.
      // Show it under Direct; Agent and platforms don't apply.
      directRate = fixedRatesByKey.get(ck)?.guest_rate ?? null;
      agentRate = null;
      for (const p of platforms) platformPrices[`platform_${p.id}`] = null;
    } else {
      // System mode: Peak is the baseline; other seasons use an override if
      // set, otherwise Peak × this season's multiplier.
      const override = overridesByKey.get(ck)?.override_rate ?? null;
      const suggested = peakBase != null ? Math.round(peakBase * mult) : null;
      const systemRate = season === 'peak' ? peakBase : (override ?? suggested);
      directRate = systemRate != null ? directGuestRate(systemRate) : null;
      agentRate = systemRate != null ? agentGuestRate(systemRate) : null;
      for (const p of platforms) {
        platformPrices[`platform_${p.id}`] = directRate != null
          ? platformListPrice(directRate, p.fee_pct, p.fixed_fee)
          : null;
      }
    }

    return {
      id: prop.id,
      slug: prop.slug || '',
      name: titleCase(prop.property_name),
      beds: prop.bedrooms ?? 0,
      isFixed,
      direct_rate: directRate ?? 0,
      agent_rate: agentRate ?? 0,
      ...platformPrices,
    };
  }), [filtered, baselineByKey, overridesByKey, fixedRatesByKey, platforms, year, season, mult]);

  /** Right-aligned, click-to-copy rand cell. Dash when there's no price. */
  function rateCell(v: number, label: string) {
    if (!v || v <= 0) return <span style={{ color: 'var(--text-light)' }}>—</span>;
    return (
      <button
        type="button"
        className="list-action-icon"
        style={{ width: 'auto', padding: '4px 8px', fontWeight: 600, fontFamily: 'inherit', fontSize: '0.8125rem', fontVariantNumeric: 'tabular-nums' }}
        onClick={() => copyToClipboard(v, label)}
        title={`Click to copy R ${v.toLocaleString('en-US')}`}
      >
        R {v.toLocaleString('en-US')}
      </button>
    );
  }

  const columns = [
    {
      key: 'slug', label: 'ID', sortable: true, width: '90px',
      render: (row: DataRow) => (
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', color: 'var(--color-primary)' }}>
          {((row as PriceRow).slug) || '—'}
        </span>
      ),
    },
    {
      key: 'name', label: 'Property', sortable: true,
      render: (row: DataRow) => {
        const r = row as PriceRow;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <strong>{r.name}</strong>
            {r.isFixed && (
              <span className="chip-fixed" title="Fixed rate — a single negotiated guest rate; agent and platform prices don't apply">
                Fixed
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'beds', label: 'Beds', sortable: true, align: 'center' as const, width: '80px',
      render: (row: DataRow) => {
        const b = (row as PriceRow).beds;
        return b > 0
          ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{b}</span>
          : <span style={{ color: 'var(--text-light)' }}>—</span>;
      },
    },
    {
      key: 'direct_rate', label: 'Direct', sortable: true, align: 'right' as const, width: '130px',
      group: 'Guest rates',
      render: (row: DataRow) => rateCell((row as PriceRow).direct_rate, 'Direct rate'),
    },
    {
      key: 'agent_rate', label: 'Agent', sortable: true, align: 'right' as const, width: '130px',
      group: 'Guest rates',
      render: (row: DataRow) => {
        const r = row as PriceRow;
        // Agent pricing doesn't apply to Fixed-mode properties.
        if (r.isFixed) return <span style={{ color: 'var(--text-light)' }}>—</span>;
        return rateCell(r.agent_rate, 'Agent guest rate');
      },
    },
    ...platforms.map(plat => ({
      key: `platform_${plat.id}`,
      label: plat.platform_name,
      sortable: true,
      align: 'right' as const,
      width: '130px',
      group: 'Guest rates',
      render: (row: DataRow) => rateCell((row as PriceRow)[`platform_${plat.id}`] as number, plat.platform_name),
    })),
  ];

  if (loading) {
    return <div className="page-loader"><div className="spinner" /></div>;
  }

  return (
    <div>
      <div className={`pricing-banner pricing-banner--${season}`}>
        <strong>Reference guest prices for the {currentSeasonOrder.label} season{currentDates ? ` (${currentDates})` : ''}.</strong> Read-only. Edit rates in Settings → Pricing.
      </div>

      {/* Toolbar — view modes (year + season) on top, filters below. */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="list-toolbar" style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: 12, marginBottom: 12 }}>
          <div className="list-toolbar-left">
            <div className="view-toggle">
              {YEAR_OPTIONS.map(y => (
                <button
                  key={y}
                  className={`view-toggle-btn ${year === y ? 'active' : ''}`}
                  onClick={() => setYear(y)}
                  title={`Season ${seasonLabel(y)}`}
                >
                  {seasonLabel(y)}
                </button>
              ))}
            </div>
          </div>
          <div className="list-toolbar-right">
            <div className="view-toggle" title="Season">
              {SEASON_ORDER.map(s => {
                const row = seasonByKey.get(s.key);
                const dates = row ? fmtDateRanges(row.date_ranges) : '';
                return (
                  <button
                    key={s.key}
                    className={`view-toggle-btn ${season === s.key ? 'active' : ''}`}
                    onClick={() => setSeason(s.key)}
                    title={dates ? `${s.label}: ${dates}` : s.label}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            <select
              className="list-filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'active' | 'inactive' | 'all')}
              title="Filter by publish status"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </select>
            <div className="list-search">
              <span className="list-search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search by name or code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && <button className="list-search-clear" onClick={() => setSearch('')}>✕</button>}
            </div>
          </div>
          <div className="list-toolbar-right">
            <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
              {filtered.length} of {properties.length}
            </span>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-secondary)' }}>
          {properties.length === 0 ? 'No properties yet.' : 'No properties match your filter.'}
        </div>
      ) : (
        <div className="card price-list-sheet" style={{ padding: 0, overflowX: 'auto' }}>
          <DataTable
            columns={columns}
            data={rows as DataRow[]}
            loading={false}
            searchable={false}
            resultsBarContent={null}
            defaultSort={{ key: 'beds', direction: 'desc' }}
          />
        </div>
      )}
    </div>
  );
}
