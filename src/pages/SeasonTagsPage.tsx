/* eslint-disable */
// @ts-nocheck
/**
 * SeasonTagsPage -- Manage business-wide and per-property season tags
 */

import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import DateInput from '../components/DateInput';
import { SEASON_TAG_OPTIONS, CT_RENTALS_PARTNER_ID } from './constants';
import type { SeasonTag } from '../types/pricing';

export default function SeasonTagsPage() {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();

  const [tags, setTags] = useState<SeasonTag[]>([]);
  const [properties, setProperties] = useState<{ id: string; property_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [newTag, setNewTag] = useState({
    name: 'Peak',
    start_date: '',
    end_date: '',
    multiplier: '1.5',
    property_id: '',
  });

  useEffect(() => { setPageTitle('Season Tags'); }, [setPageTitle]);

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

  useEffect(() => {
    if (supabase) loadData();
  }, [supabase]);

  async function handleAdd() {
    if (!newTag.start_date || !newTag.end_date) { alert('Start and end dates are required'); return; }
    if (newTag.end_date <= newTag.start_date) { alert('End date must be after start date'); return; }
    setSaving(true);
    try {
      const payload = {
        name: newTag.name,
        start_date: newTag.start_date,
        end_date: newTag.end_date,
        multiplier: parseFloat(newTag.multiplier) || 1.0,
        property_id: newTag.property_id || null,
      };
      const { data, error } = await supabase.from('season_tags').insert(payload).select();
      if (error) throw error;
      setTags((prev) => [...prev, data[0]].sort((a, b) => a.start_date.localeCompare(b.start_date)));
      setNewTag({ name: 'Peak', start_date: '', end_date: '', multiplier: '1.5', property_id: '' });
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await supabase.from('season_tags').delete().eq('id', id);
      if (error) throw error;
      setTags((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  }

  const SEASON_COLORS: Record<string, { color: string; bg: string }> = {
    Peak: { color: '#991B1B', bg: '#FEE2E2' },
    High: { color: '#92400E', bg: '#FEF3C7' },
    Mid:  { color: '#065F46', bg: '#D1FAE5' },
    Low:  { color: '#1E40AF', bg: '#DBEAFE' },
  };

  if (loading) {
    return <div className="page-loader"><div className="spinner" /></div>;
  }

  const businessWideTags = tags.filter((t) => !t.property_id);
  const propertyTags = tags.filter((t) => !!t.property_id);

  return (
    <div>
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{tags.length} season tags</span>
          </div>
          <div className="list-toolbar-right">
            <button className="btn btn-ghost" onClick={loadData}>↻ Refresh</button>
          </div>
        </div>
      </div>

      {/* ── Add new tag ── */}
      <div className="card" style={{ marginBottom: '16px', padding: '16px' }}>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '10px' }}>Add Season Tag</h3>
        <div className="season-tag-row">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Season</label>
            <select className="form-input" value={newTag.name} onChange={(e) => setNewTag({ ...newTag, name: e.target.value })}>
              {SEASON_TAG_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Start Date</label>
            <DateInput className="form-input" value={newTag.start_date} onChange={(v) => setNewTag({ ...newTag, start_date: v })} placeholder="e.g. 1 Dec 2026" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">End Date</label>
            <DateInput className="form-input" value={newTag.end_date} onChange={(v) => setNewTag({ ...newTag, end_date: v })} placeholder="e.g. 15 Jan 2027" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Multiplier</label>
            <input type="number" className="form-input" value={newTag.multiplier} onChange={(e) => setNewTag({ ...newTag, multiplier: e.target.value })} min={0.1} step="0.05" />
          </div>
          <button className="btn btn-primary" style={{ fontSize: '0.75rem' }} onClick={handleAdd} disabled={saving}>
            {saving ? '...' : '+ Add'}
          </button>
        </div>
        <div className="form-group" style={{ marginTop: '8px', marginBottom: 0 }}>
          <label className="form-label">Property (leave blank for business-wide)</label>
          <select className="form-input" value={newTag.property_id} onChange={(e) => setNewTag({ ...newTag, property_id: e.target.value })}>
            <option value="">All properties (business-wide)</option>
            {properties.map((p) => (<option key={p.id} value={p.id}>{p.property_name}</option>))}
          </select>
        </div>
      </div>

      {/* ── Business-wide tags ── */}
      <div className="card" style={{ marginBottom: '16px', padding: '16px' }}>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '10px' }}>Business-Wide Seasons</h3>
        {businessWideTags.length === 0 ? (
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-light)' }}>No business-wide season tags yet.</div>
        ) : (
          businessWideTags.map((tag) => (
            <div key={tag.id} className="season-tag-row" style={{ alignItems: 'center' }}>
              <span className="status-badge" style={{ background: SEASON_COLORS[tag.name]?.bg, color: SEASON_COLORS[tag.name]?.color }}>{tag.name}</span>
              <span style={{ fontSize: '0.8125rem' }}>{tag.start_date}</span>
              <span style={{ fontSize: '0.8125rem' }}>{tag.end_date}</span>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{tag.multiplier}x</span>
              <button className="btn btn-ghost" style={{ fontSize: '0.6875rem', padding: '4px 8px', color: 'var(--error)' }} onClick={() => handleDelete(tag.id)}>✕</button>
            </div>
          ))
        )}
      </div>

      {/* ── Per-property tags ── */}
      {propertyTags.length > 0 && (
        <div className="card" style={{ padding: '16px' }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '10px' }}>Property-Specific Overrides</h3>
          {propertyTags.map((tag) => {
            const propName = properties.find((p) => p.id === tag.property_id)?.property_name || 'Unknown';
            return (
              <div key={tag.id} className="season-tag-row" style={{ alignItems: 'center' }}>
                <div>
                  <span className="status-badge" style={{ background: SEASON_COLORS[tag.name]?.bg, color: SEASON_COLORS[tag.name]?.color }}>{tag.name}</span>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--text-light)', marginLeft: '6px' }}>{propName}</span>
                </div>
                <span style={{ fontSize: '0.8125rem' }}>{tag.start_date}</span>
                <span style={{ fontSize: '0.8125rem' }}>{tag.end_date}</span>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{tag.multiplier}x</span>
                <button className="btn btn-ghost" style={{ fontSize: '0.6875rem', padding: '4px 8px', color: 'var(--error)' }} onClick={() => handleDelete(tag.id)}>✕</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
