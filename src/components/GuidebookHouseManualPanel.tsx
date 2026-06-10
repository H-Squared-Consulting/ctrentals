/**
 * GuidebookHouseManualPanel -- admin-side editor for the manuals
 * attached to a single guidebook. Used inside GuidebookEditorPage.
 *
 * Two-column layout:
 *   left  — list of attached manuals (with category eyebrow, drag
 *           handle for reorder, X to detach)
 *   right — edit form for the currently-selected manual: title,
 *           category (required, enum-enforced), icon, body (TipTap),
 *           image URL, emergency_tag.
 *
 * Category is enforced as a non-null pick from the canonical 8 (see
 * §2.2 of the design guide). Reordering uses simple up/down buttons
 * — drag-drop is a polish step. Photo *upload* is also deferred;
 * for now hosts paste a hero URL.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from './ToastProvider';
import {
  CATEGORY_ORDER,
  EMERGENCY_TAGS,
  ICON_OPTIONS,
  toCanonicalCategory,
  type GuidebookCategory,
} from '../lib/guidebookTaxonomy';
import TipTapEditor from './TipTapEditor';
import ImageUrlField from './ImageUrlField';
import { Emoji } from '../lib/guidebookShared';

type Row = {
  assignmentId: string;
  manualId: string;
  position: number;
  slug: string;
  title: string;
  category: string | null;
  body_html: string | null;
  icon: string | null;
  image_url: string | null;
  emergency_tag: string | null;
  is_standard: boolean;
};

export default function GuidebookHouseManualPanel({ guidebookId }: { guidebookId: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  async function loadRows() {
    setLoading(true);
    const { data, error } = await supabase
      .from('guidebook_manual_assignments')
      .select('id, position, guidebook_house_manuals(id, slug, title, category, body_html, icon, image_url, emergency_tag, is_standard)')
      .eq('guidebook_id', guidebookId)
      .order('position');
    setLoading(false);
    if (error) { toast.error('Load failed: ' + error.message); return; }
    const mapped: Row[] = (data || []).map((r: any) => ({
      assignmentId: r.id,
      manualId: r.guidebook_house_manuals.id,
      position: r.position,
      slug: r.guidebook_house_manuals.slug,
      title: r.guidebook_house_manuals.title,
      category: r.guidebook_house_manuals.category,
      body_html: r.guidebook_house_manuals.body_html,
      icon: r.guidebook_house_manuals.icon,
      image_url: r.guidebook_house_manuals.image_url,
      emergency_tag: r.guidebook_house_manuals.emergency_tag,
      is_standard: r.guidebook_house_manuals.is_standard,
    }));
    setRows(mapped);
    if (!selectedId && mapped.length > 0) setSelectedId(mapped[0].manualId);
  }

  useEffect(() => { loadRows(); /* eslint-disable-next-line */ }, [guidebookId]);

  const selected = useMemo(
    () => rows.find(r => r.manualId === selectedId) ?? null,
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
    // Swap positions in DB.
    const [r1, r2] = await Promise.all([
      supabase.from('guidebook_manual_assignments').update({ position: b.position }).eq('id', a.assignmentId),
      supabase.from('guidebook_manual_assignments').update({ position: a.position }).eq('id', b.assignmentId),
    ]);
    if (r1.error || r2.error) { toast.error('Reorder failed'); return; }
    loadRows();
  }

  async function detach(row: Row) {
    if (!window.confirm(`Detach "${row.title}" from this guidebook? The library entry stays available to attach again later.`)) return;
    const { error } = await supabase
      .from('guidebook_manual_assignments')
      .delete()
      .eq('id', row.assignmentId);
    if (error) { toast.error('Detach failed: ' + error.message); return; }
    if (selectedId === row.manualId) setSelectedId(null);
    toast.success('Detached');
    loadRows();
  }

  async function createNew() {
    if (creating) return;
    setCreating(true);
    // Insert a new library entry + assign it at the end.
    const slugBase = 'new-manual';
    let slug = slugBase + '-' + Math.random().toString(36).slice(2, 7);
    const { data: lib, error: libErr } = await supabase
      .from('guidebook_house_manuals')
      .insert({
        slug,
        title: 'New manual entry',
        category: 'House Rules',
        body_html: '<p>Write your guidance here.</p>',
        icon: 'home',
        is_standard: false,
      })
      .select('id, slug')
      .single();
    if (libErr || !lib) { setCreating(false); toast.error('Create failed: ' + (libErr?.message || '')); return; }
    const nextPos = rows.length > 0 ? Math.max(...rows.map(r => r.position)) + 1 : 1;
    const { error: assignErr } = await supabase
      .from('guidebook_manual_assignments')
      .insert({
        guidebook_id: guidebookId,
        manual_id: lib.id,
        position: nextPos,
      });
    setCreating(false);
    if (assignErr) { toast.error('Attach failed: ' + assignErr.message); return; }
    setSelectedId(lib.id);
    toast.success('New manual created');
    loadRows();
  }

  async function saveSelected(form: ManualForm) {
    if (!selected || saving) return;
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    if (!form.category) { toast.error('Category is required'); return; }
    setSaving(true);
    const { error } = await supabase
      .from('guidebook_house_manuals')
      .update({
        title: form.title.trim(),
        category: form.category,
        body_html: form.body_html,
        icon: form.icon || null,
        image_url: form.image_url.trim() || null,
        emergency_tag: form.emergency_tag || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', selected.manualId);
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
            <h3 className="gb-mp-list-title">Attached manuals</h3>
            <p className="gb-mp-list-sub">{rows.length} card{rows.length === 1 ? '' : 's'} on this guidebook</p>
          </div>
          <button className="btn btn-primary" type="button" onClick={createNew} disabled={creating}>
            {creating ? '…' : '+ New'}
          </button>
        </div>

        {loading ? (
          <div className="empty-state"><div className="empty-state-title">Loading…</div></div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-title">No manuals yet</div>
            <div className="empty-state-description">Click "+ New" to add the first one.</div>
          </div>
        ) : (
          <ul className="gb-mp-rows">
            {[...rows].sort((a, b) => a.position - b.position).map(r => {
              const canonical = toCanonicalCategory(r.category);
              const active = selectedId === r.manualId;
              return (
                <li key={r.assignmentId} className={`gb-mp-row ${active ? 'is-active' : ''}`}>
                  <button
                    type="button"
                    className="gb-mp-row-main"
                    onClick={() => setSelectedId(r.manualId)}
                  >
                    <div className="gb-mp-row-cat">{canonical || r.category || 'Uncategorised'}</div>
                    <div className="gb-mp-row-title">{r.title}</div>
                  </button>
                  <div className="gb-mp-row-actions">
                    <button
                      type="button"
                      className="gb-mp-row-icon"
                      title="Move up"
                      aria-label="Move up"
                      onClick={() => moveRow(r, -1)}
                    >↑</button>
                    <button
                      type="button"
                      className="gb-mp-row-icon"
                      title="Move down"
                      aria-label="Move down"
                      onClick={() => moveRow(r, 1)}
                    >↓</button>
                    <button
                      type="button"
                      className="gb-mp-row-icon gb-mp-row-icon--danger"
                      title="Detach from this guidebook"
                      aria-label="Detach"
                      onClick={() => detach(r)}
                    >✕</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="gb-mp-editor">
        {selected
          ? <ManualEditor key={selected.manualId} row={selected} onSave={saveSelected} saving={saving} />
          : (
            <div className="empty-state">
              <div className="empty-state-icon">📝</div>
              <div className="empty-state-title">Pick a manual on the left</div>
              <div className="empty-state-description">Select an attached card to edit, or create a new one.</div>
            </div>
          )}
      </div>
    </div>
  );
}

/* ───────────────────── Editor (right pane) ────────────────────── */

type ManualForm = {
  title: string;
  category: GuidebookCategory | '';
  body_html: string;
  icon: string;
  image_url: string;
  emergency_tag: string;
};

function rowToForm(r: Row): ManualForm {
  return {
    title: r.title || '',
    category: (toCanonicalCategory(r.category) ?? '') as ManualForm['category'],
    body_html: r.body_html || '',
    icon: r.icon || '',
    image_url: r.image_url || '',
    emergency_tag: r.emergency_tag || '',
  };
}

function ManualEditor({
  row, onSave, saving,
}: { row: Row; onSave: (f: ManualForm) => void; saving: boolean }) {
  const [form, setForm] = useState<ManualForm>(() => rowToForm(row));

  const isDirty = useMemo(() => {
    const orig = rowToForm(row);
    return (Object.keys(form) as (keyof ManualForm)[]).some(k => form[k] !== orig[k]);
  }, [row, form]);

  function field<K extends keyof ManualForm>(key: K, value: ManualForm[K]) {
    setForm({ ...form, [key]: value });
  }

  return (
    <div className="gb-mp-editor-inner">
      <div className="gb-mp-editor-head">
        <div className="gb-mp-editor-eyebrow">{row.category || 'Manual entry'} · /{row.slug}</div>
        <h3 className="gb-mp-editor-title">{form.title || row.title || 'Untitled manual'}</h3>
      </div>

      <div className="form-grid-2">
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label" htmlFor="mp-title">Title</label>
          <input
            id="mp-title"
            className="form-input"
            type="text"
            value={form.title}
            onChange={e => field('title', e.target.value)}
            placeholder="e.g. Load-Shedding in Cape Town"
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="mp-category">Category *</label>
          <select
            id="mp-category"
            className="form-input"
            value={form.category}
            onChange={e => field('category', e.target.value as ManualForm['category'])}
          >
            <option value="">Pick a category…</option>
            {CATEGORY_ORDER.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="form-hint">Required. The guest page groups cards under these 8 categories.</div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="mp-icon">Icon</label>
          <select
            id="mp-icon"
            className="form-input"
            value={form.icon}
            onChange={e => field('icon', e.target.value)}
          >
            <option value="">Default (home)</option>
            {ICON_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="gb-mp-icon-preview"><Emoji name={form.icon || 'home'} /></div>
        </div>

        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Body</label>
          <TipTapEditor
            value={form.body_html}
            onChange={html => field('body_html', html)}
            placeholder="Write the guidance here…"
          />
          <div className="form-hint">Keep it short. Bold the important bits.</div>
        </div>

        <ImageUrlField
          id="mp-image"
          label="Photo"
          value={form.image_url}
          onChange={url => field('image_url', url)}
          hint="A 16:9 JPEG works best."
        />

        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label" htmlFor="mp-emerg">Emergency tag</label>
          <select
            id="mp-emerg"
            className="form-input"
            value={form.emergency_tag}
            onChange={e => field('emergency_tag', e.target.value)}
          >
            {EMERGENCY_TAGS.map(t => <option key={t.value || 'none'} value={t.value}>{t.label}</option>)}
          </select>
          <div className="form-hint">
            Pick gas/water/electrical shut-off if this card belongs in the Emergency page's shut-off section.
          </div>
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
