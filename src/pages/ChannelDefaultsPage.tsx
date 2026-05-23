/**
 * ChannelDefaultsPage — global per-partner platform fees.
 *
 * Source of truth for "what does Airbnb charge us?". Pricing scenarios
 * read these before falling back to per-property channel_profiles for
 * the listings with non-standard terms.
 *
 * Follows the standard list-page baseline:
 *   - Toolbar: filters -> search -> count -> + New Platform
 *   - Inline editing per row (intentional: small dataset, frequent tweaks)
 *   - Status pills via .ops-status-pill semantic variants
 *   - Add via ActionModal
 */

/* eslint-disable */
// @ts-nocheck

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import { useToast } from '../components/ToastProvider';
import ActionModal from '../components/ActionModal';
import DataTable from '../components/DataTable';
import type { DataRow } from '../components/DataTable';
import { CT_RENTALS_PARTNER_ID, PLATFORM_NAME_OPTIONS } from './constants';

interface ChannelDefault {
  id: string;
  partner_id: string;
  platform_name: string;
  fee_pct: number;
  fixed_fee: number;
  notes: string | null;
  is_active: boolean;
}

const EMPTY_DRAFT = { platform_name: '', fee_pct: '', fixed_fee: '0', notes: '' };

export default function ChannelDefaultsPage({ embedded }: { embedded?: boolean } = {}) {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();
  const toast = useToast();

  const [rows, setRows] = useState<ChannelDefault[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const [activeFilter, setActiveFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [search, setSearch] = useState('');

  useEffect(() => { if (!embedded) setPageTitle('Platforms'); }, [setPageTitle, embedded]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('channel_defaults')
      .select('*')
      .eq('partner_id', CT_RENTALS_PARTNER_ID)
      .order('platform_name');
    if (data) setRows(data as ChannelDefault[]);
    setLoading(false);
  }
  useEffect(() => { if (supabase) load(); }, [supabase]);

  const usedPlatforms = useMemo(() => new Set(rows.map(r => r.platform_name)), [rows]);
  const availablePlatforms = useMemo(
    () => PLATFORM_NAME_OPTIONS.filter((o: any) => !usedPlatforms.has(o.value)),
    [usedPlatforms],
  );

  const inactiveCount = useMemo(() => rows.filter(r => !r.is_active).length, [rows]);

  const filtered = useMemo(() => {
    let result = rows;
    if (activeFilter === 'active')   result = result.filter(r => r.is_active);
    if (activeFilter === 'inactive') result = result.filter(r => !r.is_active);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        (r.platform_name || '').toLowerCase().includes(q) ||
        (r.notes || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [rows, activeFilter, search]);

  function openAdd() {
    setDraft(EMPTY_DRAFT);
    setAddOpen(true);
  }

  async function handleAdd() {
    if (!draft.platform_name) { toast.error('Pick a platform'); return; }
    try {
      const payload = {
        partner_id: CT_RENTALS_PARTNER_ID,
        platform_name: draft.platform_name,
        fee_pct: parseFloat(draft.fee_pct) || 0,
        fixed_fee: parseFloat(draft.fixed_fee) || 0,
        notes: draft.notes.trim() || null,
        is_active: true,
      };
      const { error } = await supabase
        .from('channel_defaults')
        .upsert(payload, { onConflict: 'partner_id,platform_name' });
      if (error) throw error;
      toast.success('Platform added');
      setAddOpen(false);
      await load();
    } catch (err: any) {
      toast.error('Failed to save: ' + (err?.message || err));
    }
  }

  async function updateField(row: ChannelDefault, patch: Partial<ChannelDefault>) {
    try {
      const { error } = await supabase
        .from('channel_defaults')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (error) throw error;
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, ...patch } : r));
    } catch (err: any) {
      toast.error('Failed to update: ' + (err?.message || err));
    }
  }

  async function remove(row: ChannelDefault, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete the global default for ${row.platform_name}?`)) return;
    try {
      const { error } = await supabase.from('channel_defaults').delete().eq('id', row.id);
      if (error) throw error;
      setRows(prev => prev.filter(r => r.id !== row.id));
    } catch (err: any) {
      toast.error('Failed to delete: ' + (err?.message || err));
    }
  }

  return (
    <div>
      {/* Toolbar — baseline order: filters -> search -> count -> + New */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            <select
              className="list-filter-select"
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value as any)}
              title="Filter by status"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive ({inactiveCount})</option>
              <option value="all">All ({rows.length})</option>
            </select>
            <div className="list-search">
              <span className="list-search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search by platform or notes…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && <button className="list-search-clear" onClick={() => setSearch('')}>✕</button>}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
              {filtered.length} of {rows.length}
            </span>
          </div>
          <div className="list-toolbar-right">
            {availablePlatforms.length > 0 && (
              <button className="btn btn-primary" onClick={openAdd}>+ New Platform</button>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-light)' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
            {rows.length === 0
              ? <>No platform defaults yet. Click <strong>+ New Platform</strong> to add one.</>
              : <>No platforms match your filter.</>}
          </div>
        ) : (
          <DataTable
            columns={[
              {
                key: 'platform_name', label: 'Platform', sortable: true,
                render: (row: DataRow) => <strong>{(row as any).row.platform_name}</strong>,
              },
              {
                key: 'fee_pct', label: 'Fee %', sortable: true, align: 'right' as const, width: '130px',
                render: (row: DataRow) => {
                  const r = (row as any).row as ChannelDefault;
                  return (
                    <input
                      className="form-input"
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      value={r.fee_pct === 0 ? '' : r.fee_pct}
                      placeholder="0"
                      onChange={(e) => {
                        const v = e.target.value;
                        setRows(prev => prev.map(x => x.id === r.id ? { ...x, fee_pct: v === '' ? 0 : Number(v) } : x));
                      }}
                      onBlur={(e) => updateField(r, { fee_pct: parseFloat(e.target.value) || 0 })}
                      style={{ width: 100, textAlign: 'right' }}
                    />
                  );
                },
              },
              {
                key: 'fixed_fee', label: 'Fixed fee', sortable: true, align: 'right' as const, width: '150px',
                render: (row: DataRow) => {
                  const r = (row as any).row as ChannelDefault;
                  return (
                    <input
                      className="form-input"
                      type="number"
                      min={0}
                      step="0.01"
                      value={r.fixed_fee === 0 ? '' : r.fixed_fee}
                      placeholder="0"
                      onChange={(e) => {
                        const v = e.target.value;
                        setRows(prev => prev.map(x => x.id === r.id ? { ...x, fixed_fee: v === '' ? 0 : Number(v) } : x));
                      }}
                      onBlur={(e) => updateField(r, { fixed_fee: parseFloat(e.target.value) || 0 })}
                      style={{ width: 120, textAlign: 'right' }}
                    />
                  );
                },
              },
              {
                key: 'notes', label: 'Notes', sortable: true,
                render: (row: DataRow) => {
                  const r = (row as any).row as ChannelDefault;
                  return (
                    <input
                      className="form-input"
                      value={r.notes || ''}
                      onChange={(e) => setRows(prev => prev.map(x => x.id === r.id ? { ...x, notes: e.target.value } : x))}
                      onBlur={(e) => updateField(r, { notes: e.target.value.trim() || null })}
                    />
                  );
                },
              },
              {
                key: 'is_active', label: 'Status', sortable: true, align: 'center' as const, width: '110px',
                render: (row: DataRow) => {
                  const r = (row as any).row as ChannelDefault;
                  return (
                    <button
                      className={`ops-status-pill ops-status-pill--${r.is_active ? 'active' : 'inactive'}`}
                      onClick={() => updateField(r, { is_active: !r.is_active })}
                      title={r.is_active ? 'Click to mark inactive' : 'Click to reactivate'}
                      style={{ cursor: 'pointer', border: '1px solid var(--border)' }}
                    >
                      <span className="ops-status-pill-dot" />
                      {r.is_active ? 'Active' : 'Inactive'}
                    </button>
                  );
                },
              },
              {
                key: 'actions', label: '', align: 'right' as const, width: '60px',
                render: (row: DataRow) => {
                  const r = (row as any).row as ChannelDefault;
                  return (
                    <div className="list-actions">
                      <button
                        type="button"
                        className="list-action-icon"
                        title="Delete"
                        onClick={(e) => remove(r, e)}
                      >
                        ✕
                      </button>
                    </div>
                  );
                },
              },
            ]}
            data={filtered.map(r => ({
              id: r.id,
              platform_name: r.platform_name,
              fee_pct: r.fee_pct,
              fixed_fee: r.fixed_fee,
              notes: r.notes || '',
              is_active: r.is_active ? 1 : 0,
              row: r,
            }))}
            loading={false}
            searchable={false}
            resultsBarContent={null}
            defaultSort={{ key: 'platform_name', direction: 'asc' }}
          />
        )}
      </div>

      {addOpen && (
        <ActionModal
          title="New platform default"
          subtitle="Sets the default fee for one channel"
          width={560}
          primaryAction={
            <button className="btn btn-primary" onClick={handleAdd}>
              Save platform
            </button>
          }
          onClose={() => setAddOpen(false)}
        >
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Platform</label>
              <select
                className="form-input"
                value={draft.platform_name}
                onChange={(e) => setDraft({ ...draft, platform_name: e.target.value })}
              >
                <option value="">Pick a platform…</option>
                {availablePlatforms.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Fee %</label>
              <input
                className="form-input"
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={draft.fee_pct}
                onChange={(e) => setDraft({ ...draft, fee_pct: e.target.value })}
                placeholder="15"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Fixed fee</label>
              <input
                className="form-input"
                type="number"
                min={0}
                step="0.01"
                value={draft.fixed_fee}
                onChange={(e) => setDraft({ ...draft, fixed_fee: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <input
                className="form-input"
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                placeholder="Optional"
              />
            </div>
          </div>
        </ActionModal>
      )}
    </div>
  );
}
