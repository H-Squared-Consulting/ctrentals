/* eslint-disable */
// @ts-nocheck
/**
 * PropertyEditModal -- Create / edit a property
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import DetailModal from '../components/DetailModal';
import BrochureShareMenu from '../components/BrochureShareMenu';
import { useDirty } from '../lib/dirtyState';
import GallerySectionsEditor, { deriveFlatColumns } from '../components/GallerySectionsEditor';
import { useToast } from '../components/ToastProvider';
import { PROPERTY_TYPE_OPTIONS, AVAILABILITY_OPTIONS } from './constants';
import type { Baseline } from '../types/pricing';
import ProposalDetailModal from '../components/ProposalDetailModal';
import SendProposalDialog from '../components/SendProposalDialog';
import NewProposalLauncher from '../components/NewProposalLauncher';
import PricingModal from './PricingModal';
import BookingModal from './BookingModal';
import { fmtRand } from '../lib/pricingEngine';
import { notifyPipelineChanged } from '../lib/pipelineEvents';

export default function PropertyEditModal({ property, partnerId, onClose, onSave, supabase, user, initialMode = 'edit' }) {
  const toast = useToast();
  const isNew = !property.id;

  // Two operating modes:
  //   - 'view' opens the editor read-only — every input is disabled and
  //     only an "Edit" button lives in the header. Used when the user
  //     clicks anywhere on the property card.
  //   - 'edit' is the original behaviour — used when the user clicks the
  //     explicit Edit button on the card or for new-property creation.
  // The mode lives in component state (not just a prop) so the user can
  // flip from view → edit without us tearing the editor down.
  const [mode, setMode] = useState(isNew ? 'edit' : initialMode);
  const viewOnly = mode === 'view';

  // Unsaved-changes guard. We snapshot the initial form on mount; DetailModal
  // pops the dirty-check prompt on close. The snapshot is refreshed after a
  // successful Save so the user can keep editing without false-positive prompts.
  const initialFormRef = useRef(null);

  // CTR codes are the team's canonical property identifier (CTR0001, CTR0002…).
  // Generated at create time from `MAX(slug)` on the existing rows; locked
  // thereafter so the number on the team's master spreadsheet always lines
  // up with whatever's in the database. The old behaviour derived an
  // address-based kebab slug from the property name — abandoned because it
  // (a) drifted as names were edited and (b) didn't match the spreadsheet.

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
    owner_id: property.owner_id || '',
    is_featured: property.is_featured || false,
    pos_assured: property.pos_assured || false,
    sort_order: property.sort_order ?? 0,
    notes: property.notes || '',
  });

  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Snapshot the form the first time it renders so the dirty check has a
  // stable baseline. Updated again after each successful Save.
  useEffect(() => {
    if (initialFormRef.current === null) initialFormRef.current = form;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lock body scroll while the property editor is open. DetailModal +
  // ActionModal don't lock scroll themselves; the smaller modals usually
  // fit on screen so it isn't noticed, but the property editor is tall
  // and the page behind it scrolling along is disorienting. The cleanup
  // restores whatever overflow the body had before, which fires on
  // close, unmount, and route navigation.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Cheap deep compare via JSON. Form is shallow and primitive-heavy, so
  // serialisation is fine; if we ever add a Map/Set we'll need a real diff.
  const isDirty = useMemo(() => {
    if (!initialFormRef.current) return false;
    try {
      return JSON.stringify(form) !== JSON.stringify(initialFormRef.current);
    } catch {
      return false;
    }
  }, [form]);

  // Tell the silent auto-update reloader to defer a refresh while the
  // property editor has unsaved changes. DetailModal handles the dirty
  // close prompt itself; this registry call is purely for the global
  // auto-reload deferral.
  useDirty(isDirty);

  const [deleting, setDeleting] = useState(false);
  // Owner dropdown options for the Overview tab. Reloadable so an
  // owner created via the inline + button shows up immediately.
  const [owners, setOwners] = useState([]);
  async function loadOwners() {
    const { data } = await supabase
      .from('home_owners')
      .select('id, name, company, vat_number')
      .eq('partner_id', partnerId)
      .order('name');
    if (data) setOwners(data);
  }
  useEffect(() => { loadOwners(); }, [supabase, partnerId]);

  // Inline "Create owner" form state. Lightweight: name + company +
  // VAT + email + phone. Full record can be filled in later from the
  // CRM page if needed.
  const [showOwnerCreate, setShowOwnerCreate] = useState(false);
  const [ownerDraft, setOwnerDraft] = useState({ name: '', company: '', vat_number: '', email: '', phone: '' });
  const [creatingOwner, setCreatingOwner] = useState(false);
  async function createOwnerInline() {
    if (!ownerDraft.name.trim()) { toast.error('Owner name is required'); return; }
    setCreatingOwner(true);
    try {
      const payload = {
        partner_id: partnerId,
        name: ownerDraft.name.trim(),
        company: ownerDraft.company.trim() || null,
        vat_number: ownerDraft.vat_number.trim() || null,
        email: ownerDraft.email.trim() || null,
        phone: ownerDraft.phone.trim() || null,
      };
      const { data, error } = await supabase.from('home_owners').insert(payload).select().single();
      if (error) throw error;

      // Immediately persist the link to partner_properties.owner_id so the
      // user doesn't have to remember to click Save on the property editor
      // afterwards. For brand-new properties (no id yet) we just stash the
      // id on the form — handleSave's payload writes owner_id on insert.
      if (!isNew && property.id) {
        const { error: linkErr } = await supabase
          .from('partner_properties')
          .update({ owner_id: data.id, updated_at: new Date().toISOString() })
          .eq('id', property.id);
        if (linkErr) throw linkErr;
      }

      await loadOwners();
      setForm(f => ({ ...f, owner_id: data.id }));
      setOwnerDraft({ name: '', company: '', vat_number: '', email: '', phone: '' });
      setShowOwnerCreate(false);
      toast.success(`${data.name} added and linked`);
    } catch (err) {
      toast.error('Failed to create owner: ' + (err?.message || err));
    } finally {
      setCreatingOwner(false);
    }
  }
  // Two-click confirm so a stray click doesn't permanently retire a
  // property. Auto-resets after a few seconds.
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  useEffect(() => {
    if (!confirmingArchive) return;
    const t = setTimeout(() => setConfirmingArchive(false), 5000);
    return () => clearTimeout(t);
  }, [confirmingArchive]);

  // Auto-allocate the next CTR code for newly-created properties. Runs once
  // per mount: queries the highest existing CTR#### across all properties
  // (archived included — we never reuse a number), bumps it, zero-pads to
  // 4 digits. The field shows the result immediately and stays disabled
  // through save so the user never types a duplicate.
  useEffect(() => {
    if (!isNew) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('partner_properties')
        .select('slug')
        .like('slug', 'CTR%')
        .order('slug', { ascending: false })
        .limit(1);
      const lastSlug: string | undefined = data?.[0]?.slug;
      const lastNum = lastSlug ? parseInt(lastSlug.replace(/\D/g, ''), 10) : 0;
      const next = `CTR${String((isNaN(lastNum) ? 0 : lastNum) + 1).padStart(4, '0')}`;
      if (!cancelled) setForm(f => ({ ...f, slug: next }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew]);

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
    { id: 'proposals', label: 'Proposals' },
    { id: 'bookings', label: 'Bookings' },
  ];
  const [activeTab, setActiveTab] = useState('overview');

  // ── Proposals for this property (Proposals tab) ──
  // Joins through pricing_proposals via the FK so the row can surface the
  // per-night price + Owner/CTR breakdown when clicked. Without the join the
  // tab is just names + dates, no commercial context.
  const [proposals, setProposals] = useState([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [editPricingFor, setEditPricingFor] = useState(null);
  /** Proposal in the inline-send confirmation dialog. */
  const [sendingProposal, setSendingProposal] = useState(null);
  /** Opens the shared NewProposalLauncher (property-picker → PricingModal)
   *  so the New Proposal flow inside the Property modal matches the one
   *  on the Proposals page / FAB. */
  const [proposalLauncherOpen, setProposalLauncherOpen] = useState(false);
  /** Opens the shared BookingModal pre-scoped to this property so the
   *  New Booking flow matches the one on the Bookings calendar. */
  const [editingBooking, setEditingBooking] = useState<any>(null);
  /** Opens the shared <BrochureShareMenu> from the Links section. Same
   *  modal the property card uses, so the share experience is identical
   *  whether entered from the card or from inside the editor. */
  const [sharingBrochure, setSharingBrochure] = useState(false);

  async function refetchProposals() {
    const { data } = await supabase
      .from('proposals')
      .select('*, pricing_proposals(client_price_excl_vat, scenario_type, season_tag, owner_net, company_take, agents)')
      .eq('property_id', property.id)
      .order('created_at', { ascending: false });
    const mapped = (data || []).map((p) => ({
      ...p,
      property_name: property.property_name,
      guest_price: p.pricing_proposals?.client_price_excl_vat ?? null,
      scenario_type: p.pricing_proposals?.scenario_type ?? null,
      season_tag: p.pricing_proposals?.season_tag ?? null,
      owner_net: p.pricing_proposals?.owner_net ?? null,
      company_take: p.pricing_proposals?.company_take ?? null,
      agents: p.pricing_proposals?.agents ?? null,
    }));
    setProposals(mapped);
  }

  useEffect(() => {
    if (isNew || !property.id || activeTab !== 'proposals') return;
    let cancelled = false;
    setProposalsLoading(true);
    (async () => {
      await refetchProposals();
      if (!cancelled) setProposalsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activeTab, property.id, isNew, supabase]);

  /** Inline outcome flip — matches Pipeline's "Mark Booked" / Cancel UX.
   *  No confirmation dialog; the action is a single intentional click and
   *  Reopen lives in the proposal detail modal if it needs reversing. */
  async function setProposalOutcome(proposalId, outcome) {
    const update = outcome === 'booked' || outcome === 'cancelled'
      ? { status: outcome }
      : { status: 'draft' };
    await supabase.from('proposals').update(update).eq('id', proposalId);
    notifyPipelineChanged();
    refetchProposals();
  }

  // ── Baselines ──
  const currentYear = new Date().getFullYear();
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [newBaseline, setNewBaseline] = useState({ year: currentYear, daily_rate: '', monthly_rate: '' });

  useEffect(() => {
    if (!property.id || isNew) return;
    async function loadPricingData() {
      const { data } = await supabase.from('baselines').select('*').eq('property_id', property.id).order('year', { ascending: false });
      if (data) setBaselines(data);
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

  // Inline edit state for unlocked baselines. baselineEdits[id] holds the
  // in-flight daily/monthly values while the user is editing.
  const [baselineEdits, setBaselineEdits] = useState({});
  async function handleUpdateBaseline(bl) {
    const edit = baselineEdits[bl.id];
    if (!edit) return;
    const daily = parseFloat(edit.daily_rate);
    const monthly = parseFloat(edit.monthly_rate);
    if (!(daily > 0) || !(monthly > 0)) { toast.error('Daily and monthly rates must be positive numbers'); return; }
    try {
      const { error } = await supabase
        .from('baselines')
        .update({ daily_rate: daily, monthly_rate: monthly, updated_at: new Date().toISOString() })
        .eq('id', bl.id);
      if (error) throw error;
      setBaselines((prev) => prev.map((b) => (b.id === bl.id ? { ...b, daily_rate: daily, monthly_rate: monthly } : b)));
      setBaselineEdits((prev) => { const next = { ...prev }; delete next[bl.id]; return next; });
      toast.success('Baseline updated');
    } catch (err) {
      const raw = err?.message || String(err);
      if (raw.includes('BASELINE_LOCKED')) {
        toast.warning('This baseline is locked. Unlock it first.');
      } else {
        toast.error('Failed to update: ' + raw);
      }
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

  function handleNameChange(value) {
    // Slug stays put — CTR codes are independent of the property name now.
    setForm({ ...form, property_name: value });
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
        slug: form.slug.trim(),
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
        owner_id: form.owner_id || null,
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
      // Refresh the dirty baseline so the user can keep editing without
      // false-positive "unsaved changes" prompts.
      initialFormRef.current = form;
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

  // Visual state cues passed to the shared <DetailModal> shell.
  // Accent strip colour mirrors the property's published state so the
  // user gets an immediate read on whether the property is live.
  const accentColour = form.is_archived
    ? 'var(--text-light)'
    : form.is_published
    ? 'var(--success)'
    : 'var(--info)';
  const stageLabel = form.is_archived ? 'Archived' : form.is_published ? 'Active' : 'Inactive';
  const closedBadge = form.is_archived ? (
    <span className="detail-modal-mode-badge detail-modal-mode-badge--closed">Archived</span>
  ) : undefined;
  const banner = form.is_archived ? (
    <div className="detail-modal-banner" style={{ background: 'var(--bg)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }}>
      This property is <strong>archived</strong> — retired from your inventory. Use <em>Unarchive</em> below to bring it back as Inactive (hidden but easy to reactivate).
    </div>
  ) : undefined;
  // Archive flow lives in the footer alongside Save / Cancel via the
  // shared DetailModal footer slot. Matches where outcome actions live
  // on the other detail modals (Mark Booked / Mark Lost on deals etc.).
  const footerActions = !isNew ? (
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
          Cancel archive
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
        title="Archive — retire from your inventory entirely (sold, contract ended). Different from Inactive: archived properties also drop off your main lists."
      >
        Archive
      </button>
    )
  ) : undefined;

  return (
    <>
      <DetailModal
        title={isNew ? 'New property' : form.property_name || 'Property'}
        subtitle={isNew ? undefined : stageLabel}
        accentColour={accentColour}
        mode={viewOnly ? 'view' : 'edit'}
        onModeChange={(m) => {
          if (m === 'view' && isDirty) {
            const ok = window.confirm('You have unsaved changes. Discard them?');
            if (!ok) return;
            if (initialFormRef.current) setForm(initialFormRef.current);
          }
          setMode(m);
        }}
        canEdit={!form.is_archived}
        isDirty={isDirty || isNew}
        onSave={handleSave}
        onCancel={() => {
          if (isDirty) {
            const ok = window.confirm('You have unsaved changes. Discard them?');
            if (!ok) return;
          }
          if (initialFormRef.current) setForm(initialFormRef.current);
          setMode('view');
        }}
        closedBadge={closedBadge}
        banner={banner}
        footerActions={footerActions}
        onClose={onClose}
      >
        {/* Tab nav — sits at the top of the modal body so the user can
            switch concerns without leaving the modal. */}
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

        <div className={`page-editor-card ${viewOnly ? 'page-editor-card--view' : ''}`}>
          {activeTab === 'overview' && (<>
          {/* Links section sits OUTSIDE the per-tab fieldset so the Share
              brochure button stays clickable in view mode. The publish toggle
              and external URL input inside handle viewOnly explicitly. */}
          <SectionHeading>Links</SectionHeading>
          <PropertyLinksSection
            property={property}
            form={form}
            isNew={isNew}
            viewOnly={viewOnly}
            onPublishChange={(checked) => setForm({ ...form, is_published: checked })}
            onBookingUrlChange={(v) => setForm({ ...form, booking_url: v })}
            onShare={() => setSharingBrochure(true)}
          />

          <fieldset disabled={viewOnly} className="page-editor-fieldset">
          <SectionHeading>Identity</SectionHeading>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Property Name *</label>
              <input type="text" className="form-input" value={form.property_name} onChange={(e) => handleNameChange(e.target.value)} placeholder="e.g., Seaside Villa 12" />
            </div>
            <div className="form-group">
              <label className="form-label">
                Unique ID
                <span style={{ marginLeft: '6px', fontSize: '0.625rem', color: 'var(--text-light)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                  🔒 auto-generated
                </span>
              </label>
              <input
                type="text"
                className="form-input"
                value={form.slug}
                readOnly
                disabled
                title="Locked — CTR codes are auto-allocated and must match the team spreadsheet."
                style={{ background: 'var(--border-light)', cursor: 'not-allowed', color: 'var(--text-secondary)' }}
                placeholder={isNew ? 'Allocating…' : 'CTR0000'}
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
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Owner</span>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: '0.6875rem', padding: '2px 8px' }}
                onClick={() => setShowOwnerCreate(s => !s)}
              >
                {showOwnerCreate ? '× Cancel' : '+ New owner'}
              </button>
            </label>
            <select
              className="form-input"
              value={form.owner_id}
              onChange={(e) => setForm({ ...form, owner_id: e.target.value })}
              disabled={showOwnerCreate}
            >
              <option value="">— No owner linked —</option>
              {owners.map(o => (
                <option key={o.id} value={o.id}>
                  {o.name}{o.company ? ` (${o.company})` : ''}
                </option>
              ))}
            </select>

            {showOwnerCreate && (
              <div style={{ marginTop: 'var(--s-3)', padding: 'var(--s-3)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 'var(--s-2)' }}>
                  Quick add — the full record can be edited later in CRM &rarr; Home Owners.
                </div>
                <div className="form-group" style={{ marginBottom: 'var(--s-2)' }}>
                  <label className="form-label">Name *</label>
                  <input className="form-input" autoFocus value={ownerDraft.name} onChange={(e) => setOwnerDraft({ ...ownerDraft, name: e.target.value })} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-2)' }}>
                  <div className="form-group" style={{ marginBottom: 'var(--s-2)' }}>
                    <label className="form-label">Company</label>
                    <input className="form-input" value={ownerDraft.company} onChange={(e) => setOwnerDraft({ ...ownerDraft, company: e.target.value })} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 'var(--s-2)' }}>
                    <label className="form-label">VAT No.</label>
                    <input className="form-input" value={ownerDraft.vat_number} onChange={(e) => setOwnerDraft({ ...ownerDraft, vat_number: e.target.value })} placeholder="Only if listed under a company" />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-2)' }}>
                  <div className="form-group" style={{ marginBottom: 'var(--s-2)' }}>
                    <label className="form-label">Email</label>
                    <input className="form-input" type="email" value={ownerDraft.email} onChange={(e) => setOwnerDraft({ ...ownerDraft, email: e.target.value })} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 'var(--s-2)' }}>
                    <label className="form-label">Phone</label>
                    <input className="form-input" value={ownerDraft.phone} onChange={(e) => setOwnerDraft({ ...ownerDraft, phone: e.target.value })} />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--s-2)' }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setShowOwnerCreate(false)} disabled={creatingOwner}>Cancel</button>
                  <button type="button" className="btn btn-primary" onClick={createOwnerInline} disabled={creatingOwner}>
                    {creatingOwner ? 'Adding…' : 'Add owner'}
                  </button>
                </div>
              </div>
            )}
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

          </fieldset>
          </>)}

          {activeTab === 'gallery' && (
          <fieldset disabled={viewOnly} className="page-editor-fieldset">
          <SectionHeading>Photos</SectionHeading>
          <GallerySectionsEditor
            propertyId={property.id || 'new'}
            sections={form.gallery_sections}
            onChange={(next) => setForm(prev => ({ ...prev, gallery_sections: next }))}
            supabase={supabase}
            viewOnly={viewOnly}
          />
          </fieldset>
          )}

          {activeTab === 'overview' && (
          <fieldset disabled={viewOnly} className="page-editor-fieldset">
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
                {/* Active tags. In view mode the chips render without the ✕
                    affordance and without the remove-on-click handler — the
                    wrapping <fieldset disabled> only stops native form
                    controls, so the span clicks would otherwise stay live. */}
                {currentTags.length > 0 && (
                  <div className="amenity-active">
                    {currentTags.map(tag => (
                      <span
                        key={tag}
                        className="amenity-tag amenity-tag--active"
                        onClick={viewOnly ? undefined : () => removeTag(tag)}
                        style={viewOnly ? { cursor: 'default' } : undefined}
                      >
                        {tag}
                        {!viewOnly && <span className="amenity-tag-x">✕</span>}
                      </span>
                    ))}
                  </div>
                )}
                {currentTags.length === 0 && !viewOnly && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginBottom: '8px' }}>No amenities added yet. Click below to add.</div>
                )}
                {currentTags.length === 0 && viewOnly && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>No amenities listed.</div>
                )}

                {/* Custom input + preset suggestions only make sense in edit
                    mode — they're affordances for adding tags, which view
                    mode doesn't permit. */}
                {!viewOnly && (
                  <>
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
                  </>
                )}
              </div>
            );
          })()}

          </fieldset>
          )}

          {activeTab === 'proposals' && (<>
          {/* Proposals tab sits OUTSIDE any fieldset — the + New Proposal,
              Mark Booked and Cancel buttons are outcome actions, not edits
              to the property record, so they remain clickable in view mode. */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
            <SectionHeading>Proposals for this property</SectionHeading>
            {!isNew && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: '0.75rem', flexShrink: 0 }}
                onClick={() => setProposalLauncherOpen(true)}
              >
                + New Proposal
              </button>
            )}
          </div>
          {isNew ? (
            <div className="editor-tab-empty">Save this property first to start tracking proposals against it.</div>
          ) : proposalsLoading ? (
            <div className="editor-tab-empty">Loading…</div>
          ) : proposals.length === 0 ? (
            <div className="editor-tab-empty">
              No proposals yet for this property. Use <strong>+ New Proposal</strong> above to start one.
            </div>
          ) : (
            <PropertyProposalsList
              proposals={proposals}
              onOpen={setSelectedProposal}
              onSend={setSendingProposal}
              onMarkBooked={(p) => setProposalOutcome(p.id, 'booked')}
              onCancel={(p) => setProposalOutcome(p.id, 'cancelled')}
            />
          )}
          </>)}

          {activeTab === 'bookings' && (<>
          {/* Mirrors the Proposals tab — same heading + button + empty
              state shape. + New Booking opens the shared BookingModal
              (same one the Bookings calendar uses) pre-scoped to this
              property. */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
            <SectionHeading>Bookings for this property</SectionHeading>
            {!isNew && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: '0.75rem', flexShrink: 0 }}
                onClick={() => setEditingBooking({ property_id: property.id })}
              >
                + New Booking
              </button>
            )}
          </div>
          {isNew ? (
            <div className="editor-tab-empty">Save this property first to start tracking bookings against it.</div>
          ) : (
            <div className="editor-tab-empty">
              No bookings yet for this property. Use <strong>+ New Booking</strong> above to start one.
            </div>
          )}
          </>)}

        </div>
      </DetailModal>

      {selectedProposal && (
        <ProposalDetailModal
          proposal={selectedProposal}
          supabase={supabase}
          onClose={() => setSelectedProposal(null)}
          onChange={refetchProposals}
          onEditPricing={async () => {
            if (!selectedProposal.pricing_proposal_id) return;
            const { data } = await supabase
              .from('pricing_proposals')
              .select('*')
              .eq('id', selectedProposal.pricing_proposal_id)
              .single();
            if (data) {
              setEditPricingFor(data);
              setSelectedProposal(null);
            }
          }}
        />
      )}

      {editPricingFor && (
        <PricingModal
          property={{ id: property.id, property_name: property.property_name }}
          supabase={supabase}
          editPricingProposal={editPricingFor}
          onClose={() => setEditPricingFor(null)}
          onPricingSaved={() => { setEditPricingFor(null); refetchProposals(); }}
        />
      )}

      {proposalLauncherOpen && (
        <NewProposalLauncher
          onClose={() => { setProposalLauncherOpen(false); refetchProposals(); }}
        />
      )}

      {editingBooking && (
        <BookingModal
          booking={editingBooking}
          properties={[property]}
          supabase={supabase}
          user={user}
          partnerId={partnerId}
          onClose={() => setEditingBooking(null)}
          onSave={() => setEditingBooking(null)}
        />
      )}

      {sendingProposal && (
        <SendProposalDialog
          proposal={{
            id: sendingProposal.id,
            ref_code: sendingProposal.ref_code,
            property_name: property.property_name,
            guest_name: sendingProposal.guest_name,
            guest_email: sendingProposal.guest_email,
            guest_phone: sendingProposal.guest_phone,
            is_agent: !!sendingProposal.is_agent,
          }}
          supabase={supabase}
          onClose={() => setSendingProposal(null)}
          onSent={() => { setSendingProposal(null); refetchProposals(); }}
        />
      )}

      {sharingBrochure && (
        <BrochureShareMenu
          property={{
            id: property.id,
            slug: property.slug || form.slug,
            property_name: form.property_name || property.property_name,
            hero_image_url: property.hero_image_url || form.hero_image_url,
            suburb: form.suburb,
            city: form.city,
          }}
          onClose={() => setSharingBrochure(false)}
        />
      )}
    </>
  );
}

// ─── Proposals list (grouped by Pipeline stage) ─────────────────────────
// Mirrors the Pipeline page so users can act on a proposal without leaving
// the property editor. Stages match the Kanban column labels exactly so
// the mental model is consistent.

// ─── Links section ──────────────────────────────────────────────────────
// Lives at the top of the Overview tab. Surfaces every URL associated with
// the property in one logical place: publish status, public listing page,
// brochure variants (branded / agent), external listing platform.
//
// New properties don't yet have a slug, so the share URLs can't be built.
// In that case we show a friendly "save first" message instead of empty rows.

/** Editable URL input with inline Copy / Open buttons. Used for the
 *  external listing field where the user types the URL themselves. */
function ExternalUrlInput({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (v: string) => void }) {
  const [copied, setCopied] = useState(false);
  const trimmed = (value || '').trim();
  const isValid = /^https?:\/\//i.test(trimmed);
  async function copy() {
    if (!trimmed) return;
    try { await navigator.clipboard.writeText(trimmed); }
    catch { /* clipboard blocked — silently no-op */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="property-url-input-row">
      <input
        type="url"
        className="form-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://..."
        disabled={disabled}
      />
      <button
        type="button"
        className="btn btn-ghost"
        onClick={copy}
        disabled={!trimmed}
        title={trimmed ? 'Copy this URL' : 'Add a URL to copy'}
      >
        {copied ? '✓ Copied' : '🔗 Copy'}
      </button>
      {isValid ? (
        <a
          className="btn btn-ghost"
          href={trimmed}
          target="_blank"
          rel="noopener noreferrer"
          title="Open this URL in a new tab"
        >
          👁 Open
        </a>
      ) : (
        <button
          type="button"
          className="btn btn-ghost"
          disabled
          title={trimmed ? 'Enter a full URL starting with https://' : 'Add a URL to open'}
        >
          👁 Open
        </button>
      )}
    </div>
  );
}

function LinkRow({ label, hint, url, disabled }: { label: string; hint?: string; url?: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); }
    catch { /* clipboard blocked — silently no-op */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className={`property-link-row${disabled ? ' is-disabled' : ''}`}>
      <div className="property-link-meta">
        <span className="property-link-label">{label}</span>
        {hint && <span className="property-link-hint">{hint}</span>}
      </div>
      <div className="property-link-actions">
        {disabled || !url ? (
          <span className="property-link-pending">Not yet available</span>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={copy} title={`Copy ${label.toLowerCase()} link`}>
              {copied ? '✓ Copied' : '🔗 Copy link'}
            </button>
            <a className="btn btn-ghost" href={url} target="_blank" rel="noopener noreferrer" title={`Open ${label.toLowerCase()} in a new tab`}>
              👁 Open
            </a>
          </>
        )}
      </div>
    </div>
  );
}

function PropertyLinksSection({
  property, form, isNew, viewOnly, onPublishChange, onBookingUrlChange, onShare,
}: {
  property: any;
  form: any;
  isNew: boolean;
  viewOnly: boolean;
  onPublishChange: (checked: boolean) => void;
  onBookingUrlChange: (value: string) => void;
  onShare: () => void;
}) {
  const canShare = !isNew && !form.is_archived;

  return (
    <div className="property-links">
      {!form.is_archived && (
        <div className="property-links-toprow">
          <label className="editor-toggle">
            <input
              type="checkbox"
              checked={!!form.is_published}
              onChange={(e) => onPublishChange(e.target.checked)}
              disabled={viewOnly}
            />
            <span className="editor-toggle-track"><span className="editor-toggle-thumb" /></span>
            <span className="editor-toggle-label">
              {form.is_published
                ? 'Active — visible to guests on the public site and shareable brochures'
                : 'Inactive — hidden from guests but kept in your inventory. Flip back on any time'}
            </span>
          </label>
          {canShare && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onShare}
              title="Share this property's brochure (branded or agent variant)"
            >
              📤 Share brochure
            </button>
          )}
        </div>
      )}

      {isNew ? (
        <div className="editor-tab-empty">
          Save this property first. The listing URL is generated automatically once the property exists in the database.
        </div>
      ) : (
        <LinkRow
          label="Southern Escapes public listing page"
          hint="Coming soon"
          disabled
        />
      )}

      <div className="form-group" style={{ marginTop: '14px', marginBottom: 0 }}>
        <label className="form-label">External listing URL</label>
        <ExternalUrlInput
          value={form.booking_url}
          disabled={viewOnly}
          onChange={onBookingUrlChange}
        />
        <div className="form-hint" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
          Where this property is listed externally (Airbnb, Booking.com, etc). One link for now — multi-platform support is coming.
        </div>
      </div>
    </div>
  );
}

const PROPERTY_PROPOSAL_STAGES = [
  { key: 'quoted',     label: 'Proposal created', tone: 'draft' },
  { key: 'sent',       label: 'Proposal Sent',    tone: 'sent' },
  { key: 'interested', label: 'Interested',       tone: 'interested' },
  { key: 'closed',     label: 'Closed',           tone: 'closed' },
];

function stageForProposal(p) {
  if (p.status === 'booked' || p.status === 'cancelled' || p.status === 'expired' || p.status === 'archived') return 'closed';
  if (p.status === 'interested') return 'interested';
  if (p.status === 'sent' || p.status === 'viewed') return 'sent';
  return 'quoted'; // draft (or anything unknown)
}

function PropertyProposalsList({ proposals, onOpen, onSend, onMarkBooked, onCancel }) {
  // Group proposals by Pipeline stage. Empty stages are skipped to avoid a
  // wall of empty section headers — but the order matches Pipeline so the
  // user's eye lands where they expect.
  const grouped = {};
  for (const p of proposals) {
    const stage = stageForProposal(p);
    (grouped[stage] = grouped[stage] || []).push(p);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {PROPERTY_PROPOSAL_STAGES.filter(s => grouped[s.key]?.length).map(stage => (
        <div key={stage.key}>
          <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '6px' }}>
            {stage.label} <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>({grouped[stage.key].length})</span>
          </div>
          <div className="editor-list">
            {grouped[stage.key].map(pr => (
              <PropertyProposalRow
                key={pr.id}
                proposal={pr}
                stage={stage.key}
                onOpen={onOpen}
                onSend={onSend}
                onMarkBooked={onMarkBooked}
                onCancel={onCancel}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PropertyProposalRow({ proposal: pr, stage, onOpen, onSend, onMarkBooked, onCancel }) {
  const stop = (fn) => (e) => { e.stopPropagation(); fn(pr); };

  // Stage-appropriate primary action — same logic the Pipeline card uses.
  // Drafts get Send; interested gets Mark Booked + Cancel; sent stays silent
  // (the next move is the recipient's). Closed/booked/cancelled show no
  // inline action — open the detail modal to reopen if needed.
  const actions = [];
  if (stage === 'quoted') {
    actions.push({ label: '📤 Send proposal', primary: true, onClick: onSend });
  } else if (stage === 'interested') {
    actions.push({ label: '✓ Mark Booked', primary: true, onClick: onMarkBooked, color: '#065F46' });
    actions.push({ label: '✕ Cancel', primary: false, onClick: onCancel, color: '#991B1B' });
  }

  return (
    <div
      className="editor-list-row"
      onClick={() => onOpen(pr)}
      style={{ cursor: 'pointer' }}
    >
      <div className="editor-list-main">
        <div className="editor-list-title">
          {pr.guest_name || 'Unnamed recipient'}
          {pr.is_agent && <span className="status-badge" style={{ background: '#E0E7FF', color: '#3730A3', marginLeft: '6px', fontSize: '0.5625rem' }}>Agent</span>}
        </div>
        <div className="editor-list-sub">
          {pr.check_in && pr.check_out
            ? <>{new Date(pr.check_in).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })} → {new Date(pr.check_out).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}</>
            : <span style={{ color: 'var(--text-light)' }}>No dates set</span>}
          {pr.guest_price != null && (
            <span style={{ marginLeft: '10px', color: 'var(--text)' }}>
              · <strong>{fmtRand(pr.guest_price)}</strong> / night
              {pr.scenario_type && <span style={{ color: 'var(--text-light)' }}> · {pr.scenario_type}</span>}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        {actions.map((a, i) => (
          <button
            key={i}
            type="button"
            className={a.primary ? 'btn btn-outline' : 'btn btn-ghost'}
            style={{ fontSize: '0.6875rem', padding: '4px 10px', whiteSpace: 'nowrap', color: a.color, borderColor: a.color }}
            onClick={stop(a.onClick)}
          >
            {a.label}
          </button>
        ))}
        <span className={`editor-list-badge editor-list-badge--${pr.status || 'draft'}`}>{pr.status || 'draft'}</span>
      </div>
    </div>
  );
}
