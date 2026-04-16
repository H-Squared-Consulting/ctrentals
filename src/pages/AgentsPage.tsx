/* eslint-disable */
// @ts-nocheck
/**
 * AgentsPage -- Manage booking agents (name, company, email, commission)
 */

import { useState, useEffect, useMemo } from 'react';
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
  const [editForm, setEditForm] = useState({ name: '', company: '', email: '', default_commission_pct: '' });

  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAgent, setNewAgent] = useState({ name: '', company: '', email: '', default_commission_pct: '15' });

  useEffect(() => { if (!embedded) setPageTitle('Agents'); }, [setPageTitle, embedded]);

  async function loadAgents() {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('agents').select('*').order('company').order('name');
      if (error) throw error;
      setAgents(data || []);
    } catch (err) {
      console.error('Error loading agents:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (supabase) loadAgents(); }, [supabase]);

  async function handleAdd() {
    if (!newAgent.name.trim()) { alert('Agent name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        name: newAgent.name.trim(),
        company: newAgent.company.trim() || null,
        email: newAgent.email.trim() || null,
        default_commission_pct: parseFloat(newAgent.default_commission_pct) || 0,
      };
      const { data, error } = await supabase.from('agents').insert(payload).select();
      if (error) throw error;
      setAgents((prev) => [...prev, data[0]].sort((a, b) => (a.company || '').localeCompare(b.company || '') || a.name.localeCompare(b.name)));
      setNewAgent({ name: '', company: '', email: '', default_commission_pct: '15' });
      setShowAddForm(false);
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
        company: editForm.company.trim() || null,
        email: editForm.email.trim() || null,
        default_commission_pct: parseFloat(editForm.default_commission_pct) || 0,
      };
      const { error } = await supabase.from('agents').update(payload).eq('id', editingId);
      if (error) throw error;
      setAgents((prev) =>
        prev.map((a) => (a.id === editingId ? { ...a, ...payload } : a))
          .sort((a, b) => (a.company || '').localeCompare(b.company || '') || a.name.localeCompare(b.name))
      );
      setEditingId(null);
    } catch (err) {
      alert('Failed to update: ' + err.message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this agent?')) return;
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
    setEditForm({
      name: agent.name,
      company: agent.company || '',
      email: agent.email || '',
      default_commission_pct: String(agent.default_commission_pct),
    });
  }

  // Group by company for display
  const grouped = useMemo(() => {
    const filtered = !searchQuery ? agents : agents.filter((a) => {
      const text = [a.name, a.company, a.email].filter(Boolean).join(' ').toLowerCase();
      return searchQuery.toLowerCase().split(/\s+/).every((t) => text.includes(t));
    });
    const groups: Record<string, Agent[]> = {};
    filtered.forEach((a) => {
      const key = a.company || 'Independent';
      if (!groups[key]) groups[key] = [];
      groups[key].push(a);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [agents, searchQuery]);

  if (loading) {
    return <div className="page-loader"><div className="spinner" /></div>;
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            <div className="list-search" style={{ maxWidth: '300px' }}>
              <span className="list-search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search agents or companies..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && <button className="list-search-clear" onClick={() => setSearchQuery('')}>✕</button>}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
              {agents.length} agents
            </span>
          </div>
          <div className="list-toolbar-right">
            <button className="btn btn-ghost" onClick={loadAgents}>↻ Refresh</button>
            <button className="btn btn-primary" onClick={() => setShowAddForm(!showAddForm)}>
              {showAddForm ? '× Cancel' : '+ Add Agent'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Add new agent (collapsible) ── */}
      {showAddForm && (
        <div className="card" style={{ marginBottom: '16px', padding: '16px' }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '10px' }}>Add Agent</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 100px auto', gap: '8px', alignItems: 'end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Name</label>
              <input type="text" className="form-input" value={newAgent.name} onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })} placeholder="Agent name" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Company</label>
              <input type="text" className="form-input" value={newAgent.company} onChange={(e) => setNewAgent({ ...newAgent, company: e.target.value })} placeholder="Company name" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Email</label>
              <input type="email" className="form-input" value={newAgent.email} onChange={(e) => setNewAgent({ ...newAgent, email: e.target.value })} placeholder="email@..." />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Comm %</label>
              <input type="number" className="form-input" value={newAgent.default_commission_pct} onChange={(e) => setNewAgent({ ...newAgent, default_commission_pct: e.target.value })} min={0} max={100} step="0.5" />
            </div>
            <button className="btn btn-primary" style={{ fontSize: '0.75rem' }} onClick={handleAdd} disabled={saving}>
              {saving ? '...' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* ── List grouped by company ── */}
      {grouped.length === 0 ? (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-light)' }}>
          No agents yet. Click "+ Add Agent" to create one.
        </div>
      ) : (
        grouped.map(([company, companyAgents]) => (
          <div key={company} className="card" style={{ marginBottom: '12px' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text)' }}>
                {company}
              </h3>
              <span style={{ fontSize: '0.6875rem', color: 'var(--text-light)' }}>{companyAgents.length} agent{companyAgents.length !== 1 ? 's' : ''}</span>
            </div>
            <div>
              {companyAgents.map((agent) => (
                <div
                  key={agent.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: editingId === agent.id ? '1fr 1fr 1fr 100px auto' : '180px 1fr 80px auto',
                    gap: '12px',
                    alignItems: 'center',
                    padding: '10px 16px',
                    borderBottom: '1px solid var(--border-light)',
                  }}
                >
                  {editingId === agent.id ? (
                    <>
                      <input className="form-input" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="Name" />
                      <input className="form-input" value={editForm.company} onChange={(e) => setEditForm({ ...editForm, company: e.target.value })} placeholder="Company" />
                      <input className="form-input" type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} placeholder="Email" />
                      <input className="form-input" type="number" value={editForm.default_commission_pct} onChange={(e) => setEditForm({ ...editForm, default_commission_pct: e.target.value })} min={0} max={100} step="0.5" />
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button className="btn btn-primary" style={{ fontSize: '0.6875rem', padding: '4px 8px' }} onClick={handleSaveEdit}>Save</button>
                        <button className="btn btn-ghost" style={{ fontSize: '0.6875rem', padding: '4px 8px' }} onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{agent.name}</span>
                      <a href={agent.email ? `mailto:${agent.email}` : undefined} style={{ fontSize: '0.8125rem', color: 'var(--color-primary)', textDecoration: 'none' }}>
                        {agent.email || <span style={{ color: 'var(--text-light)' }}>-</span>}
                      </a>
                      <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)' }}>{agent.default_commission_pct}%</span>
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost" style={{ fontSize: '0.6875rem', padding: '4px 8px' }} onClick={() => startEdit(agent)}>Edit</button>
                        <button className="btn btn-ghost" style={{ fontSize: '0.6875rem', padding: '4px 8px', color: 'var(--error)' }} onClick={() => handleDelete(agent.id)}>Delete</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
