/* eslint-disable */
// @ts-nocheck
/**
 * HomeOwnersPage — CRM v1 for home owners.
 *
 * Core record + property portfolio link. The property count column is
 * derived from partner_properties.owner_id (set on the Property editor
 * Overview tab). Revenue/payout summary is deferred until Finance is
 * built — those need the invoices table to exist first.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import { useToast } from '../components/ToastProvider';
import EmptyState from '../components/EmptyState';
import { CT_RENTALS_PARTNER_ID } from './constants';

interface HomeOwner {
  id: string;
  partner_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  default_commission_pct: number | null;
  payment_notes: string | null;
  notes: string | null;
  created_at: string;
}

interface PropertyLite {
  id: string;
  property_name: string;
  owner_id: string | null;
}

const EMPTY_FORM = { name: '', email: '', phone: '', company: '', default_commission_pct: '', payment_notes: '', notes: '' };

export default function HomeOwnersPage() {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();
  const toast = useToast();

  const [owners, setOwners] = useState<HomeOwner[]>([]);
  const [properties, setProperties] = useState<PropertyLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editing, setEditing] = useState<HomeOwner | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setPageTitle('Home Owners'); }, [setPageTitle]);

  async function load() {
    setLoading(true);
    const [oRes, pRes] = await Promise.all([
      supabase.from('home_owners').select('*').eq('partner_id', CT_RENTALS_PARTNER_ID).order('name'),
      supabase.from('partner_properties').select('id, property_name, owner_id').eq('partner_id', CT_RENTALS_PARTNER_ID),
    ]);
    if (oRes.data) setOwners(oRes.data as HomeOwner[]);
    if (pRes.data) setProperties(pRes.data as PropertyLite[]);
    setLoading(false);
  }
  useEffect(() => { if (supabase) load(); }, [supabase]);

  // owner_id → [PropertyLite]
  const portfolioByOwner = useMemo(() => {
    const map: Record<string, PropertyLite[]> = {};
    for (const p of properties) {
      if (!p.owner_id) continue;
      (map[p.owner_id] ||= []).push(p);
    }
    return map;
  }, [properties]);

  const filtered = useMemo(() => {
    if (!searchQuery) return owners;
    const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    return owners.filter(o => {
      const text = [o.name, o.company, o.email, o.phone].filter(Boolean).join(' ').toLowerCase();
      return terms.every(t => text.includes(t));
    });
  }, [owners, searchQuery]);

  function openAdd() {
    setEditing({ id: '', partner_id: CT_RENTALS_PARTNER_ID } as HomeOwner);
    setForm(EMPTY_FORM);
  }
  function openEdit(o: HomeOwner) {
    setEditing(o);
    setForm({
      name: o.name || '',
      email: o.email || '',
      phone: o.phone || '',
      company: o.company || '',
      default_commission_pct: o.default_commission_pct != null ? String(o.default_commission_pct) : '',
      payment_notes: o.payment_notes || '',
      notes: o.notes || '',
    });
  }

  async function save() {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        partner_id: CT_RENTALS_PARTNER_ID,
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        company: form.company.trim() || null,
        default_commission_pct: form.default_commission_pct ? parseFloat(form.default_commission_pct) : null,
        payment_notes: form.payment_notes.trim() || null,
        notes: form.notes.trim() || null,
        updated_at: new Date().toISOString(),
      };
      if (editing.id) {
        const { error } = await supabase.from('home_owners').update(payload).eq('id', editing.id);
        if (error) throw error;
        toast.success('Owner updated');
      } else {
        const { error } = await supabase.from('home_owners').insert(payload);
        if (error) throw error;
        toast.success('Owner added');
      }
      setEditing(null);
      await load();
    } catch (err) {
      toast.error('Failed to save: ' + (err?.message || err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing?.id) return;
    const linked = portfolioByOwner[editing.id]?.length || 0;
    const msg = linked > 0
      ? `Delete ${editing.name}? ${linked} propert${linked === 1 ? 'y' : 'ies'} will be unlinked (the properties themselves stay).`
      : `Delete ${editing.name}?`;
    if (!confirm(msg)) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('home_owners').delete().eq('id', editing.id);
      if (error) throw error;
      toast.success('Owner deleted');
      setEditing(null);
      await load();
    } catch (err) {
      toast.error('Failed to delete: ' + (err?.message || err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            <div className="list-search">
              <span className="list-search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search owners..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && <button className="list-search-clear" onClick={() => setSearchQuery('')}>✕</button>}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>{filtered.length} of {owners.length}</span>
          </div>
          <div className="list-toolbar-right">
            <button className="btn btn-ghost" onClick={() => load()}>↻ Refresh</button>
            <button className="btn btn-primary" onClick={openAdd}>+ Add Owner</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-light)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="🏡"
          title={owners.length === 0 ? 'No home owners yet' : 'No owners match your search'}
          description={owners.length === 0 ? 'Add an owner so you can link them to the properties they own.' : 'Try a different search.'}
          action={owners.length === 0 ? <button className="btn btn-primary" onClick={openAdd}>+ Add owner</button> : null}
        />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th>Email</th>
                <th>Phone</th>
                <th style={{ textAlign: 'right' }}>Commission</th>
                <th style={{ textAlign: 'center' }}>Properties</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(o => {
                const portfolio = portfolioByOwner[o.id] || [];
                return (
                  <tr key={o.id} onClick={() => openEdit(o)} style={{ cursor: 'pointer' }}>
                    <td><strong>{o.name}</strong></td>
                    <td>{o.company || <span className="text-light">-</span>}</td>
                    <td>{o.email || <span className="text-light">-</span>}</td>
                    <td>{o.phone || <span className="text-light">-</span>}</td>
                    <td style={{ textAlign: 'right' }}>{o.default_commission_pct != null ? `${o.default_commission_pct}%` : <span className="text-light">-</span>}</td>
                    <td style={{ textAlign: 'center' }}>{portfolio.length || <span className="text-light">-</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h2 className="modal-title">{editing.id ? 'Edit owner' : 'Add owner'}</h2>
              <button className="modal-close" onClick={() => setEditing(null)}>&times;</button>
            </div>
            <div className="modal-body" style={{ padding: 'var(--s-4)' }}>
              <div className="form-group">
                <label className="form-label">Name *</label>
                <input className="form-input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Company</label>
                <input className="form-input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input className="form-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Default commission %</label>
                <input className="form-input" type="number" step="0.1" min="0" max="100" value={form.default_commission_pct} onChange={(e) => setForm({ ...form, default_commission_pct: e.target.value })} placeholder="e.g. 20" />
              </div>
              <div className="form-group">
                <label className="form-label">Payment notes</label>
                <textarea className="form-input" rows={2} value={form.payment_notes} onChange={(e) => setForm({ ...form, payment_notes: e.target.value })} placeholder="Bank details / payout instructions" />
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea className="form-input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>

              {editing.id && portfolioByOwner[editing.id]?.length > 0 && (
                <div style={{ marginTop: 'var(--s-2)' }}>
                  <div className="form-label">Linked properties</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.875rem' }}>
                    {portfolioByOwner[editing.id].map(p => <li key={p.id}>{p.property_name}</li>)}
                  </ul>
                </div>
              )}
            </div>
            <div className="modal-footer">
              {editing.id && (
                <button className="btn btn-danger" onClick={remove} disabled={saving}>Delete</button>
              )}
              <div style={{ flex: 1 }} />
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
