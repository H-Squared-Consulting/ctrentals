/**
 * EmailTemplatesPage — the editable wording for the management-phase
 * email/WhatsApp sequence.
 *
 * One row per template key (12 seeded, 1:1 with the action keys the
 * engine in `lib/managementEmails.ts` looks up). Nicki + Hayley own the
 * copy: subject + plain-text body with `{{variables}}` that render
 * against live booking data at draft time.
 *
 * Mirrors `ChannelDefaultsPage`:
 *   - embedded inside `SettingsPage` (no own page title when embedded)
 *   - toolbar: audience filter -> search -> count (no + New; fixed set)
 *   - rows via <DataTable>; status pill toggles is_active inline
 *   - edit in an <ActionModal>, save by upsert on (partner_id, key)
 */

/* eslint-disable */
// @ts-nocheck

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import { useToast } from '../components/ToastProvider';
import ActionModal from '../components/ActionModal';
import DataTable from '../components/DataTable';
import type { DataRow } from '../components/DataTable';
import { CT_RENTALS_PARTNER_ID } from './constants';
import { VARIABLE_CATALOG } from '../lib/managementEmails';

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

interface EmailTemplate {
  id: string;
  partner_id: string;
  key: string;
  audience: 'owner' | 'guest' | 'agent';
  channel_variant: string | null;
  label: string;
  subject: string;
  body: string;
  is_active: boolean;
  sort_order: number;
  updated_at?: string | null;
  updated_by?: string | null;
}

/** Audience -> a semantic pill variant. Owner/guest/agent aren't a
 *  status, but reusing the existing pill colours keeps the list legible
 *  without inventing new CSS. */
const AUDIENCE_PILL: Record<string, string> = {
  owner: 'interested', // green
  guest: 'new',        // blue
  agent: 'ready',      // amber
};

export default function EmailTemplatesPage({ embedded }: { embedded?: boolean } = {}) {
  const { supabase, user } = useAuth();
  const { setPageTitle } = useLayout();
  const toast = useToast();

  const [rows, setRows] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const [audienceFilter, setAudienceFilter] = useState<'all' | 'owner' | 'guest' | 'agent'>('all');
  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [draft, setDraft] = useState<{ subject: string; body: string }>({ subject: '', body: '' });
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (!embedded) setPageTitle('Email templates'); }, [setPageTitle, embedded]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('email_templates')
      .select('*')
      .eq('partner_id', CT_RENTALS_PARTNER_ID)
      .order('sort_order');
    if (data) setRows(data as EmailTemplate[]);
    setLoading(false);
  }
  useEffect(() => { if (supabase) load(); }, [supabase]);

  const filtered = useMemo(() => {
    let result = rows;
    if (audienceFilter !== 'all') result = result.filter(r => r.audience === audienceFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        (r.label || '').toLowerCase().includes(q) ||
        (r.key || '').toLowerCase().includes(q) ||
        (r.subject || '').toLowerCase().includes(q) ||
        (r.body || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [rows, audienceFilter, search]);

  // Variable chips filtered to the audience of the template being edited.
  const audienceVars = useMemo(() => {
    if (!editing) return [];
    return VARIABLE_CATALOG.filter((v: any) => v.audiences?.includes(editing.audience));
  }, [editing]);

  function openEdit(r: EmailTemplate, e?: React.MouseEvent) {
    e?.stopPropagation();
    setEditing(r);
    setDraft({ subject: r.subject || '', body: r.body || '' });
  }

  /** Splice `{{key}}` at the textarea caret (tracked live via the DOM
   *  element's selection range, which stays in sync with the controlled
   *  value), then restore focus + caret just past the inserted token. */
  function insertVariable(key: string) {
    const token = `{{${key}}}`;
    const el = bodyRef.current;
    if (!el) {
      setDraft(d => ({ ...d, body: d.body + token }));
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + token + el.value.slice(end);
    setDraft(d => ({ ...d, body: next }));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function save() {
    if (!editing) return;
    try {
      const payload = {
        partner_id: CT_RENTALS_PARTNER_ID,
        key: editing.key,
        audience: editing.audience,
        channel_variant: editing.channel_variant,
        label: editing.label,
        subject: draft.subject,
        body: draft.body,
        is_active: editing.is_active,
        sort_order: editing.sort_order,
        updated_at: new Date().toISOString(),
        updated_by: user?.email?.toLowerCase() ?? null,
      };
      const { error } = await supabase
        .from('email_templates')
        .upsert(payload, { onConflict: 'partner_id,key' });
      if (error) throw error;
      toast.success('Template saved');
      setEditing(null);
      await load();
    } catch (err: any) {
      toast.error('Failed to save: ' + (err?.message || err));
    }
  }

  async function toggleActive(r: EmailTemplate, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const { error } = await supabase
        .from('email_templates')
        .update({
          is_active: !r.is_active,
          updated_at: new Date().toISOString(),
          updated_by: user?.email?.toLowerCase() ?? null,
        })
        .eq('id', r.id);
      if (error) throw error;
      setRows(prev => prev.map(x => x.id === r.id ? { ...x, is_active: !r.is_active } : x));
    } catch (err: any) {
      toast.error('Failed to update: ' + (err?.message || err));
    }
  }

  return (
    <div>
      {/* Toolbar — baseline order: filter -> search -> count (no + New). */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            <select
              className="list-filter-select"
              value={audienceFilter}
              onChange={(e) => setAudienceFilter(e.target.value as any)}
              title="Filter by audience"
            >
              <option value="all">All audiences ({rows.length})</option>
              <option value="owner">Owner</option>
              <option value="guest">Guest</option>
              <option value="agent">Agent</option>
            </select>
            <div className="list-search">
              <span className="list-search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search by label, subject or body…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && <button className="list-search-clear" onClick={() => setSearch('')}>✕</button>}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
              {filtered.length} of {rows.length}
            </span>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-light)' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
            {rows.length === 0
              ? <>No templates found. They seed with the database migration.</>
              : <>No templates match your filter.</>}
          </div>
        ) : (
          <DataTable
            columns={[
              {
                key: 'label', label: 'Template', sortable: true,
                render: (row: DataRow) => {
                  const r = (row as any).row as EmailTemplate;
                  return (
                    <div>
                      <strong>{r.label}</strong>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-light)', fontFamily: 'monospace' }}>
                        {r.key}
                      </div>
                    </div>
                  );
                },
              },
              {
                key: 'audience', label: 'Audience', sortable: true, width: '130px',
                render: (row: DataRow) => {
                  const r = (row as any).row as EmailTemplate;
                  return (
                    <span className={`ops-status-pill ops-status-pill--${AUDIENCE_PILL[r.audience] || 'drafting'}`}>
                      <span className="ops-status-pill-dot" />
                      {titleCase(r.audience)}
                    </span>
                  );
                },
              },
              {
                key: 'channel_variant', label: 'Variant', sortable: true, width: '110px',
                render: (row: DataRow) => {
                  const r = (row as any).row as EmailTemplate;
                  return (
                    <span style={{ color: r.channel_variant ? 'var(--text)' : 'var(--text-light)' }}>
                      {r.channel_variant ? titleCase(r.channel_variant) : '—'}
                    </span>
                  );
                },
              },
              {
                key: 'is_active', label: 'Status', sortable: true, align: 'center' as const, width: '110px',
                render: (row: DataRow) => {
                  const r = (row as any).row as EmailTemplate;
                  return (
                    <button
                      className={`ops-status-pill ops-status-pill--${r.is_active ? 'active' : 'inactive'}`}
                      onClick={(e) => toggleActive(r, e)}
                      title={r.is_active ? 'Click to disable' : 'Click to enable'}
                      style={{ cursor: 'pointer', border: '1px solid var(--border)' }}
                    >
                      <span className="ops-status-pill-dot" />
                      {r.is_active ? 'Active' : 'Off'}
                    </button>
                  );
                },
              },
              {
                key: 'actions', label: '', align: 'right' as const, width: '110px',
                render: (row: DataRow) => {
                  const r = (row as any).row as EmailTemplate;
                  return (
                    <div className="list-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                        onClick={(e) => openEdit(r, e)}
                      >
                        ✏️ Edit
                      </button>
                    </div>
                  );
                },
              },
            ]}
            data={filtered.map(r => ({
              id: r.id,
              label: r.label,
              audience: r.audience,
              channel_variant: r.channel_variant || '',
              is_active: r.is_active ? 1 : 0,
              row: r,
            }))}
            loading={false}
            searchable={false}
            resultsBarContent={null}
            defaultSort={{ key: 'label', direction: 'asc' }}
            onRowClick={(row: any) => openEdit(row.row)}
          />
        )}
      </div>

      {editing && (
        <ActionModal
          title={editing.label}
          subtitle={<>{titleCase(editing.audience)}{editing.channel_variant ? ` · ${titleCase(editing.channel_variant)}` : ''} · plain-text email</>}
          width={720}
          primaryAction={
            <button className="btn btn-primary" onClick={save}>Save template</button>
          }
          onClose={() => setEditing(null)}
        >
          <div className="form-group">
            <label className="form-label">Subject</label>
            <input
              className="form-input"
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              placeholder="Subject line…"
            />
          </div>

          <div className="form-group" style={{ marginTop: 14 }}>
            <label className="form-label">Body</label>
            <textarea
              ref={bodyRef}
              className="form-input"
              rows={14}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              style={{ fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical' }}
            />
          </div>

          <div className="form-group" style={{ marginTop: 14 }}>
            <label className="form-label">Insert variable</label>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
              Click to drop a token at the cursor. It fills with live booking data when the email is drafted.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {audienceVars.map((v: any) => (
                <button
                  key={v.key}
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => insertVariable(v.key)}
                  title={v.label}
                  style={{ padding: '4px 8px', fontSize: '0.72rem', fontFamily: 'monospace' }}
                >
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
          </div>
        </ActionModal>
      )}
    </div>
  );
}
