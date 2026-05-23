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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');

  const [unlocked, setUnlocked] = useState(false);
  /** Pending edits keyed by `${propertyId}:${year}` → new daily rate.
   *  `null` means "clear this baseline"; a number means "set to value". */
  const [pending, setPending] = useState<Map<string, number | null>>(new Map());
  const [saving, setSaving] = useState(false);
  const isDirty = pending.size > 0;

  // Tell the silent auto-update reloader to defer a refresh while there
  // are unsaved baseline edits on this page.
  useDirty(isDirty);

  useEffect(() => { if (!embedded) setPageTitle('Pricing'); }, [setPageTitle, embedded]);

  async function load() {
    setLoading(true);
    const [propRes, baseRes, platRes] = await Promise.all([
      supabase
        .from('partner_properties')
        .select('id, slug, property_name, is_archived, is_published')
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
    ]);
    if (propRes.data) setProperties(propRes.data as Property[]);
    if (baseRes.data) setBaselines(baseRes.data as BaselineRow[]);
    if (platRes.data) setPlatforms(platRes.data as Platform[]);
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

  async function saveAll() {
    if (pending.size === 0 || saving) return;
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
      setPending(new Map());
      setUnlocked(false);
      const total = upserts.length + deletes.length;
      toast.success(`Saved ${total} baseline${total === 1 ? '' : 's'}`);
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

  if (loading) {
    return <div className="page-loader"><div className="spinner" /></div>;
  }

  return (
    <div>
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
        Per-night base rates per property. <strong>Base</strong> is what the
        owner nets. <strong>CTR margin</strong> is CTR's {CTR_MARGIN_PCT}% share
        of the guest rate. <strong>Direct</strong> is what a direct guest pays.
        Platform columns add each channel's fee on top of Direct. Page is
        locked by default.
      </p>

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
            {isDirty && (
              <span className="ops-status-pill ops-status-pill--ready">
                <span className="ops-status-pill-dot" />
                {pending.size} unsaved
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
              title={unlocked ? 'Lock the page (view-only)' : 'Unlock to edit base rates'}
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
          baselineByKey={baselineByKey}
          pending={pending}
          unlocked={unlocked}
          stageBaseline={stageBaseline}
          copyToClipboard={copyToClipboard}
        />
      )}
    </div>
  );
}

// ─── Sortable pricing table ─────────────────────────────────────────────

function PricingTable({
  properties, platforms, year, baselineByKey, pending, unlocked, stageBaseline, copyToClipboard,
}: {
  properties: Property[];
  platforms: Platform[];
  year: number;
  baselineByKey: Map<string, BaselineRow>;
  pending: Map<string, number | null>;
  unlocked: boolean;
  stageBaseline: (propertyId: string, year: number, value: number | null) => void;
  copyToClipboard: (value: number, label: string) => Promise<void>;
}) {
  const rows = properties.map(prop => {
    const key = `${prop.id}:${year}`;
    const saved = baselineByKey.get(key)?.daily_rate ?? null;
    const pendingVal = pending.has(key) ? (pending.get(key) ?? null) : undefined;
    const effective = pendingVal !== undefined ? pendingVal : saved;
    const direct = effective != null ? directGuestRate(effective) : null;
    const ctr = effective != null ? ctrMargin(effective) : null;
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
      base_rate: effective ?? 0,
      ctr_margin: ctr ?? 0,
      direct_rate: direct ?? 0,
      ...platformPrices,
      prop,
      saved,
      pendingVal,
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
      key: 'base_rate', label: `Base rate`, sortable: true, align: 'right' as const, width: '150px',
      render: (row: DataRow) => {
        const r = row as any;
        return (
          <BaselineCell
            year={year}
            saved={r.saved}
            pending={r.pendingVal}
            locked={!unlocked}
            onChange={(v) => stageBaseline(r.id, year, v)}
          />
        );
      },
    },
    {
      key: 'ctr_margin', label: 'CTR margin', sortable: true, align: 'right' as const, width: '120px',
      render: (row: DataRow) => {
        const v = (row as any).ctr_margin as number;
        return v > 0
          ? <span style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>R {v.toLocaleString('en-US')}</span>
          : <span style={{ color: 'var(--text-light)' }}>—</span>;
      },
    },
    {
      key: 'direct_rate', label: 'Direct rate', sortable: true, align: 'right' as const, width: '130px',
      render: (row: DataRow) => {
        const v = (row as any).direct_rate as number;
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
