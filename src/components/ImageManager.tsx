/* eslint-disable */
// @ts-nocheck
/**
 * ImageManager — Upload, manage, and select property images
 *
 * Props:
 *   propertyId: string (used as folder name in storage)
 *   heroImage: string | null (current hero URL)
 *   galleryImages: string[] (current gallery URLs)
 *   onHeroChange: (url: string | null) => void
 *   onGalleryChange: (urls: string[]) => void
 *   supabase: SupabaseClient
 */

import { useState, useEffect, useRef } from 'react';

const BUCKET = 'property-images';

export default function ImageManager({ propertyId, heroImage, galleryImages, onHeroChange, onGalleryChange, supabase }) {
  const [allImages, setAllImages] = useState([]);  // All URLs (hero + gallery + uploaded)
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  // Combine hero + gallery into one list, deduped
  useEffect(() => {
    const combined = new Set();
    if (heroImage) combined.add(heroImage);
    if (galleryImages) galleryImages.forEach(u => combined.add(u));
    setAllImages(Array.from(combined));
  }, [heroImage, galleryImages]);

  // Get public URL for a storage path
  function getPublicUrl(path) {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl || '';
  }

  // Upload files
  async function uploadFiles(files) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadProgress(0);

    const folder = propertyId || 'temp-' + Date.now();
    const newUrls = [];
    const total = files.length;

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
        const url = getPublicUrl(fileName);
        newUrls.push(url);
      } else {
        console.error('Upload error:', error.message);
      }

      setUploadProgress(Math.round(((i + 1) / total) * 100));
    }

    if (newUrls.length > 0) {
      const updated = [...allImages, ...newUrls];
      setAllImages(updated);

      // If no hero set, use the first uploaded image
      if (!heroImage && newUrls.length > 0) {
        onHeroChange(newUrls[0]);
      }

      // Update gallery (all images except hero)
      const currentHero = heroImage || newUrls[0];
      onGalleryChange(updated.filter(u => u !== currentHero));
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
    const oldHero = heroImage;
    onHeroChange(url);
    // Update gallery: remove new hero, add old hero back if it exists
    const newGallery = allImages.filter(u => u !== url);
    if (oldHero && oldHero !== url && !newGallery.includes(oldHero)) {
      newGallery.push(oldHero);
    }
    onGalleryChange(newGallery.filter(u => u !== url));
  }

  function removeImage(url) {
    const updated = allImages.filter(u => u !== url);
    setAllImages(updated);

    if (url === heroImage) {
      // Hero removed — promote first gallery image
      const newHero = updated.length > 0 ? updated[0] : null;
      onHeroChange(newHero);
      onGalleryChange(updated.filter(u => u !== newHero));
    } else {
      onGalleryChange(updated.filter(u => u !== heroImage));
    }
  }

  return (
    <div className="img-manager">
      {/* Hero preview */}
      <div className="img-manager-hero">
        <div className="img-manager-label">Hero Image (Cover Photo)</div>
        {heroImage ? (
          <div className="img-hero-preview">
            <img src={heroImage} alt="Hero" />
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
              const isHero = url === heroImage;
              return (
                <div key={i} className={`img-grid-item ${isHero ? 'img-grid-item--hero' : ''}`}>
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
