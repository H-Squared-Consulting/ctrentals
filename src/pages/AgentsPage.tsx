/* eslint-disable */
// @ts-nocheck
/**
 * AgentsPage -- Manage booking agents and their commission rates
 */

import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import type { Agent } from '../types/pricing';

export default function AgentsPage({ embedded }: { embedded?: boolean } = {}) {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', default_commission_pct: '' });

  const [newAgent, setNewAgent] = useState({ name: '', default_commission_pct: '10' });

  useEffect(() => { if (!embedded) setPageTitle('Agents'); }, [setPageTitle, embedded]);

  async function loadAgents() {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('agents').select('*').order('name');
      if (error) throw error;
      setAgents(data || []);
    } catch (err) {
      console.error('Error loading agents:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (supabase) loadAgents();
  }, [supabase]);

  async function handleAdd() {
    if (!newAgent.name.trim()) { alert('Agent name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        name: newAgent.name.trim(),
        default_commission_pct: parseFloat(newAgent.default_commission_pct) || 0,
      };
      const { data, error } = await supabase.from('agents').insert(payload).select();
      if (error) throw error;
      setAgents((prev) => [...prev, data[0]].sort((a, b) => a.name.localeCompare(b.name)));
      setNewAgent({ name: '', default_commission_pct: '10' });
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit() {
    if (!editForm.name.trim()) { alert('Agent name is required'); return; }
    try {
      const payload = {
        name: editForm.name.trim(),
        default_commission_pct: parseFloat(editForm.default_commission_pct) || 0,
      };
      const { error } = await supabase.from('agents').update(payload).eq('id', editingId);
      if (error) throw error;
      setAgents((prev) =>
        prev.map((a) => (a.id === editingId ? { ...a, ...payload } : a))
      );
      setEditingId(null);
    } catch (err) {
      alert('Failed to update: ' + err.message);
    }
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await supabase.from('agents').delete().eq('id', id);
      if (error) throw error;
      setAgents((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  }

  function startEdit(agent: Agent) {
    setEditingId(agent.id);
    setEditForm({ name: agent.name, default_commission_pct: String(agent.default_commission_pct) });
  }

  if (loading) {
    return <div className="page-loader"><div className="spinner" /></div>;
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{agents.length} agents</span>
          </div>
          <div className="list-toolbar-right">
            <button className="btn btn-ghost" onClick={loadAgents}>↻ Refresh</button>
          </div>
        </div>
      </div>

      {/* ── Add new agent ── */}
      <div className="card" style={{ marginBottom: '16px', padding: '16px' }}>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '10px' }}>Add Agent</h3>
        <div className="agent-row">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Name</label>
            <input type="text" className="form-input" value={newAgent.name} onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })} placeholder="Agent name" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Commission %</label>
            <input type="number" className="form-input" value={newAgent.default_commission_pct} onChange={(e) => setNewAgent({ ...newAgent, default_commission_pct: e.target.value })} min={0} max={100} step="0.5" />
          </div>
          <button className="btn btn-primary" style={{ fontSize: '0.75rem' }} onClick={handleAdd} disabled={saving}>
            {saving ? '...' : '+ Add'}
          </button>
        </div>
      </div>

      {/* ── List ── */}
      <div className="card" style={{ padding: '16px' }}>
        {agents.length === 0 ? (
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-light)', textAlign: 'center', padding: '2rem 0' }}>
            No agents yet. Add one above.
          </div>
        ) : (
          agents.map((agent) => (
            <div key={agent.id} className="agent-row" style={{ alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-light)' }}>
              {editingId === agent.id ? (
                <>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <input type="text" className="form-input" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <input type="number" className="form-input" value={editForm.default_commission_pct} onChange={(e) => setEditForm({ ...editForm, default_commission_pct: e.target.value })} min={0} max={100} step="0.5" />
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button className="btn btn-primary" style={{ fontSize: '0.6875rem', padding: '4px 8px' }} onClick={handleSaveEdit}>Save</button>
                    <button className="btn btn-ghost" style={{ fontSize: '0.6875rem', padding: '4px 8px' }} onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{agent.name}</span>
                  <span style={{ fontSize: '0.875rem' }}>{agent.default_commission_pct}%</span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button className="btn btn-ghost" style={{ fontSize: '0.6875rem', padding: '4px 8px' }} onClick={() => startEdit(agent)}>Edit</button>
                    <button className="btn btn-ghost" style={{ fontSize: '0.6875rem', padding: '4px 8px', color: 'var(--error)' }} onClick={() => handleDelete(agent.id)}>Delete</button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
