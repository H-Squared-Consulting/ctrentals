/* eslint-disable */
// @ts-nocheck
/**
 * GuestsPage — CRM v1 for guests.
 *
 * Core fields only: name, email, phone, country, source, notes. Derived
 * stats (total stays / spend / last stay) and the right-rail of linked
 * enquiries/proposals/bookings are deferred until those modules have
 * matured — the doc lists them but they need joins across tables that
 * aren't yet load-bearing on the platform.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import { useToast } from '../components/ToastProvider';
import EmptyState from '../components/EmptyState';
import { CT_RENTALS_PARTNER_ID } from './constants';

interface Guest {
  id: string;
  partner_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
}

const EMPTY_FORM = { name: '', email: '', phone: '', country: '', source: '', notes: '' };

export default function GuestsPage() {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();
  const toast = useToast();

  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [editing, setEditing] = useState<Guest | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  // Stays = bookings linked to the open guest. Loaded lazily when the
  // edit modal opens, not in the list table — the list view doesn't
  // need it and the join would be expensive across the whole table.
  const [stays, setStays] = useState<any[]>([]);
  const [staysLoading, setStaysLoading] = useState(false);

  useEffect(() => { setPageTitle('Guests'); }, [setPageTitle]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('guests')
      .select('*')
      .eq('partner_id', CT_RENTALS_PARTNER_ID)
      .order('name');
    if (!error && data) setGuests(data as Guest[]);
    setLoading(false);
  }
  useEffect(() => { if (supabase) load(); }, [supabase]);

  const countries = useMemo(() => {
    const set = new Set<string>();
    for (const g of guests) if (g.country) set.add(g.country);
    return Array.from(set).sort();
  }, [guests]);
  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const g of guests) if (g.source) set.add(g.source);
    return Array.from(set).sort();
  }, [guests]);

  const filtered = useMemo(() => {
    return guests.filter(g => {
      if (countryFilter && g.country !== countryFilter) return false;
      if (sourceFilter && g.source !== sourceFilter) return false;
      if (!searchQuery) return true;
      const text = [g.name, g.email, g.phone, g.country, g.source].filter(Boolean).join(' ').toLowerCase();
      return searchQuery.toLowerCase().split(/\s+/).filter(Boolean).every(t => text.includes(t));
    });
  }, [guests, searchQuery, countryFilter, sourceFilter]);

  function openAdd() {
    setEditing({ id: '', partner_id: CT_RENTALS_PARTNER_ID } as Guest);
    setForm(EMPTY_FORM);
  }
  function openEdit(g: Guest) {
    setEditing(g);
    setForm({
      name: g.name || '',
      email: g.email || '',
      phone: g.phone || '',
      country: g.country || '',
      source: g.source || '',
      notes: g.notes || '',
    });
    loadStays(g.id);
  }

  async function loadStays(guestId: string) {
    setStaysLoading(true);
    setStays([]);
    const { data } = await supabase
      .from('bookings')
      .select('id, check_in, check_out, status, partner_properties(property_name, slug)')
      .eq('guest_id', guestId)
      .order('check_in', { ascending: false });
    setStays(data || []);
    setStaysLoading(false);
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
        country: form.country.trim() || null,
        source: form.source.trim() || null,
        notes: form.notes.trim() || null,
        updated_at: new Date().toISOString(),
      };
      if (editing.id) {
        const { error } = await supabase.from('guests').update(payload).eq('id', editing.id);
        if (error) throw error;
        toast.success('Guest updated');
      } else {
        const { error } = await supabase.from('guests').insert(payload);
        if (error) throw error;
        toast.success('Guest added');
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
    if (!confirm(`Delete ${editing.name}? This cannot be undone.`)) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('guests').delete().eq('id', editing.id);
      if (error) throw error;
      toast.success('Guest deleted');
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
                placeholder="Search guests..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && <button className="list-search-clear" onClick={() => setSearchQuery('')}>✕</button>}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>{filtered.length} of {guests.length}</span>
            <select className="list-filter-select" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} title="Filter by country">
              <option value="">Country: any</option>
              {countries.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="list-filter-select" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} title="Filter by source">
              <option value="">Source: any</option>
              {sources.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="list-toolbar-right">
            <button className="btn btn-ghost" onClick={() => load()}>↻ Refresh</button>
            <button className="btn btn-primary" onClick={openAdd}>+ Add Guest</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-light)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="👤"
          title={guests.length === 0 ? 'No guests yet' : 'No guests match your search'}
          description={guests.length === 0 ? 'Add your first guest to start tracking who you book with.' : 'Try a different search or clear the filters.'}
          action={guests.length === 0 ? <button className="btn btn-primary" onClick={openAdd}>+ Add guest</button> : null}
        />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Country</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(g => (
                <tr key={g.id} onClick={() => openEdit(g)} style={{ cursor: 'pointer' }}>
                  <td><strong>{g.name}</strong></td>
                  <td>{g.email || <span className="text-light">-</span>}</td>
                  <td>{g.phone || <span className="text-light">-</span>}</td>
                  <td>{g.country || <span className="text-light">-</span>}</td>
                  <td>{g.source || <span className="text-light">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h2 className="modal-title">{editing.id ? 'Edit guest' : 'Add guest'}</h2>
              <button className="modal-close" onClick={() => setEditing(null)}>&times;</button>
            </div>
            <div className="modal-body" style={{ padding: 'var(--s-4)' }}>
              <div className="form-group">
                <label className="form-label">Name *</label>
                <input className="form-input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Country</label>
                  <input className="form-input" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="e.g. South Africa" />
                </div>
                <div className="form-group">
                  <label className="form-label">Source</label>
                  <input className="form-input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Direct, Agent, Airbnb..." list="guest-source-options" />
                  <datalist id="guest-source-options">
                    <option value="Direct" />
                    <option value="Agent" />
                    <option value="Airbnb" />
                    <option value="Booking.com" />
                    <option value="Referral" />
                    <option value="Website" />
                  </datalist>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea className="form-input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>

              {editing.id && (
                <div style={{ marginTop: 'var(--s-3)', borderTop: '1px solid var(--border)', paddingTop: 'var(--s-3)' }}>
                  <div className="form-label" style={{ marginBottom: 6 }}>Stays</div>
                  {staysLoading ? (
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-light)' }}>Loading…</div>
                  ) : stays.length === 0 ? (
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-light)' }}>
                      No stays linked yet. Bookings created with this guest selected will show up here.
                    </div>
                  ) : (
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {stays.map((b: any) => (
                        <li key={b.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.8125rem', padding: '6px 10px', background: 'var(--bg)', borderRadius: 'var(--radius-sm)' }}>
                          <span style={{ fontWeight: 600 }}>{b.partner_properties?.property_name || '—'}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {new Date(b.check_in).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })} → {new Date(b.check_out).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                            <span style={{ marginLeft: 8, fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{b.status}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
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
