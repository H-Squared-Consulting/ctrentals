/**
 * GuidebookDeparturePanel -- admin editor for the Departure section.
 *
 * Edits:
 *   checkout_time       — HH:MM picker
 *   checkout_text       — TipTap prose
 *   checkout_checklist  — ordered JSONB array of { id, label, icon }
 *
 * Checklist editor: per-row label + icon picker + reorder + remove,
 * plus "+ Add item" at the bottom. Each item's `id` is stable so the
 * guest's localStorage-saved ticks survive label tweaks.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from './ToastProvider';
import TipTapEditor from './TipTapEditor';
import { Emoji, type ChecklistItem } from '../lib/guidebookShared';
import { ICON_OPTIONS } from '../lib/guidebookTaxonomy';

type Form = {
  checkout_time:      string;          // 'HH:MM'
  checkout_text:      string;
  checkout_checklist: ChecklistItem[];
};

const EMPTY: Form = { checkout_time: '', checkout_text: '', checkout_checklist: [] };

function rowToForm(row: any): Form {
  return {
    checkout_time:      (row.checkout_time as string | null)?.slice(0, 5) ?? '',
    checkout_text:      row.checkout_text ?? '',
    checkout_checklist: Array.isArray(row.checkout_checklist) ? row.checkout_checklist : [],
  };
}

function newItemId(): string {
  return 'item-' + Math.random().toString(36).slice(2, 8);
}

export default function GuidebookDeparturePanel({ guidebookId }: { guidebookId: string }) {
  const toast = useToast();
  const [original, setOriginal] = useState<Form>(EMPTY);
  const [form, setForm] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('guidebooks')
        .select('checkout_time, checkout_text, checkout_checklist')
        .eq('id', guidebookId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) { toast.error('Load failed: ' + (error?.message || 'not found')); setLoading(false); return; }
      const f = rowToForm(data);
      setOriginal(f); setForm(f);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidebookId]);

  const isDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(original),
    [form, original],
  );

  function setField<K extends keyof Form>(key: K, value: Form[K]) {
    setForm({ ...form, [key]: value });
  }

  function updateItem(index: number, patch: Partial<ChecklistItem>) {
    const next = form.checkout_checklist.slice();
    next[index] = { ...next[index], ...patch };
    setField('checkout_checklist', next);
  }
  function removeItem(index: number) {
    const next = form.checkout_checklist.slice();
    next.splice(index, 1);
    setField('checkout_checklist', next);
  }
  function moveItem(index: number, dir: -1 | 1) {
    const next = form.checkout_checklist.slice();
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setField('checkout_checklist', next);
  }
  function addItem() {
    setField('checkout_checklist', [
      ...form.checkout_checklist,
      { id: newItemId(), label: 'New item', icon: 'home' },
    ]);
  }

  async function handleSave() {
    if (saving) return;
    // Light validation — labels are required.
    if (form.checkout_checklist.some(i => !i.label.trim())) {
      toast.error('Every checklist item needs a label');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('guidebooks')
      .update({
        checkout_time: form.checkout_time || null,
        checkout_text: form.checkout_text || null,
        checkout_checklist: form.checkout_checklist,
        updated_at: new Date().toISOString(),
      })
      .eq('id', guidebookId);
    setSaving(false);
    if (error) { toast.error('Save failed: ' + error.message); return; }
    setOriginal(form);
    toast.success('Saved');
  }

  if (loading) {
    return <div className="empty-state"><div className="empty-state-title">Loading…</div></div>;
  }

  return (
    <div className="gb-editor-section">
      <div className="gb-editor-section-head">
        <h2 className="gb-editor-section-title">Departure</h2>
        <p className="gb-editor-section-lede">
          Check-out time, the prose card, and the per-device checklist guests tick on their way out.
        </p>
      </div>

      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label" htmlFor="dep-time">Check-out time</label>
          <input id="dep-time" className="form-input" type="time"
                 value={form.checkout_time}
                 onChange={e => setField('checkout_time', e.target.value)} />
          <div className="form-hint">Shown as a big headline on the Departure section + on the Check-out quick-action chip.</div>
        </div>

        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Check-out instructions</label>
          <TipTapEditor
            value={form.checkout_text}
            onChange={v => setField('checkout_text', v)}
            placeholder="Leave the keys on the counter, pull the door closed, …"
          />
        </div>

        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <div className="gb-dep-checklist-head">
            <div>
              <div className="form-label" style={{ marginBottom: 0 }}>Departure checklist</div>
              <div className="form-hint" style={{ marginTop: 2 }}>
                {form.checkout_checklist.length} item{form.checkout_checklist.length === 1 ? '' : 's'} · drag-handle reorder via ↑↓
              </div>
            </div>
            <button type="button" className="btn btn-outline" onClick={addItem}>+ Add item</button>
          </div>

          {form.checkout_checklist.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📋</div>
              <div className="empty-state-title">No items yet</div>
              <div className="empty-state-description">Click "+ Add item" to start your checklist.</div>
            </div>
          ) : (
            <ul className="gb-dep-checklist-rows">
              {form.checkout_checklist.map((item, i) => (
                <li key={item.id} className="gb-dep-checklist-row">
                  <div className="gb-dep-checklist-emoji" aria-hidden>
                    <Emoji name={item.icon || 'home'} />
                  </div>
                  <div className="gb-dep-checklist-fields">
                    <input
                      className="form-input"
                      type="text"
                      value={item.label}
                      onChange={e => updateItem(i, { label: e.target.value })}
                      placeholder="Item label, e.g. Lock all doors"
                    />
                    <select
                      className="form-input"
                      value={item.icon || ''}
                      onChange={e => updateItem(i, { icon: e.target.value || undefined })}
                    >
                      <option value="">Default (home)</option>
                      {ICON_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="gb-dep-checklist-actions">
                    <button type="button" className="gb-mp-row-icon" aria-label="Move up" title="Move up" onClick={() => moveItem(i, -1)}>↑</button>
                    <button type="button" className="gb-mp-row-icon" aria-label="Move down" title="Move down" onClick={() => moveItem(i, 1)}>↓</button>
                    <button type="button" className="gb-mp-row-icon gb-mp-row-icon--danger" aria-label="Remove" title="Remove" onClick={() => removeItem(i)}>✕</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="gb-mp-editor-actions">
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={!isDirty || saving}>
          {saving ? 'Saving…' : isDirty ? 'Save changes' : 'Saved'}
        </button>
      </div>
    </div>
  );
}
