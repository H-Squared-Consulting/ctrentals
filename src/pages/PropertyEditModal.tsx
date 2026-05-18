/* eslint-disable */
// @ts-nocheck
/**
 * PropertyEditModal -- Create / edit a property
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import GallerySectionsEditor, { deriveFlatColumns } from '../components/GallerySectionsEditor';
import { useToast } from '../components/ToastProvider';
import { PROPERTY_TYPE_OPTIONS, AVAILABILITY_OPTIONS, PLATFORM_NAME_OPTIONS } from './constants';
import type { Baseline, ChannelProfile } from '../types/pricing';

export default function PropertyEditModal({ property, partnerId, onClose, onSave, supabase, user }) {
  const toast = useToast();
  const isNew = !property.id;

  // Escape acts as a back button. Body scroll is locked while the editor
  // is open — the editor renders via a portal at document.body level, so
  // the underlying page shouldn't bleed through.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Track whether the body has scrolled past zero so the header can pick
  // up a subtle shadow / shrink — gives a "stuck" feel rather than a flat,
  // static bar.
  const bodyRef = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    function onScroll() { setScrolled(el.scrollTop > 4); }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

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
    bed_sizes: Array.isArray(property.bed_sizes) ? property.bed_sizes : [],
    price_from: property.price_from ?? '',
    price_currency: property.price_currency || 'ZAR',
    hero_image_url: property.hero_image_url || '',
    gallery_images: stringifyJSON(property.gallery_images),
    image_metadata: (property.image_metadata && typeof property.image_metadata === 'object' && !Array.isArray(property.image_metadata))
      ? property.image_metadata
      : {},
    // Section-grouped gallery (new canonical source). When the form is
    // saved, hero_image_url, gallery_images, and image_metadata are
    // derived from this on the fly so the brochure / proposal / public
    // website readers keep working unchanged.
    gallery_sections: Array.isArray(property.gallery_sections) ? property.gallery_sections : [],
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
    is_archived: property.is_archived || false,
    is_featured: property.is_featured || false,
    pos_assured: property.pos_assured || false,
    sort_order: property.sort_order ?? 0,
    notes: property.notes || '',
  });

  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Two-click confirm so a stray click doesn't permanently retire a
  // property. Auto-resets after a few seconds.
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  useEffect(() => {
    if (!confirmingArchive) return;
    const t = setTimeout(() => setConfirmingArchive(false), 5000);
    return () => clearTimeout(t);
  }, [confirmingArchive]);

  async function handleArchive() {
    if (isNew || !property.id) return;
    setSaving(true);
    try {
      // Archiving also forces unpublished so the property can never be
      // accidentally shown on the public site while retired.
      const { error } = await supabase
        .from('partner_properties')
        .update({ is_archived: true, is_published: false, updated_at: new Date().toISOString() })
        .eq('id', property.id);
      if (error) throw error;
      toast.success('Property archived');
      setConfirmingArchive(false);
      if (onSave) await onSave();
    } catch (err) {
      toast.error('Failed to archive: ' + (err?.message || err));
    } finally {
      setSaving(false);
    }
  }

  async function handleUnarchive() {
    if (isNew || !property.id) return;
    setSaving(true);
    try {
      // Coming back from Archived lands the property in Inactive
      // (is_archived=false, is_published=false). The user can then
      // flip the Publish toggle on the Listing tab when ready.
      const { error } = await supabase
        .from('partner_properties')
        .update({ is_archived: false, updated_at: new Date().toISOString() })
        .eq('id', property.id);
      if (error) throw error;
      toast.success('Property restored to Inactive');
      setForm(f => ({ ...f, is_archived: false }));
      if (onSave) await onSave();
    } catch (err) {
      toast.error('Failed to unarchive: ' + (err?.message || err));
    } finally {
      setSaving(false);
    }
  }

  // ── Tabs ──
  // Tabbed detail view per the UX spec. Overview is always available;
  // tabs that need a saved property (baselines, proposals, etc.) show a
  // friendly "save first" message instead of an empty UI.
  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'gallery', label: 'Gallery' },
    { id: 'listing', label: 'Listing' },
    { id: 'brochure', label: 'Brochure' },
    { id: 'pricing', label: 'Pricing' },
    { id: 'proposals', label: 'Proposals' },
    { id: 'documents', label: 'Documents' },
    { id: 'activity', label: 'Activity' },
  ];
  const [activeTab, setActiveTab] = useState('overview');

  // ── Proposals for this property (Proposals tab) ──
  const [proposals, setProposals] = useState([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  useEffect(() => {
    if (isNew || !property.id || activeTab !== 'proposals') return;
    let cancelled = false;
    setProposalsLoading(true);
    (async () => {
      const { data } = await supabase
        .from('proposals')
        .select('id, ref_code, guest_name, check_in, check_out, status, created_at')
        .eq('property_id', property.id)
        .order('created_at', { ascending: false });
      if (!cancelled) {
        setProposals(data || []);
        setProposalsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, property.id, isNew, supabase]);

  // ── Baselines ──
  const currentYear = new Date().getFullYear();
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [newBaseline, setNewBaseline] = useState({ year: currentYear, daily_rate: '', monthly_rate: '' });

  // ── Channel Profiles ──
  const [channelProfiles, setChannelProfiles] = useState<ChannelProfile[]>([]);
  const [newChannel, setNewChannel] = useState({ platform_name: '', platform_fee_pct: '', platform_fixed_fee: '', notes: '' });

  useEffect(() => {
    if (!property.id || isNew) return;
    async function loadPricingData() {
      const [blRes, chRes] = await Promise.all([
        supabase.from('baselines').select('*').eq('property_id', property.id).order('year', { ascending: false }),
        supabase.from('channel_profiles').select('*').eq('property_id', property.id).order('platform_name'),
      ]);
      if (blRes.data) setBaselines(blRes.data);
      if (chRes.data) setChannelProfiles(chRes.data);
    }
    loadPricingData();
  }, [property.id]);

  async function handleSaveBaseline() {
    if (!newBaseline.daily_rate || !newBaseline.monthly_rate) { toast.error('Both daily and monthly rates are required'); return; }
    try {
      const payload = {
        property_id: property.id,
        year: newBaseline.year,
        daily_rate: parseFloat(newBaseline.daily_rate),
        monthly_rate: parseFloat(newBaseline.monthly_rate),
        locked: true,
      };
      const { data, error } = await supabase.from('baselines').upsert(payload, { onConflict: 'property_id,year' }).select();
      if (error) throw error;
      setBaselines((prev) => {
        const filtered = prev.filter((b) => !(b.property_id === property.id && b.year === newBaseline.year));
        return [data[0], ...filtered].sort((a, b) => b.year - a.year);
      });
      setNewBaseline({ year: currentYear, daily_rate: '', monthly_rate: '' });
    } catch (err) {
      const raw = err?.message || String(err);
      if (raw.includes('BASELINE_LOCKED')) {
        toast.warning('This baseline is locked. Unlock it first to make changes.');
      } else {
        toast.error('Failed to save baseline: ' + raw);
      }
    }
  }

  async function handleToggleBaselineLock(bl) {
    try {
      const { error } = await supabase.from('baselines').update({ locked: !bl.locked, updated_at: new Date().toISOString() }).eq('id', bl.id);
      if (error) throw error;
      setBaselines((prev) => prev.map((b) => (b.id === bl.id ? { ...b, locked: !b.locked } : b)));
    } catch (err) {
      toast.error('Failed to update: ' + err.message);
    }
  }

  async function handleDeleteBaseline(id) {
    try {
      const { error } = await supabase.from('baselines').delete().eq('id', id);
      if (error) throw error;
      setBaselines((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      const raw = err?.message || String(err);
      if (raw.includes('BASELINE_LOCKED')) {
        toast.warning('This baseline is locked. Unlock it first to delete it.');
      } else {
        toast.error('Failed to delete: ' + raw);
      }
    }
  }

  async function handleSaveChannel() {
    if (!newChannel.platform_name) { toast.error('Platform name is required'); return; }
    try {
      const payload = {
        property_id: property.id,
        platform_name: newChannel.platform_name,
        platform_fee_pct: parseFloat(newChannel.platform_fee_pct) || 0,
        platform_fixed_fee: parseFloat(newChannel.platform_fixed_fee) || 0,
        notes: newChannel.notes.trim() || null,
      };
      const { data, error } = await supabase.from('channel_profiles').insert(payload).select();
      if (error) throw error;
      setChannelProfiles((prev) => [...prev, data[0]]);
      setNewChannel({ platform_name: '', platform_fee_pct: '', platform_fixed_fee: '', notes: '' });
    } catch (err) {
      toast.error('Failed to save channel: ' + err.message);
    }
  }

  async function handleDeleteChannel(id) {
    try {
      const { error } = await supabase.from('channel_profiles').delete().eq('id', id);
      if (error) throw error;
      setChannelProfiles((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      toast.error('Failed to delete: ' + err.message);
    }
  }

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
    if (!form.property_name.trim()) { toast.error('Property name is required'); return; }
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
        // Gallery: write the canonical sections column AND derive the
        // flat columns the brochure / proposal / public website still
        // read. Single edit surface, three columns kept in sync.
        gallery_sections: form.gallery_sections,
        ...deriveFlatColumns(form.gallery_sections),
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
        is_archived: form.is_archived,
        is_featured: form.is_featured,
        pos_assured: form.pos_assured,
        sort_order: parseInt(form.sort_order, 10) || 0,
        bed_sizes: form.bed_sizes.filter(b => b.room || b.bed),
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
      toast.success(isNew ? 'Property created' : 'Property saved');
      if (onSave) await onSave();
    } catch (err) {
      console.error('Error saving property:', err);
      toast.error('Failed to save: ' + err.message);
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
      toast.error('Failed to delete: ' + err.message);
    } finally {
      setDeleting(false);
    }
  }

  const SectionHeading = ({ children }) => (
    <h3 className="editor-section-heading">{children}</h3>
  );

  // Brochure section — preview link + share actions for an existing property.
  // The brochure is auto-generated from the photos + property fields, so this
  // is a read-only section (no edit layout). Used inside the property modal.
  const BrochureShare = ({ property, form }) => {
    const [copied, setCopied] = useState(false);
    const slug = property.slug || form.slug;
    const url = slug
      ? `${window.location.origin}/brochures/${encodeURIComponent(slug)}`
      : `${window.location.origin}/brochure.html?id=${encodeURIComponent(property.id)}`;
    const subject = encodeURIComponent(`${form.property_name || 'Property'} brochure`);
    const body = encodeURIComponent(`Have a look at this brochure: ${url}`);
    const waText = encodeURIComponent(`Brochure for ${form.property_name || 'this property'}: ${url}`);
    async function copy() {
      try { await navigator.clipboard.writeText(url); }
      catch { /* clipboard blocked — silently no-op */ }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
    return (
      <div className="brochure-share">
        <div className="brochure-share-url" title={url}>{url}</div>
        <div className="brochure-share-actions">
          <button type="button" className="btn btn-primary" onClick={copy} style={{ fontSize: '0.8125rem' }}>
            {copied ? '✓ Link copied' : '🔗 Copy link'}
          </button>
          <a className="btn btn-ghost" style={{ fontSize: '0.8125rem' }} href={url} target="_blank" rel="noopener noreferrer">
            👁 Open preview
          </a>
          <a className="btn btn-ghost" style={{ fontSize: '0.8125rem' }} href={`https://wa.me/?text=${waText}`} target="_blank" rel="noopener noreferrer">
            💬 WhatsApp
          </a>
          <a className="btn btn-ghost" style={{ fontSize: '0.8125rem' }} href={`mailto:?subject=${subject}&body=${body}`}>
            ✉️ Email
          </a>
        </div>
        <div className="brochure-share-hint">
          The brochure pulls photos + details from this property automatically — there's no separate brochure layout to edit. Save your changes before sharing.
        </div>
      </div>
    );
  };

  return createPortal((
    <div className="page-editor">
      <div className={`page-editor-header ${scrolled ? 'is-scrolled' : ''}`}>
        <button className="page-editor-back" onClick={onClose} aria-label="Back to properties">
          <span className="page-editor-back-arrow" aria-hidden>←</span>
          Back to properties
        </button>
        <h2 className="page-editor-title">
          {isNew ? 'New property' : form.property_name || 'Edit property'}
        </h2>
        <div className="page-editor-header-actions">
          {!isNew && (
            form.is_archived ? (
              <button
                className="btn btn-ghost"
                onClick={handleUnarchive}
                disabled={saving}
                title="Bring this property back into circulation as Inactive"
              >
                Unarchive
              </button>
            ) : confirmingArchive ? (
              <>
                <button className="btn btn-ghost" onClick={() => setConfirmingArchive(false)}>
                  Cancel
                </button>
                <button className="btn btn-danger" onClick={handleArchive} disabled={saving}>
                  Confirm archive
                </button>
              </>
            ) : (
              <button
                className="btn btn-danger"
                onClick={() => setConfirmingArchive(true)}
                disabled={saving}
                title="Archive — permanently retires this property"
              >
                Archive
              </button>
            )
          )}
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Tab bar — matches the sub-nav style elsewhere so the editor feels
          part of the platform rather than its own UI. */}
      <div className="page-editor-tabs">
        <div className="page-editor-tabs-inner">
          <div className="subnav" role="tablist">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                className={`subnav-link ${activeTab === t.id ? 'active' : ''}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="page-editor-body" ref={bodyRef}>
        <div className="page-editor-card">
          {activeTab === 'overview' && (<>
          <SectionHeading>Identity</SectionHeading>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Property Name *</label>
              <input type="text" className="form-input" value={form.property_name} onChange={(e) => handleNameChange(e.target.value)} placeholder="e.g., Seaside Villa 12" />
            </div>
            <div className="form-group">
              <label className="form-label">Unique ID</label>
              <input
                type="text"
                className="form-input"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="CTR0000"
              />
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

          <SectionHeading>Bed Sizes</SectionHeading>
          <div className="bed-sizes-editor">
            {form.bed_sizes.map((bed, i) => (
              <div key={i} className="bed-size-row">
                <input
                  type="text"
                  className="form-input"
                  value={bed.room || ''}
                  onChange={(e) => {
                    const updated = [...form.bed_sizes];
                    updated[i] = { ...updated[i], room: e.target.value };
                    setForm(prev => ({ ...prev, bed_sizes: updated }));
                  }}
                  placeholder="e.g. Master Bedroom"
                  style={{ flex: 1 }}
                />
                <select
                  className="form-input"
                  value={bed.bed || ''}
                  onChange={(e) => {
                    const updated = [...form.bed_sizes];
                    updated[i] = { ...updated[i], bed: e.target.value };
                    setForm(prev => ({ ...prev, bed_sizes: updated }));
                  }}
                  style={{ width: '140px' }}
                >
                  <option value="">Select size</option>
                  <option value="King">King</option>
                  <option value="Queen">Queen</option>
                  <option value="Double">Double</option>
                  <option value="Single">Single</option>
                  <option value="Twin (2x Single)">Twin (2x Single)</option>
                  <option value="Bunk Beds">Bunk Beds</option>
                  <option value="Sleeper Couch">Sleeper Couch</option>
                </select>
                <button
                  className="btn btn-ghost"
                  style={{ padding: '4px 8px', fontSize: '0.875rem', color: 'var(--error)' }}
                  onClick={() => {
                    const updated = form.bed_sizes.filter((_, j) => j !== i);
                    setForm(prev => ({ ...prev, bed_sizes: updated }));
                  }}
                >✕</button>
              </div>
            ))}
            <button
              className="btn btn-ghost"
              style={{ fontSize: '0.75rem', marginTop: '4px' }}
              onClick={() => setForm(prev => ({ ...prev, bed_sizes: [...prev.bed_sizes, { room: '', bed: '' }] }))}
            >+ Add Bedroom</button>
          </div>

          </>)}

          {activeTab === 'pricing' && (<>
          <SectionHeading>Price From</SectionHeading>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group"><label className="form-label">Price From</label><input type="number" className="form-input" value={form.price_from} onChange={(e) => setForm({ ...form, price_from: e.target.value })} min={0} step="0.01" /></div>
            <div className="form-group"><label className="form-label">Currency</label>
              <select className="form-input" value={form.price_currency} onChange={(e) => setForm({ ...form, price_currency: e.target.value })}>
                <option value="ZAR">ZAR</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option>
              </select>
            </div>
          </div>

          {isNew ? (
            <div className="editor-tab-empty">Save this property first to unlock detailed pricing (baselines, channel profiles, scenarios).</div>
          ) : (
            <>
              <SectionHeading>Baselines</SectionHeading>
              <div className="baseline-editor">
                {baselines.map((bl) => (
                  <div key={bl.id} className="baseline-row">
                    <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{bl.year}</div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Daily</label>
                      <div style={{ fontSize: '0.875rem' }}>R{Number(bl.daily_rate).toLocaleString()}</div>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Monthly</label>
                      <div style={{ fontSize: '0.875rem' }}>R{Number(bl.monthly_rate).toLocaleString()}</div>
                    </div>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: '0.6875rem', padding: '4px 8px' }}
                      onClick={() => handleToggleBaselineLock(bl)}
                    >
                      {bl.locked ? '🔒' : '🔓'}
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: '0.6875rem', padding: '4px 8px', color: 'var(--error)' }}
                      onClick={() => handleDeleteBaseline(bl.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="baseline-row" style={{ marginTop: '4px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Year</label>
                    <select className="form-input" value={newBaseline.year} onChange={(e) => setNewBaseline({ ...newBaseline, year: Number(e.target.value) })} style={{ width: '80px' }}>
                      {[currentYear, currentYear + 1].map((y) => (<option key={y} value={y}>{y}</option>))}
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Daily Rate</label>
                    <input type="number" className="form-input" value={newBaseline.daily_rate} onChange={(e) => setNewBaseline({ ...newBaseline, daily_rate: e.target.value })} min={0} step="0.01" placeholder="0.00" />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Monthly Rate</label>
                    <input type="number" className="form-input" value={newBaseline.monthly_rate} onChange={(e) => setNewBaseline({ ...newBaseline, monthly_rate: e.target.value })} min={0} step="0.01" placeholder="0.00" />
                  </div>
                  <button className="btn btn-primary" style={{ fontSize: '0.6875rem', padding: '4px 10px' }} onClick={handleSaveBaseline}>Save</button>
                  <div />
                </div>
              </div>

              <SectionHeading>Channel Profiles</SectionHeading>
              <div>
                {channelProfiles.map((ch) => (
                  <div key={ch.id} className="channel-row">
                    <div style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{ch.platform_name}</div>
                    <div style={{ fontSize: '0.8125rem' }}>{ch.platform_fee_pct}%</div>
                    <div style={{ fontSize: '0.8125rem' }}>R{ch.platform_fixed_fee}</div>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: '0.6875rem', padding: '4px 8px', color: 'var(--error)' }}
                      onClick={() => handleDeleteChannel(ch.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="channel-row" style={{ marginTop: '4px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Platform</label>
                    <select className="form-input" value={newChannel.platform_name} onChange={(e) => setNewChannel({ ...newChannel, platform_name: e.target.value })}>
                      <option value="">-- Select --</option>
                      {PLATFORM_NAME_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Fee %</label>
                    <input type="number" className="form-input" value={newChannel.platform_fee_pct} onChange={(e) => setNewChannel({ ...newChannel, platform_fee_pct: e.target.value })} min={0} step="0.1" placeholder="0" />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Fixed Fee</label>
                    <input type="number" className="form-input" value={newChannel.platform_fixed_fee} onChange={(e) => setNewChannel({ ...newChannel, platform_fixed_fee: e.target.value })} min={0} step="0.01" placeholder="0.00" />
                  </div>
                  <button className="btn btn-primary" style={{ fontSize: '0.6875rem', padding: '4px 10px' }} onClick={handleSaveChannel}>Add</button>
                </div>
              </div>
            </>
          )}
          </>)}

          {activeTab === 'gallery' && (<>
          <SectionHeading>Photos</SectionHeading>
          <GallerySectionsEditor
            propertyId={property.id || 'new'}
            sections={form.gallery_sections}
            onChange={(next) => setForm(prev => ({ ...prev, gallery_sections: next }))}
            supabase={supabase}
          />
          </>)}

          {activeTab === 'brochure' && (<>
          <SectionHeading>Brochure</SectionHeading>
          {isNew ? (
            <div className="editor-tab-empty">Save this property first — the brochure is auto-generated once it exists in the database.</div>
          ) : (
            <BrochureShare property={property} form={form} />
          )}
          </>)}

          {activeTab === 'overview' && (<>
          <SectionHeading>Amenities</SectionHeading>
          {(() => {
            // Parse current tags
            const currentTags = typeof form.amenity_tags === 'string'
              ? form.amenity_tags.split(',').map(t => t.trim()).filter(Boolean)
              : Array.isArray(form.amenity_tags) ? form.amenity_tags : [];

            const presets = [
              'WiFi','Pool','Hot tub','Free parking','Air conditioning','Fireplace','Kitchen',
              'Dishwasher','Washer','Dryer','TV','BBQ grill','Coffee maker','Iron','Bathtub',
              'Heating','Sun loungers','Outdoor dining','Outdoor furniture','Private patio',
              'Mountain view','Workspace','Housekeeping','Cleaning available','Single level home',
              'Pet friendly','Garden','Gym','Sauna','Fire pit','Pool table','Trampoline',
              'Private entrance','Sound system','Crib available',
            ];

            const updateTags = (tags) => setForm(prev => ({ ...prev, amenity_tags: tags.join(', ') }));
            const addTag = (tag) => { if (!currentTags.includes(tag)) updateTags([...currentTags, tag]); };
            const removeTag = (tag) => updateTags(currentTags.filter(t => t !== tag));

            const unusedPresets = presets.filter(p => !currentTags.includes(p));

            return (
              <div className="amenity-editor">
                {/* Active tags */}
                {currentTags.length > 0 && (
                  <div className="amenity-active">
                    {currentTags.map(tag => (
                      <span key={tag} className="amenity-tag amenity-tag--active" onClick={() => removeTag(tag)}>
                        {tag} <span className="amenity-tag-x">✕</span>
                      </span>
                    ))}
                  </div>
                )}
                {currentTags.length === 0 && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginBottom: '8px' }}>No amenities added yet. Click below to add.</div>
                )}

                {/* Custom input */}
                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Type custom amenity..."
                    style={{ flex: 1 }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const val = e.target.value.trim();
                        if (val) { addTag(val); e.target.value = ''; }
                      }
                    }}
                  />
                  <button className="btn btn-ghost" style={{ fontSize: '0.75rem' }} onClick={(e) => {
                    const input = e.target.previousSibling;
                    if (input && input.value.trim()) { addTag(input.value.trim()); input.value = ''; }
                  }}>+ Add</button>
                </div>

                {/* Preset suggestions */}
                {unusedPresets.length > 0 && (
                  <div className="amenity-presets">
                    <div className="amenity-presets-label">Quick add:</div>
                    <div className="amenity-presets-list">
                      {unusedPresets.map(tag => (
                        <span key={tag} className="amenity-tag amenity-tag--preset" onClick={() => addTag(tag)}>
                          + {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          </>)}

          {activeTab === 'listing' && (<>
          <SectionHeading>Publish status</SectionHeading>
          {form.is_archived ? (
            <div className="editor-tab-empty">
              <strong>This property is archived.</strong> Use the <em>Unarchive</em> button at the top to bring it back as Inactive before publishing.
            </div>
          ) : (
            <label className="editor-toggle">
              <input
                type="checkbox"
                checked={!!form.is_published}
                onChange={(e) => setForm({ ...form, is_published: e.target.checked })}
              />
              <span className="editor-toggle-track"><span className="editor-toggle-thumb" /></span>
              <span className="editor-toggle-label">
                {form.is_published
                  ? 'Active — visible on the public site and brochures'
                  : 'Inactive — temporarily hidden, can be reactivated any time'}
              </span>
            </label>
          )}

          {!isNew && (
            <>
              <SectionHeading>Public URL</SectionHeading>
              {(() => {
                const slug = property.slug || form.slug;
                const publicUrl = slug
                  ? `${window.location.origin}/brochures/${encodeURIComponent(slug)}`
                  : `${window.location.origin}/brochure.html?id=${encodeURIComponent(property.id)}`;
                return (
                  <div className="brochure-share">
                    <div className="brochure-share-url" title={publicUrl}>{publicUrl}</div>
                    <div className="brochure-share-actions">
                      <a className="btn btn-primary" style={{ fontSize: '0.8125rem' }} href={publicUrl} target="_blank" rel="noopener noreferrer">
                        👁 Open listing
                      </a>
                    </div>
                    <div className="brochure-share-hint">
                      A dedicated listing page is in production — for now the public brochure doubles as the property's public face.
                    </div>
                  </div>
                );
              })()}
            </>
          )}

          <SectionHeading>External listings</SectionHeading>
          <div className="form-group"><label className="form-label">Booking URL</label><input type="url" className="form-input" value={form.booking_url} onChange={(e) => setForm({ ...form, booking_url: e.target.value })} placeholder="https://..." /></div>
          <div className="form-group"><label className="form-label">Listing Links (JSON)</label><textarea className="form-input" rows={3} value={form.listing_links} onChange={(e) => setForm({ ...form, listing_links: e.target.value })} placeholder='[{"platform": "airbnb", "url": "https://..."}]' /></div>
          </>)}

          {activeTab === 'proposals' && (<>
          <SectionHeading>Proposals for this property</SectionHeading>
          {isNew ? (
            <div className="editor-tab-empty">Save this property first to start tracking proposals against it.</div>
          ) : proposalsLoading ? (
            <div className="editor-tab-empty">Loading…</div>
          ) : proposals.length === 0 ? (
            <div className="editor-tab-empty">No proposals yet for this property. Create one from a matched enquiry.</div>
          ) : (
            <div className="editor-list">
              {proposals.map(pr => (
                <a
                  key={pr.id}
                  className="editor-list-row"
                  href={`${window.location.origin}/proposal.html?ref=${pr.ref_code}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <div className="editor-list-main">
                    <div className="editor-list-title">{pr.guest_name || 'Unnamed guest'}</div>
                    <div className="editor-list-sub">
                      {new Date(pr.check_in).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
                      {' → '}
                      {new Date(pr.check_out).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                  <span className={`editor-list-badge editor-list-badge--${pr.status || 'draft'}`}>{pr.status || 'draft'}</span>
                </a>
              ))}
            </div>
          )}
          </>)}

          {activeTab === 'documents' && (<>
          <SectionHeading>Documents</SectionHeading>
          <div className="editor-tab-empty">
            <strong>Coming soon.</strong> Owner agreements, insurance, leases and any file stored against the property will live here.
          </div>
          </>)}

          {activeTab === 'activity' && (<>
          <SectionHeading>Activity</SectionHeading>
          <div className="editor-tab-empty">
            <strong>Coming soon.</strong> A chronological log of enquiries, proposals, bookings, status changes and notes for this property.
          </div>
          </>)}

        </div>
      </div>

    </div>
  ), document.body);
}
