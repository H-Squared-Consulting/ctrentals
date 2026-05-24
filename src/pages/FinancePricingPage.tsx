/**
 * Settings → Pricing — quick base-rate editor + calculated platform prices.
 *
 * Purpose: once-a-year pricing review. The user picks a season-year (the
 * year switcher at the top), edits each property's base rate inline, and
 * the table immediately shows the list price for every active platform
 * so they can copy each one straight into Airbnb / Booking.com / etc.
 *
 * Platform list-price formula (gross-up): the price the channel needs to
 * show so the host nets the base rate after the channel's cut.
 *     list = (base + fixed_fee) / (1 - fee_pct/100)
 *
 * Locked by default; unlock to edit base rates; Save flushes the buffer
 * and re-locks. Edits highlight in amber. Lock state is the affordance,
 * not a refresh button.
 */

/* eslint-disable */
// @ts-nocheck

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import { useToast } from '../components/ToastProvider';
import DataTable from '../components/DataTable';
import type { DataRow } from '../components/DataTable';
import { CT_RENTALS_PARTNER_ID } from './constants';
import { CTR_DEFAULT } from '../lib/pricingEngine';
import { useDirty } from '../lib/dirtyState';

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

interface Property {
  id: string;
  slug: string | null;
  property_name: string;
  is_archived: boolean;
  is_published: boolean;
  pricing_mode: 'system' | 'fixed';
}

interface BaselineRow {
  property_id: string;
  year: number;
  daily_rate: number;
  monthly_rate: number;
  locked: boolean;
}

interface Platform {
  id: string;
  platform_name: string;
  fee_pct: number;
  fixed_fee: number;
  is_active: boolean;
}

// Available season-years for the switcher. The integer `year` stored on
// baselines is the start year of the SA peak season (Dec → Apr).
const YEAR_OPTIONS = [2026, 2027];

const seasonLabel = (y: number) => `${y}/${y + 1}`;

// ─── 4-tier seasonal pricing model ──────────────────────────────────────
// Ordered keys + labels for the UI tab strip. Dates and multipliers are
// LIVE from the seasons table; SEASON_ORDER is just for stable display.
const SEASON_ORDER = [
  { key: 'peak',     label: 'Peak' },
  { key: 'high',     label: 'High' },
  { key: 'shoulder', label: 'Shoulder' },
  { key: 'winter',   label: 'Winter' },
] as const;
type SeasonKey = typeof SEASON_ORDER[number]['key'];

interface SeasonRow {
  id: string;
  partner_id: string;
  key: SeasonKey;
  name: string;
  multiplier: number;
  date_ranges: Array<{ start: string; end: string }>;
  sort_order: number;
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
  owner_rate: number | null;
}
interface FixedSlot { guest?: number | null; owner?: number | null; }

function cellKey(propertyId: string, year: number, season: SeasonKey) {
  return `${propertyId}:${year}:${season}`;
}

/** Pretty-print a season's date_ranges JSONB for tooltips and the banner.
 *  "12-15 → 01-15" becomes "15 Dec → 15 Jan". Multiple ranges joined with " · ". */
function fmtDateRanges(ranges: Array<{ start: string; end: string }>): string {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmt(mmdd: string): string {
    const [mm, dd] = mmdd.split('-').map(s => parseInt(s, 10));
    return `${dd} ${MONTHS[mm - 1] || '?'}`;
  }
  return (ranges || []).map(r => `${fmt(r.start)} → ${fmt(r.end)}`).join(' · ');
}

// ─── Terminology (matches src/lib/pricingEngine.ts) ────────────────────
//   Base rate     — what the owner receives per night.
//   CTR Margin    — CTR's share of the guest rate. 20% for direct + platform
//                   scenarios (CTR_DEFAULT.platform). Technically a MARGIN,
//                   not a markup: it's a % of the guest rate, not a % added
//                   to the base. Marked-up equivalent would be 25% (375/1500).
//   Direct rate   — what a direct guest pays per night (no platform involved).
//                   Calculated: base ÷ (1 - CTR_MARGIN_PCT/100).
//   Platform rate — what the channel needs to list so CTR + owner are paid
//                   after the channel takes its cut. Calculated:
//                   direct_rate × (1 + fee%/100) + fixed_fee.

const CTR_MARGIN_PCT = CTR_DEFAULT.platform; // 20% — single source of truth.

/** What a direct guest pays per night (CTR's margin baked in, no platform fee). */
function directGuestRate(base: number): number {
  if (base <= 0) return 0;
  return Math.round(base / (1 - CTR_MARGIN_PCT / 100));
}

/** CTR's earnings per night for this base rate (direct - base). */
function ctrMargin(base: number): number {
  if (base <= 0) return 0;
  return directGuestRate(base) - Math.round(base);
}

/** What a platform needs to list at, given the direct rate. Fee + fixed fee
 *  apply on top of the direct guest rate (not on the base). */
function platformListPrice(direct: number, fee_pct: number, fixed_fee: number): number {
  if (direct <= 0) return 0;
  const fee = Math.max(0, fee_pct) / 100;
  return Math.round(direct * (1 + fee) + (fixed_fee || 0));
}

export default function FinancePricingPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();
  const toast = useToast();

  const [properties, setProperties] = useState<Property[]>([]);
  const [baselines, setBaselines] = useState<BaselineRow[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [loading, setLoading] = useState(true);

  const [year, setYear] = useState<number>(YEAR_OPTIONS[0]);
  const [season, setSeason] = useState<SeasonKey>('peak');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [modeFilter, setModeFilter] = useState<'all' | 'system' | 'fixed'>('all');

  const [unlocked, setUnlocked] = useState(false);
  /** Pending edits keyed by `${propertyId}:${year}` → new daily rate.
   *  `null` means "clear this baseline"; a number means "set to value". */
  const [pending, setPending] = useState<Map<string, number | null>>(new Map());
  // DB-loaded state for the seasons system. `overridesByKey` and
  // `fixedRatesByKey` are indexed by `${propertyId}:${year}:${seasonKey}` for
  // O(1) lookup during render. pricing_mode lives on partner_properties so
  // it's available via `properties`.
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [overridesByKey, setOverridesByKey] = useState<Map<string, OverrideRow>>(new Map());
  const [fixedRatesByKey, setFixedRatesByKey] = useState<Map<string, FixedRateRow>>(new Map());
  // Same pending-then-Save pattern for the new edit surfaces.
  const [pendingOverrides, setPendingOverrides] = useState<Map<string, number | null>>(new Map());
  const [pendingFixedMode, setPendingFixedMode] = useState<Map<string, boolean>>(new Map());
  const [pendingFixedRates, setPendingFixedRates] = useState<Map<string, FixedSlot>>(new Map());
  const [saving, setSaving] = useState(false);
  const isDirty = pending.size > 0
    || pendingOverrides.size > 0
    || pendingFixedMode.size > 0
    || pendingFixedRates.size > 0;

  // Tell the silent auto-update reloader to defer a refresh while there
  // are unsaved baseline edits on this page.
  useDirty(isDirty);

  // ── Lookup helpers (DB-loaded data) ──────────────────────────────────
  const seasonByKey = useMemo(() => {
    const m = new Map<SeasonKey, SeasonRow>();
    for (const s of seasons) m.set(s.key, s);
    return m;
  }, [seasons]);
  function getCommittedOverride(propertyId: string, season: SeasonKey): number | null {
    const r = overridesByKey.get(cellKey(propertyId, year, season));
    return r ? r.override_rate : null;
  }
  function getCommittedFixedSlot(propertyId: string, season: SeasonKey): FixedSlot {
    const r = fixedRatesByKey.get(cellKey(propertyId, year, season));
    return r ? { guest: r.guest_rate, owner: r.owner_rate } : {};
  }

  useEffect(() => { if (!embedded) setPageTitle('Pricing'); }, [setPageTitle, embedded]);

  async function load() {
    setLoading(true);
    const [propRes, baseRes, platRes, seasonRes, ovRes, fxRes] = await Promise.all([
      supabase
        .from('partner_properties')
        .select('id, slug, property_name, is_archived, is_published, pricing_mode')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .eq('is_archived', false)
        .order('slug'),
      supabase
        .from('baselines')
        .select('property_id, year, daily_rate, monthly_rate, locked')
        .in('year', YEAR_OPTIONS),
      supabase
        .from('channel_defaults')
        .select('id, platform_name, fee_pct, fixed_fee, is_active')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .eq('is_active', true)
        .order('platform_name'),
      supabase
        .from('seasons')
        .select('id, partner_id, key, name, multiplier, date_ranges, sort_order')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .order('sort_order'),
      supabase
        .from('property_season_overrides')
        .select('property_id, year, season_id, override_rate')
        .in('year', YEAR_OPTIONS),
      supabase
        .from('property_fixed_rates')
        .select('property_id, year, season_id, guest_rate, owner_rate')
        .in('year', YEAR_OPTIONS),
    ]);
    if (propRes.data) setProperties(propRes.data as Property[]);
    if (baseRes.data) setBaselines(baseRes.data as BaselineRow[]);
    if (platRes.data) setPlatforms(platRes.data as Platform[]);
    const seasonRows = (seasonRes.data || []) as SeasonRow[];
    setSeasons(seasonRows);
    // Build the season-id → key map once, then index overrides + fixed_rates
    // by `${propertyId}:${year}:${seasonKey}` for fast cell lookup.
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

  const baselineByKey = useMemo(() => {
    const m = new Map<string, BaselineRow>();
    for (const b of baselines) m.set(`${b.property_id}:${b.year}`, b);
    return m;
  }, [baselines]);

  function stageBaseline(propertyId: string, y: number, dailyRate: number | null) {
    const key = `${propertyId}:${y}`;
    const current = baselineByKey.get(key)?.daily_rate ?? null;
    setPending(prev => {
      const next = new Map(prev);
      if (dailyRate === current) next.delete(key);
      else next.set(key, dailyRate);
      return next;
    });
  }
  function stageOverride(propertyId: string, value: number | null) {
    const key = cellKey(propertyId, year, season);
    const current = getCommittedOverride(propertyId, season);
    setPendingOverrides(prev => {
      const next = new Map(prev);
      if ((value ?? null) === current) next.delete(key);
      else next.set(key, value);
      return next;
    });
  }
  function stageFixedMode(propertyId: string, value: boolean) {
    const prop = properties.find(p => p.id === propertyId);
    const current = prop?.pricing_mode === 'fixed';
    setPendingFixedMode(prev => {
      const next = new Map(prev);
      if (value === current) next.delete(propertyId);
      else next.set(propertyId, value);
      return next;
    });
  }
  function stageFixedSlot(propertyId: string, patch: Partial<FixedSlot>) {
    const key = cellKey(propertyId, year, season);
    const committed = getCommittedFixedSlot(propertyId, season);
    setPendingFixedRates(prev => {
      const next = new Map(prev);
      const merged: FixedSlot = { ...committed, ...(next.get(key) || {}), ...patch };
      // If merged matches committed, drop it from pending.
      if ((merged.guest ?? null) === (committed.guest ?? null) && (merged.owner ?? null) === (committed.owner ?? null)) {
        next.delete(key);
      } else {
        next.set(key, merged);
      }
      return next;
    });
  }

  async function saveAll() {
    if (!isDirty || saving) return;
    setSaving(true);
    try {
      const upserts: any[] = [];
      const deletes: Array<{ property_id: string; year: number }> = [];
      for (const [key, value] of pending.entries()) {
        const [propertyId, yearStr] = key.split(':');
        const yr = parseInt(yearStr, 10);
        if (value == null) {
          deletes.push({ property_id: propertyId, year: yr });
        } else {
          const existing = baselineByKey.get(key);
          upserts.push({
            property_id: propertyId,
            year: yr,
            daily_rate: value,
            monthly_rate: existing?.monthly_rate ?? Math.round(value * 30),
            locked: false,
            updated_at: new Date().toISOString(),
          });
        }
      }
      if (upserts.length > 0) {
        const { error } = await supabase.from('baselines').upsert(upserts, { onConflict: 'property_id,year' });
        if (error) throw error;
      }
      for (const d of deletes) {
        await supabase.from('baselines').update({ locked: false }).eq('property_id', d.property_id).eq('year', d.year);
        const { error } = await supabase.from('baselines').delete().eq('property_id', d.property_id).eq('year', d.year);
        if (error) throw error;
      }
      setBaselines(prev => {
        const next = prev.filter(b => !pending.has(`${b.property_id}:${b.year}`));
        for (const r of upserts) {
          next.push({
            property_id: r.property_id,
            year: r.year,
            daily_rate: r.daily_rate,
            monthly_rate: r.monthly_rate,
            locked: false,
          });
        }
        return next;
      });
      // Flush staged season overrides to property_season_overrides.
      const ovUpserts: Array<{ property_id: string; year: number; season_id: string; override_rate: number; updated_at: string }> = [];
      const ovDeletes: Array<{ property_id: string; year: number; season_id: string }> = [];
      for (const [k, v] of pendingOverrides.entries()) {
        const [propertyId, yrStr, seasonKeyStr] = k.split(':');
        const yr = parseInt(yrStr, 10);
        const sRow = seasonByKey.get(seasonKeyStr as SeasonKey);
        if (!sRow) continue;
        if (v == null) ovDeletes.push({ property_id: propertyId, year: yr, season_id: sRow.id });
        else ovUpserts.push({ property_id: propertyId, year: yr, season_id: sRow.id, override_rate: v, updated_at: new Date().toISOString() });
      }
      if (ovUpserts.length > 0) {
        const { error } = await supabase.from('property_season_overrides').upsert(ovUpserts, { onConflict: 'property_id,year,season_id' });
        if (error) throw error;
      }
      for (const d of ovDeletes) {
        const { error } = await supabase.from('property_season_overrides').delete()
          .eq('property_id', d.property_id).eq('year', d.year).eq('season_id', d.season_id);
        if (error) throw error;
      }

      // Flush staged pricing_mode flips to partner_properties.
      for (const [propertyId, value] of pendingFixedMode.entries()) {
        const { error } = await supabase.from('partner_properties')
          .update({ pricing_mode: value ? 'fixed' : 'system' })
          .eq('id', propertyId);
        if (error) throw error;
      }

      // Flush staged fixed-mode guest/owner rates to property_fixed_rates.
      const fxUpserts: Array<{ property_id: string; year: number; season_id: string; guest_rate: number | null; owner_rate: number | null; updated_at: string }> = [];
      for (const [k, v] of pendingFixedRates.entries()) {
        const [propertyId, yrStr, seasonKeyStr] = k.split(':');
        const yr = parseInt(yrStr, 10);
        const sRow = seasonByKey.get(seasonKeyStr as SeasonKey);
        if (!sRow) continue;
        fxUpserts.push({
          property_id: propertyId, year: yr, season_id: sRow.id,
          guest_rate: v.guest ?? null, owner_rate: v.owner ?? null,
          updated_at: new Date().toISOString(),
        });
      }
      if (fxUpserts.length > 0) {
        const { error } = await supabase.from('property_fixed_rates').upsert(fxUpserts, { onConflict: 'property_id,year,season_id' });
        if (error) throw error;
      }

      const protoCount = pendingOverrides.size + pendingFixedMode.size + pendingFixedRates.size;
      setPendingOverrides(new Map());
      setPendingFixedMode(new Map());
      setPendingFixedRates(new Map());

      setPending(new Map());
      setUnlocked(false);
      const total = upserts.length + deletes.length + protoCount;
      toast.success(`Saved ${total} change${total === 1 ? '' : 's'}`);
      // Reload so committed values for the new tables (and pricing_mode on
      // properties) reflect what's now on disk.
      await load();
    } catch (err: any) {
      toast.error('Failed to save: ' + (err?.message || String(err)));
    } finally {
      setSaving(false);
    }
  }

  function toggleLock() {
    if (unlocked && isDirty) {
      if (!confirm('You have unsaved changes. Discard them and lock?')) return;
      setPending(new Map());
      setPendingOverrides(new Map());
      setPendingFixedMode(new Map());
      setPendingFixedRates(new Map());
    }
    setUnlocked(!unlocked);
  }

  function switchYear(y: number) {
    if (isDirty) {
      if (!confirm('You have unsaved baseline edits. Discard them and switch year?')) return;
      setPending(new Map());
    }
    setYear(y);
  }

  // Navigation guard while dirty.
  useEffect(() => {
    if (!isDirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    function onDocClick(e: MouseEvent) {
      let node = e.target as HTMLElement | null;
      while (node && node !== document.body && node.tagName !== 'A') node = node.parentElement;
      if (!node || node.tagName !== 'A') return;
      const a = node as HTMLAnchorElement;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) return;
      if (a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (href === window.location.pathname) return;
      if (!confirm('You have unsaved baseline edits. Leave the page and discard them?')) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onDocClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onDocClick, true);
    };
  }, [isDirty]);

  const filtered = useMemo(() => {
    let result = properties;
    if (statusFilter === 'active')   result = result.filter(p => p.is_published);
    if (statusFilter === 'inactive') result = result.filter(p => !p.is_published);
    if (modeFilter === 'system') result = result.filter(p => (p.pricing_mode || 'system') === 'system');
    if (modeFilter === 'fixed')  result = result.filter(p => p.pricing_mode === 'fixed');
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(p =>
        p.property_name.toLowerCase().includes(q) ||
        (p.slug || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [properties, statusFilter, modeFilter, search]);

  async function copyToClipboard(value: number, label: string) {
    try {
      await navigator.clipboard.writeText(String(value));
      toast.success(`${label}: ${value.toLocaleString('en-US')} copied`);
    } catch {
      toast.error('Could not copy');
    }
  }

  if (loading) {
    return <div className="page-loader"><div className="spinner" /></div>;
  }

  const currentSeasonOrder = SEASON_ORDER.find(s => s.key === season) || SEASON_ORDER[0];
  const currentSeasonRow = seasonByKey.get(season);
  const currentDates = currentSeasonRow ? fmtDateRanges(currentSeasonRow.date_ranges) : '';
  const currentMultiplier = currentSeasonRow?.multiplier ?? 1;

  return (
    <div>
      {season === 'peak' ? (
        <div className="pricing-banner pricing-banner--peak">
          <strong>Peak = Owner's Normal Base Rate.</strong> The absolute base rate that drives every other season's calculation unless explicitly overridden.
        </div>
      ) : (
        <div className={`pricing-banner pricing-banner--${season}`}>
          <strong>You're viewing the {currentSeasonOrder.label} season ({currentDates}).</strong> Rates auto-fill from Peak × {currentMultiplier}. Type a cell to override just that property for this season; clear it to revert to the auto-fill.
        </div>
      )}

      {/* Toolbar — view modes + actions on top row, filters + search below. */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="list-toolbar" style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: 12, marginBottom: 12 }}>
          <div className="list-toolbar-left">
            <div className="view-toggle">
              {YEAR_OPTIONS.map(y => (
                <button
                  key={y}
                  className={`view-toggle-btn ${year === y ? 'active' : ''}`}
                  onClick={() => switchYear(y)}
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
            {isDirty && (
              <span className="ops-status-pill ops-status-pill--ready">
                <span className="ops-status-pill-dot" />
                {pending.size + pendingOverrides.size + pendingFixedMode.size + pendingFixedRates.size} unsaved
              </span>
            )}
            {unlocked && (
              <button
                className="btn btn-primary"
                onClick={saveAll}
                disabled={!isDirty || saving}
                title={isDirty ? 'Save all pending edits and re-lock the page' : 'No changes to save'}
              >
                {saving ? 'Saving…' : '💾 Save'}
              </button>
            )}
            <button
              className={`btn ${unlocked ? 'btn-outline-success' : 'btn-ghost'}`}
              onClick={toggleLock}
              disabled={saving}
              title={unlocked ? 'Lock the page (view-only)' : 'Unlock to edit rates'}
            >
              {unlocked ? '🔓 Unlocked' : '🔒 Locked'}
            </button>
          </div>
        </div>
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            <select
              className="list-filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              title="Filter by publish status"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </select>
            <select
              className="list-filter-select"
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value as any)}
              title="Filter by pricing mode"
            >
              <option value="all">All modes</option>
              <option value="system">System only</option>
              <option value="fixed">Fixed only</option>
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
        <PricingTable
          properties={filtered}
          platforms={platforms}
          year={year}
          season={season}
          seasonLabelText={currentSeasonOrder.label}
          seasonMultiplier={currentMultiplier}
          baselineByKey={baselineByKey}
          pending={pending}
          overridesByKey={overridesByKey}
          fixedRatesByKey={fixedRatesByKey}
          pendingOverrides={pendingOverrides}
          pendingFixedMode={pendingFixedMode}
          pendingFixedRates={pendingFixedRates}
          unlocked={unlocked}
          stageBaseline={stageBaseline}
          stageOverride={stageOverride}
          stageFixedMode={stageFixedMode}
          stageFixedSlot={stageFixedSlot}
          copyToClipboard={copyToClipboard}
        />
      )}
    </div>
  );
}

// ─── Sortable pricing table ─────────────────────────────────────────────

function PricingTable({
  properties, platforms, year, season, seasonLabelText, seasonMultiplier, baselineByKey, pending, overridesByKey, fixedRatesByKey, pendingOverrides, pendingFixedMode, pendingFixedRates, unlocked, stageBaseline, stageOverride, stageFixedMode, stageFixedSlot, copyToClipboard,
}: {
  properties: Property[];
  platforms: Platform[];
  year: number;
  season: SeasonKey;
  seasonLabelText: string;
  seasonMultiplier: number;
  baselineByKey: Map<string, BaselineRow>;
  pending: Map<string, number | null>;
  overridesByKey: Map<string, OverrideRow>;
  fixedRatesByKey: Map<string, FixedRateRow>;
  pendingOverrides: Map<string, number | null>;
  pendingFixedMode: Map<string, boolean>;
  pendingFixedRates: Map<string, FixedSlot>;
  unlocked: boolean;
  stageBaseline: (propertyId: string, year: number, value: number | null) => void;
  stageOverride: (propertyId: string, value: number | null) => void;
  stageFixedMode: (propertyId: string, value: boolean) => void;
  stageFixedSlot: (propertyId: string, patch: Partial<FixedSlot>) => void;
  copyToClipboard: (value: number, label: string) => Promise<void>;
}) {
  const mult = seasonMultiplier;
  const rows = properties.map(prop => {
    // Peak baseline (the property's anchor) — live DB value + any staged
    // baseline edit. Always the same number across all season tabs.
    const baseKey = `${prop.id}:${year}`;
    const peakSaved = baselineByKey.get(baseKey)?.daily_rate ?? null;
    const peakPending = pending.has(baseKey) ? (pending.get(baseKey) ?? null) : undefined;
    const peakEffective = peakPending !== undefined ? peakPending : peakSaved;

    // Fixed mode (per property) — DB pricing_mode + any staged flip.
    const fmKey = prop.id;
    const fixedCommitted = prop.pricing_mode === 'fixed';
    const fixedPending = pendingFixedMode.has(fmKey) ? pendingFixedMode.get(fmKey)! : undefined;
    const isFixed = fixedPending !== undefined ? fixedPending : fixedCommitted;

    // Override (per property + season) — committed value + any staged edit.
    const ovKey = cellKey(prop.id, year, season);
    const ovCommitted = overridesByKey.get(ovKey)?.override_rate ?? null;
    const ovPending = pendingOverrides.has(ovKey) ? (pendingOverrides.get(ovKey) ?? null) : undefined;

    // Fixed slot (per property + season) — committed guest/owner + staged.
    const fixedSlotRow = fixedRatesByKey.get(ovKey);
    const fixedSlotCommitted: FixedSlot = fixedSlotRow
      ? { guest: fixedSlotRow.guest_rate, owner: fixedSlotRow.owner_rate }
      : {};
    const fixedSlotPending = pendingFixedRates.has(ovKey) ? pendingFixedRates.get(ovKey)! : null;
    const fixedSlotEffective = fixedSlotPending ?? fixedSlotCommitted;
    const guestRate = fixedSlotEffective.guest ?? null;
    const ownerRate = fixedSlotEffective.owner ?? null;
    // Full margin available between guest + owner. The Pricing page shows
    // this as the entire pie; agent splitting is a booking-time concern
    // handled in the Pricing modal, not here.
    const fixedMargin = isFixed && guestRate != null && ownerRate != null
      ? Math.round(guestRate - ownerRate)
      : null;

    // Effective season rate (System mode). On Peak this IS the baseline.
    // On other seasons, override wins; otherwise auto-suggest = peak × mult.
    const suggested = peakEffective != null ? Math.round(peakEffective * mult) : null;
    const overrideEffective = ovPending !== undefined ? ovPending : ovCommitted;
    const systemRate = season === 'peak' ? peakEffective : (overrideEffective ?? suggested);

    const effectiveRate = isFixed ? guestRate : systemRate;
    const direct = !isFixed && effectiveRate != null ? directGuestRate(effectiveRate) : null;
    const ctr = !isFixed && effectiveRate != null ? ctrMargin(effectiveRate) : null;
    const platformPrices: Record<string, number | null> = {};
    for (const plat of platforms) {
      platformPrices[`platform_${plat.id}`] = direct != null
        ? platformListPrice(direct, plat.fee_pct, plat.fixed_fee)
        : null;
    }
    return {
      id: prop.id,
      slug: prop.slug || '',
      name: titleCase(prop.property_name),
      is_published: prop.is_published ? 1 : 0,
      base_rate: effectiveRate ?? 0,
      ctr_margin: isFixed ? (fixedMargin ?? 0) : (ctr ?? 0),
      direct_rate: direct ?? 0,
      ...platformPrices,
      prop,
      peakEffective,
      peakSaved,
      peakPending,
      isFixed,
      suggested,
      ovCommitted,
      ovPending,
      guestRate,
      ownerRate,
      guestPending: fixedSlotPending?.guest,
      ownerPending: fixedSlotPending?.owner,
      guestCommitted: fixedSlotCommitted.guest ?? null,
      ownerCommitted: fixedSlotCommitted.owner ?? null,
      direct,
    };
  });

  const columns = [
    {
      key: 'slug', label: 'Code', sortable: true, width: '100px',
      render: (row: DataRow) => (
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', color: 'var(--color-primary)' }}>
          {(row as any).slug || '—'}
        </span>
      ),
    },
    {
      key: 'name', label: 'Property', sortable: true,
      render: (row: DataRow) => <strong>{(row as any).name}</strong>,
    },
    {
      key: 'is_published', label: 'Status', sortable: true, align: 'center' as const, width: '100px',
      render: (row: DataRow) => {
        const r = row as any;
        return (
          <span className={`ops-status-pill ops-status-pill--${r.is_published ? 'active' : 'inactive'}`}>
            <span className="ops-status-pill-dot" />
            {r.is_published ? 'Active' : 'Inactive'}
          </span>
        );
      },
    },
    {
      key: 'mode', label: 'Mode', sortable: false, align: 'center' as const, width: '160px',
      render: (row: DataRow) => {
        const r = row as any;
        if (!unlocked) {
          return (
            <span className={`ops-status-pill ops-status-pill--${r.isFixed ? 'won' : 'drafting'}`}>
              <span className="ops-status-pill-dot" />
              {r.isFixed ? 'Fixed' : 'System'}
            </span>
          );
        }
        return (
          <div className="view-toggle" title="Pricing mode">
            <button
              className={`view-toggle-btn ${!r.isFixed ? 'active' : ''}`}
              onClick={() => stageFixedMode(r.id, false)}
              title="System: standard pricing using the season rate column"
            >System</button>
            <button
              className={`view-toggle-btn ${r.isFixed ? 'active' : ''}`}
              onClick={() => stageFixedMode(r.id, true)}
              title="Fixed: 3rd-party guest rate + pre-agreed owner rate. Platform earn = (Guest − Owner) ÷ 2 split with the agent."
            >Fixed</button>
          </div>
        );
      },
    },
    {
      key: 'base_rate', label: 'Owner Rate', sortable: true, align: 'right' as const, width: '220px',
      cellClassName: `pricing-col-season-${season}`,
      render: (row: DataRow) => {
        const r = row as any;
        if (r.isFixed) {
          // Fixed mode: Owner Rate column edits ONLY the owner rate, same
          // shape as a System row. The matching Guest rate is editable
          // in the Direct column below so the table layout stays familiar.
          return (
            <BaselineCell
              year={year}
              saved={r.ownerCommitted}
              pending={r.ownerPending}
              locked={!unlocked}
              onChange={(v) => stageFixedSlot(r.id, { owner: v })}
            />
          );
        }
        if (season === 'peak') {
          // Peak edits the live baseline (existing flow, no change).
          return (
            <BaselineCell
              year={year}
              saved={r.peakSaved}
              pending={r.peakPending}
              locked={!unlocked}
              onChange={(v) => stageBaseline(r.id, year, v)}
            />
          );
        }
        // Other seasons: saved shows committed override OR auto-suggested
        // value. Pending shows staged override. Type to override, clear to
        // revert to suggested.
        return (
          <BaselineCell
            year={year}
            saved={r.ovCommitted ?? r.suggested}
            pending={r.ovPending}
            locked={!unlocked}
            onChange={(v) => stageOverride(r.id, v)}
          />
        );
      },
    },
    {
      key: 'direct_rate', label: 'Direct', sortable: true, align: 'right' as const, width: '130px',
      cellClassName: 'pricing-col-guest-rate pricing-col-guest-rate--first',
      group: 'Guest rates',
      render: (row: DataRow) => {
        const r = row as any;
        // Fixed mode: Direct cell is the editable Guest rate (3rd-party set).
        if (r.isFixed) {
          return (
            <BaselineCell
              year={year}
              saved={r.guestCommitted}
              pending={r.guestPending}
              locked={!unlocked}
              onChange={(v) => stageFixedSlot(r.id, { guest: v })}
            />
          );
        }
        // System mode: read-only computed direct rate, click to copy.
        const v = r.direct_rate as number;
        if (v <= 0) return <span style={{ color: 'var(--text-light)' }}>—</span>;
        return (
          <button
            type="button"
            className="list-action-icon"
            style={{ width: 'auto', padding: '4px 8px', fontWeight: 600, fontFamily: 'inherit', fontSize: '0.8125rem', fontVariantNumeric: 'tabular-nums' }}
            onClick={() => copyToClipboard(v, 'Direct rate')}
            title={`Click to copy R ${v.toLocaleString('en-US')}`}
          >
            R {v.toLocaleString('en-US')}
          </button>
        );
      },
    },
    ...platforms.map(plat => ({
      key: `platform_${plat.id}`,
      label: plat.platform_name,
      sortable: true,
      align: 'right' as const,
      width: '130px',
      cellClassName: 'pricing-col-guest-rate',
      group: 'Guest rates',
      render: (row: DataRow) => {
        const v = (row as any)[`platform_${plat.id}`] as number | null;
        if (!v || v <= 0) return <span style={{ color: 'var(--text-light)' }}>—</span>;
        return (
          <button
            type="button"
            className="list-action-icon"
            style={{ width: 'auto', padding: '4px 8px', fontWeight: 600, fontFamily: 'inherit', fontSize: '0.8125rem', fontVariantNumeric: 'tabular-nums' }}
            onClick={() => copyToClipboard(v, plat.platform_name)}
            title={`Click to copy R ${v.toLocaleString('en-US')}`}
          >
            R {v.toLocaleString('en-US')}
          </button>
        );
      },
    })),
    {
      key: 'ctr_margin', label: 'CTR margin', sortable: true, align: 'right' as const, width: '120px',
      cellClassName: 'pricing-col-ctr-margin',
      group: 'CTR',
      render: (row: DataRow) => {
        const v = (row as any).ctr_margin as number;
        return v > 0
          ? <span style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>R {v.toLocaleString('en-US')}</span>
          : <span style={{ color: 'var(--text-light)' }}>—</span>;
      },
    },
  ];

  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <DataTable
        columns={columns}
        data={rows as any}
        loading={false}
        searchable={false}
        resultsBarContent={null}
        defaultSort={{ key: 'name', direction: 'asc' }}
        rowClassName={(row: any) => row.isFixed ? 'pricing-row-fixed' : ''}
      />
    </div>
  );
}

// ─── Editable base rate cell ────────────────────────────────────────────
// Locked: renders the same way as the platform price cells (plain
// "R 1,500" text, right-aligned, weight 600) so the columns read as
// siblings. Unlocked: standard .form-input with an "R" prefix; the
// cell tints amber when there's a pending edit.

function BaselineCell({
  year, saved, pending, locked, onChange,
}: {
  year: number;
  saved: number | null;
  pending: number | null | undefined;
  locked: boolean;
  onChange: (value: number | null) => void;
}) {
  const hasPending = pending !== undefined;
  const effective = hasPending ? pending : saved;
  const [value, setValue] = useState(effective != null ? String(Math.round(effective)) : '');

  useEffect(() => {
    setValue(effective != null ? String(Math.round(effective)) : '');
  }, [effective]);

  function handleInput(raw: string) {
    const digits = raw.replace(/\D/g, '');
    setValue(digits);
    if (digits === '') { onChange(null); return; }
    const parsed = parseInt(digits, 10);
    if (Number.isFinite(parsed)) onChange(parsed);
  }

  const displayValue = value ? parseInt(value, 10).toLocaleString('en-US') : '';

  if (locked) {
    return effective != null ? (
      <span style={{ fontWeight: 600 }}>R {Math.round(effective).toLocaleString('en-US')}</span>
    ) : (
      <span style={{ color: 'var(--text-light)' }}>—</span>
    );
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-light)' }}>R</span>
      <input
        type="text"
        inputMode="numeric"
        className="form-input"
        value={displayValue}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
          else if (e.key === 'Escape') {
            setValue(saved != null ? String(Math.round(saved)) : '');
            onChange(null);
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        placeholder="—"
        aria-label={`Base rate for ${year}`}
        style={{
          width: 110,
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          ...(hasPending ? { borderColor: 'var(--warning)', background: 'var(--warning-bg)' } : null),
        }}
      />
    </div>
  );
}
