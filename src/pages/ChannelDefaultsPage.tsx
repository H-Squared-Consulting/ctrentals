/* eslint-disable */
// @ts-nocheck
/**
 * ChannelDefaultsPage — global per-partner platform fees.
 *
 * Source of truth for "what does Airbnb charge us?" — pricing scenarios
 * read these before falling back to per-property channel_profiles for
 * the listings with non-standard terms.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import { useToast } from '../components/ToastProvider';
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

export default function ChannelDefaultsPage({ embedded }: { embedded?: boolean } = {}) {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();
  const toast = useToast();

  const [rows, setRows] = useState<ChannelDefault[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ platform_name: '', fee_pct: '', fixed_fee: '0', notes: '' });

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
      toast.success('Saved');
      setDraft({ platform_name: '', fee_pct: '', fixed_fee: '0', notes: '' });
      setShowAdd(false);
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

  async function remove(row: ChannelDefault) {
    if (!confirm(`Delete the global default for ${row.platform_name}?`)) return;
    try {
      const { error } = await supabase.from('channel_defaults').delete().eq('id', row.id);
      if (error) throw error;
      setRows(prev => prev.filter(r => r.id !== row.id));
    } catch (err: any) {
      toast.error('Failed to delete: ' + (err?.message || err));
    }
  }

  const usedPlatforms = new Set(rows.map(r => r.platform_name));
  const availablePlatforms = PLATFORM_NAME_OPTIONS.filter(o => !usedPlatforms.has(o.value));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--s-3)' }}>
        {availablePlatforms.length > 0 && (
          <button className="btn btn-primary" style={{ fontSize: '0.8125rem' }} onClick={() => setShowAdd(s => !s)}>
            {showAdd ? '× Cancel' : '+ Add platform'}
          </button>
        )}
      </div>

      {showAdd && (
        <div className="card" style={{ marginBottom: 'var(--s-3)', padding: 'var(--s-3)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 120px 1fr auto', gap: 8, alignItems: 'end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Platform</label>
              <select className="form-input" value={draft.platform_name} onChange={(e) => setDraft({ ...draft, platform_name: e.target.value })}>
                <option value="">-- Pick --</option>
                {availablePlatforms.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Fee %</label>
              <input className="form-input" type="number" min={0} max={100} step="0.1" value={draft.fee_pct} onChange={(e) => setDraft({ ...draft, fee_pct: e.target.value })} placeholder="15" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Fixed fee</label>
              <input className="form-input" type="number" min={0} step="0.01" value={draft.fixed_fee} onChange={(e) => setDraft({ ...draft, fixed_fee: e.target.value })} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Notes</label>
              <input className="form-input" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Optional" />
            </div>
            <button className="btn btn-primary" style={{ fontSize: '0.8125rem' }} onClick={handleAdd}>Save</button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-light)' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-light)' }}>
            No platform defaults yet. Add one to set the fee everyone gets by default.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Platform</th>
                <th style={{ textAlign: 'right', width: 120 }}>Fee %</th>
                <th style={{ textAlign: 'right', width: 140 }}>Fixed fee</th>
                <th>Notes</th>
                <th style={{ textAlign: 'center', width: 100 }}>Status</th>
                <th style={{ width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.6 }}>
                  <td><strong>{r.platform_name}</strong></td>
                  <td style={{ textAlign: 'right' }}>
                    {/* String-backed value so the user can clear the field
                        and type a fresh number; leading zero would otherwise
                        stick because Number("") === 0. */}
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
                      style={{ width: 90, textAlign: 'right' }}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
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
                      style={{ width: 110, textAlign: 'right' }}
                    />
                  </td>
                  <td>
                    <input
                      className="form-input"
                      value={r.notes || ''}
                      onChange={(e) => setRows(prev => prev.map(x => x.id === r.id ? { ...x, notes: e.target.value } : x))}
                      onBlur={(e) => updateField(r, { notes: e.target.value.trim() || null })}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className={`status-pill ${r.is_active ? 'status-pill--active' : 'status-pill--inactive'}`}
                      onClick={() => updateField(r, { is_active: !r.is_active })}
                      title={r.is_active ? 'Click to mark inactive' : 'Click to reactivate'}
                    >
                      {r.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td>
                    <button className="btn btn-ghost" style={{ fontSize: '0.75rem', color: 'var(--error)' }} onClick={() => remove(r)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
