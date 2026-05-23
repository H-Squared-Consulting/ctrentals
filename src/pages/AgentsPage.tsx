/**
 * AgentsPage -- Manage booking agents (name, company, email, commission).
 *
 * Follows the standard list-page baseline from docs/DESIGN-SYSTEM.md:
 *   - Toolbar: filters -> search -> count -> + New Agent
 *   - List rows with view/edit icons; row click opens DetailModal in view
 *   - Add + edit both flow through the same DetailModal
 *   - Active/inactive shown via shared .ops-status-pill semantic variants
 */

/* eslint-disable */
// @ts-nocheck

import { useState, useEffect, useMemo } from 'react';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import DataTable from '../components/DataTable';
import type { DataRow } from '../components/DataTable';
import DetailModal, { DetailModalSection } from '../components/DetailModal';
import type { Agent } from '../types/pricing';

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

const EMPTY_FORM = { name: '', company: '', email: '', default_commission_pct: '15' };

export default function AgentsPage({ embedded }: { embedded?: boolean } = {}) {
  const toast = useToast();
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Toolbar state
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [companyFilter, setCompanyFilter] = useState('');

  // Modal state
  const [editing, setEditing] = useState<Agent | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [form, setForm] = useState(EMPTY_FORM);
  const [initialForm, setInitialForm] = useState(EMPTY_FORM);

  useEffect(() => { if (!embedded) setPageTitle('Agents'); }, [setPageTitle, embedded]);

  async function loadAgents() {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('agents').select('*').order('company').order('name');
      if (error) throw error;
      setAgents(data || []);
    } catch (err: any) {
      console.error('Error loading agents:', err);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { if (supabase) loadAgents(); }, [supabase]);

  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const a of agents) if (a.company) set.add(a.company);
    return Array.from(set).sort();
  }, [agents]);

  const inactiveCount = useMemo(() => agents.filter(a => a.is_active === false).length, [agents]);

  const filtered = useMemo(() => {
    let result = agents;
    // Treat missing is_active as true so legacy rows show as active.
    if (activeFilter === 'active')   result = result.filter(a => a.is_active !== false);
    if (activeFilter === 'inactive') result = result.filter(a => a.is_active === false);
    if (companyFilter)               result = result.filter(a => a.company === companyFilter);
    if (searchQuery.trim()) {
      const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter(a => {
        const text = [a.name, a.company, a.email].filter(Boolean).join(' ').toLowerCase();
        return terms.every(t => text.includes(t));
      });
    }
    return result;
  }, [agents, searchQuery, activeFilter, companyFilter]);

  function openAdd() {
    setEditing({ id: '' } as Agent);
    setForm(EMPTY_FORM);
    setInitialForm(EMPTY_FORM);
    setMode('edit');
  }
  function openView(a: Agent) {
    const next = {
      name: a.name || '',
      company: a.company || '',
      email: a.email || '',
      default_commission_pct: String(a.default_commission_pct ?? ''),
    };
    setEditing(a);
    setForm(next);
    setInitialForm(next);
    setMode('view');
  }
  function openEditRow(a: Agent) {
    openView(a);
    setMode('edit');
  }

  async function save() {
    if (!form.name.trim()) { toast.error('Agent name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        company: form.company.trim() || null,
        email: form.email.trim() || null,
        default_commission_pct: parseFloat(form.default_commission_pct) || 0,
      };
      if (editing?.id) {
        const { error } = await supabase.from('agents').update(payload).eq('id', editing.id);
        if (error) throw error;
        toast.success('Agent updated');
        setInitialForm(form);
        setMode('view');
      } else {
        const { error } = await supabase.from('agents').insert(payload);
        if (error) throw error;
        toast.success('Agent added');
        setEditing(null);
      }
      await loadAgents();
    } catch (err: any) {
      toast.error('Failed to save: ' + (err?.message || err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    if (!editing?.id) return;
    const next = editing.is_active === false;
    try {
      const { error } = await supabase.from('agents').update({ is_active: next }).eq('id', editing.id);
      if (error) throw error;
      setEditing({ ...editing, is_active: next } as Agent);
      await loadAgents();
    } catch (err: any) {
      toast.error('Failed to update: ' + (err?.message || err));
    }
  }

  async function remove() {
    if (!editing?.id) return;
    if (!confirm(`Delete ${editing.name}? This cannot be undone.`)) return;
    try {
      const { error } = await supabase.from('agents').delete().eq('id', editing.id);
      if (error) throw error;
      toast.success('Agent deleted');
      setEditing(null);
      await loadAgents();
    } catch (err: any) {
      toast.error('Failed to delete: ' + (err?.message || err));
    }
  }

  if (loading) {
    return <div className="page-loader"><div className="spinner" /></div>;
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
              <option value="all">All ({agents.length})</option>
            </select>
            <select
              className="list-filter-select"
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              title="Filter by company"
            >
              <option value="">All companies</option>
              {companies.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="list-search">
              <span className="list-search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search by name, company, email…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && <button className="list-search-clear" onClick={() => setSearchQuery('')}>✕</button>}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
              {filtered.length} of {agents.length}
            </span>
          </div>
          <div className="list-toolbar-right">
            <button className="btn btn-primary" onClick={openAdd}>+ New Agent</button>
          </div>
        </div>
      </div>

      <AgentsTable
        agents={filtered}
        onView={openView}
        onEdit={openEditRow}
        emptyMessage={
          agents.length === 0
            ? 'No agents yet. Click + New Agent to add one.'
            : 'No agents match your filters.'
        }
      />

      {editing && (
        <DetailModal
          title={editing.id ? (titleCase(form.name) || 'Agent') : 'Add agent'}
          subtitle={editing.id ? (
            <>
              {form.company && <span>{titleCase(form.company)}</span>}
              {form.default_commission_pct && <span>· {form.default_commission_pct}% commission</span>}
            </>
          ) : 'New booking agent'}
          accentColour="var(--color-primary-light)"
          mode={mode}
          onModeChange={setMode}
          canEdit
          isDirty={JSON.stringify(form) !== JSON.stringify(initialForm)}
          onSave={save}
          onCancel={() => { setForm(initialForm); setMode('view'); }}
          footerActions={editing.id ? (
            <>
              <button
                className={editing.is_active === false ? 'btn btn-outline-success' : 'btn btn-ghost'}
                onClick={toggleActive}
                disabled={saving}
              >
                {editing.is_active === false ? '↺ Reactivate' : '⏸ Deactivate'}
              </button>
              <button className="btn btn-outline-danger" onClick={remove} disabled={saving}>
                Delete
              </button>
            </>
          ) : null}
          onClose={() => setEditing(null)}
        >
          <DetailModalSection heading="Agent details">
            <fieldset disabled={mode === 'view'} style={{ border: 0, padding: 0, margin: 0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
                <div className="form-group">
                  <label className="form-label">Name *</label>
                  <input
                    className="form-input"
                    autoFocus={mode === 'edit'}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Company</label>
                  <input
                    className="form-input"
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input
                    type="email"
                    className="form-input"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Default commission %</label>
                  <input
                    type="number"
                    className="form-input"
                    value={form.default_commission_pct}
                    onChange={(e) => setForm({ ...form, default_commission_pct: e.target.value })}
                    min={0}
                    max={100}
                    step="0.5"
                  />
                </div>
              </div>
            </fieldset>
          </DetailModalSection>
        </DetailModal>
      )}
    </div>
  );
}

// ─── Sortable agents table ────────────────────────────────────────────

interface AgentRow extends DataRow {
  id: string;
  name: string;
  company: string;
  email: string;
  commission: number;
  status: string;
  is_active: boolean;
  agent: Agent;
}

function AgentsTable({
  agents, onView, onEdit, emptyMessage,
}: {
  agents: Agent[];
  onView: (a: Agent) => void;
  onEdit: (a: Agent) => void;
  emptyMessage: string;
}) {
  const rows: AgentRow[] = agents.map(a => {
    const isActive = a.is_active !== false;
    return {
      id: a.id,
      name: titleCase(a.name),
      company: titleCase(a.company || ''),
      email: a.email ? a.email.toLowerCase() : '',
      commission: Number(a.default_commission_pct) || 0,
      status: isActive ? 'Active' : 'Inactive',
      is_active: isActive,
      agent: a,
    };
  });

  const columns = [
    {
      key: 'name', label: 'Agent', sortable: true,
      render: (row: DataRow) => <strong>{(row as AgentRow).name || <span className="text-light">-</span>}</strong>,
    },
    {
      key: 'company', label: 'Company', sortable: true,
      render: (row: DataRow) => (row as AgentRow).company || <span className="text-light">-</span>,
    },
    {
      key: 'email', label: 'Email', sortable: true,
      render: (row: DataRow) => (row as AgentRow).email || <span className="text-light">-</span>,
    },
    {
      key: 'commission', label: 'Commission', sortable: true, align: 'right' as const,
      render: (row: DataRow) => <span style={{ fontWeight: 600 }}>{(row as AgentRow).commission}%</span>,
    },
    {
      key: 'status', label: 'Status', sortable: true, align: 'center' as const,
      render: (row: DataRow) => {
        const r = row as AgentRow;
        return (
          <span className={`ops-status-pill ops-status-pill--${r.is_active ? 'active' : 'inactive'}`}>
            <span className="ops-status-pill-dot" />
            {r.status}
          </span>
        );
      },
    },
    {
      key: 'actions', label: '', align: 'right' as const, width: '90px',
      render: (row: DataRow) => (
        <div className="list-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="list-action-icon"
            title="View agent"
            onClick={() => onView((row as AgentRow).agent)}
          >
            👁
          </button>
          <button
            type="button"
            className="list-action-icon"
            title="Edit agent"
            onClick={() => onEdit((row as AgentRow).agent)}
          >
            ✏️
          </button>
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      loading={false}
      searchable={false}
      resultsBarContent={null}
      defaultSort={{ key: 'company', direction: 'asc' }}
      onRowClick={(row: DataRow) => onView((row as AgentRow).agent)}
      emptyMessage={emptyMessage}
    />
  );
}
