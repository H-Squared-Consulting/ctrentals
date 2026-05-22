/**
 * SeasonTagsPage -- Business-wide and per-property season tags.
 *
 * Follows the standard list-page baseline:
 *   - Toolbar: filters -> search -> count -> + New Tag
 *   - Add via ActionModal
 *   - Status shown via .ops-status-pill semantic variants (--peak/--high/--mid/--low)
 *   - Two-section list (business-wide / per-property) kept; both use the
 *     same .data-table shell so they read as siblings.
 */

/* eslint-disable */
// @ts-nocheck

import { useState, useEffect, useMemo } from 'react';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import ActionModal from '../components/ActionModal';
import DataTable from '../components/DataTable';
import type { DataRow } from '../components/DataTable';
import DateInput from '../components/DateInput';
import { SEASON_TAG_OPTIONS, CT_RENTALS_PARTNER_ID } from './constants';
import type { SeasonTag } from '../types/pricing';

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

const SEASON_VARIANT: Record<string, string> = {
  Peak: 'peak', High: 'high', Mid: 'mid', Low: 'low',
};

const EMPTY_DRAFT = {
  name: 'Peak',
  start_date: '',
  end_date: '',
  multiplier: '1.5',
  property_id: '',
};

export default function SeasonTagsPage({ embedded }: { embedded?: boolean } = {}) {
  const toast = useToast();
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();

  const [tags, setTags] = useState<SeasonTag[]>([]);
  const [properties, setProperties] = useState<{ id: string; property_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [seasonFilter, setSeasonFilter] = useState('');
  const [propertyFilter, setPropertyFilter] = useState<'' | 'business' | 'property'>('');
  const [search, setSearch] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  useEffect(() => { if (!embedded) setPageTitle('Season Tags'); }, [setPageTitle, embedded]);

  async function loadData() {
    setLoading(true);
    try {
      const [tagRes, propRes] = await Promise.all([
        supabase.from('season_tags').select('*').order('start_date'),
        supabase.from('partner_properties').select('id, property_name').eq('partner_id', CT_RENTALS_PARTNER_ID).order('property_name'),
      ]);
      if (tagRes.data) setTags(tagRes.data);
      if (propRes.data) setProperties(propRes.data);
    } catch (err) {
      console.error('Error loading season tags:', err);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { if (supabase) loadData(); }, [supabase]);

  const propertyNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of properties) map[p.id] = p.property_name;
    return map;
  }, [properties]);

  const filtered = useMemo(() => {
    let result = tags;
    if (seasonFilter) result = result.filter(t => t.name === seasonFilter);
    if (propertyFilter === 'business') result = result.filter(t => !t.property_id);
    if (propertyFilter === 'property') result = result.filter(t => !!t.property_id);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(t => {
        const pname = t.property_id ? (propertyNameById[t.property_id] || '').toLowerCase() : '';
        return (t.name || '').toLowerCase().includes(q) || pname.includes(q);
      });
    }
    return result;
  }, [tags, seasonFilter, propertyFilter, search, propertyNameById]);

  const businessWideTags = filtered.filter(t => !t.property_id);
  const propertyTags = filtered.filter(t => !!t.property_id);

  function openAdd() {
    setDraft(EMPTY_DRAFT);
    setAddOpen(true);
  }

  async function handleAdd() {
    if (!draft.start_date || !draft.end_date) { toast.error('Start and end dates are required'); return; }
    if (draft.end_date <= draft.start_date) { toast.error('End date must be after start date'); return; }
    setSaving(true);
    try {
      const payload = {
        name: draft.name,
        start_date: draft.start_date,
        end_date: draft.end_date,
        multiplier: parseFloat(draft.multiplier) || 1.0,
        property_id: draft.property_id || null,
      };
      const { error } = await supabase.from('season_tags').insert(payload);
      if (error) throw error;
      toast.success('Season tag added');
      setAddOpen(false);
      await loadData();
    } catch (err: any) {
      toast.error('Failed to save: ' + (err?.message || err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(tag: SeasonTag, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete ${tag.name} season (${tag.start_date} to ${tag.end_date})?`)) return;
    try {
      const { error } = await supabase.from('season_tags').delete().eq('id', tag.id);
      if (error) throw error;
      await loadData();
    } catch (err: any) {
      toast.error('Failed to delete: ' + (err?.message || err));
    }
  }

  if (loading) {
    return <div className="page-loader"><div className="spinner" /></div>;
  }

  function tagRows(list: SeasonTag[]): Array<DataRow & { tag: SeasonTag }> {
    return list.map(tag => ({
      id: tag.id,
      name: tag.name,
      property: titleCase(propertyNameById[tag.property_id || '']),
      start_date: tag.start_date,
      end_date: tag.end_date,
      multiplier: tag.multiplier,
      tag,
    }));
  }

  function tagColumns(includeProperty: boolean) {
    return [
      {
        key: 'name', label: 'Season', sortable: true,
        render: (row: DataRow) => {
          const name = (row as any).name as string;
          return (
            <span className={`ops-status-pill ops-status-pill--${SEASON_VARIANT[name] || 'mid'}`}>
              <span className="ops-status-pill-dot" />
              {name}
            </span>
          );
        },
      },
      ...(includeProperty ? [{
        key: 'property', label: 'Property', sortable: true,
        render: (row: DataRow) => (row as any).property || <span className="text-light">-</span>,
      }] : []),
      { key: 'start_date', label: 'Start date', sortable: true, render: (row: DataRow) => (row as any).start_date },
      { key: 'end_date', label: 'End date', sortable: true, render: (row: DataRow) => (row as any).end_date },
      {
        key: 'multiplier', label: 'Multiplier', sortable: true, align: 'right' as const,
        render: (row: DataRow) => <span style={{ fontWeight: 600 }}>{(row as any).multiplier}x</span>,
      },
      {
        key: 'actions', label: '', align: 'right' as const, width: '70px',
        render: (row: DataRow) => (
          <div className="list-actions" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="list-action-icon"
              title="Delete"
              onClick={(e) => handleDelete((row as any).tag, e)}
            >
              ✕
            </button>
          </div>
        ),
      },
    ];
  }

  return (
    <div>
      {/* Toolbar — baseline order: filters -> search -> count -> + New */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            <select
              className="list-filter-select"
              value={seasonFilter}
              onChange={(e) => setSeasonFilter(e.target.value)}
              title="Filter by season"
            >
              <option value="">All seasons</option>
              {SEASON_TAG_OPTIONS.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select
              className="list-filter-select"
              value={propertyFilter}
              onChange={(e) => setPropertyFilter(e.target.value as any)}
              title="Filter by scope"
            >
              <option value="">All scopes</option>
              <option value="business">Business-wide</option>
              <option value="property">Property-specific</option>
            </select>
            <div className="list-search">
              <span className="list-search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search by season or property…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && <button className="list-search-clear" onClick={() => setSearch('')}>✕</button>}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
              {filtered.length} of {tags.length}
            </span>
          </div>
          <div className="list-toolbar-right">
            <button className="btn btn-primary" onClick={openAdd}>+ New Tag</button>
          </div>
        </div>
      </div>

      {/* Business-wide */}
      {(propertyFilter !== 'property') && (
        <div className="card" style={{ marginBottom: 16, padding: 0 }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
            <strong style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)' }}>
              Business-wide seasons
            </strong>
            <span style={{ marginLeft: 8, fontSize: '0.6875rem', color: 'var(--text-light)' }}>
              {businessWideTags.length} {businessWideTags.length === 1 ? 'tag' : 'tags'}
            </span>
          </div>
          {businessWideTags.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              No business-wide season tags yet.
            </div>
          ) : (
            <DataTable
              columns={tagColumns(false)}
              data={tagRows(businessWideTags)}
              loading={false}
              searchable={false}
              resultsBarContent={null}
              defaultSort={{ key: 'start_date', direction: 'asc' }}
            />
          )}
        </div>
      )}

      {/* Per-property overrides */}
      {(propertyFilter !== 'business') && propertyTags.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
            <strong style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)' }}>
              Property-specific overrides
            </strong>
            <span style={{ marginLeft: 8, fontSize: '0.6875rem', color: 'var(--text-light)' }}>
              {propertyTags.length} {propertyTags.length === 1 ? 'tag' : 'tags'}
            </span>
          </div>
          <DataTable
            columns={tagColumns(true)}
            data={tagRows(propertyTags)}
            loading={false}
            searchable={false}
            resultsBarContent={null}
            defaultSort={{ key: 'start_date', direction: 'asc' }}
          />
        </div>
      )}

      {addOpen && (
        <ActionModal
          title="New season tag"
          subtitle="Pricing multiplier for a date range"
          width={620}
          primaryAction={
            <button className="btn btn-primary" onClick={handleAdd} disabled={saving}>
              {saving ? 'Saving…' : 'Save tag'}
            </button>
          }
          onClose={() => setAddOpen(false)}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
            <div className="form-group">
              <label className="form-label">Season</label>
              <select
                className="form-input"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              >
                {SEASON_TAG_OPTIONS.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Multiplier</label>
              <input
                type="number"
                className="form-input"
                value={draft.multiplier}
                onChange={(e) => setDraft({ ...draft, multiplier: e.target.value })}
                min={0.1}
                step="0.05"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Start date</label>
              <DateInput
                className="form-input"
                value={draft.start_date}
                onChange={(v) => setDraft({ ...draft, start_date: v })}
                placeholder="e.g. 1 Dec 2026"
              />
            </div>
            <div className="form-group">
              <label className="form-label">End date</label>
              <DateInput
                className="form-input"
                value={draft.end_date}
                onChange={(v) => setDraft({ ...draft, end_date: v })}
                placeholder="e.g. 15 Jan 2027"
              />
            </div>
          </div>
          <div className="form-group" style={{ marginTop: 8 }}>
            <label className="form-label">Property (leave blank for business-wide)</label>
            <select
              className="form-input"
              value={draft.property_id}
              onChange={(e) => setDraft({ ...draft, property_id: e.target.value })}
            >
              <option value="">All properties (business-wide)</option>
              {properties.map(p => <option key={p.id} value={p.id}>{titleCase(p.property_name)}</option>)}
            </select>
          </div>
        </ActionModal>
      )}
    </div>
  );
}
