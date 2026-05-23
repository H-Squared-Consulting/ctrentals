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
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import { useToast } from '../components/ToastProvider';
import DataTable from '../components/DataTable';
import type { DataRow } from '../components/DataTable';
import DetailModal, { DetailModalSection } from '../components/DetailModal';
import EmptyState from '../components/EmptyState';
import { CT_RENTALS_PARTNER_ID } from './constants';

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/(?:^|[\s\-'])\S/g, c => c.toUpperCase());
}

interface HomeOwner {
  id: string;
  partner_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  vat_number: string | null;
  payment_notes: string | null;
  notes: string | null;
  created_at: string;
}

interface PropertyLite {
  id: string;
  property_name: string;
  /** Legacy single-owner FK. Kept in sync (= the current primary
   *  owner's id, or null) for back-compat with code that hasn't
   *  migrated to property_owners yet. */
  owner_id: string | null;
}

interface PropertyOwnerLink {
  id: string;
  property_id: string;
  owner_id: string;
  is_primary: boolean;
}

const EMPTY_FORM = { name: '', email: '', phone: '', company: '', vat_number: '', payment_notes: '', notes: '' };

export default function HomeOwnersPage() {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();
  const toast = useToast();

  const [owners, setOwners] = useState<HomeOwner[]>([]);
  const [properties, setProperties] = useState<PropertyLite[]>([]);
  /** All property→owner links across the partner. Drives the
   *  portfolio map and the picker's "also owned by" hint. Falls
   *  back to deriving from partner_properties.owner_id if the
   *  join table query fails (e.g. migration not yet applied). */
  const [propertyOwners, setPropertyOwners] = useState<PropertyOwnerLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [portfolioFilter, setPortfolioFilter] = useState<'' | 'with' | 'without'>('');
  const [editing, setEditing] = useState<HomeOwner | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [form, setForm] = useState(EMPTY_FORM);
  const [initialForm, setInitialForm] = useState(EMPTY_FORM);
  const [initialSelectedIds, setInitialSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  // Property assignment state for the edit/add modal. Diffed against the
  // current portfolio on save so we only touch the rows that actually change.
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<Set<string>>(new Set());
  const [propertyPickerSearch, setPropertyPickerSearch] = useState('');
  const [propertyPickerOpen, setPropertyPickerOpen] = useState(false);

  useEffect(() => { setPageTitle('Home Owners'); }, [setPageTitle]);

  async function load() {
    setLoading(true);
    const [oRes, pRes] = await Promise.all([
      supabase.from('home_owners').select('*').eq('partner_id', CT_RENTALS_PARTNER_ID).order('name'),
      supabase.from('partner_properties').select('id, property_name, owner_id').eq('partner_id', CT_RENTALS_PARTNER_ID),
    ]);
    if (oRes.data) setOwners(oRes.data as HomeOwner[]);
    if (pRes.data) setProperties(pRes.data as PropertyLite[]);
    // Load all property→owner links scoped to this partner's
    // properties. The !inner join keeps other partners' links from
    // leaking. Falls back to deriving from owner_id below if the
    // join table isn't reachable.
    const linksRes = await supabase
      .from('property_owners')
      .select('id, property_id, owner_id, is_primary, partner_properties!inner(partner_id)')
      .eq('partner_properties.partner_id', CT_RENTALS_PARTNER_ID);
    if (linksRes.error) {
      // Fallback: synthesise links from partner_properties.owner_id.
      const synth: PropertyOwnerLink[] = (pRes.data || [])
        .filter((p: any) => p.owner_id)
        .map((p: any) => ({ id: `legacy-${p.id}`, property_id: p.id, owner_id: p.owner_id, is_primary: true }));
      setPropertyOwners(synth);
    } else {
      setPropertyOwners((linksRes.data || []) as PropertyOwnerLink[]);
    }
    setLoading(false);
  }
  useEffect(() => { if (supabase) load(); }, [supabase]);

  // owner_id → [PropertyLite]. Derived from property_owners so a
  // property with multiple linked owners appears in each owner's
  // portfolio.
  const portfolioByOwner = useMemo(() => {
    const map: Record<string, PropertyLite[]> = {};
    const byId: Record<string, PropertyLite> = {};
    for (const p of properties) byId[p.id] = p;
    for (const link of propertyOwners) {
      const p = byId[link.property_id];
      if (!p) continue;
      (map[link.owner_id] ||= []).push(p);
    }
    return map;
  }, [properties, propertyOwners]);

  // property_id → [HomeOwner] for the picker's "also owned by" hint.
  // Sorted with the primary first so the rendered list reads naturally.
  const ownersByProperty = useMemo(() => {
    const map: Record<string, HomeOwner[]> = {};
    const ownerById: Record<string, HomeOwner> = {};
    for (const o of owners) ownerById[o.id] = o;
    // Group then sort each group primary-first.
    const grouped: Record<string, PropertyOwnerLink[]> = {};
    for (const link of propertyOwners) (grouped[link.property_id] ||= []).push(link);
    for (const [propId, links] of Object.entries(grouped)) {
      links.sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
      map[propId] = links.map(l => ownerById[l.owner_id]).filter(Boolean);
    }
    return map;
  }, [owners, propertyOwners]);

  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const o of owners) if (o.company) set.add(o.company);
    return Array.from(set).sort();
  }, [owners]);

  const filtered = useMemo(() => {
    return owners.filter(o => {
      if (companyFilter && o.company !== companyFilter) return false;
      if (portfolioFilter) {
        const has = (portfolioByOwner[o.id] || []).length > 0;
        if (portfolioFilter === 'with' && !has) return false;
        if (portfolioFilter === 'without' && has) return false;
      }
      if (!searchQuery) return true;
      const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      const text = [o.name, o.company, o.email, o.phone].filter(Boolean).join(' ').toLowerCase();
      return terms.every(t => text.includes(t));
    });
  }, [owners, searchQuery, companyFilter, portfolioFilter, portfolioByOwner]);

  function openAdd() {
    setEditing({ id: '', partner_id: CT_RENTALS_PARTNER_ID } as HomeOwner);
    setForm(EMPTY_FORM);
    setInitialForm(EMPTY_FORM);
    setSelectedPropertyIds(new Set());
    setInitialSelectedIds(new Set());
    setPropertyPickerSearch('');
    setMode('edit');
  }
  function openView(o: HomeOwner) {
    const next = {
      name: o.name || '',
      email: o.email || '',
      phone: o.phone || '',
      company: o.company || '',
      vat_number: o.vat_number || '',
      payment_notes: o.payment_notes || '',
      notes: o.notes || '',
    };
    const ownedIds = new Set((portfolioByOwner[o.id] || []).map(p => p.id));
    setEditing(o);
    setForm(next);
    setInitialForm(next);
    setSelectedPropertyIds(ownedIds);
    setInitialSelectedIds(ownedIds);
    setPropertyPickerSearch('');
    setMode('view');
  }
  function openEditRow(o: HomeOwner) {
    openView(o);
    setMode('edit');
  }

  /** Write partner_properties.owner_id so legacy readers (still on the
   *  single-FK column) see the right primary. nextOwnerId === null
   *  means the property no longer has any owner. */
  async function syncLegacyOwnerId(propertyId: string, nextOwnerId: string | null) {
    await supabase
      .from('partner_properties')
      .update({ owner_id: nextOwnerId, updated_at: new Date().toISOString() })
      .eq('id', propertyId);
  }

  /** Detach `ownerId` from a single property: delete the link, promote
   *  another surviving owner to primary if needed, sync the legacy
   *  owner_id column. Used by save() drops and by the delete flow. */
  async function detachOwnerFromProperty(propertyId: string, ownerId: string) {
    const wasPrimary = propertyOwners.some(
      l => l.property_id === propertyId && l.owner_id === ownerId && l.is_primary,
    );
    await supabase
      .from('property_owners')
      .delete()
      .eq('property_id', propertyId)
      .eq('owner_id', ownerId);
    if (!wasPrimary) return;
    const survivors = await supabase
      .from('property_owners')
      .select('id, owner_id, created_at')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: true })
      .limit(1);
    const nextPrimary = survivors.data?.[0];
    if (nextPrimary) {
      await supabase
        .from('property_owners')
        .update({ is_primary: true })
        .eq('id', nextPrimary.id);
      await syncLegacyOwnerId(propertyId, nextPrimary.owner_id);
    } else {
      await syncLegacyOwnerId(propertyId, null);
    }
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
        vat_number: form.vat_number.trim() || null,
        payment_notes: form.payment_notes.trim() || null,
        notes: form.notes.trim() || null,
        updated_at: new Date().toISOString(),
      };
      let ownerId = editing.id;
      if (editing.id) {
        const { error } = await supabase.from('home_owners').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('home_owners').insert(payload).select('id').single();
        if (error) throw error;
        ownerId = data.id;
      }

      // Property assignment diff — only touch links whose membership
      // changed. Add  = id selected now, was NOT linked before; Drop
      // = id NOT selected now, WAS linked before.
      const originalIds = new Set((portfolioByOwner[editing.id] || []).map(p => p.id));
      const toAdd: string[] = [];
      const toDrop: string[] = [];
      for (const id of selectedPropertyIds) if (!originalIds.has(id)) toAdd.push(id);
      for (const id of originalIds) if (!selectedPropertyIds.has(id)) toDrop.push(id);

      for (const propId of toAdd) {
        // Add a link. Mark primary only if the property currently has
        // no other owners. Surfaces as the contact for that property.
        const existing = propertyOwners.filter(l => l.property_id === propId);
        const isPrimary = existing.length === 0;
        const { error } = await supabase
          .from('property_owners')
          .insert({ property_id: propId, owner_id: ownerId, is_primary: isPrimary });
        if (error) throw error;
        if (isPrimary) await syncLegacyOwnerId(propId, ownerId);
      }

      for (const propId of toDrop) {
        // Remove this owner's link to the property. If they were the
        // primary, promote any remaining owner (oldest first) to
        // primary so the property still has a contact.
        const wasPrimary = propertyOwners.some(
          l => l.property_id === propId && l.owner_id === ownerId && l.is_primary,
        );
        const delRes = await supabase
          .from('property_owners')
          .delete()
          .eq('property_id', propId)
          .eq('owner_id', ownerId);
        if (delRes.error) throw delRes.error;
        if (wasPrimary) {
          const survivors = await supabase
            .from('property_owners')
            .select('id, owner_id, created_at')
            .eq('property_id', propId)
            .order('created_at', { ascending: true })
            .limit(1);
          const nextPrimary = survivors.data?.[0];
          if (nextPrimary) {
            await supabase
              .from('property_owners')
              .update({ is_primary: true })
              .eq('id', nextPrimary.id);
            await syncLegacyOwnerId(propId, nextPrimary.owner_id);
          } else {
            await syncLegacyOwnerId(propId, null);
          }
        }
      }

      toast.success(editing.id ? 'Owner updated' : 'Owner added');
      setEditing(null);
      await load();
    } catch (err) {
      toast.error('Failed to save: ' + (err?.message || err));
    } finally {
      setSaving(false);
    }
  }

  /** Inline-row delete. Same flow as the modal's Delete button but skips
   *  opening the modal. Confirms before destroying. */
  async function deleteOwner(o: HomeOwner, e: React.MouseEvent) {
    e.stopPropagation();
    const linkedProps = portfolioByOwner[o.id] || [];
    const linked = linkedProps.length;
    const msg = linked > 0
      ? `Delete ${o.name}? ${linked} propert${linked === 1 ? 'y' : 'ies'} will be unlinked (the properties themselves stay).`
      : `Delete ${o.name}?`;
    if (!confirm(msg)) return;
    try {
      // Detach from every linked property first — property_owners.owner_id
      // is ON DELETE RESTRICT, so the home_owners row can only go once
      // every link is gone. Promotes a new primary where needed.
      for (const p of linkedProps) await detachOwnerFromProperty(p.id, o.id);
      const { error } = await supabase.from('home_owners').delete().eq('id', o.id);
      if (error) throw error;
      toast.success('Owner deleted');
      await load();
    } catch (err: any) {
      toast.error('Failed to delete: ' + (err?.message || err));
    }
  }

  async function remove() {
    if (!editing?.id) return;
    const linkedProps = portfolioByOwner[editing.id] || [];
    const linked = linkedProps.length;
    const msg = linked > 0
      ? `Delete ${editing.name}? ${linked} propert${linked === 1 ? 'y' : 'ies'} will be unlinked (the properties themselves stay).`
      : `Delete ${editing.name}?`;
    if (!confirm(msg)) return;
    setSaving(true);
    try {
      for (const p of linkedProps) await detachOwnerFromProperty(p.id, editing.id);
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
            <select className="list-filter-select" value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} title="Filter by company">
              <option value="">All companies</option>
              {companies.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="list-filter-select" value={portfolioFilter} onChange={(e) => setPortfolioFilter(e.target.value as any)} title="Filter by portfolio">
              <option value="">Any portfolio</option>
              <option value="with">Has properties</option>
              <option value="without">No properties</option>
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
            <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>{filtered.length} of {owners.length}</span>
          </div>
          <div className="list-toolbar-right">
            <button className="btn btn-primary" onClick={openAdd}>+ New Owner</button>
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
        <OwnersTable
          owners={filtered}
          portfolioByOwner={portfolioByOwner}
          onView={openView}
          onEdit={openEditRow}
        />
      )}

      {editing && (() => {
        const portfolio = editing.id ? (portfolioByOwner[editing.id] || []) : [];
        const isDirty =
          JSON.stringify(form) !== JSON.stringify(initialForm) ||
          [...selectedPropertyIds].sort().join(',') !== [...initialSelectedIds].sort().join(',');
        return (
          <DetailModal
            title={editing.id ? (titleCase(form.name) || 'Owner') : 'Add owner'}
            subtitle={editing.id ? (
              <>
                {form.company && <span>{titleCase(form.company)}</span>}
                <span>· {portfolio.length} {portfolio.length === 1 ? 'property' : 'properties'}</span>
              </>
            ) : 'New CRM record'}
            accentColour="var(--color-primary-light)"
            mode={mode}
            onModeChange={setMode}
            canEdit
            isDirty={isDirty}
            onSave={save}
            onCancel={() => {
              setForm(initialForm);
              setSelectedPropertyIds(initialSelectedIds);
              setMode('view');
            }}
            footerActions={editing.id ? (
              <button className="btn btn-outline-danger" onClick={remove} disabled={saving}>
                Delete
              </button>
            ) : null}
            onClose={() => setEditing(null)}
          >
            <DetailModalSection heading="Owner details">
              <fieldset disabled={mode === 'view'} style={{ border: 0, padding: 0, margin: 0 }}>
                <div className="form-group">
                  <label className="form-label">Name *</label>
                  <input className="form-input" autoFocus={mode === 'edit'} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Company</label>
                  <input className="form-input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
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
                  <label className="form-label">VAT No.</label>
                  <input className="form-input" value={form.vat_number} onChange={(e) => setForm({ ...form, vat_number: e.target.value })} placeholder="Only required if listed under a company" />
                </div>
                <div className="form-group">
                  <label className="form-label">Payment notes</label>
                  <textarea className="form-input" rows={2} value={form.payment_notes} onChange={(e) => setForm({ ...form, payment_notes: e.target.value })} placeholder="Bank details / payout instructions" />
                </div>
                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <textarea className="form-input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
              </fieldset>
            </DetailModalSection>

            <DetailModalSection heading="Properties" headingRight={selectedPropertyIds.size || null}>
              <fieldset disabled={mode === 'view'} style={{ border: 0, padding: 0, margin: 0 }}>
                <PropertyPicker
                  allProperties={properties}
                  ownersByProperty={ownersByProperty}
                  editingOwnerId={editing.id}
                  selectedIds={selectedPropertyIds}
                  onChange={setSelectedPropertyIds}
                  search={propertyPickerSearch}
                  setSearch={setPropertyPickerSearch}
                  open={propertyPickerOpen}
                  setOpen={setPropertyPickerOpen}
                />
              </fieldset>
            </DetailModalSection>
          </DetailModal>
        );
      })()}
    </div>
  );
}

// ─── Sortable owners table ──────────────────────────────────────────────

interface OwnerRow extends DataRow {
  id: string;
  name: string;
  company: string;
  vat_number: string;
  email: string;
  phone: string;
  properties_count: number;
  owner: HomeOwner;
}

function OwnersTable({
  owners, portfolioByOwner, onView, onEdit,
}: {
  owners: HomeOwner[];
  portfolioByOwner: Record<string, PropertyLite[]>;
  onView: (o: HomeOwner) => void;
  onEdit: (o: HomeOwner) => void;
}) {
  const rows: OwnerRow[] = owners.map(o => ({
    id: o.id,
    name: titleCase(o.name),
    company: titleCase(o.company || ''),
    vat_number: o.vat_number || '',
    email: o.email ? o.email.toLowerCase() : '',
    phone: o.phone || '',
    properties_count: (portfolioByOwner[o.id] || []).length,
    owner: o,
  }));

  const columns = [
    { key: 'name', label: 'Name', sortable: true, render: (row: DataRow) => <strong>{(row as OwnerRow).name || <span className="text-light">-</span>}</strong> },
    { key: 'company', label: 'Company', sortable: true, render: (row: DataRow) => (row as OwnerRow).company || <span className="text-light">-</span> },
    { key: 'vat_number', label: 'VAT No.', sortable: true, render: (row: DataRow) => (row as OwnerRow).vat_number || <span className="text-light">-</span> },
    { key: 'email', label: 'Email', sortable: true, hideOnMobile: true, render: (row: DataRow) => (row as OwnerRow).email || <span className="text-light">-</span> },
    { key: 'phone', label: 'Phone', sortable: true, hideOnMobile: true, render: (row: DataRow) => (row as OwnerRow).phone || <span className="text-light">-</span> },
    {
      key: 'properties_count', label: 'Properties', sortable: true, align: 'center' as const, width: '110px',
      render: (row: DataRow) => {
        const n = (row as OwnerRow).properties_count;
        return n > 0 ? <strong>{n}</strong> : <span className="text-light">-</span>;
      },
    },
    {
      key: 'actions', label: '', align: 'right' as const, width: '90px',
      render: (row: DataRow) => (
        <div className="list-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="list-action-icon" title="View owner" onClick={() => onView((row as OwnerRow).owner)}>👁</button>
          <button type="button" className="list-action-icon" title="Edit owner" onClick={() => onEdit((row as OwnerRow).owner)}>✏️</button>
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
      defaultSort={{ key: 'name', direction: 'asc' }}
      onRowClick={(row: DataRow) => onView((row as OwnerRow).owner)}
    />
  );
}

// ─── Property picker (combobox) ─────────────────────────────────────────
// Input doubles as a search field — focus opens the full dropdown, typing
// filters. Click-outside closes. Picking a property keeps the dropdown
// open so the user can add several in a row without re-clicking.

function PropertyPicker({
  allProperties, ownersByProperty, editingOwnerId, selectedIds, onChange, search, setSearch, open, setOpen,
}: {
  allProperties: PropertyLite[];
  ownersByProperty: Record<string, HomeOwner[]>;
  editingOwnerId: string;
  selectedIds: Set<string>;
  onChange: (next: Set<string>) => void;
  search: string;
  setSearch: (v: string) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  const q = search.trim().toLowerCase();
  const avail = allProperties
    .filter(p => !selectedIds.has(p.id))
    .filter(p => !q || p.property_name.toLowerCase().includes(q));

  return (
    <div className="property-picker" ref={rootRef}>
      <div className="property-picker-label">
        <span>Linked properties</span>
        <span className="property-picker-count">{selectedIds.size} selected</span>
      </div>

      {selectedIds.size > 0 && (
        <div className="property-picker-chips">
          {Array.from(selectedIds).map(id => {
            const p = allProperties.find(x => x.id === id);
            if (!p) return null;
            return (
              <span key={id} className="home-owner-property-chip">
                {p.property_name}
                <button
                  type="button"
                  onClick={() => {
                    const next = new Set(selectedIds);
                    next.delete(id);
                    onChange(next);
                  }}
                  title="Unlink"
                >×</button>
              </span>
            );
          })}
        </div>
      )}

      <div className="property-picker-combo">
        <input
          className="form-input"
          placeholder={open ? 'Type to filter…' : 'Click to add a property'}
          value={search}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
        />
        <button
          type="button"
          className="property-picker-chevron"
          onClick={() => setOpen(!open)}
          tabIndex={-1}
          aria-label={open ? 'Close' : 'Open'}
        >
          {open ? '▴' : '▾'}
        </button>
      </div>

      {open && (
        <div className="property-picker-dropdown">
          {avail.length === 0 ? (
            <div className="property-picker-empty">
              {q ? 'No matches.' : 'All properties already linked.'}
            </div>
          ) : (
            avail.map(p => {
              // Many-to-many: a property can have multiple owners.
              // Show the others as a hint so the user knows they're
              // adding a co-owner, not replacing anyone.
              const coOwners = (ownersByProperty[p.id] || []).filter(o => o.id !== editingOwnerId);
              return (
                <button
                  key={p.id}
                  type="button"
                  className="property-picker-option"
                  onClick={() => {
                    const next = new Set(selectedIds);
                    next.add(p.id);
                    onChange(next);
                    setSearch('');
                  }}
                >
                  <span>{p.property_name}</span>
                  {coOwners.length > 0 && (
                    <span className="property-picker-warn">
                      also owned by {coOwners.map(o => titleCase(o.name)).join(', ')}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
