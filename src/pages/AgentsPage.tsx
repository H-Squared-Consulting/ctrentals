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
import AgentPropertyPicker from '../components/AgentPropertyPicker';
import AgentPortalShareMenu from '../components/AgentPortalShareMenu';
import {
  enablePortal,
  getPropertyCountsByAgent,
  getPropertyIdsForAgent,
} from '../lib/agentPortalAdmin';
import { nextAgentRefCode } from '../lib/agentRefCode';

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
  // Per-agent portal state computed once after each load. propertyCount
  // comes from agent_properties; hasToken / activeToken come from the
  // agents row itself.
  const [portalState, setPortalState] = useState<Record<string, { hasToken: boolean; activeToken: string | null; propertyCount: number }>>({});
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

  // Two companion modals: pick which properties the agent(s) can sell,
  // and share the portal URL with a single agent.
  const [pickerConfig, setPickerConfig] = useState<{
    agentIds: string[];
    title: string;
    subtitle?: string;
    initialPropertyIds: string[];
  } | null>(null);
  const [shareAgent, setShareAgent] = useState<{ agent: Agent; token: string } | null>(null);

  // View mode: 'grouped' stacks one card per company with a bulk
  // assign button; 'list' shows the existing flat table.
  const [viewMode, setViewMode] = useState<'grouped' | 'list'>('grouped');

  async function openPickerForAgent(a: Agent) {
    const initial = await getPropertyIdsForAgent(supabase, a.id).catch(() => []);
    setPickerConfig({
      agentIds: [a.id],
      title: `Properties for ${titleCase(a.name)}`,
      subtitle: 'Pick which houses this agent can see in their portal',
      initialPropertyIds: initial,
    });
  }

  function openBulkPicker(company: string, agentsInGroup: Agent[]) {
    setPickerConfig({
      agentIds: agentsInGroup.map(a => a.id),
      title: `Properties for ${titleCase(company)}`,
      subtitle: `Assigning to ${agentsInGroup.length} ${agentsInGroup.length === 1 ? 'agent' : 'agents'} in this company`,
      initialPropertyIds: [],
    });
  }

  async function openShareFor(a: Agent) {
    // Enabling the portal if it's currently off mints a token and
    // immediately opens the share menu so the next click is "send".
    const existing = portalState[a.id]?.activeToken;
    let token = existing || '';
    if (!token) {
      try {
        token = await enablePortal(supabase, a.id);
      } catch (err: any) {
        toast.error('Failed to enable portal: ' + (err?.message || err));
        return;
      }
    }
    setShareAgent({ agent: a, token });
  }

  useEffect(() => { if (!embedded) setPageTitle('Agents'); }, [setPageTitle, embedded]);

  async function loadAgents() {
    setLoading(true);
    try {
      // SELECT * so the page keeps rendering even if the agent-portal
      // migration hasn't been applied yet (the url_token columns don't
      // exist pre-migration). Post-migration the extra columns are
      // simply included in the response.
      const { data, error } = await supabase
        .from('agents')
        .select('*')
        .order('company').order('name');
      if (error) throw error;
      const all = (data || []) as Agent[];
      setAgents(all);
      const counts = await getPropertyCountsByAgent(supabase, all.map((a: any) => a.id)).catch(() => ({}));
      const next: Record<string, { hasToken: boolean; activeToken: string | null; propertyCount: number }> = {};
      for (const a of all as any[]) {
        const hasToken = !!a.url_token && !a.url_token_revoked_at;
        next[a.id] = {
          hasToken,
          activeToken: hasToken ? a.url_token : null,
          propertyCount: counts[a.id] || 0,
        };
      }
      setPortalState(next);
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
      const payload: any = {
        name: form.name.trim(),
        company: form.company.trim() || null,
        email: form.email.trim() || null,
        default_commission_pct: parseFloat(form.default_commission_pct) || 0,
      };
      if (editing?.id) {
        // UPDATE: ref_code intentionally not touched — once an agent
        // has a code, downstream references (enquiries / proposals)
        // depend on it staying stable even if the name changes.
        const { error } = await supabase.from('agents').update(payload).eq('id', editing.id);
        if (error) throw error;
        toast.success('Agent updated');
        setInitialForm(form);
        setMode('view');
      } else {
        // INSERT: compute the next free Axx from the codes already
        // taken globally. Backfill migration handled existing rows;
        // this keeps new inserts unique going forward. agents is not
        // partner-scoped in this schema.
        const takenCodes = new Set<string>(
          agents
            .map((a: any) => a.ref_code)
            .filter((c: any): c is string => !!c),
        );
        payload.ref_code = nextAgentRefCode(payload.name, takenCodes);
        const { error } = await supabase.from('agents').insert(payload);
        if (error) throw error;
        toast.success(`Agent added · ${payload.ref_code}`);
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
      {/* Toolbar — view-mode row on top, filters / search / count below.
          Pattern follows PropertiesPage and the platform-wide convention
          (see feedback_toolbar_view_modes_separate). */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="list-toolbar" style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: 12, marginBottom: 12 }}>
          <div className="list-toolbar-left">
            <div className="view-toggle">
              <button
                type="button"
                className={`view-toggle-btn ${viewMode === 'grouped' ? 'active' : ''}`}
                onClick={() => setViewMode('grouped')}
              >
                By company
              </button>
              <button
                type="button"
                className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                onClick={() => setViewMode('list')}
              >
                All agents
              </button>
            </div>
          </div>
          <div className="list-toolbar-right">
            <button className="btn btn-primary" onClick={openAdd}>+ New Agent</button>
          </div>
        </div>

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
        </div>
      </div>

      {viewMode === 'list' ? (
        <AgentsTable
          agents={filtered}
          portalState={portalState}
          onView={openView}
          onEdit={openEditRow}
          onOpenPicker={openPickerForAgent}
          onOpenShare={openShareFor}
          emptyMessage={
            agents.length === 0
              ? 'No agents yet. Click + New Agent to add one.'
              : 'No agents match your filters.'
          }
        />
      ) : (
        <AgentsGrouped
          agents={filtered}
          portalState={portalState}
          onView={openView}
          onEdit={openEditRow}
          onOpenPicker={openPickerForAgent}
          onOpenShare={openShareFor}
          onBulkAssign={openBulkPicker}
          emptyMessage={
            agents.length === 0
              ? 'No agents yet. Click + New Agent to add one.'
              : 'No agents match your filters.'
          }
        />
      )}

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
            <fieldset disabled={mode === 'view'} className="form-fieldset-reset">
              <div className="form-grid-2">
                {/* Code is locked — generated at creation from the
                    agent's initials and never re-derived on edit so
                    enquiry / proposal refs that mention it stay
                    valid. Shows a placeholder for unsaved new
                    agents (the code is assigned at insert time). */}
                <div className="form-group">
                  <label className="form-label">Code</label>
                  <input
                    className="form-input"
                    value={editing?.id ? ((editing as any).ref_code || '—') : 'auto · generated on save'}
                    readOnly
                    disabled
                    style={{
                      fontFamily: 'ui-monospace, monospace',
                      fontWeight: 600,
                      color: editing?.id ? 'var(--color-primary)' : 'var(--text-light)',
                      background: 'var(--surface-muted, #F3F4F6)',
                      cursor: 'not-allowed',
                    }}
                    title="A{xx} where xx = agent initials. Locked once assigned."
                  />
                </div>
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

      {pickerConfig && (
        <AgentPropertyPicker
          agentIds={pickerConfig.agentIds}
          title={pickerConfig.title}
          subtitle={pickerConfig.subtitle}
          initialPropertyIds={pickerConfig.initialPropertyIds}
          onSaved={loadAgents}
          onClose={() => setPickerConfig(null)}
        />
      )}

      {shareAgent && (
        <AgentPortalShareMenu
          agent={shareAgent.agent}
          initialToken={shareAgent.token}
          onClose={() => { setShareAgent(null); loadAgents(); }}
        />
      )}
    </div>
  );
}

// ─── Grouped view (one card per company) ──────────────────────────────

type PortalStateMap = Record<string, { hasToken: boolean; activeToken: string | null; propertyCount: number }>;

function AgentsGrouped({
  agents, portalState, onView, onEdit, onOpenPicker, onOpenShare, onBulkAssign, emptyMessage,
}: {
  agents: Agent[];
  portalState: PortalStateMap;
  onView: (a: Agent) => void;
  onEdit: (a: Agent) => void;
  onOpenPicker: (a: Agent) => void;
  onOpenShare: (a: Agent) => void;
  onBulkAssign: (company: string, agentsInGroup: Agent[]) => void;
  emptyMessage: string;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, Agent[]>();
    for (const a of agents) {
      const company = (a.company || '').trim() || 'Independent';
      if (!map.has(company)) map.set(company, []);
      map.get(company)!.push(a);
    }
    // Stable sort by company name; agents inside each group by name.
    const entries = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
    for (const [, list] of entries) list.sort((x, y) => (x.name || '').localeCompare(y.name || ''));
    return entries;
  }, [agents]);

  if (agents.length === 0) {
    return (
      <div className="card" style={{ padding: 'var(--s-5)', textAlign: 'center', color: 'var(--text-secondary)' }}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {groups.map(([company, list]) => (
        <GroupCard
          key={company}
          company={company}
          agents={list}
          portalState={portalState}
          onView={onView}
          onEdit={onEdit}
          onOpenPicker={onOpenPicker}
          onOpenShare={onOpenShare}
          onBulkAssign={() => onBulkAssign(company, list)}
        />
      ))}
    </div>
  );
}

function GroupCard({
  company, agents, portalState, onView, onEdit, onOpenPicker, onOpenShare, onBulkAssign,
}: {
  company: string;
  agents: Agent[];
  portalState: PortalStateMap;
  onView: (a: Agent) => void;
  onEdit: (a: Agent) => void;
  onOpenPicker: (a: Agent) => void;
  onOpenShare: (a: Agent) => void;
  onBulkAssign: () => void;
}) {
  return (
    <div className="card">
      <div className="list-toolbar" style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: 12, marginBottom: 0 }}>
        <div className="list-toolbar-left">
          <strong style={{ fontSize: '0.9375rem', color: 'var(--text)' }}>{titleCase(company)}</strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
            {agents.length} {agents.length === 1 ? 'agent' : 'agents'}
          </span>
        </div>
        <div className="list-toolbar-right">
          <button
            type="button"
            className="btn btn-outline"
            onClick={onBulkAssign}
            title="Assign the same property list to every agent in this company"
          >
            Assign properties to all
          </button>
        </div>
      </div>

      <div>
        {agents.map(a => (
          <AgentGroupRow
            key={a.id}
            agent={a}
            portalState={portalState}
            onView={onView}
            onEdit={onEdit}
            onOpenPicker={onOpenPicker}
            onOpenShare={onOpenShare}
          />
        ))}
      </div>
    </div>
  );
}

function AgentGroupRow({
  agent, portalState, onView, onEdit, onOpenPicker, onOpenShare,
}: {
  agent: Agent;
  portalState: PortalStateMap;
  onView: (a: Agent) => void;
  onEdit: (a: Agent) => void;
  onOpenPicker: (a: Agent) => void;
  onOpenShare: (a: Agent) => void;
}) {
  const isActive = agent.is_active !== false;
  const st = portalState[agent.id] || { hasToken: false, activeToken: null, propertyCount: 0 };
  const propertyCount = st.propertyCount;
  const portalEnabled = st.hasToken;

  return (
    <div
      onClick={() => onView(agent)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-4)',
        padding: '10px 16px',
        borderTop: '1px solid var(--border-light)',
        cursor: 'pointer',
      }}
    >
      {/* Locked code pill — leads the row so the team can identify
          the agent by the same shorthand used in enquiry / proposal
          refs. Monospace + primary colour matches every other ref
          code on the platform. */}
      <span
        title={(agent as any).ref_code ? `Agent code · ${(agent as any).ref_code}` : 'No code assigned'}
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontWeight: 600,
          color: (agent as any).ref_code ? 'var(--color-primary)' : 'var(--text-light)',
          fontSize: '0.8125rem',
          minWidth: 56,
        }}
      >
        {(agent as any).ref_code || '—'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{titleCase(agent.name)}</div>
        {agent.email && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{agent.email.toLowerCase()}</div>
        )}
      </div>

      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
        {Number(agent.default_commission_pct) || 0}%
      </span>

      <span className={`ops-status-pill ops-status-pill--${isActive ? 'active' : 'inactive'}`}>
        <span className="ops-status-pill-dot" />
        {isActive ? 'Active' : 'Inactive'}
      </span>

      <button
        type="button"
        className="btn btn-ghost"
        style={{ fontSize: '0.8125rem', padding: '4px 10px' }}
        onClick={(e) => { e.stopPropagation(); onOpenPicker(agent); }}
        title="Pick which properties this agent can sell"
      >
        {propertyCount} props
      </button>

      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className={`ops-status-pill ops-status-pill--${portalEnabled ? 'active' : 'inactive'}`}>
          <span className="ops-status-pill-dot" />
          {portalEnabled ? 'Active' : 'Off'}
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: '0.75rem', padding: '4px 8px' }}
          onClick={() => onOpenShare(agent)}
          title={portalEnabled ? 'Share portal link' : 'Enable portal and share link'}
        >
          {portalEnabled ? 'Share' : 'Enable'}
        </button>
      </div>

      <div className="list-actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="list-action-icon"
          title="View agent"
          onClick={() => onView(agent)}
        >
          👁
        </button>
        <button
          type="button"
          className="list-action-icon"
          title="Edit agent"
          onClick={() => onEdit(agent)}
        >
          ✏️
        </button>
      </div>
    </div>
  );
}

// ─── Sortable agents table ────────────────────────────────────────────

interface AgentRow extends DataRow {
  id: string;
  ref_code: string;
  name: string;
  company: string;
  email: string;
  commission: number;
  status: string;
  is_active: boolean;
  property_count: number;
  portal_enabled: boolean;
  agent: Agent;
}

function AgentsTable({
  agents, portalState, onView, onEdit, onOpenPicker, onOpenShare, emptyMessage,
}: {
  agents: Agent[];
  portalState: PortalStateMap;
  onView: (a: Agent) => void;
  onEdit: (a: Agent) => void;
  onOpenPicker: (a: Agent) => void;
  onOpenShare: (a: Agent) => void;
  emptyMessage: string;
}) {
  const rows: AgentRow[] = agents.map(a => {
    const isActive = a.is_active !== false;
    const st = portalState[a.id] || { hasToken: false, activeToken: null, propertyCount: 0 };
    return {
      id: a.id,
      ref_code: (a as any).ref_code || '',
      name: titleCase(a.name),
      company: titleCase(a.company || ''),
      email: a.email ? a.email.toLowerCase() : '',
      commission: Number(a.default_commission_pct) || 0,
      status: isActive ? 'Active' : 'Inactive',
      is_active: isActive,
      property_count: st.propertyCount,
      portal_enabled: st.hasToken,
      agent: a,
    };
  });

  const columns = [
    {
      key: 'ref_code', label: 'Code', sortable: true, width: '90px',
      render: (row: DataRow) => {
        const code = (row as AgentRow).ref_code;
        return code
          ? <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: 'var(--color-primary)' }}>{code}</span>
          : <span className="text-light">—</span>;
      },
    },
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
      key: 'property_count', label: 'Properties', sortable: true, align: 'center' as const, width: '120px',
      render: (row: DataRow) => {
        const r = row as AgentRow;
        return (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: '0.8125rem', padding: '4px 10px' }}
            onClick={(e) => { e.stopPropagation(); onOpenPicker(r.agent); }}
            title="Pick which properties this agent can sell"
          >
            {r.property_count}
          </button>
        );
      },
    },
    {
      key: 'portal_enabled', label: 'Portal', sortable: true, align: 'center' as const, width: '170px',
      render: (row: DataRow) => {
        const r = row as AgentRow;
        return (
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className={`ops-status-pill ops-status-pill--${r.portal_enabled ? 'active' : 'inactive'}`}>
              <span className="ops-status-pill-dot" />
              {r.portal_enabled ? 'Active' : 'Off'}
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: '0.75rem', padding: '4px 8px' }}
              onClick={() => onOpenShare(r.agent)}
              title={r.portal_enabled ? 'Share portal link' : 'Enable portal and share link'}
            >
              {r.portal_enabled ? 'Share' : 'Enable'}
            </button>
          </div>
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
