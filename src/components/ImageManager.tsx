/* eslint-disable */
// @ts-nocheck
/**
 * ImageManager — Upload, manage, and select property images
 */

import { useState, useEffect, useRef } from 'react';

const BUCKET = 'property-images';

export default function ImageManager({ propertyId, heroImage, galleryImages, onHeroChange, onGalleryChange, supabase }) {
  // Master list of all image URLs — initialized once from props, then managed internally
  const [allImages, setAllImages] = useState(() => {
    const set = new Set();
    if (heroImage) set.add(heroImage);
    if (galleryImages) galleryImages.forEach(u => set.add(u));
    return Array.from(set);
  });
  const [currentHero, setCurrentHero] = useState(heroImage || null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  // Push changes up to parent whenever hero or allImages changes
  function syncToParent(hero, images) {
    onHeroChange(hero || '');
    onGalleryChange(images.filter(u => u !== hero));
  }

  function getPublicUrl(path) {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl || '';
  }

  async function uploadFiles(files) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadProgress(0);

    const folder = propertyId || 'temp-' + Date.now();
    const newUrls = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;

      const ext = file.name.split('.').pop() || 'jpg';
      const fileName = `${folder}/${Date.now()}-${i}.${ext}`;

      const { error } = await supabase.storage.from(BUCKET).upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
      });

      if (!error) {
        newUrls.push(getPublicUrl(fileName));
      } else {
        console.error('Upload error:', error.message);
      }
      setUploadProgress(Math.round(((i + 1) / files.length) * 100));
    }

    if (newUrls.length > 0) {
      const updated = [...allImages, ...newUrls];
      const hero = currentHero || newUrls[0];
      setAllImages(updated);
      setCurrentHero(hero);
      syncToParent(hero, updated);
    }

    setUploading(false);
    setUploadProgress(0);
  }

  function handleFileSelect(e) {
    uploadFiles(e.target.files);
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    uploadFiles(e.dataTransfer.files);
  }

  function setAsHero(url) {
    setCurrentHero(url);
    syncToParent(url, allImages);
  }

  function removeImage(url) {
    const updated = allImages.filter(u => u !== url);
    setAllImages(updated);

    let hero = currentHero;
    if (url === currentHero) {
      hero = updated.length > 0 ? updated[0] : null;
      setCurrentHero(hero);
    }
    syncToParent(hero, updated);
  }

  return (
    <div className="img-manager">
      {/* Hero preview */}
      <div className="img-manager-hero">
        <div className="img-manager-label">Hero Image (Cover Photo)</div>
        {currentHero ? (
          <div className="img-hero-preview">
            <img src={currentHero} alt="Hero" />
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
            <span>Uploading... {uploadProgress}%</span>
          </div>
        ) : (
          <>
            <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>📷</div>
            <div style={{ fontWeight: 600, fontSize: '0.8125rem' }}>Drop images here or click to upload</div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-light)' }}>JPG, PNG, or WebP</div>
          </>
        )}
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: 'none' }} onChange={handleFileSelect} />
      </div>

      {/* Image grid */}
      {allImages.length > 0 && (
        <>
          <div className="img-manager-label" style={{ marginTop: '12px' }}>
            All Images ({allImages.length}) — click to set as hero
          </div>
          <div className="img-grid">
            {allImages.map((url, i) => {
              const isHero = url === currentHero;
              return (
                <div key={url} className={`img-grid-item ${isHero ? 'img-grid-item--hero' : ''}`}>
                  <img src={url} alt={`Image ${i + 1}`} onClick={() => setAsHero(url)} />
                  {isHero && <span className="img-grid-badge">HERO</span>}
                  <button className="img-grid-remove" onClick={(e) => { e.stopPropagation(); removeImage(url); }} title="Remove">✕</button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
