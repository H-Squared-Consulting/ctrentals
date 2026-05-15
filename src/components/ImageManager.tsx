/* eslint-disable */
// @ts-nocheck
/**
 * ImageManager — Upload, manage, and select property images
 */

import { useState, useEffect, useRef } from 'react';

const BUCKET = 'property-images';
const MAX_DIM = 1920;        // long-edge pixel cap for on-upload compression
const JPEG_QUALITY = 0.82;   // visually lossless-ish for photos
const GRID_INITIAL = 12;     // thumbs shown before "Show all" is tapped

// Resize a File in the browser via <canvas> so uploads are small enough for
// the admin UI to actually render. Leaves non-raster files untouched.
async function compressImageFile(file) {
  try {
    if (!file.type.startsWith('image/')) return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    // If the image is already small enough, skip the re-encode.
    if (scale === 1 && file.size < 600_000) return file;

    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise((res) =>
      canvas.toBlob((b) => res(b), 'image/jpeg', JPEG_QUALITY)
    );
    if (!blob) return file;
    // Rewrite extension to .jpg since we just encoded as JPEG.
    const baseName = file.name.replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch (err) {
    console.warn('[ImageManager] compress failed, uploading original:', err);
    return file;
  }
}

export default function ImageManager({ propertyId, heroImage, galleryImages, imageMetadata, onHeroChange, onGalleryChange, onImageMetadataChange, supabase }) {
  // Master list of all image URLs — initialized once from props, then managed internally
  const [allImages, setAllImages] = useState(() => {
    const set = new Set();
    if (heroImage) set.add(heroImage);
    if (galleryImages) galleryImages.forEach(u => set.add(u));
    return Array.from(set);
  });
  const [currentHero, setCurrentHero] = useState(heroImage || null);
  // Per-image metadata: { [url]: { caption, show_in_brochure } }.
  // Missing entry == { caption: '', show_in_brochure: true }, so old rows
  // with a NULL/empty image_metadata behave exactly like before.
  const [metadata, setMetadata] = useState(() =>
    imageMetadata && typeof imageMetadata === 'object' ? { ...imageMetadata } : {}
  );
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadCounter, setUploadCounter] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [dragOver, setDragOver] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const fileRef = useRef(null);

  // Push changes up to parent whenever hero or allImages changes
  function syncToParent(hero, images, meta) {
    onHeroChange(hero || '');
    onGalleryChange(images.filter(u => u !== hero));
    if (onImageMetadataChange) onImageMetadataChange(meta ?? metadata);
  }

  function getMeta(url) {
    const m = metadata[url];
    return {
      caption: (m && typeof m.caption === 'string') ? m.caption : '',
      show_in_brochure: !m || m.show_in_brochure !== false, // default true
    };
  }

  function updateMeta(url, patch) {
    setMetadata((prev) => {
      const current = prev[url] || { caption: '', show_in_brochure: true };
      const next = { ...prev, [url]: { ...current, ...patch } };
      // Push to parent so it lands in the form payload on save.
      if (onImageMetadataChange) onImageMetadataChange(next);
      return next;
    });
  }

  function getPublicUrl(path) {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl || '';
  }

  async function uploadFiles(fileList) {
    // Snapshot the FileList into a stable array up front — the input's
    // FileList is live and can be yanked out from under the loop.
    const files = Array.from(fileList || []);
    console.log('[ImageManager] uploadFiles called with', files.length, 'file(s):',
      files.map((f) => `${f.name} (${f.type || 'no-type'}, ${f.size}B)`));
    if (files.length === 0) return;

    setUploading(true);
    setUploadProgress(0);
    setUploadCounter({ done: 0, total: files.length });

    const folder = propertyId || 'temp-' + Date.now();
    const newUrls = [];
    const failures = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // Tell the UI we're STARTING file i+1 of N before we await, so the
        // "2 of 4" label paints during the slow network call, not after.
        setUploadCounter({ done: i + 1, total: files.length });
        console.log(`[ImageManager] starting file ${i + 1}/${files.length}: ${file.name}`);

        // Per-file try/catch — one bad file must never abort the whole batch.
        try {
          if (!file.type || !file.type.startsWith('image/')) {
            failures.push(`${file.name}: not an image (type "${file.type || 'unknown'}")`);
          } else {
            // Resize/re-encode client-side BEFORE upload so the grid isn't
            // forced to decode 20 MB originals later.
            const compressed = await compressImageFile(file);
            const ext = (compressed.name.split('.').pop() || 'jpg').toLowerCase();
            const unique =
              (typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
            const fileName = `${folder}/${unique}.${ext}`;

            const { error } = await supabase.storage.from(BUCKET).upload(fileName, compressed, {
              cacheControl: '31536000',
              upsert: false,
              contentType: compressed.type,
            });

            if (error) {
              console.error(`Upload error for ${file.name}:`, error.message);
              failures.push(`${file.name}: ${error.message}`);
            } else {
              newUrls.push(getPublicUrl(fileName));
            }
          }
        } catch (fileErr) {
          console.error(`Upload threw for ${file.name}:`, fileErr);
          failures.push(`${file.name}: ${fileErr?.message || fileErr}`);
        }

        // Tick the progress bar once this file resolves.
        setUploadProgress(Math.round(((i + 1) / files.length) * 100));
        console.log(`[ImageManager] finished file ${i + 1}/${files.length}`);
      }
      console.log(`[ImageManager] loop done. Uploaded ${newUrls.length}/${files.length}. Failures:`, failures);

      if (newUrls.length > 0) {
        const updated = [...allImages, ...newUrls];
        const hero = currentHero || newUrls[0];
        setAllImages(updated);
        setCurrentHero(hero);
        syncToParent(hero, updated, metadata);
      }

      if (failures.length > 0) {
        alert(
          `${newUrls.length} of ${files.length} image${files.length === 1 ? '' : 's'} uploaded.\n\n` +
          `Failed:\n• ${failures.join('\n• ')}`
        );
      }
    } finally {
      // Always unlock the UI — even if something unexpected happened above.
      setUploading(false);
      setUploadProgress(0);
      setUploadCounter({ done: 0, total: 0 });
    }
  }

  async function handleFileSelect(e) {
    // Snapshot first; only clear the input AFTER uploadFiles has returned,
    // so the live FileList isn't yanked out from under the upload loop.
    const picked = e.target.files;
    await uploadFiles(picked);
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    uploadFiles(e.dataTransfer.files);
  }

  function setAsHero(url) {
    setCurrentHero(url);
    syncToParent(url, allImages, metadata);
  }

  function removeImage(url) {
    const updated = allImages.filter(u => u !== url);
    setAllImages(updated);

    // Drop the metadata entry so dead caption strings don't ride along.
    const nextMeta = { ...metadata };
    delete nextMeta[url];
    setMetadata(nextMeta);

    let hero = currentHero;
    if (url === currentHero) {
      hero = updated.length > 0 ? updated[0] : null;
      setCurrentHero(hero);
    }
    syncToParent(hero, updated, nextMeta);
  }

  return (
    <div className="img-manager">
      {/* Hero preview */}
      <div className="img-manager-hero">
        <div className="img-manager-label">Hero Image (Cover Photo)</div>
        {currentHero ? (
          <div className="img-hero-preview">
            <img src={currentHero} alt="Hero" loading="lazy" decoding="async" />
            <div className="img-hero-overlay">
              <span className="img-hero-badge">HERO</span>
            </div>
          </div>
        ) : (
          <div className="img-hero-empty">No hero image selected. Upload images below.</div>
        )}
      </div>

      {/* Upload area */}
      <div
        className={`img-upload-zone ${dragOver ? 'img-upload-zone--active' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
      >
        {uploading ? (
          <div className="img-upload-progress">
            <div className="img-upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
            <span>
              {uploadCounter.total > 1
                ? `Uploading ${uploadCounter.done} of ${uploadCounter.total}... ${uploadProgress}%`
                : `Uploading... ${uploadProgress}%`}
            </span>
          </div>
        ) : (
          <>
            <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>📷</div>
            <div style={{ fontWeight: 600, fontSize: '0.8125rem' }}>Drop images here or click to upload</div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-light)' }}>
              JPG, PNG, or WebP — pick or drop multiple files at once
            </div>
          </>
        )}
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: 'none' }} onChange={handleFileSelect} />
      </div>

      {/* Image grid */}
      {allImages.length > 0 && (() => {
        // Always show the hero first, then the rest. When the gallery is large,
        // only paint the first GRID_INITIAL thumbs until the user taps "Show all"
        // — decoding 37+ multi-MB images at once locks up the modal.
        const ordered = currentHero
          ? [currentHero, ...allImages.filter((u) => u !== currentHero)]
          : allImages;
        const visible = showAll ? ordered : ordered.slice(0, GRID_INITIAL);
        const hiddenCount = ordered.length - visible.length;
        return (
          <>
            <div className="img-manager-label" style={{ marginTop: '12px' }}>
              All Images ({allImages.length}) — click an image to set as hero. Add a caption to label it on brochures and proposals. Untick "Show in brochures" to hide a photo from outputs.
            </div>
            <div className="img-grid">
              {visible.map((url, i) => {
                const isHero = url === currentHero;
                const m = getMeta(url);
                return (
                  <div key={url} className={`img-grid-card ${isHero ? 'img-grid-card--hero' : ''}`}>
                    <div className={`img-grid-item ${isHero ? 'img-grid-item--hero' : ''}`}>
                      <img
                        src={url}
                        alt={`Image ${i + 1}`}
                        loading="lazy"
                        decoding="async"
                        onClick={() => setAsHero(url)}
                      />
                      {isHero && <span className="img-grid-badge">HERO</span>}
                      <button className="img-grid-remove" onClick={(e) => { e.stopPropagation(); removeImage(url); }} title="Remove">✕</button>
                    </div>
                    <div className="img-grid-meta">
                      <input
                        type="text"
                        className="form-input img-grid-caption"
                        placeholder="Add a caption (e.g. Master bedroom)"
                        value={m.caption}
                        onChange={(e) => updateMeta(url, { caption: e.target.value })}
                      />
                      {isHero ? (
                        <div className="img-grid-hero-note">Always shown in brochures</div>
                      ) : (
                        <label className="img-grid-toggle">
                          <input
                            type="checkbox"
                            checked={m.show_in_brochure}
                            onChange={(e) => updateMeta(url, { show_in_brochure: e.target.checked })}
                          />
                          <span>Show in brochures</span>
                        </label>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {hiddenCount > 0 && (
              <button
                className="btn btn-ghost"
                style={{ marginTop: '8px', fontSize: '0.8125rem' }}
                onClick={() => setShowAll(true)}
              >
                Show all {ordered.length} images ({hiddenCount} hidden)
              </button>
            )}
            {showAll && ordered.length > GRID_INITIAL && (
              <button
                className="btn btn-ghost"
                style={{ marginTop: '8px', fontSize: '0.8125rem' }}
                onClick={() => setShowAll(false)}
              >
                Collapse to first {GRID_INITIAL}
              </button>
            )}
          </>
        );
      })()}
    </div>
  );
}
