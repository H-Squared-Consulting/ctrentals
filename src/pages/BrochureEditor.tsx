/* eslint-disable */
// @ts-nocheck
/**
 * BrochureEditor — per-property brochure layout customisation.
 *
 * Mom edits which sections appear and which order the photos go in.
 * Live preview is the real brochure.html embedded as an iframe; we send
 * draft configs via postMessage so the preview updates instantly without
 * needing to save first.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

// Section keys must match the cfg.hide() calls in public/brochure.html.
// "Hero" and the footer are intentionally not toggleable — hiding the hero
// would leave a brochure with no title; the footer is just a copyright line.
const SECTIONS: { key: string; label: string; help: string }[] = [
  { key: 'stats',     label: 'Key stats',           help: 'Bedrooms, bathrooms, sleeps, and the location line.' },
  { key: 'beds',      label: 'Sleeping arrangements', help: 'Per-room bed sizes (only renders if filled in).' },
  { key: 'about',     label: 'About this property', help: 'The long-form description block.' },
  { key: 'gallery',   label: 'Gallery',             help: 'Photo grid (filtered by per-photo "Show in brochures").' },
  { key: 'amenities', label: 'Amenities',           help: 'The amenity-tag list.' },
  { key: 'share',     label: 'Share button',        help: '"Copy link" button at the bottom of the brochure.' },
];

export default function BrochureEditor({ property, onClose, onSave, supabase }) {
  const initialCfg = useMemo(() => {
    const c = property.brochure_config;
    const obj = (c && typeof c === 'object' && !Array.isArray(c)) ? c : {};
    return {
      hidden_sections: Array.isArray(obj.hidden_sections) ? obj.hidden_sections : [],
      photo_order:     Array.isArray(obj.photo_order) ? obj.photo_order : null,
    };
  }, [property.id]);

  const [hidden, setHidden] = useState<string[]>(initialCfg.hidden_sections);
  // Photo order is derived from the gallery_images column. If a saved
  // photo_order exists, apply it as the starting point (URLs not present
  // in gallery are dropped; new URLs appended at the end).
  const galleryUrls: string[] = useMemo(() => {
    const g = property.gallery_images;
    if (Array.isArray(g)) return g;
    if (typeof g === 'string') {
      try { const p = JSON.parse(g); return Array.isArray(p) ? p : []; } catch { return []; }
    }
    return [];
  }, [property.id]);

  // image_metadata is the same column the property editor writes — toggling
  // include/exclude here updates the canonical state, so a photo hidden from
  // brochures in this view is also reflected as unticked in PropertyEditModal
  // on next load. Local state until Save flushes to the DB.
  const [imageMeta, setImageMeta] = useState<Record<string, any>>(() => {
    const m = property.image_metadata;
    return (m && typeof m === 'object' && !Array.isArray(m)) ? { ...m } : {};
  });
  function getShow(url: string) {
    const m = imageMeta[url];
    return !m || m.show_in_brochure !== false; // default true
  }
  function toggleInclude(url: string) {
    setImageMeta(prev => {
      const cur = prev[url] || {};
      return { ...prev, [url]: { ...cur, show_in_brochure: cur.show_in_brochure === false ? true : false } };
    });
  }

  const [order, setOrder] = useState<string[]>(() => {
    const saved = initialCfg.photo_order;
    if (!saved) return galleryUrls.slice();
    const set = new Set(galleryUrls);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const u of saved)       { if (set.has(u) && !seen.has(u)) { out.push(u); seen.add(u); } }
    for (const u of galleryUrls) { if (!seen.has(u)) out.push(u); }
    return out;
  });

  const [saving, setSaving] = useState(false);
  // Post-save confirmation state. When set, an overlay appears with two clear
  // next actions: share the brochure link or return to the Properties view.
  const [savedConfirm, setSavedConfirm] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const shareUrl = `${window.location.origin}/brochure.html?id=${encodeURIComponent(property.id)}`;

  // Drag state for reordering the photo strip. dragIndex is the source thumb
  // being dragged; dropIndex is the gap index (0..N) where it would land.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // Push the current draft config to the iframe whenever it changes.
  const draftConfig = useMemo(() => ({
    hidden_sections: hidden,
    // Only emit photo_order if it differs from the natural gallery_images
    // order — keeps stored configs tidy for properties she didn't reorder.
    photo_order: arraysEqual(order, galleryUrls) ? null : order,
  }), [hidden, order, galleryUrls]);

  function postPreview() {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage(
      { type: 'preview-config', config: draftConfig, image_metadata: imageMeta },
      '*'
    );
  }

  useEffect(() => { postPreview(); }, [draftConfig, imageMeta]);

  // Iframe tells us when it's mounted and ready to receive previews.
  useEffect(() => {
    function onMsg(evt: MessageEvent) {
      if (evt.data && evt.data.type === 'preview-ready') postPreview();
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [draftConfig, imageMeta]);

  // Lock background scroll while the editor is open and restore on unmount.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  function toggleSection(key: string) {
    setHidden(prev => prev.indexOf(key) >= 0 ? prev.filter(k => k !== key) : [...prev, key]);
  }

  // Drop the dragged thumb at the "gap" indicated by dropIndex (0..N).
  // Splicing logic accounts for the source being removed before insertion.
  function performDrop(from: number, gap: number) {
    setOrder(prev => {
      if (from === gap || from === gap - 1) return prev; // dropped on itself
      const next = prev.slice();
      const [item] = next.splice(from, 1);
      const insertAt = gap > from ? gap - 1 : gap;
      next.splice(insertAt, 0, item);
      return next;
    });
  }

  function onDragStart(idx: number, e: React.DragEvent) {
    setDragIndex(idx);
    // Required for Firefox to start the drag.
    try { e.dataTransfer.setData('text/plain', String(idx)); } catch {}
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragEnd() {
    setDragIndex(null);
    setDropIndex(null);
  }
  // Decide which gap to target based on cursor X relative to the thumb's
  // bounding box midpoint. Gap N means "drop just before photo N".
  function onDragOverThumb(idx: number, e: React.DragEvent) {
    if (dragIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isAfter = e.clientX > rect.left + rect.width / 2;
    setDropIndex(isAfter ? idx + 1 : idx);
  }
  function onDropOnStrip(e: React.DragEvent) {
    if (dragIndex === null || dropIndex === null) return;
    e.preventDefault();
    performDrop(dragIndex, dropIndex);
    setDragIndex(null);
    setDropIndex(null);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = { brochure_config: draftConfig, image_metadata: imageMeta };
      // .select('id') so an RLS-filtered no-op update is detectable as 0 rows
      // instead of a silent success.
      const { data, error } = await supabase
        .from('partner_properties')
        .update(payload)
        .eq('id', property.id)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('No rows updated — your account may not have permission to edit this property.');
      }
      setSavedConfirm(true);
      // NB: deliberately not calling onSave() here. The parent's loadProperties()
      // flips a `loading` flag that replaces the whole PropertiesPage tree with
      // a spinner — that would unmount this editor and lose savedConfirm + the
      // local edit state. Property cards don't display anything derived from
      // brochure_config / image_metadata, so the refresh is gratuitous.
    } catch (err: any) {
      alert('Failed to save brochure layout: ' + (err?.message || err));
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      // Fallback for browsers that block the async clipboard API.
      const ta = document.createElement('textarea');
      ta.value = shareUrl;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2500); } catch {}
      document.body.removeChild(ta);
    }
  }

  return (
    <div className="brochure-editor-overlay">
      <div className="brochure-editor">
        <div className="brochure-editor-header">
          <div>
            <h2 className="brochure-editor-title">Brochure Layout — {property.property_name}</h2>
            <div className="brochure-editor-sub">
              Changes preview live. Click <strong>Save</strong> to keep them.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        <div className="brochure-editor-body">
          {/* ── Controls panel (sections only) ── */}
          <div className="brochure-editor-controls">
            <div className="brochure-editor-section">
              <div className="brochure-editor-section-title">Sections</div>
              <div className="brochure-editor-section-hint">
                Untick to hide a section from this property's brochure.
              </div>
              {SECTIONS.map(s => {
                const isHidden = hidden.indexOf(s.key) >= 0;
                return (
                  <label key={s.key} className="brochure-editor-toggle">
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      onChange={() => toggleSection(s.key)}
                    />
                    <div>
                      <div className="brochure-editor-toggle-label">{s.label}</div>
                      <div className="brochure-editor-toggle-help">{s.help}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* ── Live preview ── */}
          <div className="brochure-editor-preview">
            <iframe
              ref={iframeRef}
              title="Brochure preview"
              src={`/brochure.html?id=${encodeURIComponent(property.id)}&preview=1`}
            />
          </div>
        </div>

        {/* ── Photo strip (drag to reorder) ── */}
        <div className="brochure-editor-strip">
          <div className="brochure-editor-strip-header">
            <div className="brochure-editor-section-title">Photo lineup — drag to reorder</div>
            <div className="brochure-editor-section-hint">
              Drag any photo left or right to change its position. The first photo gets the big "feature" slot at the top of the gallery.
            </div>
          </div>
          {order.length === 0 ? (
            <div className="brochure-editor-empty">No gallery photos yet. Add some in the property editor.</div>
          ) : (
            <div
              className="brochure-editor-strip-row"
              onDragOver={(e) => { if (dragIndex !== null) e.preventDefault(); }}
              onDrop={onDropOnStrip}
            >
              {order.map((url, idx) => {
                const meta = imageMeta[url] || {};
                const show = getShow(url);
                const isDragging = dragIndex === idx;
                const showInsertBefore = dropIndex === idx && dragIndex !== null && dragIndex !== idx && dragIndex !== idx - 1;
                const showInsertAfter  = dropIndex === idx + 1 && dragIndex !== null && dragIndex !== idx && dragIndex !== idx + 1 && idx === order.length - 1;
                return (
                  <div key={url} className="brochure-editor-strip-slot">
                    {showInsertBefore && <div className="brochure-editor-strip-marker" />}
                    <div
                      className={`brochure-editor-thumb ${idx === 0 ? 'is-feature' : ''} ${!show ? 'is-hidden' : ''} ${isDragging ? 'is-dragging' : ''}`}
                      draggable
                      onDragStart={(e) => onDragStart(idx, e)}
                      onDragEnd={onDragEnd}
                      onDragOver={(e) => onDragOverThumb(idx, e)}
                    >
                      <div className="brochure-editor-thumb-pos">{idx + 1}</div>
                      <img src={url} alt={`Photo ${idx + 1}`} loading="lazy" draggable={false} />
                      {idx === 0 && show && <div className="brochure-editor-thumb-badge">FEATURE</div>}
                      {!show && <div className="brochure-editor-thumb-overlay">Excluded</div>}
                      {meta.caption && (
                        <div className="brochure-editor-thumb-caption" title={meta.caption}>{meta.caption}</div>
                      )}
                      <button
                        className={`brochure-editor-thumb-toggle ${show ? 'is-on' : 'is-off'}`}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleInclude(url); }}
                        title={show ? 'Click to exclude from brochure' : 'Click to include in brochure'}
                      >
                        {show ? '✓ Included' : '+ Include'}
                      </button>
                    </div>
                    {showInsertAfter && <div className="brochure-editor-strip-marker" />}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Post-save confirmation. Backdrop is no longer click-to-close —
            the only way out is via the three explicit buttons. ── */}
        {savedConfirm && (
          <div className="brochure-editor-saved-overlay">
            <div className="brochure-editor-saved-card">
              <div className="brochure-editor-saved-check">✓</div>
              <div className="brochure-editor-saved-title">Brochure saved</div>
              <div className="brochure-editor-saved-sub">
                The updated brochure is live at the share link below. What would you like to do next?
              </div>
              <div className="brochure-editor-saved-url" title={shareUrl}>{shareUrl}</div>
              <div className="brochure-editor-saved-actions">
                <button className="btn btn-primary" onClick={handleCopyLink}>
                  {linkCopied ? '✓ Link copied' : 'Copy share link'}
                </button>
                <a
                  className="btn btn-ghost"
                  href={shareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in new tab
                </a>
                <button className="btn btn-ghost" onClick={onClose}>
                  Back to properties
                </button>
              </div>
              <button
                className="brochure-editor-saved-keep"
                onClick={() => setSavedConfirm(false)}
              >
                Keep editing
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function arraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
