/**
 * SeasonsPage (route still /settings/seasons) — the home for the 4-tier
 * seasonal pricing model.
 *
 * Each row is one season (Peak / High / Shoulder / Winter). Key + name are
 * fixed; date ranges and multiplier are editable. Lock-by-default, unlock
 * to edit, Save flushes all staged changes. Same affordance as Pricing.
 *
 * The Pricing page reads these multipliers + date ranges to auto-suggest
 * per-property per-season rates; the pricing engine reads them to pick
 * the right season for any check-in date.
 */

/* eslint-disable */
// @ts-nocheck

import { useState, useEffect, useMemo } from 'react';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import DataTable from '../components/DataTable';
import type { DataRow } from '../components/DataTable';
import { CT_RENTALS_PARTNER_ID } from './constants';
import { useDirty } from '../lib/dirtyState';

const SEASON_ORDER = ['peak', 'high', 'shoulder', 'winter'] as const;
type SeasonKey = typeof SEASON_ORDER[number];

interface SeasonRow {
  id: string;
  partner_id: string;
  key: SeasonKey;
  name: string;
  multiplier: number;
  date_ranges: Array<{ start: string; end: string }>;
  sort_order: number;
}

/** Convert "12-15" → "15 Dec" for tooltips and read-only display. */
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtMmDd(mmdd: string): string {
  if (!mmdd) return '';
  const [mm, dd] = mmdd.split('-').map(s => parseInt(s, 10));
  if (!mm || !dd) return mmdd;
  return `${dd} ${MONTHS[mm - 1] || '?'}`;
}
function fmtDateRanges(ranges: Array<{ start: string; end: string }>): string {
  return (ranges || []).map(r => `${fmtMmDd(r.start)} → ${fmtMmDd(r.end)}`).join(' · ');
}

export default function SeasonsPage({ embedded }: { embedded?: boolean } = {}) {
  const toast = useToast();
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();

  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  /** Staged edits keyed by season key → partial patch on the row. Save
   *  flushes these to the seasons table; clear on Lock or after Save. */
  const [pending, setPending] = useState<Map<SeasonKey, Partial<SeasonRow>>>(new Map());
  const [saving, setSaving] = useState(false);
  const isDirty = pending.size > 0;

  useDirty(isDirty);

  useEffect(() => { if (!embedded) setPageTitle('Seasons'); }, [setPageTitle, embedded]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('seasons')
      .select('id, partner_id, key, name, multiplier, date_ranges, sort_order')
      .eq('partner_id', CT_RENTALS_PARTNER_ID)
      .order('sort_order');
    if (error) {
      toast.error('Failed to load seasons: ' + error.message);
      setLoading(false);
      return;
    }
    setSeasons((data || []) as SeasonRow[]);
    setLoading(false);
  }
  useEffect(() => { if (supabase) load(); /* eslint-disable-next-line */ }, [supabase]);

  function stage(key: SeasonKey, patch: Partial<SeasonRow>) {
    setPending(prev => {
      const next = new Map(prev);
      const current = next.get(key) || {};
      next.set(key, { ...current, ...patch });
      return next;
    });
  }
  function effective(s: SeasonRow): SeasonRow {
    const patch = pending.get(s.key);
    return patch ? { ...s, ...patch } : s;
  }

  async function saveAll() {
    if (!isDirty || saving) return;
    setSaving(true);
    try {
      for (const [key, patch] of pending.entries()) {
        const target = seasons.find(s => s.key === key);
        if (!target) continue;
        const updates: any = { updated_at: new Date().toISOString() };
        if (patch.multiplier !== undefined) updates.multiplier = patch.multiplier;
        if (patch.date_ranges !== undefined) updates.date_ranges = patch.date_ranges;
        const { error } = await supabase.from('seasons').update(updates).eq('id', target.id);
        if (error) throw error;
      }
      toast.success(`Saved ${pending.size} season${pending.size === 1 ? '' : 's'}`);
      setPending(new Map());
      setUnlocked(false);
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
    }
    setUnlocked(!unlocked);
  }

  // Sort to canonical order regardless of DB sort_order so the UI is stable.
  const orderedSeasons = useMemo(() => {
    const byKey = new Map<SeasonKey, SeasonRow>();
    for (const s of seasons) byKey.set(s.key, s);
    return SEASON_ORDER.map(k => byKey.get(k)).filter(Boolean) as SeasonRow[];
  }, [seasons]);

  const rows = orderedSeasons.map(s => {
    const eff = effective(s);
    return {
      id: s.id,
      key: s.key,
      name: eff.name,
      multiplier: eff.multiplier,
      date_ranges: eff.date_ranges,
      raw: s,
      effective: eff,
    };
  });

  const columns = [
    {
      key: 'name', label: 'Season', sortable: false, width: '140px',
      render: (row: DataRow) => {
        const k = (row as any).key as SeasonKey;
        return (
          <span className={`ops-status-pill ops-status-pill--${k}`}>
            <span className="ops-status-pill-dot" />
            {(row as any).name}
          </span>
        );
      },
    },
    {
      key: 'date_ranges', label: 'Active dates (MM-DD)', sortable: false,
      render: (row: DataRow) => {
        const r = row as any;
        const ranges = r.date_ranges as Array<{ start: string; end: string }>;
        if (!unlocked) {
          return <span style={{ fontWeight: 600 }}>{fmtDateRanges(ranges) || '—'}</span>;
        }
        return (
          <div className="seasons-ranges-editor">
            {ranges.map((rng, i) => (
              <div key={i} className="seasons-range-row">
                <input
                  type="text"
                  className="form-input"
                  value={rng.start}
                  placeholder="MM-DD"
                  onChange={(e) => {
                    const next = ranges.slice();
                    next[i] = { ...rng, start: e.target.value };
                    stage(r.key, { date_ranges: next });
                  }}
                />
                <span className="seasons-range-arrow">→</span>
                <input
                  type="text"
                  className="form-input"
                  value={rng.end}
                  placeholder="MM-DD"
                  onChange={(e) => {
                    const next = ranges.slice();
                    next[i] = { ...rng, end: e.target.value };
                    stage(r.key, { date_ranges: next });
                  }}
                />
                <button
                  type="button"
                  className="list-action-icon"
                  title="Remove range"
                  onClick={() => {
                    const next = ranges.filter((_, idx) => idx !== i);
                    stage(r.key, { date_ranges: next });
                  }}
                >✕</button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => stage(r.key, { date_ranges: [...ranges, { start: '', end: '' }] })}
            >+ Add range</button>
          </div>
        );
      },
    },
    {
      key: 'multiplier', label: 'Multiplier', sortable: false, align: 'right' as const, width: '150px',
      render: (row: DataRow) => {
        const r = row as any;
        if (!unlocked) {
          return <span style={{ fontWeight: 600 }}>×{r.multiplier}</span>;
        }
        return (
          <input
            type="number"
            step="0.01"
            min="0"
            className="form-input"
            value={r.multiplier}
            onChange={(e) => stage(r.key, { multiplier: Number(e.target.value) })}
            disabled={r.key === 'peak'}
            title={r.key === 'peak' ? 'Peak is the anchor and always ×1.00' : 'Multiplier applied to Peak rate to derive this season'}
            style={{ width: 90, textAlign: 'right' }}
          />
        );
      },
    },
  ];

  if (loading) {
    return <div className="page-loader"><div className="spinner" /></div>;
  }

  return (
    <div>
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
        Four-tier seasonal pricing calendar. Each season has its date ranges (MM-DD format,
        multiple allowed per season) and a multiplier applied to each property's Peak rate to
        derive the auto-suggested rate. Edits made here ripple through every non-overridden
        cell on the Pricing page and every quote across the app.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="list-toolbar">
          <div className="list-toolbar-left" />
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
              >
                {saving ? 'Saving…' : '💾 Save'}
              </button>
            )}
            <button
              className={`btn ${unlocked ? 'btn-outline-success' : 'btn-ghost'}`}
              onClick={toggleLock}
              disabled={saving}
              title={unlocked ? 'Lock the page (view-only)' : 'Unlock to edit seasons'}
            >
              {unlocked ? '🔓 Unlocked' : '🔒 Locked'}
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <DataTable
          columns={columns}
          data={rows as any}
          loading={false}
          searchable={false}
          resultsBarContent={null}
        />
      </div>
    </div>
  );
}
