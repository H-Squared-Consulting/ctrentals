/**
 * GuidebookEditorPage -- admin editor at /guidebooks/:id.
 *
 * Detail-modal visual language (5px primary accent strip, mode badge,
 * sticky header) rendered as a full page rather than a modal — the
 * editor is too dense to live inside an overlay (per §4.9.2 of the
 * design guide).
 *
 * Scope per GUIDEBOOK_DESIGN_GUIDE §8.2:
 *   - Left section nav: Basics, Arrival & WiFi, House Manual,
 *     Recommendations, Departure, Emergency, Preview.
 *   - Only the Basics panel is fully wired (property name, slug,
 *     hero image URL, host name + phone, publish toggle).
 *   - Other panels stub to "Coming in PR #N" so the navigation
 *     scaffolding is real but doesn't pretend to edit fields it
 *     can't yet save.
 *
 * Save persists via UPDATE; Publish toggles is_published; Preview
 * opens /g/:slug in a new tab.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useLayout } from '../contexts/LayoutContext';
import { useToast } from '../components/ToastProvider';
import GuidebookHouseManualPanel from '../components/GuidebookHouseManualPanel';
import GuidebookArrivalPanel from '../components/GuidebookArrivalPanel';
import GuidebookEmergencyPanel from '../components/GuidebookEmergencyPanel';
import GuidebookRecommendationsPanel from '../components/GuidebookRecommendationsPanel';
import GuidebookDeparturePanel from '../components/GuidebookDeparturePanel';

type Guidebook = {
  id: string;
  slug: string;
  property_name: string;
  host_name: string | null;
  host_phone: string | null;
  hero_image_url: string | null;
  is_published: boolean;
  updated_at: string;
};

type Section = 'basics' | 'arrival' | 'manual' | 'recommendations' | 'departure' | 'emergency' | 'preview';

const SECTIONS: { id: Section; label: string; futurePR?: number }[] = [
  { id: 'basics',          label: 'Basics' },
  { id: 'arrival',         label: 'Arrival & WiFi' },
  { id: 'manual',          label: 'House Manual' },
  { id: 'recommendations', label: 'Recommendations' },
  { id: 'departure',       label: 'Departure' },
  { id: 'emergency',       label: 'Emergency' },
  { id: 'preview',         label: 'Preview' },
];

type BasicsForm = {
  property_name: string;
  slug: string;
  host_name: string;
  host_phone: string;
  hero_image_url: string;
};

function toBasicsForm(g: Guidebook): BasicsForm {
  return {
    property_name: g.property_name || '',
    slug: g.slug || '',
    host_name: g.host_name || '',
    host_phone: g.host_phone || '',
    hero_image_url: g.hero_image_url || '',
  };
}

export default function GuidebookEditorPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { setPageTitle, setPageHeaderHidden } = useLayout();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [guidebook, setGuidebook] = useState<Guidebook | null>(null);
  const [section, setSection] = useState<Section>('basics');
  const [form, setForm] = useState<BasicsForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Page chrome is supplied by the editor itself (sticky top bar) so
  // hide the default admin page header for this route only.
  useEffect(() => {
    setPageHeaderHidden(true);
    setPageTitle('Guidebook');
    return () => { setPageHeaderHidden(false); };
  }, [setPageTitle, setPageHeaderHidden]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setNotFound(false);
      const { data, error } = await supabase
        .from('guidebooks')
        .select('id, slug, property_name, host_name, host_phone, hero_image_url, is_published, updated_at')
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) { setNotFound(true); setLoading(false); return; }
      setGuidebook(data as Guidebook);
      setForm(toBasicsForm(data as Guidebook));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  const isDirty = useMemo(() => {
    if (!guidebook || !form) return false;
    const original = toBasicsForm(guidebook);
    return (Object.keys(form) as (keyof BasicsForm)[]).some(k => form[k] !== original[k]);
  }, [guidebook, form]);

  async function handleSave() {
    if (!guidebook || !form || saving) return;
    if (!form.property_name.trim()) { toast.error('Property name is required'); return; }
    if (!form.slug.trim() || !/^[a-z0-9-]+$/.test(form.slug)) {
      toast.error('Slug must be lowercase letters, numbers and hyphens only');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from('guidebooks')
      .update({
        property_name: form.property_name.trim(),
        slug: form.slug.trim(),
        host_name: form.host_name.trim() || null,
        host_phone: form.host_phone.trim() || null,
        hero_image_url: form.hero_image_url.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', guidebook.id)
      .select('id, slug, property_name, host_name, host_phone, hero_image_url, is_published, updated_at')
      .single();
    setSaving(false);
    if (error) { toast.error('Save failed: ' + error.message); return; }
    setGuidebook(data as Guidebook);
    setForm(toBasicsForm(data as Guidebook));
    toast.success('Saved');
  }

  async function handlePublishToggle() {
    if (!guidebook || publishing) return;
    const next = !guidebook.is_published;
    setPublishing(true);
    const { data, error } = await supabase
      .from('guidebooks')
      .update({ is_published: next, updated_at: new Date().toISOString() })
      .eq('id', guidebook.id)
      .select('id, slug, property_name, host_name, host_phone, hero_image_url, is_published, updated_at')
      .single();
    setPublishing(false);
    if (error) { toast.error((next ? 'Publish' : 'Unpublish') + ' failed: ' + error.message); return; }
    setGuidebook(data as Guidebook);
    toast.success(next ? 'Published' : 'Unpublished');
  }

  if (loading) {
    return <div className="empty-state"><div className="empty-state-title">Loading…</div></div>;
  }
  if (notFound || !guidebook || !form) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📖</div>
        <div className="empty-state-title">Guidebook not found</div>
        <div className="empty-state-description">
          <button className="btn btn-outline" onClick={() => navigate('/guidebooks')}>Back to list</button>
        </div>
      </div>
    );
  }

  const previewHref = `/g/${guidebook.slug}`;

  return (
    <div className="gb-editor">
      <div className="gb-editor-strip" aria-hidden />

      <div className="gb-editor-topbar">
        <button className="gb-editor-back" onClick={() => navigate('/guidebooks')} aria-label="Back to guidebooks">
          ← Guidebooks
        </button>
        <div className="gb-editor-topbar-title">
          <span className="gb-editor-topbar-name">{guidebook.property_name}</span>
          <span className="gb-editor-topbar-slug">/g/{guidebook.slug}</span>
          <span className={`status-badge ${guidebook.is_published ? 'status-badge--success' : 'status-badge--warning'}`}>
            {guidebook.is_published ? 'Published' : 'Draft'}
          </span>
          {isDirty && <span className="status-badge status-badge--warning">Unsaved</span>}
        </div>
        <div className="gb-editor-topbar-actions">
          <a className="btn btn-outline" href={previewHref} target="_blank" rel="noopener noreferrer">Preview</a>
          <button
            type="button"
            className={`btn ${guidebook.is_published ? 'btn-outline-danger' : 'btn-outline-success'}`}
            onClick={handlePublishToggle}
            disabled={publishing}
          >
            {publishing ? '…' : guidebook.is_published ? 'Unpublish' : 'Publish'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!isDirty || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="gb-editor-body">
        <nav className="gb-editor-nav" aria-label="Guidebook sections">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              type="button"
              className={`gb-editor-nav-link ${section === s.id ? 'is-active' : ''}`}
              onClick={() => setSection(s.id)}
            >
              <span className="gb-editor-nav-label">{s.label}</span>
              {s.futurePR && (
                <span className="gb-editor-nav-future">PR #{s.futurePR}</span>
              )}
            </button>
          ))}
        </nav>

        <main className="gb-editor-panel">
          {section === 'basics' && (
            <BasicsPanel form={form} setForm={setForm} />
          )}
          {section === 'arrival' && (
            <GuidebookArrivalPanel guidebookId={guidebook.id} />
          )}
          {section === 'manual' && (
            <div className="gb-editor-section">
              <div className="gb-editor-section-head">
                <h2 className="gb-editor-section-title">House Manual</h2>
                <p className="gb-editor-section-lede">
                  Cards grouped by category on the guest page. Category is required — the guest renderer
                  skips uncategorised entries.
                </p>
              </div>
              <GuidebookHouseManualPanel guidebookId={guidebook.id} />
            </div>
          )}
          {section === 'recommendations' && (
            <div className="gb-editor-section">
              <div className="gb-editor-section-head">
                <h2 className="gb-editor-section-title">Recommendations</h2>
                <p className="gb-editor-section-lede">
                  The curated Cape Town list. Coordinates pin each place on the guest Map view; category groups
                  them on the List view.
                </p>
              </div>
              <GuidebookRecommendationsPanel guidebookId={guidebook.id} />
            </div>
          )}
          {section === 'departure' && (
            <GuidebookDeparturePanel guidebookId={guidebook.id} />
          )}
          {section === 'emergency' && (
            <GuidebookEmergencyPanel guidebookId={guidebook.id} />
          )}
          {section === 'preview' && (
            <PreviewPanel previewHref={previewHref} />
          )}
        </main>
      </div>
    </div>
  );
}

/* ───────────────────────── Basics panel ──────────────────────────── */
function BasicsPanel({
  form, setForm,
}: { form: BasicsForm; setForm: (f: BasicsForm) => void }) {
  function field<K extends keyof BasicsForm>(key: K, value: string) {
    setForm({ ...form, [key]: value });
  }
  return (
    <div className="gb-editor-section">
      <div className="gb-editor-section-head">
        <h2 className="gb-editor-section-title">Basics</h2>
        <p className="gb-editor-section-lede">
          Property name, public slug, host contact and hero image. These power the guest hero and the host-contact chip.
        </p>
      </div>

      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label" htmlFor="gb-property-name">Property name</label>
          <input
            id="gb-property-name"
            className="form-input"
            type="text"
            value={form.property_name}
            onChange={e => field('property_name', e.target.value)}
            placeholder="9 Montrose Terrace"
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="gb-slug">Slug (public URL)</label>
          <input
            id="gb-slug"
            className="form-input"
            type="text"
            value={form.slug}
            onChange={e => field('slug', e.target.value.toLowerCase())}
            placeholder="montrose-terrace"
          />
          <div className="form-hint">
            Guest URL will be <code>/g/{form.slug || 'your-slug'}</code>. Lowercase, hyphens, no spaces.
          </div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="gb-host-name">Host name</label>
          <input
            id="gb-host-name"
            className="form-input"
            type="text"
            value={form.host_name}
            onChange={e => field('host_name', e.target.value)}
            placeholder="Hayley"
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="gb-host-phone">Host phone (with country code)</label>
          <input
            id="gb-host-phone"
            className="form-input"
            type="tel"
            value={form.host_phone}
            onChange={e => field('host_phone', e.target.value)}
            placeholder="+27 83 415 7779"
          />
          <div className="form-hint">Used by the Call host button and the Emergency page.</div>
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label" htmlFor="gb-hero">Hero image URL</label>
          <input
            id="gb-hero"
            className="form-input"
            type="url"
            value={form.hero_image_url}
            onChange={e => field('hero_image_url', e.target.value)}
            placeholder="https://…"
          />
          <div className="form-hint">A 1600px-wide JPEG works well. Photo upload arrives in PR #5.</div>
          {form.hero_image_url && (
            <div className="gb-editor-hero-preview" aria-hidden>
              <img src={form.hero_image_url} alt="" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Preview panel ─────────────────────────── */
function PreviewPanel({ previewHref }: { previewHref: string }) {
  return (
    <div className="gb-editor-section">
      <div className="gb-editor-section-head">
        <h2 className="gb-editor-section-title">Preview</h2>
        <p className="gb-editor-section-lede">
          See the guest-facing guidebook the way a guest will. Opens in a new tab — keep this editor open in
          the background while you tweak.
        </p>
      </div>
      <div className="gb-editor-preview-actions">
        <a className="btn btn-primary" href={previewHref} target="_blank" rel="noopener noreferrer">
          Open guest guidebook ↗
        </a>
        <code className="gb-list-slug">{previewHref}</code>
      </div>
    </div>
  );
}
