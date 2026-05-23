/* eslint-disable */
// @ts-nocheck
/**
 * GallerySectionsEditor — section-grouped photo management.
 *
 * Replaces the previous flat ImageManager. Photos are organised into
 * collapsible sections (Living Area, Master Bedroom, etc.). Per-photo
 * controls: star = hero (one per property), eye = visible in brochure,
 * pencil = caption, bin = delete. Drag a photo within a section to
 * reorder, drag across sections to re-group, drag onto the upload zone
 * to add new ones. Renaming a section is an inline edit on its title;
 * deleting a section moves its photos into Unsorted so nothing is ever
 * lost by accident.
 *
 * Single source of truth on the partner_properties.gallery_sections
 * jsonb column. The parent component derives hero_image_url /
 * gallery_images / image_metadata from this structure on save so the
 * existing brochure and public-website readers keep working.
 */
import { useEffect, useRef, useState } from 'react';
import { useToast } from './ToastProvider';

const BUCKET = 'property-images';
const MAX_DIM = 1920;
const JPEG_QUALITY = 0.82;

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function compressImageFile(file) {
  try {
    if (!file.type || !file.type.startsWith('image/')) return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 600_000) return file;
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', JPEG_QUALITY));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export default function GallerySectionsEditor({ propertyId, sections, onChange, supabase, viewOnly = false }) {
  const toast = useToast();
  // Local state mirrors the canonical sections array. Every mutation
  // produces a new array and bubbles up via onChange so the parent's
  // form state can flush derived columns on save.
  const [draft, setDraft] = useState(() => normaliseSections(sections));
  const [collapsed, setCollapsed] = useState({}); // sectionId -> bool
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [editingCaption, setEditingCaption] = useState(null); // photoId
  const [captionDraft, setCaptionDraft] = useState('');
  const [uploadingTo, setUploadingTo] = useState(null); // sectionId | null
  const [uploadCounter, setUploadCounter] = useState({ done: 0, total: 0 });
  const [drag, setDrag] = useState(null); // { sectionId, photoId } | null
  const [dropTarget, setDropTarget] = useState(null); // sectionId | null

  useEffect(() => {
    // If the parent re-loads the property (e.g. after a fresh fetch),
    // sync the draft. Don't override mid-edit.
    if (renamingId || editingCaption || drag) return;
    setDraft(normaliseSections(sections));
  }, [sections]);

  function commit(next) {
    setDraft(next);
    onChange(next);
  }

  // ── Section mutators ─────────────────────────────────────────────
  function addSection() {
    // Prepend so the new section is immediately visible at the top of the
    // list (a property like Villa Kilimani has 100+ photos under an
    // existing section, and appending would bury the new section below
    // the fold). Also drop the user straight into rename mode and scroll
    // to it so it's obvious *which* section was just created.
    const id = uuid();
    const next = [{ id, name: '', sort_order: 0, photos: [] }, ...draft];
    commit(reindex(next));
    setRenamingId(id);
    setRenameValue('');
    // Defer the scroll until React has painted the new node.
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-section-id="${id}"]`);
      if (el && 'scrollIntoView' in el) (el as HTMLElement).scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }

  function renameSection(id, name) {
    // Empty stays empty — the editor renders the placeholder so the user
    // is reminded to name it. Don't silently rename to "Untitled".
    const trimmed = name.trim();
    commit(draft.map(s => s.id === id ? { ...s, name: trimmed } : s));
  }

  function deleteSection(id) {
    const target = draft.find(s => s.id === id);
    if (!target) return;
    if (target.photos.length > 0) {
      const label = target.name || 'this section';
      const ok = confirm(`Delete "${label}" and its ${target.photos.length} photo${target.photos.length === 1 ? '' : 's'}? This cannot be undone.`);
      if (!ok) return;
    }
    const next = draft.filter(s => s.id !== id);
    commit(reindex(next));
  }

  function moveSection(id, dir) {
    const idx = draft.findIndex(s => s.id === id);
    if (idx < 0) return;
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= draft.length) return;
    const next = draft.slice();
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    commit(reindex(next));
  }

  // ── Photo mutators ───────────────────────────────────────────────
  function setHero(photoId) {
    commit(draft.map(s => ({
      ...s,
      photos: s.photos.map(p => ({ ...p, is_hero: p.id === photoId })),
    })));
  }

  function toggleVisible(photoId) {
    commit(draft.map(s => ({
      ...s,
      photos: s.photos.map(p => p.id === photoId ? { ...p, is_visible: !p.is_visible } : p),
    })));
  }

  function setCaption(photoId, caption) {
    commit(draft.map(s => ({
      ...s,
      photos: s.photos.map(p => p.id === photoId ? { ...p, caption: caption.trim() } : p),
    })));
  }

  function deletePhoto(photoId) {
    if (!confirm('Delete this photo? This cannot be undone.')) return;
    commit(draft.map(s => ({
      ...s,
      photos: s.photos.filter(p => p.id !== photoId),
    })));
  }

  // ── Drag and drop ────────────────────────────────────────────────
  function onDragStartPhoto(sectionId, photoId, e) {
    setDrag({ sectionId, photoId });
    try { e.dataTransfer.setData('text/plain', photoId); } catch {}
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragEndPhoto() {
    setDrag(null);
    setDropTarget(null);
  }

  function onDragOverPhoto(sectionId, photoId, e) {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (drag.sectionId === sectionId && drag.photoId === photoId) return;
    // Determine insertion side (before/after the target photo) by mouse X.
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;
    moveDraggedTo(sectionId, photoId, after ? 'after' : 'before');
  }

  function onDragOverSection(sectionId, e) {
    if (!drag) return;
    e.preventDefault();
    setDropTarget(sectionId);
    // If the target section is empty, just put the dragged photo there.
    const tgt = draft.find(s => s.id === sectionId);
    if (tgt && tgt.photos.length === 0) {
      moveDraggedTo(sectionId, null, 'end');
    }
  }

  function moveDraggedTo(targetSectionId, targetPhotoId, where) {
    if (!drag) return;
    let movingPhoto = null;
    let nextSections = draft.map(s => {
      if (s.id !== drag.sectionId) return s;
      const idx = s.photos.findIndex(p => p.id === drag.photoId);
      if (idx < 0) return s;
      movingPhoto = s.photos[idx];
      const photos = s.photos.slice();
      photos.splice(idx, 1);
      return { ...s, photos };
    });
    if (!movingPhoto) return;
    nextSections = nextSections.map(s => {
      if (s.id !== targetSectionId) return s;
      const photos = s.photos.slice();
      if (where === 'end' || targetPhotoId === null) {
        photos.push(movingPhoto);
      } else {
        const idx = photos.findIndex(p => p.id === targetPhotoId);
        const insertAt = where === 'after' ? idx + 1 : idx;
        photos.splice(insertAt, 0, movingPhoto);
      }
      return { ...s, photos };
    });
    setDraft(reindexPhotos(nextSections));
    setDrag({ ...drag, sectionId: targetSectionId });
  }

  function onDropSection() {
    // Commit the in-progress drag (draft is already updated during dragover).
    commit(reindexPhotos(draft));
    setDrag(null);
    setDropTarget(null);
  }

  // ── Upload ───────────────────────────────────────────────────────
  async function handleFiles(sectionId, fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploadingTo(sectionId);
    setUploadCounter({ done: 0, total: files.length });
    const folder = propertyId || 'temp-' + Date.now();
    const newPhotos = [];
    const failures = [];
    try {
      for (let i = 0; i < files.length; i++) {
        setUploadCounter({ done: i + 1, total: files.length });
        const file = files[i];
        try {
          if (!file.type || !file.type.startsWith('image/')) {
            failures.push(`${file.name}: not an image`);
            continue;
          }
          const compressed = await compressImageFile(file);
          const ext = (compressed.name.split('.').pop() || 'jpg').toLowerCase();
          const fileName = `${folder}/${uuid()}.${ext}`;
          const { error } = await supabase.storage.from(BUCKET).upload(fileName, compressed, {
            cacheControl: '31536000',
            upsert: false,
            contentType: compressed.type,
          });
          if (error) {
            failures.push(`${file.name}: ${error.message}`);
            continue;
          }
          const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
          if (data?.publicUrl) {
            newPhotos.push({
              id: uuid(),
              url: data.publicUrl,
              caption: '',
              is_hero: false,
              is_visible: true,
              sort_order: 0,
            });
          }
        } catch (err) {
          failures.push(`${file.name}: ${err?.message || err}`);
        }
      }
      if (newPhotos.length > 0) {
        // Append new photos to the target section. If there's no hero
        // anywhere yet, promote the first uploaded photo to hero so the
        // brochure has something to put at the top.
        const heroExists = draft.some(s => s.photos.some(p => p.is_hero));
        if (!heroExists) newPhotos[0].is_hero = true;
        const next = draft.map(s =>
          s.id === sectionId ? { ...s, photos: [...s.photos, ...newPhotos] } : s
        );
        commit(reindexPhotos(next));
      }
      if (failures.length > 0) {
        toast.warning(`${newPhotos.length} of ${files.length} uploaded. ${failures.length} failed.`);
        // Detail in the console — toast keeps the top-line short.
        console.warn('[GallerySectionsEditor] upload failures:', failures);
      } else if (newPhotos.length > 0) {
        toast.success(`Uploaded ${newPhotos.length} photo${newPhotos.length === 1 ? '' : 's'}.`);
      }
    } finally {
      setUploadingTo(null);
      setUploadCounter({ done: 0, total: 0 });
    }
  }

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="gse">
      <div className="gse-toolbar">
        <button type="button" className="btn btn-ghost" onClick={addSection}>+ Add section</button>
        <div className="gse-toolbar-hint">
          Star a photo to make it the cover. Drag photos to reorder or move them between sections.
        </div>
      </div>

      {draft.length === 0 ? (
        <div className="gse-empty">
          <div style={{ fontSize: '1.5rem', marginBottom: 6 }}>📂</div>
          No photo sections yet. Click <strong>+ Add section</strong> above to create your first one (e.g. "Living area" or "Bedrooms"). Photos are uploaded into the section you create.
        </div>
      ) : (
        draft.map((section, sIdx) => {
          const isCollapsed = !!collapsed[section.id];
          const isDropTarget = dropTarget === section.id;
          return (
            <div
              key={section.id}
              data-section-id={section.id}
              className={`gse-section ${isDropTarget ? 'is-droptarget' : ''}`}
              // Drop targets only active when editing. View mode shows the
              // photos but doesn't accept incoming drags.
              onDragOver={viewOnly ? undefined : (e) => onDragOverSection(section.id, e)}
              onDrop={viewOnly ? undefined : onDropSection}
            >
              <div className="gse-section-header">
                <button
                  type="button"
                  className="gse-section-toggle"
                  onClick={() => setCollapsed(prev => ({ ...prev, [section.id]: !isCollapsed }))}
                  title={isCollapsed ? 'Expand' : 'Collapse'}
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
                {renamingId === section.id ? (
                  <input
                    autoFocus
                    type="text"
                    className="gse-section-name-input"
                    placeholder="Name this section, e.g. Master bedroom"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => { renameSection(section.id, renameValue); setRenamingId(null); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { renameSection(section.id, renameValue); setRenamingId(null); }
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={`gse-section-name ${!section.name ? 'is-placeholder' : ''}`}
                    onClick={() => { setRenamingId(section.id); setRenameValue(section.name); }}
                    title="Click to rename"
                  >
                    {section.name || 'Untitled section — click to name'}
                  </button>
                )}
                <span className="gse-section-count">{section.photos.length} {section.photos.length === 1 ? 'photo' : 'photos'}</span>
                <div className="gse-section-actions">
                  <button type="button" className="gse-iconbtn" onClick={() => moveSection(section.id, 'up')} disabled={sIdx === 0} title="Move section up">↑</button>
                  <button type="button" className="gse-iconbtn" onClick={() => moveSection(section.id, 'down')} disabled={sIdx === draft.length - 1} title="Move section down">↓</button>
                  <button type="button" className="gse-iconbtn gse-iconbtn--danger" onClick={() => deleteSection(section.id)} title="Delete section">🗑</button>
                </div>
              </div>

              {!isCollapsed && (
                <>
                  {section.photos.length === 0 ? (
                    <div className="gse-section-empty">
                      Empty section. Drag photos here or use the upload zone below.
                    </div>
                  ) : (
                    <div className="gse-photo-grid">
                      {section.photos.map(photo => (
                        <PhotoTile
                          key={photo.id}
                          photo={photo}
                          viewOnly={viewOnly}
                          isDragging={drag && drag.photoId === photo.id}
                          editingCaption={editingCaption === photo.id}
                          captionDraft={captionDraft}
                          onCaptionDraft={setCaptionDraft}
                          onEditCaption={() => { setEditingCaption(photo.id); setCaptionDraft(photo.caption || ''); }}
                          onCommitCaption={() => { setCaption(photo.id, captionDraft); setEditingCaption(null); }}
                          onCancelCaption={() => setEditingCaption(null)}
                          onSetHero={() => setHero(photo.id)}
                          onToggleVisible={() => toggleVisible(photo.id)}
                          onDelete={() => deletePhoto(photo.id)}
                          onDragStart={(e) => onDragStartPhoto(section.id, photo.id, e)}
                          onDragEnd={onDragEndPhoto}
                          onDragOver={(e) => onDragOverPhoto(section.id, photo.id, e)}
                        />
                      ))}
                    </div>
                  )}
                  {/* Upload affordance is for adding photos — has no role
                      in view mode, hide the whole zone rather than disabling
                      it visually. */}
                  {!viewOnly && (
                  <UploadZone
                    sectionId={section.id}
                    isUploading={uploadingTo === section.id}
                    counter={uploadCounter}
                    onFiles={(files) => handleFiles(section.id, files)}
                  />
                  )}
                </>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function PhotoTile({
  photo, viewOnly, isDragging, editingCaption, captionDraft,
  onCaptionDraft, onEditCaption, onCommitCaption, onCancelCaption,
  onSetHero, onToggleVisible, onDelete,
  onDragStart, onDragEnd, onDragOver,
}) {
  return (
    <div
      className={`gse-photo ${photo.is_hero ? 'is-hero' : ''} ${!photo.is_visible ? 'is-hidden' : ''} ${isDragging ? 'is-dragging' : ''}`}
      // View mode: tiles are non-draggable. Per-photo control buttons
      // (star / eye / pencil / bin) are already disabled by the
      // <fieldset disabled> wrapper in PropertyEditModal.
      draggable={!editingCaption && !viewOnly}
      onDragStart={viewOnly ? undefined : onDragStart}
      onDragEnd={viewOnly ? undefined : onDragEnd}
      onDragOver={viewOnly ? undefined : onDragOver}
    >
      <img src={photo.url} alt="" loading="lazy" draggable={false} />
      <div className="gse-photo-overlay">
        <button type="button" className={`gse-photo-btn ${photo.is_hero ? 'is-on' : ''}`} onClick={onSetHero} title={photo.is_hero ? 'Cover photo' : 'Set as cover photo'}>★</button>
        <button type="button" className={`gse-photo-btn ${photo.is_visible ? '' : 'is-off'}`} onClick={onToggleVisible} title={photo.is_visible ? 'Visible on brochure' : 'Hidden from brochure'}>{photo.is_visible ? '👁' : '🚫'}</button>
        <button type="button" className="gse-photo-btn" onClick={onEditCaption} title="Edit caption">✏️</button>
        <button type="button" className="gse-photo-btn gse-photo-btn--danger" onClick={onDelete} title="Delete photo">🗑</button>
      </div>
      {photo.is_hero && <div className="gse-photo-badge">COVER</div>}
      {!photo.is_visible && <div className="gse-photo-banner">HIDDEN</div>}
      {editingCaption ? (
        <div className="gse-photo-caption-edit">
          <input
            autoFocus
            type="text"
            className="form-input"
            value={captionDraft}
            onChange={(e) => onCaptionDraft(e.target.value)}
            placeholder="e.g. Master bedroom"
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitCaption();
              if (e.key === 'Escape') onCancelCaption();
            }}
            onBlur={onCommitCaption}
          />
        </div>
      ) : photo.caption ? (
        <div className="gse-photo-caption" title={photo.caption}>{photo.caption}</div>
      ) : null}
    </div>
  );
}

function UploadZone({ sectionId, isUploading, counter, onFiles }) {
  const fileRef = useRef(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`gse-upload ${over ? 'is-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}
      onClick={() => fileRef.current?.click()}
    >
      {isUploading ? (
        <div>Uploading {counter.done} of {counter.total}…</div>
      ) : (
        <div>
          <div style={{ fontSize: '1.25rem', marginBottom: 2 }}>📷</div>
          <div style={{ fontWeight: 600, fontSize: '0.8125rem' }}>Drop photos here or click to upload</div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-light)' }}>JPG, PNG, or WebP</div>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { onFiles(e.target.files); if (fileRef.current) fileRef.current.value = ''; }}
      />
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────
function normaliseSections(input) {
  if (!Array.isArray(input)) return [];
  return input.map((s, i) => ({
    id: s.id || uuid(),
    // Treat legacy "Unsorted" buckets (created by the backfill) as
    // unnamed so the editor prompts the user to name them rather than
    // implying we picked the name.
    name: typeof s.name === 'string' && s.name.trim().toLowerCase() !== 'unsorted' ? s.name : '',
    sort_order: typeof s.sort_order === 'number' ? s.sort_order : i,
    photos: Array.isArray(s.photos) ? s.photos.map((p, j) => ({
      id: p.id || uuid(),
      url: p.url || '',
      caption: p.caption || '',
      is_hero: !!p.is_hero,
      is_visible: p.is_visible !== false,
      sort_order: typeof p.sort_order === 'number' ? p.sort_order : j,
    })).filter(p => p.url) : [],
  }));
}

function reindex(sections) {
  return sections.map((s, i) => ({ ...s, sort_order: i }));
}

function reindexPhotos(sections) {
  return sections.map((s, i) => ({
    ...s,
    sort_order: i,
    photos: s.photos.map((p, j) => ({ ...p, sort_order: j })),
  }));
}

/**
 * Derive the flat columns the existing brochure / proposal / website
 * readers expect from a gallery_sections array. The parent component
 * should call this and include the result in its save payload alongside
 * gallery_sections itself so legacy readers keep rendering correctly.
 */
export function deriveFlatColumns(sections) {
  const flat = [];
  for (const s of (sections || [])) {
    for (const p of (s.photos || [])) {
      flat.push({ ...p, _section: s.name });
    }
  }
  const hero = flat.find(p => p.is_hero);
  const gallery = flat.filter(p => !p.is_hero).map(p => p.url);
  const imageMetadata = {};
  for (const p of flat) {
    if (p.is_hero) continue;
    const entry = {};
    if (p.caption) entry.caption = p.caption;
    if (p.is_visible === false) entry.show_in_brochure = false;
    if (Object.keys(entry).length > 0) imageMetadata[p.url] = entry;
  }
  return {
    hero_image_url: hero ? hero.url : null,
    gallery_images: gallery,
    image_metadata: imageMetadata,
  };
}
