/* eslint-disable */
// @ts-nocheck
/**
 * PropertyEditModal -- Create / edit a property
 */

import { useState } from 'react';
import ImageManager from '../components/ImageManager';
import { PROPERTY_TYPE_OPTIONS, AVAILABILITY_OPTIONS } from './constants';

export default function PropertyEditModal({ property, partnerId, onClose, onSave, supabase, user }) {
  const isNew = !property.id;

  const generateSlug = (name) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const parseAmenityTags = (tags) => {
    if (Array.isArray(tags)) return tags.join(', ');
    if (typeof tags === 'string') return tags;
    return '';
  };

  const stringifyJSON = (val) => {
    if (!val) return '';
    if (typeof val === 'string') return val;
    try { return JSON.stringify(val, null, 2); } catch { return ''; }
  };

  const [form, setForm] = useState({
    property_name: property.property_name || '',
    slug: property.slug || '',
    tagline: property.tagline || '',
    description: property.description || '',
    property_type: property.property_type || 'short_term_rental',
    address_line1: property.address_line1 || '',
    address_line2: property.address_line2 || '',
    suburb: property.suburb || '',
    city: property.city || '',
    province: property.province || '',
    postal_code: property.postal_code || '',
    bedrooms: property.bedrooms ?? '',
    bathrooms: property.bathrooms ?? '',
    sleeps: property.sleeps ?? '',
    price_from: property.price_from ?? '',
    price_currency: property.price_currency || 'ZAR',
    hero_image_url: property.hero_image_url || '',
    gallery_images: stringifyJSON(property.gallery_images),
    amenity_tags: parseAmenityTags(property.amenity_tags),
    booking_url: property.booking_url || '',
    listing_links: stringifyJSON(property.listing_links),
    contact_email: property.contact_email || '',
    contact_phone: property.contact_phone || '',
    whatsapp_number: property.whatsapp_number || '',
    external_rating: property.external_rating ?? '',
    external_rating_source: property.external_rating_source || '',
    external_review_count: property.external_review_count ?? '',
    owner_name: property.owner_name || '',
    owner_email: property.owner_email || '',
    owner_phone: property.owner_phone || '',
    is_published: property.is_published || false,
    is_featured: property.is_featured || false,
    pos_assured: property.pos_assured || false,
    sort_order: property.sort_order ?? 0,
    notes: property.notes || '',
  });

  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function handleNameChange(value) {
    const updates = { property_name: value };
    if (isNew || !form.slug) updates.slug = generateSlug(value);
    setForm({ ...form, ...updates });
  }

  function parseAmenityTagsInput(str) {
    return str.split(',').map((t) => t.trim()).filter(Boolean);
  }

  function safeParseJSON(str) {
    if (!str || !str.trim()) return null;
    try { return JSON.parse(str); } catch { return null; }
  }

  async function handleSave() {
    if (!form.property_name.trim()) { alert('Property name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        partner_id: partnerId,
        property_name: form.property_name.trim(),
        slug: form.slug.trim() || generateSlug(form.property_name),
        tagline: form.tagline.trim() || null,
        description: form.description.trim() || null,
        property_type: form.property_type || null,
        address_line1: form.address_line1.trim() || null,
        address_line2: form.address_line2.trim() || null,
        suburb: form.suburb.trim() || null,
        city: form.city.trim() || null,
        province: form.province.trim() || null,
        postal_code: form.postal_code.trim() || null,
        bedrooms: form.bedrooms !== '' ? parseInt(form.bedrooms, 10) || 0 : null,
        bathrooms: form.bathrooms !== '' ? parseInt(form.bathrooms, 10) || 0 : null,
        sleeps: form.sleeps !== '' ? parseInt(form.sleeps, 10) || 0 : null,
        price_from: form.price_from !== '' ? parseFloat(form.price_from) || null : null,
        price_currency: form.price_currency || 'ZAR',
        hero_image_url: form.hero_image_url.trim() || null,
        gallery_images: safeParseJSON(form.gallery_images),
        amenity_tags: parseAmenityTagsInput(form.amenity_tags),
        booking_url: form.booking_url.trim() || null,
        listing_links: safeParseJSON(form.listing_links),
        contact_email: form.contact_email.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        whatsapp_number: form.whatsapp_number.trim() || null,
        external_rating: form.external_rating !== '' ? parseFloat(form.external_rating) || null : null,
        external_rating_source: form.external_rating_source.trim() || null,
        external_review_count: form.external_review_count !== '' ? parseInt(form.external_review_count, 10) || null : null,
        owner_name: form.owner_name.trim() || null,
        owner_email: form.owner_email.trim() || null,
        owner_phone: form.owner_phone.trim() || null,
        is_published: form.is_published,
        is_featured: form.is_featured,
        pos_assured: form.pos_assured,
        sort_order: parseInt(form.sort_order, 10) || 0,
        notes: form.notes.trim() || null,
      };

      if (isNew) {
        payload.created_by = user?.id || null;
        const { error } = await supabase.from('partner_properties').insert(payload);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('partner_properties').update(payload).eq('id', property.id);
        if (error) throw error;
      }
      if (onSave) await onSave();
    } catch (err) {
      console.error('Error saving property:', err);
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const { error } = await supabase.from('partner_properties').delete().eq('id', property.id);
      if (error) throw error;
      if (onSave) await onSave();
    } catch (err) {
      console.error('Error deleting property:', err);
      alert('Failed to delete: ' + err.message);
    } finally {
      setDeleting(false);
    }
  }

  const SectionHeading = ({ children }) => (
    <h3 style={{ margin: '1.5rem 0 0.75rem', fontSize: '0.875rem', fontWeight: 600, textTransform: 'uppercase', color: '#6B7280', letterSpacing: '0.05em' }}>
      {children}
    </h3>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{isNew ? 'Add Property' : 'Edit Property'}</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          <SectionHeading>Identity</SectionHeading>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Property Name *</label>
              <input type="text" className="form-input" value={form.property_name} onChange={(e) => handleNameChange(e.target.value)} placeholder="e.g., Seaside Villa 12" />
            </div>
            <div className="form-group">
              <label className="form-label">Slug</label>
              <input type="text" className="form-input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="seaside-villa-12" />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Tagline</label>
            <input type="text" className="form-input" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="Short one-liner" />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea className="form-input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="About this property..." />
          </div>
          <div className="form-group">
            <label className="form-label">Property Type</label>
            <select className="form-input" value={form.property_type} onChange={(e) => setForm({ ...form, property_type: e.target.value })}>
              {PROPERTY_TYPE_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
            </select>
          </div>

          <SectionHeading>Location</SectionHeading>
          <div className="form-group">
            <label className="form-label">Address Line 1</label>
            <input type="text" className="form-input" value={form.address_line1} onChange={(e) => setForm({ ...form, address_line1: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Address Line 2</label>
            <input type="text" className="form-input" value={form.address_line2} onChange={(e) => setForm({ ...form, address_line2: e.target.value })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Suburb</label>
              <input type="text" className="form-input" value={form.suburb} onChange={(e) => setForm({ ...form, suburb: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">City</label>
              <input type="text" className="form-input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Province</label>
              <input type="text" className="form-input" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} />
            </div>
          </div>
          <div className="form-group" style={{ maxWidth: '200px' }}>
            <label className="form-label">Postal Code</label>
            <input type="text" className="form-input" value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} />
          </div>

          <SectionHeading>Capacity</SectionHeading>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <div className="form-group"><label className="form-label">Bedrooms</label><input type="number" className="form-input" value={form.bedrooms} onChange={(e) => setForm({ ...form, bedrooms: e.target.value })} min={0} /></div>
            <div className="form-group"><label className="form-label">Bathrooms</label><input type="number" className="form-input" value={form.bathrooms} onChange={(e) => setForm({ ...form, bathrooms: e.target.value })} min={0} /></div>
            <div className="form-group"><label className="form-label">Sleeps</label><input type="number" className="form-input" value={form.sleeps} onChange={(e) => setForm({ ...form, sleeps: e.target.value })} min={0} /></div>
          </div>

          <SectionHeading>Pricing</SectionHeading>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group"><label className="form-label">Price From</label><input type="number" className="form-input" value={form.price_from} onChange={(e) => setForm({ ...form, price_from: e.target.value })} min={0} step="0.01" /></div>
            <div className="form-group"><label className="form-label">Currency</label>
              <select className="form-input" value={form.price_currency} onChange={(e) => setForm({ ...form, price_currency: e.target.value })}>
                <option value="ZAR">ZAR</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option>
              </select>
            </div>
          </div>

          <SectionHeading>Images</SectionHeading>
          <ImageManager
            propertyId={property.id || 'new'}
            heroImage={form.hero_image_url || null}
            galleryImages={(() => {
              if (Array.isArray(form.gallery_images)) return form.gallery_images;
              if (typeof form.gallery_images === 'string' && form.gallery_images.trim()) {
                try { const parsed = JSON.parse(form.gallery_images); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
              }
              return [];
            })()}
            onHeroChange={(url) => setForm({ ...form, hero_image_url: url || '' })}
            onGalleryChange={(urls) => setForm({ ...form, gallery_images: JSON.stringify(urls) })}
            supabase={supabase}
          />

          <SectionHeading>Amenities</SectionHeading>
          <div className="form-group"><label className="form-label">Amenity Tags (comma-separated)</label><input type="text" className="form-input" value={form.amenity_tags} onChange={(e) => setForm({ ...form, amenity_tags: e.target.value })} placeholder="pool, wifi, parking, pet-friendly" /></div>

          <SectionHeading>Links</SectionHeading>
          <div className="form-group"><label className="form-label">Booking URL</label><input type="url" className="form-input" value={form.booking_url} onChange={(e) => setForm({ ...form, booking_url: e.target.value })} placeholder="https://..." /></div>
          <div className="form-group"><label className="form-label">Listing Links (JSON)</label><textarea className="form-input" rows={3} value={form.listing_links} onChange={(e) => setForm({ ...form, listing_links: e.target.value })} placeholder='[{"platform": "airbnb", "url": "https://..."}]' /></div>

          <SectionHeading>Contact Override</SectionHeading>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <div className="form-group"><label className="form-label">Email</label><input type="email" className="form-input" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></div>
            <div className="form-group"><label className="form-label">Phone</label><input type="tel" className="form-input" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} /></div>
            <div className="form-group"><label className="form-label">WhatsApp</label><input type="tel" className="form-input" value={form.whatsapp_number} onChange={(e) => setForm({ ...form, whatsapp_number: e.target.value })} /></div>
          </div>

          <SectionHeading>Rating</SectionHeading>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <div className="form-group"><label className="form-label">External Rating</label><input type="number" className="form-input" value={form.external_rating} onChange={(e) => setForm({ ...form, external_rating: e.target.value })} min={0} max={5} step="0.1" /></div>
            <div className="form-group"><label className="form-label">Rating Source</label><input type="text" className="form-input" value={form.external_rating_source} onChange={(e) => setForm({ ...form, external_rating_source: e.target.value })} placeholder="e.g., Google, Airbnb" /></div>
            <div className="form-group"><label className="form-label">Review Count</label><input type="number" className="form-input" value={form.external_review_count} onChange={(e) => setForm({ ...form, external_review_count: e.target.value })} min={0} /></div>
          </div>

          <SectionHeading>Owner (Internal)</SectionHeading>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <div className="form-group"><label className="form-label">Owner Name</label><input type="text" className="form-input" value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} /></div>
            <div className="form-group"><label className="form-label">Owner Email</label><input type="email" className="form-input" value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })} /></div>
            <div className="form-group"><label className="form-label">Owner Phone</label><input type="tel" className="form-input" value={form.owner_phone} onChange={(e) => setForm({ ...form, owner_phone: e.target.value })} /></div>
          </div>

          <SectionHeading>Publishing</SectionHeading>
          <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', marginBottom: '0.75rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} />
              <span className="form-label" style={{ margin: 0 }}>Published</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_featured} onChange={(e) => setForm({ ...form, is_featured: e.target.checked })} />
              <span className="form-label" style={{ margin: 0 }}>Featured</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.pos_assured} onChange={(e) => setForm({ ...form, pos_assured: e.target.checked })} />
              <span className="form-label" style={{ margin: 0 }}>POS Assured</span>
            </label>
          </div>
          <div className="form-group" style={{ maxWidth: '120px' }}>
            <label className="form-label">Sort Order</label>
            <input type="number" className="form-input" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} min={0} />
          </div>

          <SectionHeading>Notes</SectionHeading>
          <div className="form-group">
            <textarea className="form-input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Internal notes..." />
          </div>
        </div>

        <div className="modal-footer">
          {!isNew && !showDeleteConfirm && (
            <button className="btn btn-outline" style={{ color: '#dc2626' }} onClick={() => setShowDeleteConfirm(true)}>Delete</button>
          )}
          {!isNew && showDeleteConfirm && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#dc2626', fontSize: '0.875rem' }}>Delete this property?</span>
              <button className="btn btn-outline" style={{ color: '#dc2626' }} onClick={handleDelete} disabled={deleting}>{deleting ? 'Deleting...' : 'Confirm Delete'}</button>
              <button className="btn btn-ghost" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
            </div>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
