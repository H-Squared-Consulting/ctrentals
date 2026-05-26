/**
 * GuidebookRecommendationsPanel -- admin-side editor for the
 * recommendations attached to a single guidebook. Mirrors the
 * House Manual panel layout: list on the left, editor on the right.
 *
 * Categories are free-text on recommendations (host-curated, not the
 * fixed enum the manual cards use). The map view (PR #6) needs
 * lat/lng to pin the rec — the editor exposes both as numeric inputs.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from './ToastProvider';
import TipTapEditor from './TipTapEditor';

type Row = {
  assignmentId: string;
  recId: string;
  position: number;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  image_url: string | null;
  lat: number | null;
  lng: number | null;
};

export default function GuidebookRecommendationsPanel({ guidebookId }: { guidebookId: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  async function loadRows() {
    setLoading(true);
    const { data, error } = await supabase
      .from('guidebook_recommendation_assignments')
      .select('id, position, guidebook_recommendations(id, slug, name, category, description, address, phone, website, image_url, lat, lng)')
      .eq('guidebook_id', guidebookId)
      .order('position');
    setLoading(false);
    if (error) { toast.error('Load failed: ' + error.message); return; }
    const mapped: Row[] = (data || []).map((r: any) => ({
      assignmentId: r.id,
      recId:        r.guidebook_recommendations.id,
      position:     r.position,
      slug:         r.guidebook_recommendations.slug,
      name:         r.guidebook_recommendations.name,
      category:     r.guidebook_recommendations.category,
      description:  r.guidebook_recommendations.description,
      address:      r.guidebook_recommendations.address,
      phone:        r.guidebook_recommendations.phone,
      website:      r.guidebook_recommendations.website,
      image_url:    r.guidebook_recommendations.image_url,
      lat:          r.guidebook_recommendations.lat,
      lng:          r.guidebook_recommendations.lng,
    }));
    setRows(mapped);
    if (!selectedId && mapped.length > 0) setSelectedId(mapped[0].recId);
  }

  useEffect(() => { loadRows(); /* eslint-disable-next-line */ }, [guidebookId]);

  const selected = useMemo(
    () => rows.find(r => r.recId === selectedId) ?? null,
    [rows, selectedId],
  );

  async function moveRow(row: Row, dir: -1 | 1) {
    const sorted = [...rows].sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex(r => r.assignmentId === row.assignmentId);
    if (idx < 0) return;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[swapIdx];
    const [r1, r2] = await Promise.all([
      supabase.from('guidebook_recommendation_assignments').update({ position: b.position }).eq('id', a.assignmentId),
      supabase.from('guidebook_recommendation_assignments').update({ position: a.position }).eq('id', b.assignmentId),
    ]);
    if (r1.error || r2.error) { toast.error('Reorder failed'); return; }
    loadRows();
  }

  async function detach(row: Row) {
    if (!window.confirm(`Detach "${row.name}" from this guidebook? The library entry stays available to attach again.`)) return;
    const { error } = await supabase
      .from('guidebook_recommendation_assignments')
      .delete()
      .eq('id', row.assignmentId);
    if (error) { toast.error('Detach failed: ' + error.message); return; }
    if (selectedId === row.recId) setSelectedId(null);
    toast.success('Detached');
    loadRows();
  }

  async function createNew() {
    if (creating) return;
    setCreating(true);
    const slug = 'new-rec-' + Math.random().toString(36).slice(2, 7);
    const { data: lib, error: libErr } = await supabase
      .from('guidebook_recommendations')
      .insert({
        slug,
        name: 'New recommendation',
        category: 'Top attractions',
        description: '<p>Why guests love it…</p>',
      })
      .select('id, slug')
      .single();
    if (libErr || !lib) { setCreating(false); toast.error('Create failed: ' + (libErr?.message || '')); return; }
    const nextPos = rows.length > 0 ? Math.max(...rows.map(r => r.position)) + 1 : 1;
    const { error: assignErr } = await supabase
      .from('guidebook_recommendation_assignments')
      .insert({ guidebook_id: guidebookId, recommendation_id: lib.id, position: nextPos });
    setCreating(false);
    if (assignErr) { toast.error('Attach failed: ' + assignErr.message); return; }
    setSelectedId(lib.id);
    toast.success('New recommendation created');
    loadRows();
  }

  async function saveSelected(form: RecForm) {
    if (!selected || saving) return;
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    const lat = form.lat.trim();
    const lng = form.lng.trim();
    if ((lat && isNaN(Number(lat))) || (lng && isNaN(Number(lng)))) {
      toast.error('Latitude and longitude must be numbers');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('guidebook_recommendations')
      .update({
        name:        form.name.trim(),
        category:    form.category.trim() || null,
        description: form.description     || null,
        address:     form.address.trim()  || null,
        phone:       form.phone.trim()    || null,
        website:     form.website.trim()  || null,
        image_url:   form.image_url.trim()|| null,
        lat:         lat ? Number(lat) : null,
        lng:         lng ? Number(lng) : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', selected.recId);
    setSaving(false);
    if (error) { toast.error('Save failed: ' + error.message); return; }
    toast.success('Saved');
    loadRows();
  }

  return (
    <div className="gb-mp">
      <div className="gb-mp-list">
        <div className="gb-mp-list-head">
          <div>
            <h3 className="gb-mp-list-title">Attached recommendations</h3>
            <p className="gb-mp-list-sub">{rows.length} place{rows.length === 1 ? '' : 's'} on this guidebook</p>
          </div>
          <button className="btn btn-primary" type="button" onClick={createNew} disabled={creating}>
            {creating ? '…' : '+ New'}
          </button>
        </div>

        {loading ? (
          <div className="empty-state"><div className="empty-state-title">Loading…</div></div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📍</div>
            <div className="empty-state-title">No recommendations yet</div>
            <div className="empty-state-description">Click "+ New" to add the first one.</div>
          </div>
        ) : (
          <ul className="gb-mp-rows">
            {[...rows].sort((a, b) => a.position - b.position).map(r => {
              const active = selectedId === r.recId;
              return (
                <li key={r.assignmentId} className={`gb-mp-row ${active ? 'is-active' : ''}`}>
                  <button
                    type="button"
                    className="gb-mp-row-main"
                    onClick={() => setSelectedId(r.recId)}
                  >
                    <div className="gb-mp-row-cat">{r.category || 'Uncategorised'}</div>
                    <div className="gb-mp-row-title">{r.name}</div>
                  </button>
                  <div className="gb-mp-row-actions">
                    <button type="button" className="gb-mp-row-icon" title="Move up" aria-label="Move up" onClick={() => moveRow(r, -1)}>↑</button>
                    <button type="button" className="gb-mp-row-icon" title="Move down" aria-label="Move down" onClick={() => moveRow(r, 1)}>↓</button>
                    <button type="button" className="gb-mp-row-icon gb-mp-row-icon--danger" title="Detach" aria-label="Detach" onClick={() => detach(r)}>✕</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="gb-mp-editor">
        {selected
          ? <RecEditor key={selected.recId} row={selected} onSave={saveSelected} saving={saving} />
          : (
            <div className="empty-state">
              <div className="empty-state-icon">📝</div>
              <div className="empty-state-title">Pick a recommendation</div>
              <div className="empty-state-description">Select an attached place to edit, or create a new one.</div>
            </div>
          )}
      </div>
    </div>
  );
}

/* ───────────────────── Editor (right pane) ────────────────────── */

type RecForm = {
  name:        string;
  category:    string;
  description: string;
  address:     string;
  phone:       string;
  website:     string;
  image_url:   string;
  lat:         string;
  lng:         string;
};

function rowToForm(r: Row): RecForm {
  return {
    name:        r.name        || '',
    category:    r.category    || '',
    description: r.description || '',
    address:     r.address     || '',
    phone:       r.phone       || '',
    website:     r.website     || '',
    image_url:   r.image_url   || '',
    lat:         r.lat != null ? String(r.lat) : '',
    lng:         r.lng != null ? String(r.lng) : '',
  };
}

function RecEditor({
  row, onSave, saving,
}: { row: Row; onSave: (f: RecForm) => void; saving: boolean }) {
  const [form, setForm] = useState<RecForm>(() => rowToForm(row));
  const isDirty = useMemo(() => {
    const orig = rowToForm(row);
    return (Object.keys(form) as (keyof RecForm)[]).some(k => form[k] !== orig[k]);
  }, [row, form]);

  function field<K extends keyof RecForm>(key: K, value: RecForm[K]) {
    setForm({ ...form, [key]: value });
  }

  return (
    <div className="gb-mp-editor-inner">
      <div className="gb-mp-editor-head">
        <div className="gb-mp-editor-eyebrow">{row.category || 'Recommendation'} · /{row.slug}</div>
        <h3 className="gb-mp-editor-title">{form.name || row.name || 'Untitled recommendation'}</h3>
      </div>

      <div className="form-grid-2">
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label" htmlFor="rec-name">Name</label>
          <input
            id="rec-name"
            className="form-input"
            type="text"
            value={form.name}
            onChange={e => field('name', e.target.value)}
            placeholder="Kirstenbosch National Botanical Garden"
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="rec-category">Category</label>
          <input
            id="rec-category"
            className="form-input"
            type="text"
            value={form.category}
            onChange={e => field('category', e.target.value)}
            placeholder="e.g. Top attractions, Wine & dining"
            list="rec-category-suggestions"
          />
          <datalist id="rec-category-suggestions">
            <option value="Top attractions" />
            <option value="Wine & dining" />
            <option value="Bars & breweries" />
            <option value="Day trips" />
            <option value="Markets" />
            <option value="Beaches" />
            <option value="Culture" />
            <option value="Active" />
          </datalist>
          <div className="form-hint">Free text. Cards group by category on the guest page.</div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="rec-website">Website</label>
          <input
            id="rec-website"
            className="form-input"
            type="url"
            value={form.website}
            onChange={e => field('website', e.target.value)}
            placeholder="https://…"
          />
        </div>

        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Description</label>
          <TipTapEditor
            value={form.description}
            onChange={html => field('description', html)}
            placeholder="A short sell — why guests love it."
          />
        </div>

        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label" htmlFor="rec-address">Address</label>
          <input
            id="rec-address"
            className="form-input"
            type="text"
            value={form.address}
            onChange={e => field('address', e.target.value)}
            placeholder="Rhodes Dr, Newlands, Cape Town"
          />
          <div className="form-hint">Powers the Open-in-Maps deep link on the card.</div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="rec-lat">Latitude</label>
          <input
            id="rec-lat"
            className="form-input"
            type="text"
            inputMode="decimal"
            value={form.lat}
            onChange={e => field('lat', e.target.value)}
            placeholder="-33.9881"
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="rec-lng">Longitude</label>
          <input
            id="rec-lng"
            className="form-input"
            type="text"
            inputMode="decimal"
            value={form.lng}
            onChange={e => field('lng', e.target.value)}
            placeholder="18.4329"
          />
          <div className="form-hint">Coordinates pin the place on the Map view.</div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="rec-phone">Phone (optional)</label>
          <input
            id="rec-phone"
            className="form-input"
            type="tel"
            value={form.phone}
            onChange={e => field('phone', e.target.value)}
            placeholder="+27 21 …"
          />
        </div>

        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label" htmlFor="rec-image">Photo URL</label>
          <input
            id="rec-image"
            className="form-input"
            type="url"
            value={form.image_url}
            onChange={e => field('image_url', e.target.value)}
            placeholder="https://…"
          />
          <div className="form-hint">A 16:9 landscape photo works best. Drag-and-drop upload arrives in a later polish step.</div>
          {form.image_url && (
            <div className="gb-editor-hero-preview" aria-hidden>
              <img src={form.image_url} alt="" />
            </div>
          )}
        </div>
      </div>

      <div className="gb-mp-editor-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onSave(form)}
          disabled={!isDirty || saving}
        >
          {saving ? 'Saving…' : isDirty ? 'Save changes' : 'Saved'}
        </button>
      </div>
    </div>
  );
}
