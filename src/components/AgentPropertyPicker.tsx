/**
 * AgentPropertyPicker -- modal for picking which CT Rentals properties
 * one or more agents can sell through their portal.
 *
 * Multi-select against the active portfolio. Save writes via
 * agentPortalAdmin.setPropertyIdsForAgent (DELETE-then-INSERT on the
 * agent_properties join table).
 *
 * Single-agent mode: pass agentIds=[id]. Bulk mode (e.g. "assign to
 * all Cape Concierge agents"): pass agentIds=[id1, id2, ...]. In bulk
 * mode, the saved set is written to every agent in the array,
 * overwriting any per-agent selection they had before.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './ToastProvider';
import ActionModal from './ActionModal';
import { setPropertyIdsForAgent } from '../lib/agentPortalAdmin';
import { CT_RENTALS_PARTNER_ID } from '../pages/constants';

interface PropertyLite {
  id: string;
  slug: string | null;
  property_name: string;
  suburb: string | null;
  is_archived: boolean | null;
  is_published: boolean | null;
}

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

export default function AgentPropertyPicker({
  agentIds,
  title,
  subtitle,
  initialPropertyIds = [],
  onClose,
  onSaved,
}: {
  agentIds: string[];
  title: string;
  subtitle?: string;
  initialPropertyIds?: string[];
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}) {
  const { supabase } = useAuth();
  const toast = useToast();

  const [properties, setProperties] = useState<PropertyLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialPropertyIds));
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('partner_properties')
        .select('id, slug, property_name, suburb, is_archived, is_published')
        .eq('partner_id', CT_RENTALS_PARTNER_ID)
        .order('property_name');
      if (cancelled) return;
      if (error) {
        toast.error('Failed to load properties: ' + error.message);
        setLoading(false);
        return;
      }
      setProperties((data || []).filter((p: PropertyLite) => !p.is_archived && p.is_published));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, toast]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return properties;
    return properties.filter(p => {
      const text = [p.property_name, p.suburb, p.slug].filter(Boolean).join(' ').toLowerCase();
      return text.includes(q);
    });
  }, [properties, search]);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(filtered.map(p => p.id)));
  }

  function clearAll() {
    setSelected(new Set());
  }

  async function save() {
    setSaving(true);
    try {
      const ids = Array.from(selected);
      for (const agentId of agentIds) {
        await setPropertyIdsForAgent(supabase, agentId, ids);
      }
      const agentNoun = agentIds.length === 1 ? 'agent' : `${agentIds.length} agents`;
      const propNoun = ids.length === 1 ? '1 property' : `${ids.length} properties`;
      toast.success(`${propNoun} assigned to ${agentNoun}`);
      if (onSaved) await onSaved();
      onClose();
    } catch (err: any) {
      toast.error('Failed to save: ' + (err?.message || err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ActionModal
      title={title}
      subtitle={subtitle}
      width={620}
      primaryAction={
        <button className="btn btn-primary" onClick={save} disabled={loading || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      }
      onClose={onClose}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', marginBottom: 'var(--s-3)' }}>
        <input
          className="form-input"
          style={{ flex: 1 }}
          placeholder="Search property name, suburb or slug…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="btn btn-ghost" onClick={selectAll} disabled={loading}>Select all</button>
        <button type="button" className="btn btn-ghost" onClick={clearAll} disabled={loading}>Clear</button>
      </div>

      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 'var(--s-3)' }}>
        {loading
          ? 'Loading…'
          : `${selected.size} of ${filtered.length} selected${search ? ' (filtered)' : ''}`}
      </div>

      {agentIds.length > 1 && (
        <div style={{
          fontSize: '0.8125rem',
          color: 'var(--warning)',
          background: 'var(--warning-bg)',
          border: '1px solid #FCD34D',
          borderRadius: 'var(--radius-sm)',
          padding: 'var(--s-2) var(--s-3)',
          marginBottom: 'var(--s-3)',
        }}>
          <strong>Bulk assign:</strong> saving will overwrite each agent's existing property list with this exact selection.
        </div>
      )}

      <div style={{
        maxHeight: 360,
        overflowY: 'auto',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--surface)',
      }}>
        {loading && (
          <div style={{ padding: 'var(--s-5)', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Loading active properties…
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: 'var(--s-5)', textAlign: 'center', color: 'var(--text-secondary)' }}>
            No properties match the search.
          </div>
        )}
        {!loading && filtered.map(p => (
          <label
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--s-3)',
              padding: 'var(--s-2) var(--s-3)',
              borderBottom: '1px solid var(--border-light)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={selected.has(p.id)}
              onChange={() => toggle(p.id)}
              style={{ flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: 'var(--text)' }}>
                {titleCase(p.property_name)}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {[p.slug, titleCase(p.suburb || '')].filter(Boolean).join(' · ')}
              </div>
            </div>
          </label>
        ))}
      </div>
    </ActionModal>
  );
}
