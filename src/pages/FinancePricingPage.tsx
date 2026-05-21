/**
 * Settings → Pricing — flat baseline editor.
 *
 * One row per property; baseline daily rate for the current season-year
 * (2026/2027) and the next (2027/2028) is editable inline. Updates flow
 * straight to the `baselines` table — no calculator, no modal. Property
 * scenarios / season multipliers / commissions all live elsewhere and
 * cascade off whatever the baseline is set to here.
 *
 * Locked rows are still editable here — saving sets locked=false so the
 * ladies don't get blocked by the soft-lock trigger when adjusting rates
 * in bulk.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import { useToast } from '../components/ToastProvider';
import { CT_RENTALS_PARTNER_ID } from './constants';
import { fmtRand } from '../lib/pricingEngine';

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

// The two season-years the table edits. SA peak season spans Dec → Apr
// across two calendar years; the integer `year` stored on baselines is
// the start year of that season.
const YEAR_A = 2026;
const YEAR_B = 2027;

const seasonLabel = (y: number) => `${y}/${y + 1}`;

export default function FinancePricingPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();
  const toast = useToast();

  const [properties, setProperties] = useState<Property[]>([]);
  const [baselines, setBaselines] = useState<BaselineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Page is read-only until the user explicitly unlocks it. Re-locks
  // automatically on save. Replaces the old Refresh button — refresh is
  // pulled in on demand, the lock state is the more important affordance.
  const [unlocked, setUnlocked] = useState(false);
  // Buffer of unsaved edits, keyed by `${propertyId}:${year}` → new daily
  // rate. `null` means "clear this baseline" (the user wiped the cell);
  // a number means "set to this value". Absent key === no change.
  const [pending, setPending] = useState<Map<string, number | null>>(new Map());
  const [saving, setSaving] = useState(false);
  const isDirty = pending.size > 0;

  // When embedded inside SettingsPage, the parent owns the title.
  useEffect(() => { if (!embedded) setPageTitle('Pricing'); }, [setPageTitle, embedded]);

  async function load() {
    setLoading(true);
    const [propRes, baseRes] = await Promise.all([
      supabase
        .from('partner_properties')
        .select('id, slug, property_name, is_archived, is_published')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .eq('is_archived', false)
        .order('slug'),
      supabase
        .from('baselines')
        .select('property_id, year, daily_rate, monthly_rate, locked')
        .in('year', [YEAR_A, YEAR_B]),
    ]);
    if (propRes.data) setProperties(propRes.data as Property[]);
    if (baseRes.data) setBaselines(baseRes.data as BaselineRow[]);
    setLoading(false);
  }
  useEffect(() => { if (supabase) load(); /* eslint-disable-next-line */ }, [supabase]);

  /** O(1) lookup keyed by property_id + ':' + year. */
  const baselineMap = useMemo(() => {
    const m = new Map<string, BaselineRow>();
    for (const b of baselines) m.set(`${b.property_id}:${b.year}`, b);
    return m;
  }, [baselines]);

  /** Stage one cell edit. Doesn't touch the DB — Save flushes the whole
   *  buffer in one go. The entry is removed only when the user's value
   *  matches what's already saved (a no-op), so clearing a saved
   *  baseline stages a real `null` edit that Save will turn into a
   *  delete. */
  function stageBaseline(propertyId: string, year: number, dailyRate: number | null) {
    const key = `${propertyId}:${year}`;
    const current = baselineMap.get(key)?.daily_rate ?? null;
    setPending(prev => {
      const next = new Map(prev);
      if (dailyRate === current) {
        // Back to the saved value — drop the pending entry.
        next.delete(key);
      } else {
        next.set(key, dailyRate);
      }
      return next;
    });
  }

  /** Flush every pending edit to the DB in one batch. Upserts so a cell
   *  that didn't have a baseline yet gets inserted; existing rows just
   *  get the new daily_rate. monthly_rate is preserved when the row
   *  exists; seeded from daily × 30 when creating fresh. locked=false so
   *  edits here aren't blocked by the soft-lock trigger.
   *  On success the page re-locks and the buffer clears. */
  async function saveAll() {
    if (pending.size === 0 || saving) return;
    setSaving(true);
    try {
      // Split the buffer into upserts (numeric value) and deletes (null —
      // user cleared the cell). Deletes need locked=false first so the
      // soft-lock trigger doesn't reject them.
      const upserts: Array<{ property_id: string; year: number; daily_rate: number; monthly_rate: number; locked: boolean; updated_at: string }> = [];
      const deletes: Array<{ property_id: string; year: number }> = [];

      for (const [key, value] of pending.entries()) {
        const [propertyId, yearStr] = key.split(':');
        const year = parseInt(yearStr, 10);
        if (value == null) {
          deletes.push({ property_id: propertyId, year });
        } else {
          const existing = baselineMap.get(key);
          const monthly = existing?.monthly_rate ?? Math.round(value * 30);
          upserts.push({
            property_id: propertyId,
            year,
            daily_rate: value,
            monthly_rate: monthly,
            locked: false,
            updated_at: new Date().toISOString(),
          });
        }
      }

      if (upserts.length > 0) {
        const { error } = await supabase
          .from('baselines')
          .upsert(upserts, { onConflict: 'property_id,year' });
        if (error) throw error;
      }

      for (const d of deletes) {
        // Unlock first (the existing row may have locked=true), then delete.
        await supabase
          .from('baselines')
          .update({ locked: false })
          .eq('property_id', d.property_id)
          .eq('year', d.year);
        const { error } = await supabase
          .from('baselines')
          .delete()
          .eq('property_id', d.property_id)
          .eq('year', d.year);
        if (error) throw error;
      }

      // Merge results into local state so the table reflects the new
      // values without another network round-trip.
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

  /** Toggle handler. Locking with unsaved changes asks for confirmation
   *  so the user doesn't lose work by accidentally clicking the padlock. */
  function toggleLock() {
    if (unlocked && isDirty) {
      if (!confirm('You have unsaved changes. Discard them and lock?')) return;
      setPending(new Map());
    }
    setUnlocked(!unlocked);
  }

  // Navigation guard — sidebar clicks, refresh, close-tab and back/forward
  // all fire a confirm when the buffer is dirty. React Router v6 doesn't
  // give us a clean useBlocker outside data routers, so we listen at the
  // document level: any click on an internal <a> while dirty gets a
  // confirm; cancel → preventDefault → user stays on the page.
  useEffect(() => {
    if (!isDirty) return;

    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }

    function onDocClick(e: MouseEvent) {
      // Walk up to find the anchor target (button-in-anchor case).
      let node = e.target as HTMLElement | null;
      while (node && node !== document.body && node.tagName !== 'A') {
        node = node.parentElement;
      }
      if (!node || node.tagName !== 'A') return;
      const a = node as HTMLAnchorElement;
      const href = a.getAttribute('href');
      // Skip external links, anchors, downloads, new-tab modifiers.
      if (!href || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) return;
      if (a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey) return;
      // Same-page link (we're already at /settings/pricing, ignore).
      if (href === window.location.pathname) return;

      if (!confirm('You have unsaved baseline edits. Leave the page and discard them?')) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    window.addEventListener('beforeunload', onBeforeUnload);
    // Capture phase so we intercept before React Router's own click handler.
    document.addEventListener('click', onDocClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onDocClick, true);
    };
  }, [isDirty]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return properties;
    return properties.filter(p =>
      p.property_name.toLowerCase().includes(q) ||
      (p.slug || '').toLowerCase().includes(q)
    );
  }, [properties, search]);

  if (loading) {
    return <div className="page-loader"><div className="spinner" /></div>;
  }

  return (
    <div>
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-light)', margin: '0 0 12px' }}>
        Per-night baseline rates for each property. The page is view-only
        until you tap <strong>🔒 Locked</strong>. Edits highlight in amber
        as you type; <strong>Save</strong> writes them all in one go and
        re-locks the page.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            <div className="list-search">
              <span className="list-search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search by name or CTR code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && <button className="list-search-clear" onClick={() => setSearch('')}>✕</button>}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
              {filtered.length} of {properties.length}
            </span>
          </div>
          <div className="list-toolbar-right">
            {isDirty && (
              <span className="pricing-dirty-badge">
                ● {pending.size} unsaved
              </span>
            )}
            {unlocked && (
              <button
                className="btn btn-primary"
                onClick={saveAll}
                disabled={!isDirty || saving}
                title={isDirty ? 'Save all pending edits and lock the page' : 'No changes to save'}
              >
                {saving ? 'Saving…' : '💾 Save'}
              </button>
            )}
            <button
              className={`btn ${unlocked ? 'btn-outline' : 'btn-ghost'}`}
              onClick={toggleLock}
              disabled={saving}
              title={unlocked ? 'Lock the page (view-only)' : 'Unlock to edit baselines'}
            >
              {unlocked ? '🔓 Unlocked' : '🔒 Locked'}
            </button>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-light)' }}>
          {properties.length === 0 ? 'No properties.' : 'No matches.'}
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 110 }}>CTR Code</th>
                <th>Property</th>
                <th style={{ textAlign: 'right', width: 200 }}>{seasonLabel(YEAR_A)} baseline / night</th>
                <th style={{ textAlign: 'right', width: 200 }}>{seasonLabel(YEAR_B)} baseline / night</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id}>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                      {p.slug || '—'}
                    </span>
                  </td>
                  <td>
                    <strong>{p.property_name}</strong>
                    {!p.is_published && (
                      <span className="status-badge" style={{ background: '#F3F4F6', color: '#6B7280', marginLeft: '8px', fontSize: '0.5625rem' }}>
                        Inactive
                      </span>
                    )}
                  </td>
                  <BaselineCell
                    propertyId={p.id}
                    year={YEAR_A}
                    saved={baselineMap.get(`${p.id}:${YEAR_A}`)?.daily_rate ?? null}
                    pending={pending.has(`${p.id}:${YEAR_A}`) ? pending.get(`${p.id}:${YEAR_A}`) ?? null : undefined}
                    locked={!unlocked}
                    onChange={(v) => stageBaseline(p.id, YEAR_A, v)}
                  />
                  <BaselineCell
                    propertyId={p.id}
                    year={YEAR_B}
                    saved={baselineMap.get(`${p.id}:${YEAR_B}`)?.daily_rate ?? null}
                    pending={pending.has(`${p.id}:${YEAR_B}`) ? pending.get(`${p.id}:${YEAR_B}`) ?? null : undefined}
                    locked={!unlocked}
                    onChange={(v) => stageBaseline(p.id, YEAR_B, v)}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Editable cell ──────────────────────────────────────────────────────
// Read-only chip when the page is locked. When unlocked, becomes a number
// input that stages edits up to the parent on every keystroke — so the
// Save button appears the moment the user changes anything, not on blur.
// Actual DB write only happens when the parent's Save button is clicked.
// A coloured ring highlights cells that have unsaved edits.

function BaselineCell({
  propertyId: _propertyId, year, saved, pending, locked, onChange,
}: {
  propertyId: string;
  year: number;
  saved: number | null;
  /** undefined = no edit pending; null = user cleared the cell;
   *  number = user typed a new value. */
  pending: number | null | undefined;
  locked: boolean;
  onChange: (value: number | null) => void;
}) {
  // The cell's displayed value follows the staged edit if there is one,
  // else falls back to the saved value. `pending === null` means the user
  // wiped the field on purpose — show empty.
  const hasPending = pending !== undefined;
  const effective = hasPending ? pending : saved;
  const [value, setValue] = useState(effective != null ? String(Math.round(effective)) : '');

  useEffect(() => {
    setValue(effective != null ? String(Math.round(effective)) : '');
  }, [effective]);

  /** Sync each keystroke up to the parent so the Save button reacts
   *  instantly. Parent de-stages the cell when the value matches saved.
   *  Strip everything except digits — the formatting (commas) is added
   *  back in the display below, so state stays clean. */
  function handleInput(raw: string) {
    const digits = raw.replace(/\D/g, '');
    setValue(digits);
    if (digits === '') {
      onChange(null);
      return;
    }
    const parsed = parseInt(digits, 10);
    if (Number.isFinite(parsed)) onChange(parsed);
  }

  // Plain comma formatting for display. Avoids `toLocaleString('en-ZA')`
  // which inserts non-breaking spaces — those interact badly with
  // select-all-and-delete in controlled inputs (the DOM value and our
  // state diverge on the whitespace char, then React's reconciliation
  // can keep the old value on screen).
  const displayValue = value
    ? parseInt(value, 10).toLocaleString('en-US')
    : '';

  const fieldClasses = [
    'baseline-cell-field',
    locked && 'baseline-cell-field--locked',
    hasPending && 'baseline-cell-field--pending',
  ].filter(Boolean).join(' ');

  // Locked variant — render as plain text so it's clearly not interactive.
  if (locked) {
    return (
      <td className="baseline-cell">
        <div className={fieldClasses}>
          <span className="baseline-cell-prefix">R</span>
          <span className="baseline-cell-readonly">
            {effective != null
              ? Math.round(effective).toLocaleString('en-US')
              : <span style={{ color: 'var(--text-light)' }}>—</span>}
          </span>
        </div>
      </td>
    );
  }

  return (
    <td className="baseline-cell">
      <label className={fieldClasses}>
        <span className="baseline-cell-prefix">R</span>
        <input
          type="text"
          inputMode="numeric"
          className="baseline-cell-input"
          value={displayValue}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
            else if (e.key === 'Escape') {
              // Cancel this cell — revert to the saved value and clear
              // any pending edit so the badge count drops.
              setValue(saved != null ? String(Math.round(saved)) : '');
              onChange(null);
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          placeholder="—"
          aria-label={`Baseline for ${year}`}
        />
      </label>
    </td>
  );
}
